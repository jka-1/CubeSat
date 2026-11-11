// Reuse validated consolidation offline. Preserve physical detail and identities;
// deduplicate identical output buffers/meshes, including the regulator instances.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r176/three.module.js';
import {GLTFLoader} from './vendor/OfflineGLTFLoader.mjs';
import {deduplicateMaterials,consolidateComponent} from './vendor/offline-consolidation.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..'),base=path.join(root,'site/knight-eps-phase12');
const raw=fs.readFileSync(path.join(base,'models/KnightEPS_Detailed.glb')),jn=raw.readUInt32LE(12),source=JSON.parse(raw.subarray(20,20+jn)),binary=raw.subarray(28+jn);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHash=hash(raw);
if(sourceHash!=='dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47')throw Error('Unexpected canonical source');
const metadata=JSON.parse(fs.readFileSync(path.join(base,'docs/component_manifest.json')));
// Texture placeholders avoid browser-only decoding. Original PNG bytes,
// materials, samplers, texture references and metadata are copied unchanged.
globalThis.self=globalThis;
const loader=new GLTFLoader();
loader.register(parser=>({name:'KNIGHT_OFFLINE_TEXTURE_REFERENCE',loadTexture(index){const t=new THREE.Texture();t.name='source_texture_'+index;return Promise.resolve(t)}}));
const gltf=await loader.parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
deduplicateMaterials(gltf.scene);
let before=0;gltf.scene.traverse(m=>{if(m.isMesh)before+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});
for(const id of Object.keys(metadata.components)){const part=gltf.scene.getObjectByName(id);if(!part)throw Error('Missing component '+id);consolidateComponent(part,metadata.display.mesh_name)}
const out={asset:{version:'2.0',generator:'Knight EPS isolated display compiler'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:source.materials,textures:source.textures,images:structuredClone(source.images),samplers:source.samplers,extensionsUsed:source.extensionsUsed,accessors:[],bufferViews:[],buffers:[]};
const chunks=[],viewCache=new Map(),accessorCache=new Map(),meshCache=new Map();let length=0;
function view(bytes){const key=hash(bytes);if(viewCache.has(key))return viewCache.get(key);const id=out.bufferViews.length,pad=Buffer.alloc((bytes.length+3)&~3);bytes.copy(pad);out.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(pad);length+=pad.length;viewCache.set(key,id);return id}
for(let i=0;i<out.images.length;i++){const original=source.bufferViews[source.images[i].bufferView],start=original.byteOffset||0;out.images[i].bufferView=view(binary.subarray(start,start+original.byteLength))}
const types=new Map([[Float32Array,5126],[Uint32Array,5125],[Uint16Array,5123],[Uint8Array,5121],[Int16Array,5122],[Int8Array,5120]]);
function accessor(array,itemSize,normalized=false,position=false){
 const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),a={bufferView:view(bytes),componentType:types.get(array.constructor),count:array.length/itemSize,type:{1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'}[itemSize]};
 if(!a.componentType||!a.type)throw Error('Unsupported attribute schema');if(normalized)a.normalized=true;
 if(position){a.min=Array(itemSize).fill(Infinity);a.max=Array(itemSize).fill(-Infinity);for(let i=0;i<array.length;i++){const k=i%itemSize;a.min[k]=Math.min(a.min[k],array[i]);a.max[k]=Math.max(a.max[k],array[i])}}
 const key=JSON.stringify(a);if(accessorCache.has(key))return accessorCache.get(key);const id=out.accessors.length;out.accessors.push(a);accessorCache.set(key,id);return id;
}
const names={position:'POSITION',normal:'NORMAL',uv:'TEXCOORD_0',uv1:'TEXCOORD_1',color:'COLOR_0',tangent:'TANGENT'};
function meshIndex(mesh){
 const geo=mesh.geometry,attributes={};for(const [name,a] of Object.entries(geo.attributes)){if(a.isInterleavedBufferAttribute||!names[name])throw Error('Unsupported geometry attribute '+name);attributes[names[name]]=accessor(a.array,a.itemSize,a.normalized,name==='position')}
 const count=geo.index?.count||geo.attributes.position.count,groups=geo.groups.length?geo.groups:[{start:0,count,materialIndex:0}],materials=[mesh.material].flat();
 const primitives=groups.map(group=>{const material=materials[group.materialIndex||0],association=gltf.parser.associations.get(material);if(association?.materials===undefined)throw Error('Lost source material association');let indices=geo.index?geo.index.array.slice(group.start,group.start+group.count):Uint32Array.from({length:group.count},(_,i)=>group.start+i);let maximum=0;for(const i of indices)maximum=Math.max(maximum,i);indices=maximum<=65535?Uint16Array.from(indices):Uint32Array.from(indices);return {attributes,indices:accessor(indices,1),material:association.materials}});
 const key=JSON.stringify(primitives);if(meshCache.has(key))return meshCache.get(key);const id=out.meshes.length;out.meshes.push({name:mesh.name,primitives});meshCache.set(key,id);return id;
}
function nodeIndex(object){
 const id=out.nodes.length,extras=structuredClone(object.userData);if(extras.framingPoints)extras.framingPoints=object.userData.framingPoints.map(v=>v.toArray());
 const node={name:object.name,translation:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray(),extras};out.nodes.push(node);
 if(object.isMesh)node.mesh=meshIndex(object);if(object.children.length)node.children=object.children.map(nodeIndex);return id;
}
out.scenes[0].nodes=gltf.scene.children.map(nodeIndex);out.buffers=[{byteLength:length}];
let after=0;function visit(i){const n=out.nodes[i];if(n.mesh!==undefined)for(const p of out.meshes[n.mesh].primitives)after+=out.accessors[p.indices].count/3;for(const c of n.children||[])visit(c)}for(const i of out.scenes[0].nodes)visit(i);
if(before!==874229||after!==before)throw Error('Triangle integrity failure');
const json=Buffer.from(JSON.stringify(out)),jp=Buffer.alloc((json.length+3)&~3,32);json.copy(jp);const header=Buffer.alloc(20),bh=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+jp.length+length,8);header.writeUInt32LE(jp.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(length);bh.writeUInt32LE(0x004e4942,4);
const asset=Buffer.concat([header,jp,bh,...chunks]);fs.mkdirSync(path.join(here,'assets'),{recursive:true});fs.writeFileSync(path.join(here,'assets/display.glb'),asset);
const report={sourceSHA256:sourceHash,outputSHA256:hash(asset),bytes:asset.length,sourceTriangles:before,outputTriangles:after,components:Object.keys(metadata.components).length,meshes:out.meshes.length,geometryBytes:length,physicalGeometryPolicy:'All triangles retained; rigid local baking matches existing consolidation. No quantization or decimation.',images:'Original image payloads and material definitions retained. No image decoding.'};fs.writeFileSync(path.join(here,'assets/build-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
