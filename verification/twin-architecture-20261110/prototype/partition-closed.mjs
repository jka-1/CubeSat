import {BufferGeometry,BufferAttribute} from 'three';
const cache=new WeakMap();
export function partitionClosed(geometry,ranges){
 const key=JSON.stringify(ranges),old=cache.get(geometry);if(old){if(old.key!==key)throw Error('Inconsistent closed-face partition');return old.geometry}
 if(geometry.groups.length)throw Error('Partition requires a single source primitive');
 const source=geometry.index?.array||Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i),mask=new Uint8Array(source.length/3);let closed=0,last=0;
 for(const [start,count] of ranges){
  if(start%3||count%3||count<=0||start<last||start+count>source.length)throw Error('Invalid closed-face range');
  mask.fill(1,start/3,(start+count)/3);closed+=count;last=start+count;
 }
 if(!closed||closed===source.length)throw Error('Partition must contain both closed and retained faces');
 const index=new source.constructor(source.length);let a=0,b=closed;
 for(let t=0;t<mask.length;t++){let at=mask[t]?a:b;for(let k=0;k<3;k++)index[at++]=source[t*3+k];if(mask[t])a=at;else b=at}
 const out=new BufferGeometry();for(const [name,attribute] of Object.entries(geometry.attributes))out.setAttribute(name,attribute);
 out.setIndex(new BufferAttribute(index,1));out.addGroup(0,closed,0);out.addGroup(closed,index.length-closed,1);
 out.boundingBox=geometry.boundingBox?.clone()||null;out.boundingSphere=geometry.boundingSphere?.clone()||null;
 cache.set(geometry,{key,geometry:out});return out;
}
