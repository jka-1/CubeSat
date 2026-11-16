import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('../../site/knight-eps-phase12/models/',import.meta.url);
function read(name){const bytes=fs.readFileSync(new URL(name,base)),size=bytes.readUInt32LE(12);return {bytes,json:JSON.parse(bytes.subarray(20,20+size)),bin:bytes.subarray(28+size)}}
const canonical=read('display/display-compact.glb'),appearance=read('clean-prototype/appearance.glb');
function values(g,id){
 const a=g.json.accessors[id],v=g.json.bufferViews[a.bufferView],start=(v.byteOffset||0)+(a.byteOffset||0),width={SCALAR:1,VEC2:2,VEC3:3}[a.type];
 const sizes={5123:2,5125:4,5126:4},read={5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'};
 return Array.from({length:a.count*width},(_,i)=>g.bin[read[a.componentType]](start+i*sizes[a.componentType]));
}
function triangles(g,name){
 const node=g.json.nodes.find(n=>n.name===name),out=[];
 for(const p of g.json.meshes[node.mesh].primitives){
  const positions=values(g,p.attributes.POSITION),indices=values(g,p.indices);
  for(let i=0;i<indices.length;i+=3){
   const v=indices.slice(i,i+3).map(index=>positions.slice(index*3,index*3+3).map(x=>x.toFixed(6)).join(','));
   // Cyclic ordering permits a different first vertex but preserves winding.
   out.push([v.join(';'),[v[1],v[2],v[0]].join(';'),[v[2],v[0],v[1]].join(';')].sort()[0]);
  }
 }
 return out.sort();
}
test('clean panel UV seams preserve every original triangle, winding and local position',()=>{
 for(const id of ['SolarPanel_01','SolarPanel_02'])assert.deepEqual(triangles(appearance,'Clean_'+id),triangles(canonical,id));
});
test('appearance export excludes electronics, cinematic transforms, cameras and workbench',()=>{
 const provenance=JSON.parse(fs.readFileSync(new URL('clean-prototype/appearance.json',base)));
 assert.equal(createHash('sha256').update(appearance.bytes).digest('hex'),provenance.outputSHA256);
 assert.equal(provenance.components.length,10);
 assert.deepEqual(appearance.json.nodes.map(n=>n.name),provenance.components.map(id=>'Clean_'+id));
 for(const node of appearance.json.nodes)for(const key of ['translation','rotation','scale','matrix','camera'])assert.equal(node[key],undefined);
 assert.equal(appearance.json.animations,undefined);
 assert.equal(appearance.json.cameras,undefined);
 for(const id of ['SolarPanel_01','SolarPanel_02']){
  const node=appearance.json.nodes.find(n=>n.name==='Clean_'+id),primitives=appearance.json.meshes[node.mesh].primitives;
  assert.equal(primitives.length,3);
  for(const p of primitives)assert.notEqual(p.attributes.TEXCOORD_0,undefined);
  const surface=appearance.json.materials[primitives[0].material];assert(surface.pbrMetallicRoughness.baseColorTexture);assert(surface.normalTexture);
 }
});
