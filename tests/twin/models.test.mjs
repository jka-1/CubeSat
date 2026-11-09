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
test('all seven PCB assemblies use supplied detailed geometry with no legacy mesh',()=>{
 assert.equal(boards.size,7);
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
 const support={INA226:[1,'max',.0048675984144210815],Regulator_01:[1,'max',.003917410969734192],Regulator_02:[1,'max',.003917410969734192],MCU_Final:[2,'min',-.007162891328334808],LightSensor:[2,'min',-.003950402140617371],TemperatureSensor:[0,'max',.003950398415327072],Charger_BMS034A_EVM:[2,'min',-.004780130460858345]};
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
