import {Box3,Vector3,Quaternion,Group} from 'three';

// Logical assemblies keep physical CAD ownership and geometry unchanged.
export function createInspection(parts,components,payload,world){
 const payloadParts=parts.filter(p=>components[p.name]?.group==='miner');
 const batteryParts=parts.filter(p=>components[p.name]?.group==='battery_assembly');
 const battery=new Group();battery.name='BatteryPack_4x18650';
 const batterySource=components.BatteryHolder_4x18650_CAD;
 const batteryInfo={...batterySource,group:'battery_assembly',label:'Battery pack',description:'Four 18650 cells with their holder and contacts.',display_info:{...batterySource?.display_info,name:'Battery pack',model:'4 × 18650 battery pack',purpose:'Four battery cells with their holder and contacts.'}};
 const source=components.NerdMiner_Board_LCD;
 const payloadInfo={...source,label:'Payload',description:'Demonstration payload with its board, LCD, enclosure and mounting hardware.',display_info:{...source?.display_info,name:'Payload',purpose:'Demonstration payload with its board, LCD, enclosure and mounting hardware.'}};
 const info=name=>name===battery.name?batteryInfo:name===payload?.name?payloadInfo:components[name]||{label:name,group:'other',provisional:true};
 const canonical=part=>part&&info(part.name).group==='miner'?payload:part&&info(part.name).group==='battery_assembly'?battery:part;
 const members=part=>!part?[]:part===payload?payloadParts:part===battery?batteryParts:[part];
 const bounds=part=>{const box=new Box3();for(const member of members(part))box.expandByObject(member);return box};
 const items=parts.filter(p=>!payloadParts.includes(p)&&!batteryParts.includes(p));if(payload)items.push(payload);if(batteryParts.length)items.push(battery);
 const frames=new Map();world.updateWorldMatrix(true,true);
 for(const part of parts){
  const p=info(part.name);
  if(!p.mounting_normal||!(['floor_electronics','side_wall_electronics','rear_wall_electronics'].includes(p.group)||part.name==='LightSensor'))continue;
  const normal=new Vector3(...p.mounting_normal).normalize();
  const up=Math.abs(normal.z)>.9?new Vector3(0,1,0):new Vector3(0,0,1);
  // Store in the part's frame, so opening the lid or another parent transform
  // also rotates its focus frame. The mounting normal faces the components.
  const inverse=part.matrixWorld.clone().invert();
  frames.set(part,{normal:normal.transformDirection(world.matrixWorld).transformDirection(inverse),up:up.transformDirection(world.matrixWorld).transformDirection(inverse)});
 }
 function view(part,center){
  part.updateWorldMatrix(true,true);const frame=frames.get(part);
  if(frame)return {direction:frame.normal.clone().transformDirection(part.matrixWorld),up:frame.up.clone().transformDirection(part.matrixWorld),pcb:true};
  if(part===payload||info(part.name).group==='battery_assembly'){
   const direction=bounds(part).getCenter(new Vector3()).sub(center);direction.y=0;
   if(direction.lengthSq()<1e-8)direction.set(part===payload?-1:1,0,0);
   direction.normalize().add(new Vector3(0,.18,.3)).normalize();return {direction,up:new Vector3(0,1,0),pcb:false};
  }
  return {direction:new Vector3(-1,1.05,1.25).normalize(),up:new Vector3(0,1,0),pcb:false};
 }
 return {info,canonical,members,items,view,bounds};
}

// Return inspection framing to the Y-up orbit used by the assembly controls.
// Looking exactly along Y makes azimuth singular; retain distance and use the
// inspection screen-up direction to approach a small, stable polar clearance.
export function satelliteOrbitPose(before,target){
 const up=new Vector3(0,1,0),offset=before.position.clone().sub(before.target),distance=offset.length();
 const horizontal=new Vector3(offset.x,0,offset.z),minimum=Math.sin(Math.PI/36);
 if(distance&&horizontal.length()/distance<minimum){
  const sign=offset.y<0?-1:1;
  if(horizontal.length()/distance<1e-4){horizontal.copy(before.up).setY(0).multiplyScalar(-sign);if(horizontal.lengthSq()<1e-12)horizontal.set(0,0,1)}
  horizontal.normalize().multiplyScalar(distance*minimum);
  offset.set(horizontal.x,sign*distance*Math.cos(Math.PI/36),horizontal.z);
 }
 return {position:target.clone().add(offset),target:target.clone(),up};
}

// Arc around the orbit anchor rather than travel straight through the model.
export function orbitTransition(before,after,t){
 const from=before.position.clone().sub(before.target),to=after.position.clone().sub(after.target);
 const rotation=new Quaternion().setFromUnitVectors(from.clone().normalize(),to.clone().normalize());
 const turn=new Quaternion().slerp(rotation,t),target=before.target.clone().lerp(after.target,t);
 const position=from.normalize().applyQuaternion(turn).multiplyScalar((1-t)*before.position.distanceTo(before.target)+t*after.position.distanceTo(after.target)).add(target);
 const up=before.up.clone().lerp(after.up,t).normalize();
 return {position,target,up};
}
