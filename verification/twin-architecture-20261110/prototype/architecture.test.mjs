import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import * as THREE from './vendor/three-r176/three.module.js';
import {GLTFLoader} from './vendor/OfflineGLTFLoader.mjs';
import {deduplicateMaterials,consolidateComponent} from './vendor/offline-consolidation.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
function read(file){const bytes=fs.readFileSync(file),n=bytes.readUInt32LE(12);return {bytes,json:JSON.parse(bytes.subarray(20,20+n)),bin:bytes.subarray(28+n)}}
const source=read(path.join(root,'site/knight-eps-phase12/models/KnightEPS_Detailed.glb')),derived=read(path.join(here,'assets/display.glb'));
const metadata=JSON.parse(fs.readFileSync(path.join(root,'site/knight-eps-phase12/docs/component_manifest.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('canonical source is unchanged and derivative retains original materials/images',()=>{
 assert.equal(sha(source.bytes),'dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47');
 for(const name of ['materials','textures','samplers','extensionsUsed'])assert.deepEqual(derived.json[name],source.json[name]);
 for(let i=0;i<source.json.images.length;i++){
  const bytes=(g,n)=>{const v=g.json.bufferViews[g.json.images[n].bufferView];return g.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)};
  assert.deepEqual(bytes(derived,i),bytes(source,i));
 }
});
test('prepared geometry preserves all component triangle counts, transforms and bounds',async()=>{
 globalThis.self=globalThis;const loader=new GLTFLoader();loader.register(()=>({name:'KNIGHT_TEST_TEXTURES',loadTexture(){return Promise.resolve(new THREE.Texture())}}));
 const [a,b]=await Promise.all([source,derived].map(g=>loader.parseAsync(g.bytes.buffer.slice(g.bytes.byteOffset,g.bytes.byteOffset+g.bytes.byteLength),'')));
 // Compare serialization against the already validated live consolidation,
 // including every indexed position/normal/UV, not merely counts and bounds.
 deduplicateMaterials(a.scene);
 for(const id of Object.keys(metadata.components))consolidateComponent(a.scene.getObjectByName(id),metadata.display.mesh_name);
 function signatures(part,gltf){
  const streams=new Map();part.traverse(mesh=>{
   if(!mesh.isMesh)return;const geo=mesh.geometry,attrs=Object.entries(geo.attributes).sort(([a],[b])=>a.localeCompare(b)),materials=[mesh.material].flat();
   for(const group of geo.groups.length?geo.groups:[{start:0,count:geo.index?.count||geo.attributes.position.count,materialIndex:0}]){
    const material=gltf.parser.associations.get(materials[group.materialIndex||0]).materials,key=material+'/'+attrs.map(([n,a])=>n+':'+a.itemSize).join(','),stride=attrs.reduce((n,[_,a])=>n+a.itemSize,0),expanded=new Float32Array(group.count*stride);let at=0;
    for(let i=group.start;i<group.start+group.count;i++){const index=geo.index?geo.index.array[i]:i;for(const [_,attribute] of attrs)for(let k=0;k<attribute.itemSize;k++)expanded[at++]=attribute.array[index*attribute.itemSize+k]}
    if(!streams.has(key))streams.set(key,createHash('sha256'));streams.get(key).update(Buffer.from(expanded.buffer));
   }
  });return Object.fromEntries([...streams].sort(([a],[b])=>a.localeCompare(b)).map(([k,h])=>[k,h.digest('hex')]));
 }
 for(const g of [a,b])g.scene.updateMatrixWorld(true);
 const count=p=>{let n=0;p.traverse(m=>{if(m.isMesh)n+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});return n};
 assert.equal(count(a.scene),874229);assert.equal(count(b.scene),874229);
 for(const id of Object.keys(metadata.components)){
  const x=a.scene.getObjectByName(id),y=b.scene.getObjectByName(id);assert.ok(x&&y,id);assert.equal(count(x),count(y),id);
  assert.deepEqual(x.matrixWorld.elements,y.matrixWorld.elements,id+' transform');
  assert.deepEqual(signatures(x,a),signatures(y,b),id+' all indexed attributes');
  const xb=new THREE.Box3().setFromObject(x),yb=new THREE.Box3().setFromObject(y);
  assert.ok(xb.min.distanceTo(yb.min)<1e-7&&xb.max.distanceTo(yb.max)<1e-7,id+' bounds');
 }
 const geometries=part=>{const all=[];part.traverse(m=>{if(m.isMesh)all.push(m.geometry)});return all};
 const first=geometries(b.scene.getObjectByName('Regulator_01')),second=new Set(geometries(b.scene.getObjectByName('Regulator_02')));
 assert.ok(first.length&&first.every(g=>second.has(g)),'regulator GPU geometry remains shared');
});
test('coverage package retains dimensions and every verified source mask byte',()=>{
 const info=JSON.parse(fs.readFileSync(path.join(here,'assets/artwork-masks.json'))),bytes=gunzipSync(fs.readFileSync(path.join(here,'assets/artwork-masks.bin.gz')));
 assert.equal(info.records.length,15);assert.equal(bytes.length,info.decodedMaskBytes);
 const audit=JSON.parse(fs.readFileSync(path.join(here,'../asset-audit.json')));
 for(const r of info.records){assert.equal(sha(bytes.subarray(r.offset,r.offset+r.length)),r.maskSHA256);assert.equal(r.length,r.dimensions[0]*r.dimensions[1]);assert.deepEqual(r.dimensions,audit.images[r.image].dimensions);assert.ok(r.sourceTexelsExact)}
});

