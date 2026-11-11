import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
const vendor=new URL('../../site/knight-eps-phase12/viewer/vendor/three/',import.meta.url);
registerHooks({resolve(specifier,context,next){if(specifier==='three')return {url:new URL('build/three.module.js',vendor).href,shortCircuit:true};if(specifier.startsWith('three/addons/'))return {url:new URL(specifier.slice(6),vendor).href,shortCircuit:true};return next(specifier,context)}});
const THREE=await import('three');
const {GLTFLoader}=await import(new URL('addons/loaders/GLTFLoader.js',vendor));
const {deduplicateMaterials,consolidateComponent,instanceFixtures}=await import('../../site/knight-eps-phase12/viewer/render-optimizations.mjs');
// Parsing-only image stand-in: no renderer/upload, and texture identities/UVs stay
// real. Browser comparison separately verifies actual decoded artwork.
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});globalThis.ProgressEvent=class {};
const base=new URL('../../site/knight-eps-phase12/',import.meta.url),bytes=fs.readFileSync(new URL('models/KnightEPS_Detailed.glb',base));
const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const metadata=JSON.parse(fs.readFileSync(new URL('docs/component_manifest.json',base)));
const parts=Object.keys(metadata.components).map(id=>scene.getObjectByName(id));
function signature(part){
 part.updateWorldMatrix(true,true);const hashes=new Map(),v=new THREE.Vector3(),normal=new THREE.Vector3();let triangles=0;
 part.traverse(m=>{if(!m.isMesh)return;const g=m.geometry,materials=[m.material].flat(),groups=Array.isArray(m.material)?g.groups:[{start:0,count:g.index?.count||g.attributes.position.count,materialIndex:0}];
  const matrix=part.matrixWorld.clone().invert().multiply(m.matrixWorld),nm=new THREE.Matrix3().getNormalMatrix(matrix);
  for(const group of groups){const mat=materials[group.materialIndex],key=mat.uuid;if(!hashes.has(key))hashes.set(key,[]);const values=hashes.get(key);triangles+=group.count/3;
   for(let i=group.start;i<group.start+group.count;i++){const j=g.index?g.index.getX(i):i;v.fromBufferAttribute(g.attributes.position,j).applyMatrix4(matrix);normal.fromBufferAttribute(g.attributes.normal,j).applyNormalMatrix(nm);const data=[...v.toArray(),...normal.toArray()];if(mat.map&&g.attributes.uv)data.push(g.attributes.uv.getX(j),g.attributes.uv.getY(j));for(const value of data)values.push(value)}
  }
 });return {triangles,materials:hashes};
}
test('runtime consolidation preserves actual CAD triangles, normals, artwork UVs, component IDs and anchors',()=>{
 deduplicateMaterials(scene);const anchors=parts.map(p=>p.matrix.clone());let maxError=0;
 for(const [i,part] of parts.entries()){
  const before=signature(part);consolidateComponent(part,metadata.display.mesh_name);const after=signature(part);assert.equal(after.triangles,before.triangles);
  for(const [mat,values] of before.materials){const actual=after.materials.get(mat);assert.equal(actual?.length,values.length,part.name+' material ownership changed');for(let j=0;j<values.length;j++){const error=Math.abs(values[j]-actual[j]);maxError=Math.max(maxError,error);if(error>2e-7)assert.fail(part.name+' triangle/normal/UV data changed by '+error)}}assert.deepEqual(part.matrix,anchors[i]);assert.equal(scene.getObjectByName(part.name),part);
 }
 console.log('Maximum consolidated attribute error:',maxError);const payload=scene.getObjectByName('NerdMiner_Board_LCD');assert.equal(payload.children.filter(m=>m.isMesh).length,1,'Payload must have one body mesh');assert.equal(payload.children[0].material.length,5,'Keep five body material regions');
 assert(scene.getObjectByName(metadata.display.mesh_name)?.geometry.attributes.uv,'Keep dedicated screen');
});
test('fixture instances follow world transforms and visibility; selection keeps the precise original owner',()=>{
 for(const part of parts)part.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true}});
 const result=instanceFixtures(scene,parts,id=>metadata.components[id]);assert.equal(result.batches.length,2);assert.deepEqual(result.batches.map(b=>b.members.length),[26,26]);
 const {mesh,members}=result.batches[0],fixture=members[0],matrix=new THREE.Matrix4();result.sync(null);mesh.getMatrixAt(0,matrix);assert(matrix.elements.every((x,i)=>Math.abs(x-fixture.matrixWorld.elements[i])<1e-7));
 fixture.position.x+=.04;fixture.visible=false;result.sync(null);assert.equal(mesh.count,25);fixture.visible=true;result.sync(fixture);assert.equal(mesh.count,25);assert(fixture.layers.isEnabled(0));assert(!members[1].layers.isEnabled(0));
 result.sync(null,new Set([fixture,members[1]]));assert.equal(mesh.count,24);assert(fixture.layers.isEnabled(0));assert(members[1].layers.isEnabled(0));
 result.sync(null);assert.equal(mesh.count,26);mesh.getMatrixAt(0,matrix);assert(matrix.elements.every((x,i)=>Math.abs(x-fixture.matrixWorld.elements[i])<1e-7));result.dispose();
});
test('material equivalence shares equal appearances and keeps different texture references distinct',()=>{
 const root=new THREE.Group(),a=new THREE.MeshStandardMaterial({color:0xffaa00}),b=a.clone(),c=a.clone();a.name='A';b.name='B';c.map=new THREE.Texture();
 for(const mat of [a,b,c])root.add(new THREE.Mesh(new THREE.BoxGeometry(),mat));deduplicateMaterials(root);assert.equal(root.children[0].material,root.children[1].material);assert.notEqual(root.children[0].material,root.children[2].material);
});
