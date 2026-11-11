import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {decodeCoverage,decodeGzip} from '../../site/knight-eps-phase12/viewer/rendering/decode-coverage.mjs';
const base=new URL('../../site/knight-eps-phase12/models/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,base));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function glb(bytes){const n=bytes.readUInt32LE(12);return {json:JSON.parse(bytes.subarray(20,20+n)),binary:bytes.subarray(28+n)}}
const source=glb(read('KnightEPS_Detailed.glb')),display=glb(read('display/display-compact.glb'));
test('compressed model delivery reconstructs the complete certified GLB exactly',async()=>{
 const zipped=read('display/display-compact.glb.gz'),raw=read('display/display-compact.glb');
 const buffer=zipped.buffer.slice(zipped.byteOffset,zipped.byteOffset+zipped.byteLength);
 // Added multicolor board PNGs stay byte-exact. Bound transport against the
 // measured previous package plus their independently measured PNG payloads.
 assert.equal(zipped.length,10222122);
 assert.ok(zipped.length<=8075595+347224+136440+1202688+665844);
 assert.ok(zipped.length<raw.length);
 assert.deepEqual(Buffer.from(await decodeGzip(buffer)),raw);
 const decoded=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
 assert.equal(await decodeGzip(decoded),decoded,'accept transparent HTTP content decoding');
 await assert.rejects(decodeGzip(buffer.slice(0,buffer.byteLength-8)));
});
test('coverage delivery accepts gzip or HTTP-decoded bytes and rejects truncation',async()=>{
 const mask=Uint8Array.of(0,255,255,0,255,0,0,255),gzip=gzipSync(mask);
 const compressed=gzip.buffer.slice(gzip.byteOffset,gzip.byteOffset+gzip.byteLength);
 assert.deepEqual(new Uint8Array(await decodeCoverage(compressed,mask.length)),mask);
 assert.equal(await decodeCoverage(mask.buffer,mask.length),mask.buffer);
 await assert.rejects(decodeCoverage(mask.buffer,mask.length+1),/Incomplete artwork/);
 await assert.rejects(decodeCoverage(compressed.slice(0,compressed.byteLength-3),mask.length));
});
test('shipped display package preserves canonical CAD, every expanded attribute and original images',()=>{
 const provenance=JSON.parse(read('display/provenance.json'));
 assert.equal(sha(read('KnightEPS_Detailed.glb')),provenance.canonicalSHA256);
 for(const [name,hash] of Object.entries(provenance.files))assert.equal(sha(read('display/'+name)),hash,name);
 for(const key of ['materials','textures','samplers','extensionsUsed'])assert.deepEqual(display.json[key],source.json[key]);
 const image=(g,i)=>{const v=g.json.bufferViews[g.json.images[i].bufferView],s=v.byteOffset||0;return g.binary.subarray(s,s+v.byteLength)};
 for(let i=0;i<source.json.images.length;i++)assert.deepEqual(image(display,i),image(source,i));
 const access=i=>{const a=display.json.accessors[i],v=display.json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]*{5126:4,5125:4,5123:2,5121:1}[a.componentType];assert.equal(v.byteStride||size,size);const s=(v.byteOffset||0)+(a.byteOffset||0);return {a,size,bytes:display.binary.subarray(s,s+a.count*size)}};
 const report=JSON.parse(read('display/compact-report.json'));
 for(const row of report.proof){const primitive=display.json.meshes[row.mesh].primitives[row.primitive],indices=access(primitive.indices);assert.equal(indices.a.count/3,row.triangles);
  for(const [name,expected] of Object.entries(row.expandedAttributeSHA256)){const attribute=access(primitive.attributes[name]),hash=createHash('sha256');for(let i=0;i<indices.a.count;i++){const index=indices.size===2?indices.bytes.readUInt16LE(i*2):indices.bytes.readUInt32LE(i*4);hash.update(attribute.bytes.subarray(index*attribute.size,(index+1)*attribute.size))}assert.equal(hash.digest('hex'),expected,name)}
 }
 let triangles=0;const visit=i=>{const node=display.json.nodes[i];if(node.mesh!==undefined)for(const p of display.json.meshes[node.mesh].primitives)triangles+=display.json.accessors[p.indices].count/3;for(const child of node.children||[])visit(child)};
 for(const i of display.json.scenes[display.json.scene].nodes)visit(i);assert.equal(triangles,871131);
 const manifest=JSON.parse(fs.readFileSync(new URL('../../site/knight-eps-phase12/docs/component_manifest.json',import.meta.url)));
 assert.equal(Object.keys(manifest.components).length,95);for(const id of Object.keys(manifest.components))assert.ok(display.json.nodes.some(n=>n.name===id),id);
 const certificate=JSON.parse(read('display/closed-primitives-compact.json'));assert.equal(certificate.displaySHA256,sha(read('display/display-compact.glb')));
});
test('shipped full-resolution artwork matches every audited coverage byte',()=>{
 const info=JSON.parse(read('display/artwork-masks.json')),bytes=gunzipSync(read('display/artwork-masks.bin.gz'));
 assert.equal(info.sourceSHA256,sha(read('KnightEPS_Detailed.glb')));assert.equal(bytes.length,info.decodedMaskBytes);assert.equal(info.records.length,15);assert.equal(info.rgbaImages.length,4);
 for(const record of info.rgbaImages){assert.ok(!info.records.some(r=>r.image===record.image));assert.match(record.sourceRGBA8SHA256,/^[a-f0-9]{64}$/)}
 for(const record of info.records){const v=source.json.bufferViews[source.json.images[record.image].bufferView],s=v.byteOffset||0,png=source.binary.subarray(s,s+v.byteLength);assert.deepEqual(record.dimensions,[png.readUInt32BE(16),png.readUInt32BE(20)]);assert.equal(record.length,record.dimensions[0]*record.dimensions[1]);assert.equal(sha(bytes.subarray(record.offset,record.offset+record.length)),record.maskSHA256);assert.equal(record.sourceTexelsExact,true)}
});
