import * as THREE from 'three';
import {installLeanAcrylic} from './lean-acrylic.mjs';
import {createDepthGuard} from './depth-guard.mjs';
import {installOrthographicShadows} from './orthographic-shadow.mjs';
import {installCertifiedCulling} from './certified-culling.mjs';
import {depthFirstOpaque} from './depth-order.mjs';
import {installMaterialConstants} from './material-constants.mjs';
import {installMatteEnvironment} from './matte-environment.mjs';
import {installCheapOcclusion} from './cheap-occlusion.mjs';
import {installFXAA} from './fxaa-pass.mjs';

Error.stackTraceLimit=80;
export const variant=new URLSearchParams(location.search).get('renderer')||'legacy';
export async function createRenderer(){
 const depth=new URLSearchParams(location.search).get('depth')||'log';
 if(!['log','reverse','bounded'].includes(depth))throw Error('Unknown prototype depth mode');
 const options={antialias:!['off','fxaa'].includes(new URLSearchParams(location.search).get('aa')),alpha:false,logarithmicDepthBuffer:depth!=='reverse',reverseDepthBuffer:depth==='reverse'};
 const renderer=variant==='legacy'?new THREE.WebGLRenderer(options):new THREE.WebGPURenderer({...options,forceWebGL:variant==='node-webgl'});
 if(renderer.init)await renderer.init();
 if(new URLSearchParams(location.search).get('order')==='depth'){
  if(variant!=='legacy')throw Error('Depth-order experiment requires the pinned WebGL renderer');
  renderer.setOpaqueSort(depthFirstOpaque);
 }
 if(depth==='reverse'&&(variant!=='legacy'||!renderer.capabilities.reverseDepthBuffer)){renderer.dispose();throw Error('Reverse-depth experiment requires verified EXT_clip_control on the legacy renderer')}
 renderer.__prototypeDepth=depth;
 if(renderer.backend){const draw=renderer.renderObject.bind(renderer);renderer.renderObject=(...args)=>{try{return draw(...args)}catch(error){error.message+=' [object='+args[0]?.name+':'+args[0]?.type+', material='+args[4]?.name+':'+args[4]?.type+']';throw error}}}
 renderer.__prototypeCopies=new Map();if(renderer.copyFramebufferToTexture){const copy=renderer.copyFramebufferToTexture.bind(renderer);renderer.copyFramebufferToTexture=(texture,...args)=>{const result=copy(texture,...args);renderer.__prototypeCopies.set(texture,{width:texture.image?.width,height:texture.image?.height,x:args[0]?.x||0,y:args[0]?.y||0,type:texture.type,format:texture.format,generateMipmapsRequested:texture.generateMipmaps});return result}}
 if(!renderer.capabilities)renderer.capabilities={getMaxAnisotropy:()=>renderer.getMaxAnisotropy()};
 return renderer;
}

