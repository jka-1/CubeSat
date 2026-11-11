import {Vector3,DoubleSide,FrontSide} from 'three';

// Exact closed/outward topology is certified offline against the asset hash.
// Do not cull when the camera clips/intersects the conservative solid bounds.
export function outsideClipVolume(box,world,camera){
 const point=new Vector3();let min=Infinity,max=-Infinity;
 for(let i=0;i<8;i++){
  point.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse);
  min=Math.min(min,-point.z);max=Math.max(max,-point.z);
 }
 return min>camera.near&&max<camera.far;
}

export function installCertifiedCulling(scene){
 const state={eligibleMeshes:0,eligibleTriangles:0,frontMeshes:0,shadowFrontMeshes:0,doubleSidedFallbacks:0};
 scene.traverse(mesh=>{if(mesh.isMesh&&mesh.userData.certifiedClosed){state.eligibleMeshes++;state.eligibleTriangles+=mesh.userData.certifiedClosedRanges?mesh.geometry.groups[0].count/3:(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3}});
 return {state,update(camera){
  const lights=[];scene.traverseVisible(light=>{if(light.isLight&&light.castShadow){light.shadow.updateMatrices(light);lights.push(light)}});
  state.frontMeshes=0;state.shadowFrontMeshes=0;state.doubleSidedFallbacks=0;
  scene.traverseVisible(mesh=>{
   if(!mesh.isMesh||!mesh.userData.certifiedClosed)return;
   if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
   const front=outsideClipVolume(box,mesh.matrixWorld,camera),shadowFront=lights.length>0&&lights.every(light=>light.shadow.camera.isOrthographicCamera&&outsideClipVolume(box,mesh.matrixWorld,light.shadow.camera));
   for(const [i,material] of [mesh.material].flat().entries()){
    if(mesh.userData.certifiedClosedMaterialIndices&&!mesh.userData.certifiedClosedMaterialIndices.includes(i))continue;
    // X-ray/other transparent overrides retain both surfaces.
    const side=front&&!material.transparent?FrontSide:DoubleSide;
    if(material.side!==side){material.side=side;material.needsUpdate=true}
    material.shadowSide=shadowFront&&!material.transparent?FrontSide:DoubleSide;
   }
   if(front)state.frontMeshes++;else state.doubleSidedFallbacks++;
   if(shadowFront)state.shadowFrontMeshes++;
  });
 }};
}