test('vertex compaction preserves every indexed position, normal, UV, node and image byte',()=>{
 const compact=read(path.join(here,'assets/display-compact.glb')),report=JSON.parse(fs.readFileSync(path.join(here,'assets/compact-report.json'))),certificate=JSON.parse(fs.readFileSync(path.join(here,'assets/closed-primitives-compact.json')));
 assert.equal(sha(compact.bytes),report.outputSHA256);assert.equal(certificate.displaySHA256,report.outputSHA256);assert.equal(report.sourceSHA256,sha(derived.bytes));
 for(const key of ['nodes','materials','textures','samplers','scenes'])assert.deepEqual(compact.json[key],derived.json[key]);
 function access(g,i){const a=g.json.accessors[i],v=g.json.bufferViews[a.bufferView],bytes={5126:4,5125:4,5123:2}[a.componentType]*{SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],start=(v.byteOffset||0)+(a.byteOffset||0);return {a,data:g.bin.subarray(start,start+a.count*bytes),bytes}}
 function expanded(g,p,key){const attr=access(g,p.attributes[key]),index=access(g,p.indices),output=Buffer.alloc(index.a.count*attr.bytes);for(let i=0;i<index.a.count;i++){const n=index.a.componentType===5123?index.data.readUInt16LE(i*2):index.data.readUInt32LE(i*4);attr.data.copy(output,i*attr.bytes,n*attr.bytes,(n+1)*attr.bytes)}return sha(output)}
 for(let m=0;m<derived.json.meshes.length;m++)for(let i=0;i<derived.json.meshes[m].primitives.length;i++){
  const a=derived.json.meshes[m].primitives[i],b=compact.json.meshes[m].primitives[i];assert.equal(a.material,b.material);
  assert.deepEqual(Object.keys(a.attributes).sort(),Object.keys(b.attributes).sort());for(const key of Object.keys(a.attributes))assert.equal(expanded(derived,a,key),expanded(compact,b,key),`${m}/${i}/${key}`);
 }
 for(let i=0;i<derived.json.images.length;i++){const bytes=g=>{const v=g.json.bufferViews[g.json.images[i].bufferView];return g.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)};assert.deepEqual(bytes(derived),bytes(compact))}
});
