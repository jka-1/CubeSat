/** Rebuild browser geometry from the original assembly and supplied CAD exports.
 * Run: node scripts/build-detailed-twin.mjs [path/to/Final_Models_V1.zip]
 * Power-board inputs: model-sources/power-boards/ (hash-pinned supplied exports).
 * KNIGHT_TWIN_OUTPUT can stage a candidate before adoption.
 * No decimation or nonuniform scaling: millimeters become meters, then rigid CAD rotations.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from '../site/knight-eps-phase12/viewer/vendor/three/build/three.core.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'site/knight-eps-phase12');
const outputBase=process.env.KNIGHT_TWIN_OUTPUT?path.resolve(process.env.KNIGHT_TWIN_OUTPUT):base;
fs.mkdirSync(path.join(outputBase,'models'),{recursive:true});fs.mkdirSync(path.join(outputBase,'docs'),{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'knight-cad-'));
const archive=process.argv[2]||path.join(root,'model-sources/Final_Models_V1.zip');
function read(file){const b=fs.readFileSync(file),n=b.readUInt32LE(12);return {json:JSON.parse(b.subarray(20,20+n)),bin:b.subarray(28+n)}}
const original=read(path.join(base,'models/KnightEPS_Phase10.glb'));
const out=structuredClone(original.json);
// Repack only referenced data at the end, so the replaced geometry is absent from the output.
let chunks=[original.bin],length=original.bin.length;
function append(buffer){const padded=Buffer.alloc((buffer.length+3)&~3);buffer.copy(padded);const offset=length;chunks.push(padded);length+=padded.length;return offset}
function accessor(array,size,type=5126){const index=out.bufferViews.length;const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);out.bufferViews.push({buffer:0,byteOffset:append(bytes),byteLength:bytes.length});const a={bufferView:index,componentType:type,count:array.length/size,type:{1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'}[size]};if(size===3){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<array.length;i++) {let k=i%3;a.min[k]=Math.min(a.min[k],array[i]);a.max[k]=Math.max(a.max[k],array[i])}}out.accessors.push(a);return out.accessors.length-1}
function values(g,id){const a=g.json.accessors[id],v=g.json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],bytes={5126:4,5125:4,5123:2,5121:1}[a.componentType];const array=a.componentType===5126?new Float32Array(a.count*size):new Uint32Array(a.count*size);for(let i=0;i<a.count;i++)for(let k=0;k<size;k++){const off=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||bytes*size)+k*bytes;array[i*size+k]=a.componentType===5126?g.bin.readFloatLE(off):a.componentType===5125?g.bin.readUInt32LE(off):a.componentType===5123?g.bin.readUInt16LE(off):g.bin.readUInt8(off)}return array}
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Offsets anchor the substrate support face, not the changing populated bounding box.
// Axes are the source axes for each local output axis; signs preserve connector orientation.
const specifications=[
 ['INA226','INA226_v12',[0,2,1],[1,-1,1],[-.017135,.0048675984,-.02206]],
 ['Regulator_01','Regulator_PCB',[1,2,0],[-1,-1,1],[.049365,.00391741097,-.03428]],
 ['Regulator_02','Regulator_PCB',[1,2,0],[-1,-1,1],[.049365,.00391741097,-.03428]],
 ['MCU_Final','Final_MCU_v12',[1,0,2],[1,-1,1],[-.06143,.06476,-.00716289133]],
 ['LightSensor','lightsens',[1,0,2],[-1,1,1],[.045555,-.066665,-.00395040283]],
 ['TemperatureSensor','tempsens',[2,0,1],[-1,1,-1],[.00395039842,-.034915,.043015]],
 ['BMS_BQ76942','Knight_EPS_BMS_Final_green.glb',[0,1,2],[1,1,1],[-.03330040314793587,-.02667,-.0024687983095645905]],
 ['Charger_BMS034A_EVM','Knight_EPS_MPPT_High_Fidelity_Gerber_v4.glb',[0,1,2],[1,1,1],[-.04395015165,-.04112153128,-.00322057074]]
];
const report={archive_sha256:sha(archive),units:'meters',optimization:'Merge by material within each PCB; retain all triangles and artwork. Reuse regulator geometry. Strip unreferenced legacy geometry.',boards:[],limitations:['The supplied regulator substrate is 32.69 × 43.16 mm; the previous substrate was 33.96 × 40.62 mm. Substrate center, underside and connector orientation are retained at true scale. Retaining fixtures follow the measured outline delta: bottom pairs move down 1.27 mm and side pairs move inward 0.635 mm; support depth is unchanged.','Existing mounts are illustrative and require clip spring deflection (up to approximately 0.482 mm); no physical fit certification is implied.']};
const replacementHashes={
 'Knight_EPS_BMS_Final_green.glb':'19157890e571f6dc2b74fff6eea2dc763ac4936c0612e53cda3ce80f8ff53145',
 'Knight_EPS_MPPT_High_Fidelity_Gerber_v4.glb':'ca9d409e9b038669eaef278d4e0ecd4fb3e41a0667d531ff192458be4e378613'
};
const cache=new Map();
try{
 execFileSync('unzip',['-q',archive,'Final Models_V1/*','-d',temp]);
 for(const [id,file,axes,signs,offset] of specifications){
  const replacement=file.endsWith('.glb'),filename=replacement?file:file+'_high_detail.glb',source=replacement?path.join(root,'model-sources/power-boards',filename):path.join(temp,'Final Models_V1',filename),g=read(source),node=out.nodes.find(n=>n.name===id);
  if(replacement&&sha(source)!==replacementHashes[filename])throw Error('Replacement source changed; re-audit datums: '+filename);
  if(!node||node.mesh===undefined)throw Error(`Missing original ${id}`);
  const oldPrimitive=out.meshes[node.mesh].primitives[0],oldBounds=out.accessors[oldPrimitive.attributes.POSITION];
  let built=cache.get(file);
  if(!built){
   const materialOffset=out.materials.length,textureOffset=(out.textures||=[]).length,imageOffset=(out.images||=[]).length,samplerOffset=(out.samplers||=[]).length;
   for(const image of g.json.images||[]){const v=g.json.bufferViews[image.bufferView];const view=out.bufferViews.length;out.bufferViews.push({buffer:0,byteOffset:append(g.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)),byteLength:v.byteLength});out.images.push({...image,bufferView:view})}
   out.samplers.push(...g.json.samplers||[]);
   for(const texture of g.json.textures||[])out.textures.push({...texture,source:texture.source+imageOffset,...(texture.sampler===undefined?{}:{sampler:texture.sampler+samplerOffset})});
   function remapTextures(value){if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){if(k.endsWith('Texture')&&v?.index!==undefined)v.index+=textureOffset;else remapTextures(v)}}
   for(const material of g.json.materials){const m=structuredClone(material);remapTextures(m);m.name=`${file} / ${m.name}`;out.materials.push(m)}
   const batches=new Map();let sourceDraws=0,triangles=0;const bounds=new THREE.Box3(),substrate=new THREE.Box3();
   const sourceNodes=[];
   function visitSource(i,parent=new THREE.Matrix4()){
    const n=g.json.nodes[i],local=n.matrix?new THREE.Matrix4().fromArray(n.matrix):new THREE.Matrix4().compose(new THREE.Vector3(...n.translation||[0,0,0]),new THREE.Quaternion(...n.rotation||[0,0,0,1]),new THREE.Vector3(...n.scale||[1,1,1]));
    const matrix=parent.clone().multiply(local);if(n.mesh!==undefined)sourceNodes.push({n,matrix});for(const child of n.children||[])visitSource(child,matrix);
   }
   for(const i of g.json.scenes[g.json.scene||0].nodes)visitSource(i);
   const mapping=new THREE.Matrix4().set(signs[0]*(axes[0]===0),signs[0]*(axes[0]===1),signs[0]*(axes[0]===2),0,signs[1]*(axes[1]===0),signs[1]*(axes[1]===1),signs[1]*(axes[1]===2),0,signs[2]*(axes[2]===0),signs[2]*(axes[2]===1),signs[2]*(axes[2]===2),0,0,0,0,1).scale(new THREE.Vector3(.001,.001,.001)).setPosition(...offset);
   for(const {n,matrix} of sourceNodes){
    for(const p of g.json.meshes[n.mesh].primitives){
     if(replacement&&Object.keys(p.attributes).some(k=>!['POSITION','NORMAL','TEXCOORD_0'].includes(k)))throw Error('Unreviewed replacement attribute schema');
     const pos=values(g,p.attributes.POSITION),uv=p.attributes.TEXCOORD_0===undefined?null:values(g,p.attributes.TEXCOORD_0),indices=p.indices===undefined?Uint32Array.from({length:pos.length/3},(_,i)=>i):values(g,p.indices);
     const transform=mapping.clone().multiply(matrix),geometry=new THREE.BufferGeometry();
     geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
     // Preserve supplied normals; these two exports omit them, so only those
     // missing attributes are generated using their original indexed topology.
     if(replacement&&p.attributes.NORMAL!==undefined)geometry.setAttribute('normal',new THREE.BufferAttribute(values(g,p.attributes.NORMAL),3));
     else if(replacement)geometry.computeVertexNormals();
     geometry.applyMatrix4(transform);
     if(!replacement)geometry.computeVertexNormals();
     if(transform.determinant()<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
     const normal=geometry.getAttribute('normal').array;
     for(let i=0;i<pos.length;i+=3){const point=new THREE.Vector3().fromArray(pos,i);bounds.expandByPoint(point);if(replacement?n.name==='PCB_board_material0':n.name.startsWith('Board_1_')&&n.name.endsWith('_0'))substrate.expandByPoint(point)}
     const key=`${p.material}/${!!uv}`,batch=batches.get(key)||{material:p.material+materialOffset,positions:[],normals:[],uvs:[],indices:[],vertices:0,names:[]};
     batch.positions.push(pos);batch.normals.push(normal);if(uv)batch.uvs.push(uv);batch.indices.push(Uint32Array.from(indices,x=>x+batch.vertices));batch.vertices+=pos.length/3;batch.names.push(n.name);batches.set(key,batch);sourceDraws++;triangles+=indices.length/3;
    }
   }
   function concat(arrays,Type){const a=new Type(arrays.reduce((n,a)=>n+a.length,0));let i=0;for(const x of arrays){a.set(x,i);i+=x.length}return a}
   const children=[];
   for(const batch of batches.values()){const attributes={POSITION:accessor(concat(batch.positions,Float32Array),3),NORMAL:accessor(concat(batch.normals,Float32Array),3)};if(batch.uvs.length)attributes.TEXCOORD_0=accessor(concat(batch.uvs,Float32Array),2);const mesh=out.meshes.length;out.meshes.push({name:`${file}_material_${batch.material}`,primitives:[{attributes,indices:accessor(concat(batch.indices,Uint32Array),1,5125),material:batch.material}]});children.push(out.nodes.length);out.nodes.push({name:`Detailed_${file}_${children.length}`,mesh,extras:{source_nodes:batch.names,source_asset:filename}})}
   built={children,triangles,sourceDraws,draws:children.length,bounds:[bounds.min.toArray(),bounds.max.toArray()],substrate:[substrate.min.toArray(),substrate.max.toArray()]};cache.set(file,built);
  }
  // Each board owns distinct child nodes; both regulator instances share immutable meshes.
  delete node.mesh;node.children=built.children.map(i=>{const n=structuredClone(out.nodes[i]);n.name=`${id}_${n.name}`;out.nodes.push(n);return out.nodes.length-1});node.extras={...node.extras,geometry_status:'user_supplied_high_detail',source_asset:filename,source_sha256:sha(source)};
  report.boards.push({id,source:filename,source_path:replacement?'model-sources/power-boards/'+filename:'Final Models_V1/'+filename,sha256:sha(source),axes,signs,offset_m:offset,original_local_bounds:[oldBounds.min,oldBounds.max],local_bounds:built.bounds,substrate_local_bounds:built.substrate,triangles:built.triangles,source_draws:built.sourceDraws,draws:built.draws});
 }
 // The revised regulator outline differs by exact 0.05/0.10 inch increments.
 // Follow its measured edges with each complete clip/base pair, retaining the
 // board anchor, support depth, spring engagement and fixture scale/orientation.
 report.fixture_adjustments=[];
 for(const n of out.nodes){
  if(!/^Mount_Regulator_0[12]_/.test(n.name))continue;
  const delta=n.extras.wall_role==='bottom'?[0,0,-.00127]:n.extras.wall_role==='left_side'?[.000635,0,0]:[-.000635,0,0];
  n.translation=n.translation.map((x,i)=>x+delta[i]);
  report.fixture_adjustments.push({id:n.name,cad_offset_m:delta});
 }
 // Record the actual imported envelopes in both CAD and website coordinates.
 const transforms=new Map();
 function worldTransforms(i,parent=new THREE.Matrix4()){
  const n=out.nodes[i],local=n.matrix?new THREE.Matrix4().fromArray(n.matrix):new THREE.Matrix4().compose(new THREE.Vector3(...n.translation||[0,0,0]),new THREE.Quaternion(...n.rotation||[0,0,0,1]),new THREE.Vector3(...n.scale||[1,1,1]));
  const matrix=parent.clone().multiply(local);transforms.set(n.name,matrix);for(const c of n.children||[])worldTransforms(c,matrix);
 }
 for(const scene of out.scenes)for(const i of scene.nodes)worldTransforms(i);
 const metadataPath=path.join(base,'docs/component_manifest.json'),metadata=JSON.parse(fs.readFileSync(metadataPath));
 const cadFromWorld=new THREE.Matrix4().fromArray(metadata.orientation.cad_to_gltf_root_matrix_column_major).invert();
 function updateBounds(id,localBounds){const worldMatrix=transforms.get(id),world=new THREE.Box3(new THREE.Vector3(...localBounds[0]),new THREE.Vector3(...localBounds[1])).applyMatrix4(worldMatrix),cad=new THREE.Box3(new THREE.Vector3(...localBounds[0]),new THREE.Vector3(...localBounds[1])).applyMatrix4(cadFromWorld.clone().multiply(worldMatrix));const part=metadata.components[id];part.world_bbox_m=[world.min.toArray(),world.max.toArray()];part.world_center_m=world.getCenter(new THREE.Vector3()).toArray();part.cad_bbox_m=[cad.min.toArray(),cad.max.toArray()];part.cad_center_m=cad.getCenter(new THREE.Vector3()).toArray();return {world_bounds_m:part.world_bbox_m,cad_bounds_m:part.cad_bbox_m}}
 for(const board of report.boards){Object.assign(board,updateBounds(board.id,board.local_bounds));const part=metadata.components[board.id];part.active_source=board.source_path;part.geometry_status='user_supplied_high_detail';part.triangles=board.triangles;part.description=part.display_info.purpose;part.model_upgrade={source_sha256:board.sha256,report:'model-upgrades.json'}}
 for(const adjustment of report.fixture_adjustments){const n=out.nodes.find(n=>n.name===adjustment.id),p=out.meshes[n.mesh].primitives[0],a=out.accessors[p.attributes.POSITION];updateBounds(adjustment.id,[a.min,a.max]);metadata.components[adjustment.id].outline_correction_m=adjustment.cad_offset_m}
 fs.writeFileSync(path.join(outputBase,'docs/component_manifest.json'),JSON.stringify(metadata,null,2)+'\n');
 // Keep the original hierarchy/IDs and only its reachable nodes and mesh data.
 const nodeMap=new Map();function visit(i){if(nodeMap.has(i))return;nodeMap.set(i,nodeMap.size);for(const c of out.nodes[i].children||[])visit(c)}for(const scene of out.scenes)for(const i of scene.nodes)visit(i);
 out.nodes=[...nodeMap].map(([i])=>{const n=out.nodes[i];if(n.children)n.children=n.children.map(i=>nodeMap.get(i));return n});for(const scene of out.scenes)scene.nodes=scene.nodes.map(i=>nodeMap.get(i));
 function compact(key,ids){const map=new Map([...new Set(ids)].map((id,i)=>[id,i]));out[key]=[...map.keys()].map(i=>out[key][i]);return i=>map.get(i)}
 const meshMap=compact('meshes',out.nodes.filter(n=>n.mesh!==undefined).map(n=>n.mesh));for(const n of out.nodes)if(n.mesh!==undefined)n.mesh=meshMap(n.mesh);
 const primitives=out.meshes.flatMap(m=>m.primitives);const matMap=compact('materials',primitives.map(p=>p.material));for(const p of primitives)p.material=matMap(p.material);
 const acMap=compact('accessors',primitives.flatMap(p=>[...Object.values(p.attributes),p.indices]));for(const p of primitives){p.indices=acMap(p.indices);for(const k in p.attributes)p.attributes[k]=acMap(p.attributes[k])}
 const allBinary=Buffer.concat(chunks);chunks=[];length=0;
 const bvMap=compact('bufferViews',[...out.accessors.map(a=>a.bufferView),...out.images.map(i=>i.bufferView)]);for(const a of out.accessors)a.bufferView=bvMap(a.bufferView);for(const i of out.images)i.bufferView=bvMap(i.bufferView);
 for(const view of out.bufferViews){const bytes=allBinary.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);view.byteOffset=append(bytes)}
 out.buffers=[{byteLength:length}];out.asset.generator='Knight EPS detailed PCB compiler';const json=Buffer.from(JSON.stringify(out));const jsonPad=Buffer.alloc((json.length+3)&~3,32);json.copy(jsonPad);const binary=Buffer.concat(chunks),header=Buffer.alloc(20),bh=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonPad.length+binary.length,8);header.writeUInt32LE(jsonPad.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);
 const destination=path.join(outputBase,'models/KnightEPS_Detailed.glb');fs.writeFileSync(destination,Buffer.concat([header,jsonPad,bh,binary]));report.output_sha256=sha(destination);report.output_bytes=fs.statSync(destination).size;
 report.logical_triangles=Object.values(metadata.components).reduce((n,p)=>n+p.triangles,0);
 report.power_board_policy='New exports retain all triangles, original materials, embedded RGBA images and indexed topology; absent normals generated. Units mm to m; translation anchors substrate underside and XY datums. No additional fixture movement for the replacement pair.';

 fs.writeFileSync(path.join(outputBase,'docs/model-upgrades.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({bytes:report.output_bytes,boards:report.boards.map(({id,triangles,source_draws,draws})=>({id,triangles,source_draws,draws}))},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true})}
