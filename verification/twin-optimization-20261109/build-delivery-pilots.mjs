// Local derivatives only. Never invokes the CAD compiler or changes source assets.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {MeshoptEncoder} from './delivery-vendor/meshoptimizer-v0.18/meshopt_encoder.module.js';
import {MeshoptDecoder} from './delivery-vendor/three-r176/libs/meshopt_decoder.module.js';
const here=path.dirname(fileURLToPath(import.meta.url));
export const source=path.resolve(here,'../../site/knight-eps-phase12/models/KnightEPS_Detailed.glb');
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function readGLB(file){const bytes=fs.readFileSync(file),n=bytes.readUInt32LE(12);return {json:JSON.parse(bytes.subarray(20,20+n)),bin:bytes.subarray(28+n),bytes}}
export function writeGLB(file,json,bin){
 const j=Buffer.from(JSON.stringify(json)),jp=Buffer.alloc((j.length+3)&~3,32);j.copy(jp);
 const bp=Buffer.alloc((bin.length+3)&~3);bin.copy(bp);const h=Buffer.alloc(20),bh=Buffer.alloc(8);
 h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+jp.length+bp.length,8);h.writeUInt32LE(jp.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bp.length);bh.writeUInt32LE(0x004e4942,4);
 fs.writeFileSync(file,Buffer.concat([h,jp,bh,bp]));
}
export async function build(){
 const {json:g,bin,bytes}=readGLB(source),destination=path.join(here,'delivery-assets');fs.mkdirSync(destination,{recursive:true});
 const report={source:{bytes:bytes.length,sha256:sha(bytes)},geometry:{},textures:[],candidates:[]};
 await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
 const m=structuredClone(g),chunks=[];let length=0,decodedLength=0;
 function append(data){const p=Buffer.alloc((data.length+3)&~3);p.set(data);const offset=length;chunks.push(p);length+=p.length;return offset}
 const indexAccessors=new Set(g.meshes.flatMap(x=>x.primitives.map(p=>p.indices)).filter(x=>x!==undefined));
 for(const [i,v] of m.bufferViews.entries()){
  const data=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),accessors=g.accessors.map((a,id)=>({a,id})).filter(({a})=>a.bufferView===i);
  if(!accessors.length){v.byteOffset=append(data);continue}
  if(accessors.length!==1)throw Error('Unexpected shared/interleaved view '+i);
  const {a,id}=accessors[0],stride=v.byteStride||({SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]*{5126:4,5125:4,5123:2,5121:1}[a.componentType]);
  if(a.byteOffset||data.length!==a.count*stride)throw Error('Unexpected accessor layout '+id);
  const mode=indexAccessors.has(id)?'INDICES':'ATTRIBUTES';
  const encoded=MeshoptEncoder.encodeGltfBuffer(new Uint8Array(data),a.count,stride,mode);
  const decoded=new Uint8Array(data.length);MeshoptDecoder.decodeGltfBuffer(decoded,a.count,stride,encoded,mode);
  if(!Buffer.from(decoded).equals(data))throw Error('Lossless roundtrip failed '+id);
  decodedLength=(decodedLength+3)&~3;v.buffer=1;v.byteOffset=decodedLength;decodedLength+=data.length;
  v.extensions={...v.extensions,EXT_meshopt_compression:{buffer:0,byteOffset:append(encoded),byteLength:encoded.length,byteStride:stride,count:a.count,mode,filter:'NONE'}};
 }
 m.buffers=[{byteLength:length},{byteLength:decodedLength,extensions:{EXT_meshopt_compression:{fallback:true}}}];
 m.extensionsUsed=[...new Set([...(m.extensionsUsed||[]),'EXT_meshopt_compression'])];m.extensionsRequired=[...new Set([...(m.extensionsRequired||[]),'EXT_meshopt_compression'])];
 const meshFile=path.join(destination,'KnightEPS_Detailed-meshopt-lossless.glb');writeGLB(meshFile,m,Buffer.concat(chunks));
 report.geometry={decodedBytes:decodedLength,quantization:false,filters:'NONE',indexMode:'INDICES',encoderVersion:'0.18',roundtrip:'byte-exact for every attribute/index view'};
 report.candidates.push({name:'meshopt',file:path.basename(meshFile),bytes:fs.statSync(meshFile).size,sha256:sha(fs.readFileSync(meshFile))});
 const basis=process.env.KNIGHT_BASISU;if(!basis)throw Error('Set KNIGHT_BASISU to the pinned Basis Universal 1.16.4 executable');
 const t=structuredClone(g),tc=[bin];let tl=(bin.length+3)&~3;if(tl!==bin.length)tc.push(Buffer.alloc(tl-bin.length));
 for(const [index,label] of [[6,'regulator-top-copper'],[7,'regulator-bottom-copper'],[8,'regulator-silkscreen']]){
  const tex=t.textures[index],image=g.images[tex.source],v=g.bufferViews[image.bufferView],png=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
  const input=path.join(destination,label+'.png'),output=path.join(destination,label+'.ktx2');fs.writeFileSync(input,png);
  const args=['-ktx2','-uastc','-uastc_level','4','-ktx2_zstandard_level','18','-mipmap','-mip_srgb','-mip_filter','box','-force_alpha','-max_threads','2','-file',input,'-output_file',output];
  const log=execFileSync(basis,args,{encoding:'utf8',maxBuffer:4*1024*1024});fs.writeFileSync(path.join(destination,label+'-encode.txt'),log);
  const data=fs.readFileSync(output),imageIndex=t.images.length,viewIndex=t.bufferViews.length;t.bufferViews.push({buffer:0,byteOffset:tl,byteLength:data.length});t.images.push({bufferView:viewIndex,mimeType:'image/ktx2',name:label});tex.extensions={...tex.extensions,KHR_texture_basisu:{source:imageIndex}};
  tc.push(data);tl+=data.length;const padding=(-tl)&3;if(padding){tc.push(Buffer.alloc(padding));tl+=padding}
  report.textures.push({texture:index,label,dimensions:[png.readUInt32BE(16),png.readUInt32BE(20)],pngBytes:png.length,ktx2Bytes:data.length,inputSHA256:sha(png),outputSHA256:sha(data),args:args.map(x=>x===input?path.basename(input):x===output?path.basename(output):x)});
 }
 t.buffers=[{byteLength:tl}];t.extensionsUsed=[...new Set([...(t.extensionsUsed||[]),'KHR_texture_basisu'])];
 const textureFile=path.join(destination,'KnightEPS_Detailed-regulator-uastc.glb');writeGLB(textureFile,t,Buffer.concat(tc));report.candidates.push({name:'ktx2',file:path.basename(textureFile),bytes:fs.statSync(textureFile).size,sha256:sha(fs.readFileSync(textureFile))});
 report.basis={version:'1.16.4',binarySHA256:sha(fs.readFileSync(basis)),uastcLevel:4,rdo:false,zstandardLevel:18,mipFilter:'box, sRGB-aware; compare with driver-generated baseline mips',pngFallbacksRetained:true};
 fs.writeFileSync(path.join(destination,'build-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
