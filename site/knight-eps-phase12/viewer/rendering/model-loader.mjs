import {DataTexture,RedFormat,UnsignedByteType,LinearFilter,LinearMipmapLinearFilter,Vector3,NoColorSpace} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CoverageStandardMaterial} from './legacy-coverage.mjs';
import {LeanAcrylicMaterial} from './lean-acrylic.mjs';
import {decodeCoverage,decodeGzip} from './decode-coverage.mjs';

const base=new URL('../../models/display/',import.meta.url);
const sourceHash='f1ed146e43c7dd3291beed9599d9a4f42f3e54b726dde8600ad978be8ad649c4';
async function fetchAsset(name,kind){
 const response=await fetch(new URL(name,base));
 if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
 return kind==='json'?response.json():response.arrayBuffer();
}

export async function loadDisplayModel(timing={}){
 const start=performance.now();
 const loader=new GLTFLoader(),coverage=typeof DecompressionStream==='function';
 // Static gzip needs no server configuration. Older browsers keep the GLB
 // and embedded RGBA maps. HTTP-decoded gzip responses work too.
 const modelPromise=(async()=>{
  const downloaded=await fetchAsset(coverage?'display-compact.glb.gz':'display-compact.glb');
  timing.modelDownloadMs=performance.now()-start;timing.modelResponseBytes=downloaded.byteLength;
  const unpackStart=performance.now(),bytes=coverage?await decodeGzip(downloaded):downloaded;
  timing.modelUnpackMs=performance.now()-unpackStart;return bytes;
 })();
 const artworkPromise=coverage?(async()=>{
  const [info,zipped]=await Promise.all([fetchAsset('artwork-masks.json','json'),fetchAsset('artwork-masks.bin.gz')]);
  if(info.sourceSHA256!==sourceHash)throw Error('Artwork belongs to another model');
  const unpackStart=performance.now(),bytes=await decodeCoverage(zipped,info.decodedMaskBytes);
  timing.artworkUnpackMs=performance.now()-unpackStart;return {info,bytes};
 })():null;
 const [bytes,certificate,artwork]=await Promise.all([
  modelPromise,fetchAsset('closed-primitives-compact.json','json'),artworkPromise
 ]);
 const maskInfo=artwork?.info,maskBytes=artwork?.bytes;
 timing.assetsReadyMs=performance.now()-start;
 let certified=false;
 const verifyStart=performance.now();
 if(globalThis.crypto?.subtle){
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==certificate.displaySHA256)throw Error('Display model does not match its geometry certificate');
  certified=true;
 }
 timing.verifyMs=performance.now()-verifyStart;
 // On older browsers retain the original embedded RGBA artwork. Without a
 // secure-context hash API, keep both faces rather than trust the certificate.
 if(coverage){
  loader.register(()=>({name:'KNIGHT_COVERAGE_TEXTURE',loadTexture(index){
   const record=maskInfo.records.find(r=>r.textures.includes(index));if(!record)return null;
   const [w,h]=record.dimensions;
   if(record.length!==w*h||record.offset<0||record.offset+record.length>maskBytes.byteLength)throw Error('Invalid artwork dimensions');
   const texture=new DataTexture(new Uint8Array(maskBytes,record.offset,record.length),w,h,RedFormat,UnsignedByteType);
   texture.name='Coverage_'+record.image;texture.flipY=false;texture.unpackAlignment=1;texture.generateMipmaps=true;
   texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.colorSpace=NoColorSpace;
   texture.userData.coverage=record;texture.needsUpdate=true;return Promise.resolve(texture);
  }}));
 }
 const parseStart=performance.now(),gltf=await loader.parseAsync(bytes,base.href);
 timing.parseMs=performance.now()-parseStart;
 const rows=new Map(certificate.primitives.filter(p=>p.eligible).map(p=>[p.mesh+'/'+p.primitive,p]));
 gltf.scene.traverse(mesh=>{
  const association=gltf.parser.associations.get(mesh);
  if(mesh.isMesh&&certified&&association&&rows.has(association.meshes+'/'+association.primitives))mesh.userData.certifiedClosed=true;
  if(mesh.userData.framingPoints)mesh.userData.framingPoints=mesh.userData.framingPoints.map(v=>new Vector3(...v));
 });
 gltf.scene.userData.displayPackage={prepared:true,certified,coverageImages:maskInfo?.records.length||0};
 timing.totalMs=performance.now()-start;
 return gltf;
}

// Certification requires independent sidedness; coverage and acrylic classes
// preserve their shader behavior when the viewer clones selection overrides.
export function prepareDisplayModel(model){
 const coverage=new Map(),acrylic=new Map();
 model.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const convert=source=>{
   let material=mesh.userData.certifiedClosed?source.clone():source;
   if(material.map?.userData.coverage){
    // GLTFLoader marks base-color maps sRGB after the custom texture hook.
    // Coverage is linear data; its foreground color is decoded in the shader.
    material.map.colorSpace=NoColorSpace;
    if(!coverage.has(material))coverage.set(material,new CoverageStandardMaterial().copy(material));
    material=coverage.get(material);
   }
   if(material.transmission>0){
    if(!acrylic.has(material))acrylic.set(material,new LeanAcrylicMaterial().copy(material));
    material=acrylic.get(material);
   }
   return material;
  };
  mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);
 });
}

export function disposeModel(model){
 const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set();
 model?.traverse(mesh=>{if(mesh.isMesh){geometries.add(mesh.geometry);for(const material of [mesh.material].flat()){materials.add(material);for(const value of Object.values(material))if(value?.isTexture){textures.add(value);images.add(value.image)}}}});
 for(const resource of [...geometries,...materials,...textures])resource.dispose();
 for(const image of images)image?.close?.();
 model?.clear();
}
