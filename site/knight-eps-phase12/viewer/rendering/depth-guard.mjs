import {Box3,Vector3} from 'three';

export function depthRange(minDepth,maxDepth,fallbackNear=.002,bits=24,farDepth=maxDepth){
 const near=minDepth>0?Math.max(.00001,minDepth*.9):Math.min(.002,fallbackNear);
 const far=Math.max(near*2,farDepth*1.05);
 // Fixed-point reversed depth has the SAME quantization as forward depth.
 // Fit the clip volume rather than crediting reversal with float precision.
 const worstStep=maxDepth**2*(far-near)/(far*near*(2**bits-1));
 return {near,far,minDepth,maxDepth,worstStep,certified:minDepth>0&&worstStep<.000064/8};
}

export function conditionalDepthMaterial(material){
 const compile=material.onBeforeCompile;
 material.onBeforeCompile=function(shader,renderer){
  compile.call(this,shader,renderer);
  const prelude='#ifdef KNIGHT_BOUNDED_DEPTH\n#undef USE_LOGDEPTHBUF\n#endif\n';
  shader.vertexShader=prelude+shader.vertexShader;shader.fragmentShader=prelude+shader.fragmentShader;
 };
 material.needsUpdate=true;
}

export function createDepthGuard(root,camera,{conditional=false}={}){
 const box=new Box3(),corner=new Vector3(),prepared=new WeakSet();let state=null;
 return {get state(){return state},update(){
  root.updateWorldMatrix(true,true);camera.updateMatrixWorld();
  let min=Infinity,max=-Infinity,far=0;const materials=new Set();
  root.traverseVisible(mesh=>{
   if(!mesh.isMesh)return;
   for(const material of [mesh.material].flat())materials.add(material);
   if(mesh.isInstancedMesh){mesh.computeBoundingBox();box.copy(mesh.boundingBox)}
   else{if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();box.copy(mesh.geometry.boundingBox)}
   for(let i=0;i<8;i++){
    corner.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const depth=-corner.z;far=Math.max(far,depth);
    if(mesh.name!=='Display_ShadowFloor'){min=Math.min(min,depth);max=Math.max(max,depth)}
   }
  });
  if(!Number.isFinite(min))return;
  state=depthRange(min,max,camera.near,24,far);state.active=conditional?(state.certified?'bounded':'logarithmic-fallback'):'reverse-diagnostic';
  if(conditional)for(const material of materials){
   if(!prepared.has(material)){conditionalDepthMaterial(material);prepared.add(material)}
   material.defines??={};const was='KNIGHT_BOUNDED_DEPTH' in material.defines;
   if(was!==state.certified){if(state.certified)material.defines.KNIGHT_BOUNDED_DEPTH=1;else delete material.defines.KNIGHT_BOUNDED_DEPTH;material.needsUpdate=true}
  }
  if(camera.near!==state.near||camera.far!==state.far){camera.near=state.near;camera.far=state.far;camera.updateProjectionMatrix()}
 }};
}
