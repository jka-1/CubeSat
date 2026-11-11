import {MeshDepthMaterial,LessEqualDepth} from 'three';

export function cheapOccluder(mesh){
 const mat=mesh.material,triangles=(mesh.geometry?.index?.count||mesh.geometry?.attributes.position?.count||0)/3;
 return mesh.isMesh&&!mesh.isSkinnedMesh&&!Array.isArray(mat)&&triangles<=512&&mat.visible&&!mat.transparent&&mat.depthWrite&&mat.depthTest&&mat.depthFunc===LessEqualDepth&&!mat.alphaTest&&!mat.alphaHash&&!mat.alphaToCoverage&&!mat.displacementMap&&!mat.polygonOffset&&!mat.clippingPlanes?.length;
}

export function installCheapOcclusion(renderer,scene){
 const depth=new MeshDepthMaterial({colorWrite:false}),prepared=new WeakSet(),state={frames:0,occluders:0,triangles:0};
 depth.onBeforeCompile=shader=>{shader.vertexShader='#undef USE_LOGDEPTHBUF\ninvariant gl_Position;\n'+shader.vertexShader;shader.fragmentShader='#undef USE_LOGDEPTHBUF\n'+shader.fragmentShader};
 depth.onBeforeRender=function(renderer,scene,camera,geometry,object){if(this.side!==object.material.side){this.side=object.material.side;this.needsUpdate=true}};
 function prepareMaterial(mat){
  if(prepared.has(mat))return;
  const compile=mat.onBeforeCompile;mat.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);shader.vertexShader='invariant gl_Position;\n'+shader.vertexShader};mat.needsUpdate=true;prepared.add(mat);
 }
 return {state,prepareMaterial,dispose(){depth.dispose()},render(camera,guard,draw){
  if(guard?.state?.active!=='bounded'||scene.overrideMaterial||scene.background||!renderer.autoClear)return draw(scene,camera);
  const hidden=[];state.occluders=0;state.triangles=0;
  scene.traverseVisible(mesh=>{
   if(!mesh.isMesh)return;
   for(const mat of [mesh.material].flat())prepareMaterial(mat);
   if(!cheapOccluder(mesh)){hidden.push(mesh);mesh.visible=false}
   else{state.occluders++;state.triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1)}
  });
  const shadows=renderer.shadowMap.enabled;
  try{
   scene.overrideMaterial=depth;renderer.shadowMap.enabled=false;draw(scene,camera);
  }finally{scene.overrideMaterial=null;renderer.shadowMap.enabled=shadows;for(const mesh of hidden)mesh.visible=true}
  renderer.autoClear=false;
  try{draw(scene,camera);state.frames++}finally{renderer.autoClear=true}
 }};
}
