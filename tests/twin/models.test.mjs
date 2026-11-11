import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base=new URL('../../site/knight-eps-phase12/',import.meta.url);
function read(name){const b=fs.readFileSync(new URL(name,base)),n=b.readUInt32LE(12);assert.equal(b.readUInt32LE(8),b.length);return {json:JSON.parse(b.subarray(20,20+n)),bin:b.subarray(28+n)}}
const old=read('models/KnightEPS_Phase10.glb'),next=read('models/KnightEPS_Detailed.glb');
const report=JSON.parse(fs.readFileSync(new URL('docs/model-upgrades.json',base)));
const manifest=JSON.parse(fs.readFileSync(new URL('docs/component_manifest.json',base)));
const boards=new Set(report.boards.map(b=>b.id));
function renderNodes(i){const n=next.json.nodes[i];return [n,...(n.children||[]).flatMap(renderNodes)]}
function data(g,i){const a=g.json.accessors[i],v=g.json.bufferViews[a.bufferView];return g.bin.subarray((v.byteOffset||0)+(a.byteOffset||0),(v.byteOffset||0)+v.byteLength)}
function meshData(g,i){return g.json.meshes[i].primitives.map(p=>Object.entries(p.attributes).sort().map(([k,v])=>[k,createHash('sha256').update(data(g,v)).digest('hex')]).concat([['indices',createHash('sha256').update(data(g,p.indices)).digest('hex')]]))}
test('all eight PCB assemblies use supplied detailed geometry with no legacy mesh',()=>{
 assert.equal(boards.size,8);
 for(const board of report.boards){
  const index=next.json.nodes.findIndex(n=>n.name===board.id),n=next.json.nodes[index];
  assert.equal(n.mesh,undefined);assert.equal(n.extras.source_sha256,board.sha256);assert.equal(n.extras.source_asset,board.source);
  const parts=renderNodes(index).filter(n=>n.mesh!==undefined);assert.equal(parts.length,board.draws);
  assert.equal(parts.reduce((n,p)=>n+next.json.meshes[p.mesh].primitives.reduce((n,q)=>n+next.json.accessors[q.indices].count/3,0),0),board.triangles);
  assert(!next.json.meshes.some(m=>m.name===board.id));
  assert.equal(manifest.components[board.id].model_upgrade.source_sha256,board.sha256);
 }
});
test('all existing component identities and board anchor transforms survive',()=>{
 for(const [id,part] of Object.entries(manifest.components)){
  const before=old.json.nodes.find(n=>n.name===id),after=next.json.nodes.find(n=>n.name===id);assert(after,`Missing ${id}`);
  for(const k of ['rotation','scale','matrix'])assert.deepEqual(after[k],before[k],`${id} changed ${k}`);
  const correction=report.fixture_adjustments.find(a=>a.id===id);
  const target=correction?before.translation.map((v,i)=>v+correction.cad_offset_m[i]):before.translation;
  assert.deepEqual(after.translation,target,`${id} moved unexpectedly`);
  if(before.mesh!==undefined&&!boards.has(id))assert.deepEqual(meshData(next,after.mesh),meshData(old,before.mesh),`${id} geometry changed`);
 }
});
test('substrate support planes remain seated, without scaling electronics',()=>{
 const support={BMS_BQ76942:[2,'min',-.004053758457303047],INA226:[1,'max',.0048675984144210815],Regulator_01:[1,'max',.003917410969734192],Regulator_02:[1,'max',.003917410969734192],MCU_Final:[2,'min',-.007162891328334808],LightSensor:[2,'min',-.003950402140617371],TemperatureSensor:[0,'max',.003950398415327072],Charger_BMS034A_EVM:[2,'min',-.004780130460858345]};
 for(const b of report.boards){const [axis,side,value]=support[b.id];assert(Math.abs(b.substrate_local_bounds[side==='min'?0:1][axis]-value)<1e-7,`${b.id} support plane changed`)}
 assert.equal(report.fixture_adjustments.length,12);
 for(const a of report.fixture_adjustments){assert.equal(a.cad_offset_m[1],0,'Regulator fixture support depth changed');assert(Math.abs(Math.hypot(...a.cad_offset_m)-(/_01_(Base|Clip)$/.test(a.id)?.00127:.000635))<1e-10)}
});
test('compiler packs only referenced geometry and valid binary ranges',()=>{
 const meshes=new Set(next.json.nodes.filter(n=>n.mesh!==undefined).map(n=>n.mesh));assert.equal(meshes.size,next.json.meshes.length);
 for(const v of next.json.bufferViews){assert.equal((v.byteOffset||0)%4,0);assert((v.byteOffset||0)+v.byteLength<=next.bin.length)}
 for(const p of next.json.meshes.flatMap(m=>m.primitives)){const positions=next.json.accessors[p.attributes.POSITION];assert.equal(positions.componentType,5126);assert(positions.min.every(Number.isFinite));assert(positions.max.every(Number.isFinite))}
 assert(report.boards.reduce((n,b)=>n+b.draws,0)<report.boards.reduce((n,b)=>n+b.source_draws,0)/2);
});
test('new power boards preserve every supplied position, UV, triangle, material and embedded image',()=>{
 const inputs={BMS_BQ76942:['Knight_EPS_BMS_Final_green.glb','19157890e571f6dc2b74fff6eea2dc763ac4936c0612e53cda3ce80f8ff53145',32036,178],Charger_BMS034A_EVM:['Knight_EPS_MPPT_High_Fidelity_Gerber_v4.glb','ca9d409e9b038669eaef278d4e0ecd4fb3e41a0667d531ff192458be4e378613',117816,475]};
 const digest=b=>createHash('sha256').update(b).digest('hex');
 const floats=(g,id)=>{const a=g.json.accessors[id],v=g.json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3}[a.type],start=(v.byteOffset||0)+(a.byteOffset||0);assert.equal(a.componentType,5126);return Float32Array.from({length:a.count*size},(_,i)=>g.bin.readFloatLE(start+i*4))};
 const png=(g,i)=>{const v=g.json.bufferViews[g.json.images[i].bufferView],s=v.byteOffset||0;return g.bin.subarray(s,s+v.byteLength)};
 for(const [id,[filename,hash,triangles,draws]] of Object.entries(inputs)){
  const bytes=fs.readFileSync(new URL('../../model-sources/power-boards/'+filename,import.meta.url)),n=bytes.readUInt32LE(12),source={json:JSON.parse(bytes.subarray(20,20+n)),bin:bytes.subarray(28+n)},board=report.boards.find(b=>b.id===id);
  assert.equal(digest(bytes),hash);assert.equal(board.triangles,triangles);assert.equal(board.source_draws,draws);
  const node=next.json.nodes.find(n=>n.name===id);
  for(const child of node.children.map(i=>next.json.nodes[i])){
   const p=next.json.meshes[child.mesh].primitives[0],positions=[],uvs=[];let sourceIndices=0;const expectedIndices=[];
   for(const name of child.extras.source_nodes){
    const node=source.json.nodes.find(n=>n.name===name);for(const k of ['matrix','translation','rotation','scale'])assert.equal(node[k],undefined,'independently audited flat source');
    for(const q of source.json.meshes[node.mesh].primitives){
     const src=floats(source,q.attributes.POSITION);
     for(let i=0;i<src.length;i+=3)for(let k=0;k<3;k++)positions.push(Math.fround(src[i+board.axes[k]]*.001*board.signs[k]+board.offset_m[k]));
     if(q.attributes.TEXCOORD_0!==undefined)uvs.push(...floats(source,q.attributes.TEXCOORD_0));
     const ia=source.json.accessors[q.indices],iv=source.json.bufferViews[ia.bufferView],is=(iv.byteOffset||0)+(ia.byteOffset||0),ib={5121:1,5123:2,5125:4}[ia.componentType],baseVertex=positions.length/3-src.length/3;for(let i=0;i<ia.count;i++)expectedIndices.push(baseVertex+(ib===1?source.bin.readUInt8(is+i):ib===2?source.bin.readUInt16LE(is+i*2):source.bin.readUInt32LE(is+i*4)));sourceIndices+=ia.count;
     const imported=structuredClone(next.json.materials[p.material]);imported.name=imported.name.slice(filename.length+3);
     const original=structuredClone(source.json.materials[q.material]);
     // Texture indices are remapped; compare their original image payloads.
     for(const mat of [imported,original])if(mat.pbrMetallicRoughness.baseColorTexture)delete mat.pbrMetallicRoughness.baseColorTexture.index;
     assert.deepEqual(imported,original);
    }
   }
   assert.equal(digest(Buffer.from(Float32Array.from(positions).buffer)),digest(Buffer.from(floats(next,p.attributes.POSITION).buffer)));
   assert.equal(next.json.accessors[p.indices].count,sourceIndices);assert.equal(digest(Buffer.from(Uint32Array.from(expectedIndices).buffer)),digest(data(next,p.indices)));
   if(uvs.length)assert.deepEqual(floats(next,p.attributes.TEXCOORD_0),Float32Array.from(uvs));
  }
  for(let i=0;i<source.json.images.length;i++)assert.ok(next.json.images.some((_,j)=>digest(png(next,j))===digest(png(source,i))));
 }
});
