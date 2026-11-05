import * as THREE from 'three';
/** Bounds of actual vertices in screen coordinates. Independent of DPR. */
export function projectedBounds(camera,points){
 camera.updateMatrixWorld(true);const matrix=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),v=new THREE.Vector3();
 const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
 for(const p of points){v.copy(p).applyMatrix4(matrix);min[0]=Math.min(min[0],v.x);min[1]=Math.min(min[1],v.y);max[0]=Math.max(max[0],v.x);max[1]=Math.max(max[1],v.y)}return {min,max};
}
/** Compose around a physical orbit anchor, using an off-axis frustum for visual centering.
 * No world transform is changed. Returns normalized projection offset for transitions.
 */
export function frameCamera(camera,points,anchor,direction,width,height){
 if(!points.length||width<=0||height<=0)return null;
 camera.aspect=width/height;camera.clearViewOffset();
 let extent=.01;for(const p of points)extent=Math.max(extent,p.distanceTo(anchor));
 camera.near=Math.max(.0001,extent/100);camera.far=Math.max(10,extent*40);camera.updateProjectionMatrix();
 const margin=Math.min(.82,Math.max(.55,1-110/height));let lo=extent*1.01,hi=extent*30;
 for(let i=0;i<26;i++){const d=(lo+hi)/2;camera.position.copy(anchor).addScaledVector(direction,d);camera.lookAt(anchor);const b=projectedBounds(camera,points);if(b.max[0]-b.min[0]>1.7||b.max[1]-b.min[1]>2*margin)lo=d;else hi=d}
 camera.position.copy(anchor).addScaledVector(direction,hi);camera.lookAt(anchor);const b=projectedBounds(camera,points),mx=(b.min[0]+b.max[0])/2,my=(b.min[1]+b.max[1])/2;
 camera.setViewOffset(width,height,mx*width/2,-my*height/2,width,height);camera.updateMatrixWorld(true);
 return {shift:[mx/2,-my/2],extent};
}
