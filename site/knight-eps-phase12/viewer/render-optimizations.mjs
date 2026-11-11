import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Names/UUIDs are identity, not appearance. Texture references remain in the key:
// equal scalar properties alone do not make differently textured materials equal.
export function deduplicateMaterials(root){
 const canonical=new Map();let before=0;
 root.traverse(mesh=>{if(!mesh.isMesh)return;const materials=[mesh.material].flat().map(material=>{
  before++;const textures={};for(const value of Object.values(material))if(value?.isTexture)textures[value.uuid]={uuid:value.uuid};const json=material.toJSON({textures,images:{}});for(const key of ['uuid','name','metadata','textures','images','userData'])delete json[key];
  const key=JSON.stringify(json);if(!canonical.has(key))canonical.set(key,material);return canonical.get(key);
 });mesh.material=Array.isArray(mesh.material)?materials:materials[0]});
 return {references:before,unique:canonical.size};
}
function schema(geometry){return JSON.stringify(Object.entries(geometry.attributes).sort().map(([name,a])=>[name,a.itemSize,a.normalized,a.array.constructor.name]))}

// Consolidate only static opaque leaves inside an independently owned component.
// Keep all vertices/indices/normals/UVs, and bake rigid child transforms locally.
export function consolidateComponent(part,screenName){
 const candidates=[];part.updateWorldMatrix(true,true);
 part.traverse(mesh=>{
  if(mesh===part||!mesh.isMesh||mesh.name===screenName||mesh.isSkinnedMesh||Array.isArray(mesh.material)||mesh.material.transparent||mesh.material.transmission>0||mesh.geometry.groups.length||Object.keys(mesh.geometry.morphAttributes).length)return;
  if(mesh.children.length||!mesh.visible)return;
  candidates.push(mesh);
 });
 if(candidates.length<2)return {before:candidates.length,after:candidates.length};
 const inverse=part.matrixWorld.clone().invert(),buckets=new Map(),copies=[];
 const framingPoints=[];part.traverse(mesh=>{if(!mesh.isMesh)return;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox,matrix=inverse.clone().multiply(mesh.matrixWorld);for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])framingPoints.push(new THREE.Vector3(x,y,z).applyMatrix4(matrix))});part.userData.framingPoints=framingPoints;
 for(const mesh of candidates){
  const geometry=mesh.geometry.clone(),relative=inverse.clone().multiply(mesh.matrixWorld),identity=new THREE.Matrix4();if(!relative.elements.every((v,i)=>Math.abs(v-identity.elements[i])<1e-12))geometry.applyMatrix4(relative);copies.push(geometry);
  // The payload has some untextured leaves without UVs. Adding unused UVs allows
  // one body mesh; existing artwork UVs and all other attributes stay untouched.
  if(part.name==='NerdMiner_Board_LCD'&&!geometry.attributes.uv&&!mesh.material.map)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
  const key=[mesh.material.uuid,schema(geometry),!!geometry.index,mesh.castShadow,mesh.receiveShadow].join('/');
  if(!buckets.has(key))buckets.set(key,{meshes:[],geometries:[],material:mesh.material});
  const bucket=buckets.get(key);bucket.meshes.push(mesh);bucket.geometries.push(geometry);
 }
 const batches=[];
 for(const bucket of buckets.values()){
  const geometry=mergeGeometries(bucket.geometries);if(!geometry)throw Error('Incompatible component geometry: '+part.name);
  batches.push({...bucket,geometry});
 }
 // One body object where layouts/shadow flags agree, with one draw group per
 // material. Other components keep incompatible layouts in separate meshes.
 const layouts=new Map();for(const batch of batches){const mesh=batch.meshes[0],key=[schema(batch.geometry),!!batch.geometry.index,mesh.castShadow,mesh.receiveShadow].join('/');if(!layouts.has(key))layouts.set(key,[]);layouts.get(key).push(batch)}
 let count=0;
 for(const compatible of layouts.values()){
  const geometry=mergeGeometries(compatible.map(b=>b.geometry),true);if(!geometry)throw Error('Incompatible component batches: '+part.name);
  const materials=compatible.map(b=>b.material),mesh=new THREE.Mesh(geometry,materials);
  mesh.name=part.name+'_Body_'+count++;mesh.castShadow=compatible[0].meshes[0].castShadow;mesh.receiveShadow=compatible[0].meshes[0].receiveShadow;
  mesh.userData.source_nodes=compatible.flatMap(b=>b.meshes.map(m=>m.name));part.add(mesh);
 }
 for(const mesh of candidates)mesh.removeFromParent();
 for(const geometry of [...copies,...batches.map(b=>b.geometry)])geometry.dispose();
 return {before:candidates.length,after:count,drawGroups:batches.length};
}

// Originals remain logical components and precise raycast/bounds references on
// layer 1. Camera/shadows use layer 0. Selected or temporarily ghosted fixtures render their own materials.
export function instanceFixtures(scene,parts,info){
 const groups=new Map(),batches=[];
 for(const part of parts){
  if(info(part.name).group!=='pcb_fixtures'||!part.isMesh||part.children.length||Array.isArray(part.material)||part.material.transparent)continue;
  const key=[part.geometry.uuid,part.material.uuid,part.castShadow,part.receiveShadow].join('/');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);
 }
 for(const members of groups.values()){
  if(members.length<2)continue;
  const first=members[0],mesh=new THREE.InstancedMesh(first.geometry,first.material,members.length);mesh.name='Fixture_instances_'+batches.length;mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
  for(const member of members)member.layers.set(1);batches.push({mesh,members});
 }
 function sync(selected,overrides=new Set()){
  scene.updateMatrixWorld(true);
  for(const {mesh,members} of batches){let count=0;for(const member of members){const override=member===selected||overrides.has(member);member.layers.set(override?0:1);let visible=true;for(let p=member;p;p=p.parent)visible&&=p.visible;if(visible&&!override)mesh.setMatrixAt(count++,member.matrixWorld)}mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere()}
 }
 return {sync,batches,dispose:()=>{for(const {mesh} of batches){mesh.removeFromParent();mesh.dispose()}}};
}