export function installRenderer({renderer,scene,camera,controls,api,parts,display,model,clearSelection,releaseController}){
 const omitShadowDepth=new URLSearchParams(location.search).get('shadow')==='ortho';
 const shadowOptimization=omitShadowDepth||window.__artworkPreparation?.coverageMaterials>0?installOrthographicShadows(scene,{omitOrthographicDepthWrite:omitShadowDepth}):null;
 const beginAcrylicFrame=installLeanAcrylic(renderer,model);
 const depthGuard=renderer.__prototypeDepth!=='log'?createDepthGuard(scene,camera,{conditional:renderer.__prototypeDepth==='bounded'}):null;
 const culling=['certified','partial'].includes(new URLSearchParams(location.search).get('cull'))?installCertifiedCulling(scene):null;
 const pbr=new URLSearchParams(location.search).get('pbr');
 const constants=pbr==='constants'?installMaterialConstants(scene):pbr==='matte-env'?installMatteEnvironment(scene):null;
 const occlusion=new URLSearchParams(location.search).get('prepass')==='cheap'?installCheapOcclusion(renderer,scene):null;
 const fxaa=new URLSearchParams(location.search).get('aa')==='fxaa'?installFXAA(renderer):null;
 const originalRender=renderer.render.bind(renderer),samples=[],gpu=[],queries=[];
 let recording=false,last=null,serial=0,recordStart=0,firstSubmitted=null,epoch=0,disjointCount=0;
 let firstImageResolve;api.readyForImage=new Promise(resolve=>{firstImageResolve=resolve});
 const backend=renderer.backend,context=renderer.getContext?.()||backend?.gl,gl=typeof context?.getExtension==='function'?context:null;
 const ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');
 const resources={geometries:new Set(),materials:new Set(),textures:new Set(),images:new Set()};
 function remember(root){root.traverse(m=>{if(!m.isMesh)return;resources.geometries.add(m.geometry);for(const mat of [m.material].flat()){resources.materials.add(mat);for(const t of Object.values(mat))if(t?.isTexture){resources.textures.add(t);if(t.image)resources.images.add(t.image)}}})}
 remember(model);
 function poll(){
  if(!ext)return;
  if(gl.getParameter(ext.GPU_DISJOINT_EXT)){disjointCount++;for(const q of queries)gl.deleteQuery(q.query);queries.length=0;return}
  while(queries.length&&gl.getQueryParameter(queries[0].query,gl.QUERY_RESULT_AVAILABLE)){const q=queries.shift();if(q.epoch===epoch)gpu.push(gl.getQueryParameter(q.query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q.query)}
 }
 renderer.render=(s,c)=>{
  if(s!==scene||c!==camera)return originalRender(s,c);
  const now=performance.now(),start=now;
  constants?.update();
  depthGuard?.update();
  culling?.update(c);
  beginAcrylicFrame(c);
  if(backend&&renderer.shadowMap.needsUpdate)s.traverse(o=>{if(o.isLight&&o.shadow){o.shadow.autoUpdate=false;o.shadow.needsUpdate=true}});
  if(recording){poll();if(last!==null)samples.push({intervalMs:now-last});last=now}
  let query=null;
  if(recording&&ext&&serial++%4===0&&queries.length<8){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}
  try{if(occlusion)occlusion.render(c,depthGuard,originalRender);else originalRender(s,c);fxaa?.render(originalRender)}finally{if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({query,epoch})}}
  if(backend)renderer.shadowMap.needsUpdate=false;
  if(firstSubmitted===null){firstSubmitted=performance.now();requestAnimationFrame(()=>firstImageResolve({submittedMs:firstSubmitted,nextRAFms:performance.now(),note:'Submission plus next RAF; not a GPU completion timestamp.'}))}
  if(recording&&samples.length)Object.assign(samples.at(-1),{cpuMs:performance.now()-start,callbackCpuMs:renderer.__prototypeFrameStart?performance.now()-renderer.__prototypeFrameStart:null,draws:renderer.info.render.drawCalls??renderer.info.render.calls,triangles:renderer.info.render.triangles,depthMode:depthGuard?.state?.active||'logarithmic',capturePixels:renderer.__acrylicCopyPixels||0});
 };
 const dispose=api.dispose,backendDispose=renderer.dispose.bind(renderer);let released=false;
 api.dispose=()=>{
  if(released)return;released=true;recording=false;for(const q of queries)gl.deleteQuery(q.query);queries.length=0;
  // Release shared resources while backend disposal listeners are still alive.
  renderer.dispose=()=>{};
  try{
   remember(model);fxaa?.dispose();occlusion?.dispose();scene.traverse(o=>o.shadow?.dispose?.());dispose();remember(model);
   for(const t of resources.textures)t.dispose();for(const image of resources.images)image.close?.();
   for(const geometry of resources.geometries)geometry.dispose();for(const material of resources.materials)material.dispose();
   for(const [texture] of renderer.__prototypeCopies)texture.dispose();renderer.__prototypeCopies.clear();
   model.clear();scene.clear();releaseController?.();for(const set of Object.values(resources))set.clear();
  }finally{renderer.dispose=backendDispose;backendDispose()}
 };

 const originalParts=parts.map(p=>({id:p.name,position:p.position.toArray()}));
 const logicalTriangles=()=>{let count=0;model.traverse(m=>{if(m.isMesh)count+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});return count};
 const memory=()=>{const textures=new Set();model.traverse(m=>{if(m.isMesh)for(const mat of [m.material].flat())for(const t of Object.values(mat))if(t?.isTexture)textures.add(t)});let bytes=0;const list=[];for(const t of textures){let w=t.image?.width||0,h=t.image?.height||0,n=0;if(t.isCompressedTexture)n=t.mipmaps.reduce((s,m)=>s+m.data.byteLength,0);else if(w&&h){const channels=t.format===THREE.RedFormat?1:4;while(true){n+=w*h*channels;if(!t.generateMipmaps||w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2))}}bytes+=n;list.push({width:t.image?.width,height:t.image?.height,compressed:!!t.isCompressedTexture,format:t.format,actualGPUFormat:backend?.get(t)?.texture?.format||null,cpuPixelBytes:t.image?.data?.byteLength||null,bytesEstimate:n})}const target=renderer._frameBufferTarget;return {materialBytesEstimate:bytes,textures:list,renderer:renderer.info.memory,framebufferTarget:target?{width:target.width,height:target.height,samples:target.samples,type:target.texture.type,format:target.texture.format,generateMipmaps:target.texture.generateMipmaps}:null,viewportCopies:[...renderer.__prototypeCopies].map(([t,record])=>({...record,actualGPUFormat:backend?.get(t)?.texture?.format||null}))}};
 window.__architecture={api,renderer,scene,camera,controls,parts,display,model,clearSelection,originalParts,logicalTriangles,memory,depthGuard,shadowOptimization,culling,constants,occlusion,fxaa,
  backend:backend?.isWebGPUBackend?'webgpu':backend?.isWebGLBackend?'node-webgl':'legacy-webgl',
  hardware:()=>{const debug=gl?.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,webGPUAdapter:backend?.adapter?.info?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,backend.adapter.info[k]])):backend?.device?.adapterInfo?Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,backend.device.adapterInfo[k]])):null,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,viewport:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],buffer:[renderer.domElement.width,renderer.domElement.height],samples:gl?gl.getParameter(gl.SAMPLES):renderer.samples,logarithmicDepthBuffer:renderer.logarithmicDepthBuffer??renderer.capabilities.logarithmicDepthBuffer}},
  begin(){epoch++;disjointCount=0;samples.length=0;gpu.length=0;last=null;serial=0;recordStart=performance.now();recording=true},
  end(){recording=false;poll();return {elapsedMs:performance.now()-recordStart,samples:[...samples],gpuMs:[...gpu],gpuTimingSupported:!!ext,gpuDisjointCount:disjointCount,unresolvedQueries:queries.length}},
  ownership:()=>Object.fromEntries(Object.entries(resources).map(([k,v])=>[k,v.size]))
 };
}

export function createFloorMaterial(lamp){return variant==='legacy'?new THREE.ShadowMaterial({opacity:.14}):new THREE.ShadowNodeMaterial({opacity:.14,lightsNode:THREE.TSL.lights([lamp])})}
