import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../../site/knight-eps-phase12/viewer/vendor/three/build/three.module.js',import.meta.url).href:specifier,context)}});
const {createInspection,orbitTransition,satelliteOrbitPose}=await import('../../site/knight-eps-phase12/viewer/inspection.mjs');
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Vector3} from '../../site/knight-eps-phase12/viewer/vendor/three/build/three.module.js';
function fixture(){
 const world=new Group(),payload=new Group();payload.name='Payload';world.add(payload);
 const part=(name,parent=world)=>{const m=new Mesh(new BoxGeometry(.02,.05,.02),new MeshBasicMaterial());m.name=name;parent.add(m);return m};
 const board=part('PCB'),cell=part('Cell'),body=part('NerdMiner_Board_LCD',payload),screw=part('Screw',payload);cell.position.x=.16;payload.position.x=-.16;
 const components={PCB:{group:'floor_electronics',mounting_normal:[0,0,1]},Cell:{group:'battery_assembly'},NerdMiner_Board_LCD:{group:'miner',display_info:{fields:['battery_voltage_v']}},Screw:{group:'miner'}};
 return {world,payload,board,cell,body,screw,inspection:createInspection([board,cell,body,screw],components,payload,world)};
}
test('payload leaves share one logical selection without changing CAD ownership',()=>{
 const {inspection,payload,body,screw,board}=fixture();
 assert.equal(inspection.canonical(body),payload);assert.equal(inspection.canonical(screw),payload);
 assert.deepEqual(inspection.members(payload),[body,screw]);assert.deepEqual(inspection.members(board),[board]);assert.deepEqual(inspection.members(null),[]);
 assert.equal(inspection.items.length,3);assert.equal(body.parent,payload);assert.equal(screw.parent,payload);
 assert.equal(inspection.info(payload.name).label,'Payload');assert.deepEqual(inspection.info(payload.name).display_info.fields,['battery_voltage_v']);
});
test('head-on PCB focus follows its current parent transform',()=>{
 const {inspection,world,board}=fixture();world.rotation.x=-Math.PI/2;
 const pose=inspection.view(board,new Vector3());assert.ok(pose.pcb);
 assert.ok(pose.direction.distanceTo(new Vector3(0,1,0))<1e-10);assert.ok(Math.abs(pose.direction.dot(pose.up))<1e-10);
 board.rotation.y=Math.PI/2;const moved=inspection.view(board,new Vector3());assert.ok(moved.direction.distanceTo(new Vector3(1,0,0))<1e-10);
});
test('battery and payload focus approach their outside faces',()=>{
 const {inspection,payload,cell}=fixture();
 assert.ok(inspection.view(cell,new Vector3()).direction.x>.9);
 assert.ok(inspection.view(payload,new Vector3()).direction.x<-.9);
});
test('opposite-side focus transition keeps its distance from the orbit anchor',()=>{
 const before={position:new Vector3(-1,0,0),target:new Vector3(),up:new Vector3(0,1,0)},after={position:new Vector3(1,0,0),target:new Vector3(),up:new Vector3(0,1,0)};
 for(const t of [0,.25,.5,.75,1]){const pose=orbitTransition(before,after,t);assert.ok(Math.abs(pose.position.distanceTo(pose.target)-1)<1e-10);assert.ok(Number.isFinite(pose.up.length()))}
 assert.ok(orbitTransition(before,after,0).position.distanceTo(before.position)<1e-10);assert.ok(orbitTransition(before,after,1).position.distanceTo(after.position)<1e-10);
});
test('battery pack owns holder and four cells logically, with complete inspection bounds',()=>{
 const world=new Group(),parts=[];
 for(const [i,name] of ['BatteryHolder_4x18650_CAD','BatteryCell_01','BatteryCell_02','BatteryCell_03','BatteryCell_04'].entries()){
  const part=new Mesh(new BoxGeometry(.01,.02,.03),new MeshBasicMaterial());part.name=name;part.position.set(.16,0,i*.02);world.add(part);parts.push(part);
 }
 const components=Object.fromEntries(parts.map(p=>[p.name,{group:'battery_assembly',display_info:{fields:['battery_voltage_v']}}]));
 const inspect=createInspection(parts,components,null,world),pack=inspect.canonical(parts[0]);
 assert.equal(pack.name,'BatteryPack_4x18650');assert.deepEqual(inspect.items,[pack]);
 for(const part of parts){assert.equal(inspect.canonical(part),pack);assert.equal(part.parent,world)}
 assert.deepEqual(inspect.members(pack),parts);assert.equal(inspect.info(pack.name).label,'Battery pack');
 const bounds=inspect.bounds(pack);assert.ok(Math.abs(bounds.getSize(new Vector3()).z-.11)<1e-7);
 assert.ok(inspect.view(pack,new Vector3()).direction.x>.8);
});

test('floor-board focus returns to upright orbit without a polar singularity',()=>{
 const anchor=new Vector3(.01,.05,-.02);
 for(const sign of [-1,1])for(const screenUp of [new Vector3(0,0,-1),new Vector3(1,0,0)]){
  const before={position:new Vector3(.03,.2*sign,.01),target:new Vector3(.03,0,.01),up:screenUp},after=satelliteOrbitPose(before,anchor);
  const offset=after.position.clone().sub(after.target);
  assert.ok(after.up.equals(new Vector3(0,1,0)));assert.ok(after.target.equals(anchor));
  assert.ok(Math.abs(offset.length()-.2)<1e-12);assert.ok(Math.hypot(offset.x,offset.z)/offset.length()>.08);
  assert.equal(Math.sign(offset.y),sign);
  for(const t of [0,.25,.5,.75,1]){const pose=orbitTransition(before,after,t);assert.ok(pose.up.clone().cross(pose.position.clone().sub(pose.target).normalize()).length()>.08)}
 }
});
test('ordinary inspection returns upright while preserving angle and distance',()=>{
 const before={position:new Vector3(.32,.08,.05),target:new Vector3(.16,.05,0),up:new Vector3(0,1,0)},anchor=new Vector3(0,.048,0),after=satelliteOrbitPose(before,anchor);
 assert.ok(after.position.clone().sub(after.target).distanceTo(before.position.clone().sub(before.target))<1e-12);
 assert.ok(after.up.equals(before.up));assert.ok(before.target.equals(new Vector3(.16,.05,0)));
});
