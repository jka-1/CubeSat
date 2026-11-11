import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from './delivery-vendor/three-r176/loaders/KTX2Loader.js';
import {MeshoptDecoder} from './delivery-vendor/three-r176/libs/meshopt_decoder.module.js';
const root='/verification/twin-optimization-20261109/',q=new URLSearchParams(location.search),variant=q.get('pilot')||'original';
const loading={variant,cache:q.get('cache')||'cold',moduleStartMs:performance.now(),imageDecodes:[],transcodes:[],meshDecodes:[],shaderCalls:[],uploads:[]};
let ktx=null,gltf=null,renderTarget=null,probe=null;
export function beginProbe(){
 const decode=globalThis.createImageBitmap.bind(globalThis);
 globalThis.createImageBitmap=async(...args)=>{const start=performance.now(),image=await decode(...args);loading.imageDecodes.push({startMs:start,endMs:performance.now(),width:image.width,height:image.height});return image};
}
function instrumentGL(THREE,renderer){
 const gl=renderer.getContext(),bindings=new Map(),allocations=new Map(),renderbuffers=new Map();let unit=gl.TEXTURE0,boundRenderbuffer=null;
 const bound=target=>bindings.get(unit+':'+target);
 const storageBytes=(w,h,format)=>[0x8e8c,0x8e8d,0x93b0,0x93d0,0x9278,0x9279,0x83f3,0x8c4f].includes(format)?Math.ceil(w/4)*Math.ceil(h/4)*16:w*h*(format===gl.RGBA16F?8:format===gl.RGBA32F?16:4);
 for(const name of ['activeTexture','bindTexture','deleteTexture','texStorage2D','texImage2D','compressedTexImage2D','texSubImage2D','compressedTexSubImage2D','generateMipmap','compileShader','linkProgram','bindRenderbuffer','deleteRenderbuffer','renderbufferStorage','renderbufferStorageMultisample']){
  const original=gl[name].bind(gl);gl[name]=(...args)=>{
   const start=performance.now();const result=original(...args),end=performance.now();
   if(name==='bindRenderbuffer')boundRenderbuffer=args[1];
   else if(name==='deleteRenderbuffer')renderbuffers.delete(args[0]);
   else if(name==='renderbufferStorage'||name==='renderbufferStorageMultisample'){
    const ms=name==='renderbufferStorageMultisample',samples=ms?args[1]:1,format=args[ms?2:1],w=args[ms?3:2],h=args[ms?4:3];renderbuffers.set(boundRenderbuffer,{width:w,height:h,samples,format,estimatedBytes:storageBytes(w,h,format)*samples});
   }else if(name==='activeTexture')unit=args[0];
   else if(name==='bindTexture')bindings.set(unit+':'+args[0],args[1]);
   else if(name==='deleteTexture')allocations.delete(args[0]);
   else if(name==='texStorage2D'){
    const texture=bound(args[0]);if(texture){const levels=new Map();let w=args[3],h=args[4];for(let i=0;i<args[1];i++){levels.set(i,{width:w,height:h,bytes:storageBytes(w,h,args[2]),internalFormat:args[2],estimated:true});w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2))}allocations.set(texture,levels)}
    loading.uploads.push({kind:name,startMs:start,endMs:end,width:args[3],height:args[4],levels:args[1],internalFormat:args[2]});
   }else if(name==='texSubImage2D'||name==='compressedTexSubImage2D'){
    loading.uploads.push({kind:name,startMs:start,endMs:end,level:args[1]});
   }
   else if(name==='texImage2D'||name==='compressedTexImage2D'){
    const texture=bound(args[0]);if(!texture)return result;
    let width,height,bytes,compressed=name==='compressedTexImage2D';
    if(compressed){width=args[3];height=args[4];bytes=args[6]?.byteLength??0}
    else{const image=args.length===6?args[5]:null;width=image?.width??args[3];height=image?.height??args[4];
     const type=args.length===6?args[4]:args[7],format=args.length===6?args[3]:args[6];const channels=format===gl.RED?1:format===gl.RG?2:format===gl.RGB?3:format===gl.DEPTH_COMPONENT?1:4;const size=type===gl.HALF_FLOAT||type===gl.UNSIGNED_SHORT?2:1;bytes=width*height*channels*size;
    }
    if(!allocations.has(texture))allocations.set(texture,new Map());allocations.get(texture).set(args[1],{width,height,bytes,compressed,internalFormat:args[2]});
    loading.uploads.push({kind:name,startMs:start,endMs:end,width,height,level:args[1],bytes,internalFormat:args[2]});
   }else if(name==='generateMipmap'){
    const levels=allocations.get(bound(args[0]));if(levels?.has(0)){const base=levels.get(0);let w=base.width,h=base.height,level=1;while(w>1||h>1){w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));if(!levels.has(level))levels.set(level,{width:w,height:h,bytes:w*h*base.bytes/(base.width*base.height),estimated:true});level++}}
   }else if(name==='compileShader'||name==='linkProgram')loading.shaderCalls.push({kind:name,startMs:start,endMs:end});
   return result;
  };
 }
 return {allocations,renderbuffers,gl};
}
export async function loadPilot(THREE,renderer,originalURL){
 probe=instrumentGL(THREE,renderer);
 const file={original:originalURL,ktx2:root+'delivery-assets/KnightEPS_Detailed-regulator-uastc.glb',meshopt:root+'delivery-assets/KnightEPS_Detailed-meshopt-lossless.glb?assetRevision=aligned-v2'}[variant];if(!file)throw Error('Unknown pilot');
 loading.modelURL=new URL(file,location.href).href;loading.fetchStartMs=performance.now();
 const response=await fetch(loading.modelURL,{cache:loading.cache==='cold'?'reload':'default'});if(!response.ok)throw Error('Model HTTP '+response.status);const bytes=await response.arrayBuffer();loading.fetchEndMs=performance.now();loading.modelBytes=bytes.byteLength;
 const loader=new GLTFLoader();
 if(variant==='ktx2'){
  ktx=new KTX2Loader().setTranscoderPath(root+'delivery-vendor/three-r176/libs/basis/').setWorkerLimit(1).detectSupport(renderer);loading.transcodeSupport={...ktx.workerConfig};
  const create=ktx._createTexture.bind(ktx);ktx._createTexture=async(...args)=>{const start=performance.now(),texture=await create(...args);loading.transcodes.push({startMs:start,endMs:performance.now(),format:texture.format,dimensions:[texture.image.width,texture.image.height],mipLevels:texture.mipmaps.length,mipBytes:texture.mipmaps.reduce((n,m)=>n+m.data.byteLength,0)});return texture};loader.setKTX2Loader(ktx);
 }
 if(variant==='meshopt'){
  const decoder={...MeshoptDecoder,decodeGltfBufferAsync(count,size,source,mode,filter){return MeshoptDecoder.ready.then(()=>{const start=performance.now(),target=new Uint8Array(count*size);MeshoptDecoder.decodeGltfBuffer(target,count,size,source,mode,filter);loading.meshDecodes.push({startMs:start,endMs:performance.now(),bytes:target.byteLength});return target})}};loader.setMeshoptDecoder(decoder);
 }
 loading.parseStartMs=performance.now();gltf=await loader.parseAsync(bytes,new URL('.',loading.modelURL).href);loading.parseEndMs=performance.now();
 return gltf;
}
export function install({THREE,renderer,scene,camera,controls,api,parts,clearSelection}){
 const gl=renderer.getContext(),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={loading,variant,userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timerSupported:!!timer,interactions:[],checks:[],captures:[]};
 let active=null,pending=[],currentQuery=null,frame=0,sample=false,firstModelFrame=false;
 function poll(){for(let i=pending.length-1;i>=0;i--){const p=pending[i];if(gl.getQueryParameter(p.query,gl.QUERY_RESULT_AVAILABLE)){const disjoint=gl.getParameter(timer.GPU_DISJOINT_EXT);if(!disjoint)p.owner.gpu[p.name].push(gl.getQueryParameter(p.query,gl.QUERY_RESULT)/1e6);else p.owner.disjoint++;gl.deleteQuery(p.query);pending.splice(i,1)}}}
 globalThis.__twinDeliveryPass={target:t=>renderTarget=t,begin(){},end(){}};
 const render=renderer.render.bind(renderer);
 renderer.render=(...args)=>{
  poll();frame++;sample=!!active&&!active.noQueries&&frame%4===0;const start=performance.now();
  if(timer&&sample){currentQuery=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,currentQuery)}
  render(...args);const end=performance.now();
  if(currentQuery){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query:currentQuery,name:'total',owner:active});currentQuery=null}
  if(active){active.cpu.push(end-start);active.calls.push(renderer.info.render.calls);active.triangles.push(renderer.info.render.triangles);if(active.last!==null)active.intervals.push(start-active.last);active.last=start;active.frames++}
  if(api.state().loaded&&!firstModelFrame){firstModelFrame=true;loading.firstModelSubmitMs=end;loading.firstModelRenderCPUms=end-start;requestAnimationFrame(()=>{loading.firstUsableRAFms=performance.now();window.parent.postMessage({kind:'pilot-first-frame'},location.origin)})}
 };
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const stat=xs=>{const s=[...xs].sort((a,b)=>a-b);return {median:s[Math.floor(s.length*.5)]??null,p95:s[Math.min(s.length-1,Math.floor(s.length*.95))]??null,samples:s.length}};
 const sum=xs=>xs.reduce((a,b)=>a+b,0);
 function textures(){
  const unique=new Map(),images=new Set();gltf.scene.traverse(m=>{if(m.isMesh)for(const mat of [m.material].flat())for(const value of Object.values(mat))if(value?.isTexture)unique.set(value.uuid,value)});
  let total=0;const entries=[];
  for(const texture of unique.values()){
   const image=texture.image;if(!image)continue;images.add(image);let bytes=0,levels=0;
   if(texture.isCompressedTexture){bytes=sum(texture.mipmaps.map(m=>m.data.byteLength));levels=texture.mipmaps.length}
   else{let w=image.width,h=image.height;bytes=w*h*4;levels=1;if(texture.generateMipmaps)while(w>1||h>1){w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));bytes+=w*h*4;levels++}}
   total+=bytes;entries.push({name:texture.name,uuid:texture.uuid,sourceUUID:texture.source.uuid,dimensions:[image.width,image.height],format:texture.format,formatName:Object.entries(THREE).find(([k,v])=>v===texture.format&&k.endsWith('Format'))?.[0],type:texture.type,mipLevels:levels,generateMipmaps:texture.generateMipmaps,colorSpace:texture.colorSpace,minFilter:texture.minFilter,magFilter:texture.magFilter,anisotropy:texture.anisotropy,estimatedBytes:bytes,uploaded:!!renderer.properties.get(texture).__webglTexture,compressed:!!texture.isCompressedTexture});
  }
  const allocated=[...probe.allocations.values()].map(levels=>[...levels.values()]);
  return {uniqueMaterialTextureObjects:unique.size,uniqueImageObjects:images.size,estimatedMaterialTextureBytes:total,textures:entries,trackedWebGLTextureObjects:allocated.length,trackedTextureStorageEstimateBytes:sum(allocated.flat().map(m=>m.bytes)),note:'Material RGBA8 estimates include mip chains. GL upload observations are storage estimates, not driver VRAM. Renderbuffers/default framebuffer excluded.'};
 }
 function targets(){const attributes=gl.getContextAttributes(),samples=gl.getParameter(gl.SAMPLES),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;return {buffer:[w,h],viewport:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],outputDPR:renderer.getPixelRatio(),refractionScale:renderer.transmissionResolutionScale,defaultFramebuffer:{attributes,samples,lowerBoundColorDepthBytes:w*h*(4+3)*Math.max(1,samples),note:'Assume RGBA8 + 24-bit depth; compositor/resolve copies and driver padding unknown.'},transmission:renderTarget?{dimensions:[renderTarget.width,renderTarget.height],type:renderTarget.texture.type,format:renderTarget.texture.format,samplesRequested:renderTarget.samples,colorMipmaps:renderTarget.texture.generateMipmaps,depth:renderTarget.depthBuffer,stencil:renderTarget.stencilBuffer,note:'Tracked GL textures include resolved color/mips; multisample color/depth renderbuffers require separate estimates.'}:null,shadowMaps:(()=>{const out=[];scene.traverse(o=>{if(o.isLight&&o.shadow?.map)out.push({name:o.name,dimensions:[o.shadow.map.width,o.shadow.map.height],type:o.shadow.map.texture.type,depth:o.shadow.map.depthBuffer})});return out})(),environment:{dimensions:[scene.environment.image.width,scene.environment.image.height],type:scene.environment.type,format:scene.environment.format},rendererTextureCount:renderer.info.memory.textures}}
 async function measure(label,action,duration,warmup=0,noQueries=false){
  action();await sleep(warmup);const m={label,noQueries,gpu:{total:[]},cpu:[],calls:[],triangles:[],intervals:[],last:null,frames:0,disjoint:0};active=m;await sleep(duration);active=null;sample=false;
  for(let i=0;i<20&&pending.some(p=>p.owner===m);i++){poll();await sleep(25)}
  report.interactions.push({label,intervalMs:stat(m.intervals),cpuRenderMs:stat(m.cpu),drawCalls:stat(m.calls),triangles:stat(m.triangles),gpuPassMs:Object.fromEntries(Object.entries(m.gpu).map(([k,v])=>[k,stat(v)])),frames:m.frames,disjoint:m.disjoint,pendingQueries:pending.filter(p=>p.owner===m).length});
 }
 const capture=async(name)=>{const data=api.capture();await fetch('/__delivery_image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:variant+'-'+name,data})});report.captures.push({name,camera:structuredClone(api.state().camera)})};
 const check=(name,condition)=>{report.checks.push({name,pass:!!condition});if(!condition)throw Error(name)};
 async function run(){
  await api.ready;loading.viewerReadyMs=performance.now();while(!loading.firstUsableRAFms)await sleep(25);
  report.initialResidency=textures();report.initialTargets=targets();report.readyEventMs=loading.viewerReadyMs;
  if(q.get('mode')==='artwork'){
   api.setQuality('studio');api.select('Regulator_01');document.querySelector('#isolate-selected').click();api.focus();await sleep(1000);
   const part=parts.find(p=>p.name==='Regulator_01'),target=controls.target.clone(),distance=camera.position.distanceTo(target),normal=new THREE.Vector3(0,1,0).transformDirection(part.matrixWorld),right=new THREE.Vector3(1,0,0).transformDirection(part.matrixWorld),up=new THREE.Vector3(0,0,1).transformDirection(part.matrixWorld);clearSelection();
   for(const [label,n,r,u] of [['artwork-front',1,.08,.05],['artwork-back',-1,.08,.05],['artwork-oblique',.4,1,.2]]){
    const direction=normal.clone().multiplyScalar(n).addScaledVector(right,r).addScaledVector(up,u).normalize();camera.up.copy(up);camera.position.copy(target).addScaledVector(direction,distance);controls.enableDamping=false;controls.update();controls.enableDamping=true;controls.dispatchEvent({type:'change'});await sleep(300);await capture(label);
   }
   check('full-resolution artwork captures',renderer.getPixelRatio()===2&&renderer.transmissionResolutionScale===1);
  }
  if(['full','resume','visual'].includes(q.get('mode'))){
   let triangles=0;for(const part of parts)part.traverse(m=>{if(m.isMesh)triangles+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});report.logicalTriangles=triangles;report.geometryAudit=api.geometryAudit();check('all logical triangles retained',triangles===874229);check('seven detailed board identities retained',report.geometryAudit.length===7);
   api.setQuality('studio');await sleep(1200);const state=api.state();report.studioState=state.camera;report.studioTargets=targets();check('95 components and full-resolution Studio',state.parts.length===95&&state.camera.pixelRatio===2&&renderer.transmissionResolutionScale===1);
   const pose={position:camera.position.clone(),target:controls.target.clone(),up:camera.up.clone(),view:structuredClone(camera.view)};
   const restore=()=>{controls.autoRotate=false;controls.enableDamping=false;camera.position.copy(pose.position);controls.target.copy(pose.target);camera.up.copy(pose.up);const v=pose.view;camera.setViewOffset(v.fullWidth,v.fullHeight,v.offsetX,v.offsetY,v.width,v.height);controls.update();controls.enableDamping=true;controls.dispatchEvent({type:'change'})};
   if(q.get('mode')!=='visual'){
   await capture('assembled');
   if(q.get('mode')==='resume'){
    await measure('Studio orbit — no GPU queries control',()=>{restore();controls.autoRotate=true;controls.autoRotateSpeed=2;controls.dispatchEvent({type:'change'})},2000,750,true);restore();await sleep(400);
   }
   await measure('Studio orbit',()=>{restore();controls.autoRotate=true;controls.autoRotateSpeed=2;controls.dispatchEvent({type:'change'})},3000,750);
   restore();await sleep(600);await measure('Studio lid',()=>document.querySelector('#top-toggle').click(),1800);await sleep(1000);await capture('lid');document.querySelector('#top-toggle').click();await sleep(1800);restore();
   await measure('Studio explosion',()=>document.querySelector('#explode-toggle').click(),1800);await sleep(800);await capture('exploded');api.reset();await sleep(1800);
   }
   for(const kind of ['top','bottom','side']){api.select('Regulator_01');document.querySelector('#isolate-selected').click();api.focus();await sleep(650);api.view(kind);await sleep(650);api.focus();await sleep(650);clearSelection();await capture('regulator-'+kind);api.select('Regulator_01');document.querySelector('#isolate-selected').click()}
   api.select('Regulator_02');document.querySelector('#isolate-selected').click();api.view('iso');await sleep(650);api.focus();await sleep(650);check('Regulator 2 picking/isolation',api.selectionProbe()?.id==='Regulator_02'&&api.state().parts.filter(p=>p.visible).length===1);api.setVisible('Regulator_02',false);check('visibility',!api.state().parts.find(p=>p.id==='Regulator_02').visible);api.setVisible('Regulator_02',true);document.querySelector('#isolate-selected').click();api.reset();await sleep(1800);
   api.view('miner');await sleep(650);await capture('acrylic');api.updateTelemetry({battery_voltage_v:15.42,temperature_c:26.5},{source:'live'});check('LCD telemetry',api.state().display.readings.battery_voltage_v===15.42);api.setScreenState('standby',{title:'PILOT CHECK',message:'READY'});check('LCD presentation',api.state().display.presentation.title==='PILOT CHECK');api.resetTelemetry();api.setScreenState('telemetry');document.querySelector('#xray-toggle').click();check('X-ray',api.state().xray);document.querySelector('#xray-toggle').click();api.setQuality('performance');check('Performance retained',api.state().quality==='performance');api.setQuality('studio');
  }
  report.residency=textures();report.targets=targets();report.trackedRenderbuffers=[...probe.renderbuffers.values()];report.loadingSummary={fetchMs:loading.fetchEndMs-loading.fetchStartMs,parseIncludingDecodeMs:loading.parseEndMs-loading.parseStartMs,decodeCalls:loading.imageDecodes.length,decodeWallDurationSumMs:sum(loading.imageDecodes.map(x=>x.endMs-x.startMs)),transcodeWallDurationSumMs:sum(loading.transcodes.map(x=>x.endMs-x.startMs)),meshDecodeCPUms:sum(loading.meshDecodes.map(x=>x.endMs-x.startMs)),meshDecodedBytes:sum(loading.meshDecodes.map(x=>x.bytes)),firstModelSubmitMs:loading.firstModelSubmitMs,firstUsableRAFms:loading.firstUsableRAFms,firstModelRenderCPUms:loading.firstModelRenderCPUms,uploadSubmissionCPUms:sum(loading.uploads.filter(x=>x.endMs<=loading.firstModelSubmitMs).map(x=>x.endMs-x.startMs)),shaderCallCPUms:sum(loading.shaderCalls.filter(x=>x.endMs<=loading.firstModelSubmitMs).map(x=>x.endMs-x.startMs)),note:'Overlapping phases must not be added. First usable means model render submitted then next RAF, not GPU completion. Shader driver work may occur elsewhere.'};
  report.webGPUAPIAvailable=!!navigator.gpu;report.resources=performance.getEntriesByType('resource').filter(x=>/glb|basis_transcoder|meshopt|KTX2|zstd/.test(x.name)).map(x=>({name:x.name,duration:x.duration,transferSize:x.transferSize,encodedBodySize:x.encodedBodySize,decodedBodySize:x.decodedBodySize}));
  report.complete=true;window.__deliveryReport=report;window.parent.postMessage({kind:'pilot-result',report},location.origin);
 }
 window.__deliveryCleanup=()=>{api.dispose();ktx?.dispose();const unique=new Set();gltf?.scene.traverse(m=>{if(m.isMesh)for(const mat of [m.material].flat())for(const t of Object.values(mat))if(t?.isTexture)unique.add(t)});for(const t of unique){t.image?.close?.();t.dispose()}renderer.forceContextLoss();delete globalThis.__twinDeliveryPass};
 run().catch(e=>{report.error=e.stack;window.parent.postMessage({kind:'pilot-result',report},location.origin)});
}
