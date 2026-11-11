import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readGLB,source,sha} from './build-delivery-pilots.mjs';
import {MeshoptDecoder} from './delivery-vendor/three-r176/libs/meshopt_decoder.module.js';
import {read as readKTX} from './delivery-vendor/three-r176/libs/ktx-parse.module.js';
const original=readGLB(source),report=JSON.parse(fs.readFileSync(new URL('./delivery-assets/build-report.json',import.meta.url)));
const candidate=name=>readGLB(new URL('./delivery-assets/'+name,import.meta.url));
test('source, metadata, transforms, materials and logical model topology survive both delivery paths',()=>{
 assert.equal(sha(original.bytes),'dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47');
 for(const info of report.candidates){const c=candidate(info.file);for(const key of ['nodes','scenes','scene','meshes','accessors','materials','samplers'])assert.deepEqual(c.json[key],original.json[key],info.name+' changed '+key);assert.equal(sha(c.bytes),info.sha256)}
});
test('lossless Meshopt decodes every attribute and index byte exactly using the r176 decoder',async()=>{
 await MeshoptDecoder.ready;const c=candidate('KnightEPS_Detailed-meshopt-lossless.glb');let count=0;
 for(const [i,v] of c.json.bufferViews.entries()){
  const e=v.extensions?.EXT_meshopt_compression,sourceView=original.json.bufferViews[i],before=original.bin.subarray(sourceView.byteOffset||0,(sourceView.byteOffset||0)+sourceView.byteLength);
  assert.equal((v.byteOffset||0)%4,0,'virtual fallback alignment '+i);
  let decoded;if(e){decoded=new Uint8Array(e.count*e.byteStride);MeshoptDecoder.decodeGltfBuffer(decoded,e.count,e.byteStride,new Uint8Array(c.bin.subarray(e.byteOffset,e.byteOffset+e.byteLength)),e.mode,e.filter);count++;assert.equal(e.filter,'NONE')}
  else decoded=c.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);
  assert(Buffer.from(decoded).equals(before),'Buffer view '+i+' differs');
 }assert(count>0);
});
test('KTX2 only replaces the three regulator textures and preserves dimensions, alpha, mip chains and PNG fallbacks',()=>{
 const c=candidate('KnightEPS_Detailed-regulator-uastc.glb');assert(c.bin.subarray(0,original.bin.length).equals(original.bin));assert.deepEqual(c.json.images.slice(0,original.json.images.length),original.json.images);
 for(const [i,t] of c.json.textures.entries()){
  if(![6,7,8].includes(i)){assert.deepEqual(t,original.json.textures[i]);continue}
  assert.equal(t.source,original.json.textures[i].source);const im=c.json.images[t.extensions.KHR_texture_basisu.source],v=c.json.bufferViews[im.bufferView],ktx=readKTX(new Uint8Array(c.bin.subarray(v.byteOffset,v.byteOffset+v.byteLength)));
  assert.equal(ktx.pixelWidth,3000);assert.equal(ktx.pixelHeight,2272);assert.equal(ktx.levels.length,12);assert.equal(ktx.supercompressionScheme,2);assert.equal(ktx.dataFormatDescriptor[0].transferFunction,2);assert.equal(ktx.dataFormatDescriptor[0].flags,0);
 }
});
