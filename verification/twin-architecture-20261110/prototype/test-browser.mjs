// Bounded CDP driver for our local prototype in a dedicated temporary profile.
// No package dependencies, personal browser profile or external model upload.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.join(here,'results');
await fs.mkdir(results,{recursive:true});
const [mode='smoke',variant='legacy',asset='original',appearance='studio',depth='log',shadow='baseline',cull='baseline',order='baseline',pbr='baseline',capture='full',prepass='baseline',aa='on']=process.argv.slice(2);
const clock=['load60','thermal60','screen60','animation60','hotreplay60'].includes(mode)?'timer60':'raf';
const key=`${variant}-${asset}${appearance==='studio'?'':'-'+appearance}${depth==='log'?'':'-'+depth}${shadow==='baseline'?'':'-'+shadow+'-shadow'}${cull==='baseline'?'':'-'+cull+'-cull'}${order==='baseline'?'':'-'+order+'-order'}${pbr==='baseline'?'':'-'+pbr+'-pbr'}${capture==='full'?'':'-'+capture+'-capture'}${prepass==='baseline'?'':'-'+prepass+'-prepass'}${aa==='on'?'':aa==='fxaa'?'-fxaa':'-no-msaa'}${clock==='raf'?'':'-'+clock+'-clock'}`;
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map(),logs=[];let id=0,sessionId;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result)}else if(['Runtime.exceptionThrown','Log.entryAdded','Runtime.consoleAPICalled','Target.targetCrashed','Target.targetDestroyed','Target.detachedFromTarget','Inspector.targetCrashed'].includes(m.method)){if(logs.length<80)logs.push(m)}};
function send(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}))})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targetId,output={mode,variant,asset,appearance,depth,shadow,cull,order,pbr,capture,prepass,aa,clock,started:new Date().toISOString(),browser:version.Browser};
try{
 // Reuse one test target and close all other targets in this temporary profile.
 const targets=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');
 targetId=targets[0]?.targetId||(await send('Target.createTarget',{url:'about:blank'},null)).targetId;
 for(const t of targets.slice(1))await send('Target.closeTarget',{targetId:t.targetId},null);
 sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
 await send('Target.setDiscoverTargets',{discover:true},null);await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1290,height:720,deviceScaleFactor:1,mobile:false});
 await send('Page.bringToFront');
 if(mode==='calibrate'){
  await send('Page.navigate',{url:'about:blank'});await sleep(200);
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  output.refresh=await evaluate(`new Promise(resolve=>{const times=[];let last=null;function frame(t){if(last!==null)times.push(t-last);last=t;if(times.length<120)requestAnimationFrame(frame);else resolve({intervals:times,visibility:document.visibilityState,focused:document.hasFocus(),screen:{width:screen.width,height:screen.height},devicePixelRatio})}requestAnimationFrame(frame)})`);
  output.window=await send('Browser.getWindowForTarget',{targetId},null);output.complete=true;
  await fs.writeFile(path.join(results,'refresh-calibration.json'),JSON.stringify(output,null,2)+'\n');
  const values=output.refresh.intervals.toSorted((a,b)=>a-b);console.log(JSON.stringify({medianIntervalMs:values[60],visibility:output.refresh.visibility,focused:output.refresh.focused,window:output.window}));socket.close();process.exit(0);
 }

 if(mode!=='status'&&mode!=='capture'){
  // Runtime.enable replays console entries from the previous page. Clear them
  // before navigating so an earlier failed candidate cannot poison this run.
  await send('Runtime.discardConsoleEntries');await send('Log.clear');logs.length=0;
  await send('Page.navigate',{url:`http://127.0.0.1:8770/verification/twin-architecture-20261110/prototype/?renderer=${variant}&asset=${asset}&appearance=${appearance}&depth=${depth}&shadow=${shadow}&cull=${cull}&order=${order}&clock=${clock}&pbr=${pbr}&capture=${capture}&prepass=${prepass}&aa=${aa}`});
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){const state=await evaluate(`({ready:!!window.__architecture,error:document.querySelector('#render-error')?.textContent})`);if(state.error)throw Error(state.error);if(state.ready)break;await sleep(500)}
  await evaluate(`window.knightEPSTwin.ready.then(async()=>{window.knightEPSTwin.setQuality('studio');return window.knightEPSTwin.readyForImage})`);
  await sleep(2500);
 }
 output.hardware=await evaluate('window.__architecture.hardware()');
 output.depthSupport=await evaluate(`(()=>{const r=__architecture.renderer,g=r.getContext?.()||r.backend?.gl;return typeof g?.getExtension==='function'?{clipControl:!!g.getExtension('EXT_clip_control'),depthBits:g.getParameter(g.DEPTH_BITS),requested:r.__prototypeDepth,reverse:r.capabilities.reverseDepthBuffer}:null})()`);
 output.backend=await evaluate('window.__architecture.backend');
 output.geometry=await evaluate('({triangles:__architecture.logicalTriangles(),parts:__architecture.parts.length,boards:knightEPSTwin.geometryAudit()})');
 output.state=await evaluate('knightEPSTwin.state()');
 output.memory=await evaluate('__architecture.memory()');output.artwork=await evaluate('window.__artworkPreparation||null');output.costDiagnostic=await evaluate('window.__costDiagnostic||null');
 output.diagnosticOverlay=await evaluate(`(()=>{const e=document.querySelector('[data-architecture-diagnostic]')||[...document.querySelectorAll('div')].find(e=>!e.children.length&&e.textContent.startsWith('DIAGNOSTIC ·'));return e?.getBoundingClientRect().toJSON()||null})()`);
 output.uiOverlays=await evaluate(`['.viewport header','.preset-controls','.framing-controls','.instructions','#sidebar-toggle','[data-architecture-diagnostic]'].map(selector=>({selector,rect:document.querySelector(selector)?.getBoundingClientRect().toJSON()})).filter(x=>x.rect)`);
 if(mode==='review'||mode==='qualify'){
  if(mode==='qualify'){
   output.depthFallback=await evaluate(`(async()=>{const p=__architecture,T=await import('three');p.controls.autoRotate=false;p.controls.enableDamping=false;p.api.reset();p.api.view('iso');await new Promise(r=>setTimeout(r,600));const position=p.camera.position.clone(),up=p.camera.up.clone(),target=p.controls.target.clone();p.camera.position.copy(target).add(new T.Vector3(.035,0,0));p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));const fallback={...p.depthGuard.state};let boundedMaterials=0;p.scene.traverseVisible(m=>{if(m.isMesh)for(const mat of [m.material].flat())if('KNIGHT_BOUNDED_DEPTH' in (mat.defines||{}))boundedMaterials++});p.camera.position.copy(position);p.camera.up.copy(up);p.controls.target.copy(target);p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));return {fallback,boundedMaterials,restored:{...p.depthGuard.state}}})()`);
   if(output.depthFallback.fallback.active!=='logarithmic-fallback'||output.depthFallback.boundedMaterials||output.depthFallback.restored.active!=='bounded')throw Error('Depth fallback/restoration failed');
   if(cull!=='baseline'){
    output.cullingFallback=await evaluate(`(async()=>{const p=__architecture,T=await import('three');let mesh;p.model.traverseVisible(m=>{if(!mesh&&m.isMesh&&m.userData.certifiedClosed)mesh=m});if(!mesh)throw Error('Missing certified solid');const position=p.camera.position.clone(),up=p.camera.up.clone(),target=p.controls.target.clone(),center=mesh.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld);p.camera.position.copy(center);p.controls.target.copy(center).add(new T.Vector3(.05,0,0));p.camera.lookAt(p.controls.target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));const insideSide=[mesh.material].flat()[0].side,insideDepth=p.depthGuard.state.active,insideCallbackCpuMs=p.api.performance().cpuFrameMs;p.camera.position.copy(position);p.camera.up.copy(up);p.controls.target.copy(target);p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));return {insideSide,insideDepth,insideCallbackCpuMs,restoredSide:[mesh.material].flat()[0].side,expectedInside:T.DoubleSide,expectedOutside:T.FrontSide}})()`);
    if(output.cullingFallback.insideSide!==output.cullingFallback.expectedInside||output.cullingFallback.restoredSide!==output.cullingFallback.expectedOutside)throw Error('Closed-solid interior fallback/restoration failed');
   }
  }
  if(mode==='qualify'&&aa==='fxaa'){
   output.aaResize=await evaluate(`(async()=>{const p=__architecture,read=()=>({buffer:[p.renderer.domElement.width,p.renderer.domElement.height],filter:[p.fxaa.state.width,p.fxaa.state.height],copies:p.memory().viewportCopies.length});p.api.setQuality('performance');await new Promise(r=>setTimeout(r,500));const smaller=read();p.api.setQuality('studio');await new Promise(r=>setTimeout(r,500));return {smaller,restored:read()}})()`);
   const {smaller,restored}=output.aaResize;
   if(smaller.buffer[0]>=restored.buffer[0]||[smaller,restored].some(s=>s.buffer.some((v,i)=>v!==s.filter[i])||s.copies>2))throw Error('AA resize or capture resource reuse failed');
  }
  output.dispose=await evaluate(`(async()=>{const p=__architecture;p.api.dispose();p.api.dispose();const count=p.api.performance().renderCount;await new Promise(r=>setTimeout(r,1200));return {renderCountStable:p.api.performance().renderCount===count,ownership:p.ownership(),parts:p.parts.length,modelChildren:p.model.children.length}})()`);
  if(!output.dispose.renderCountStable||Object.values(output.dispose.ownership).some(Boolean)||output.dispose.parts||output.dispose.modelChildren)throw Error('Cleanup check failed');
  await send('Page.navigate',{url:`http://127.0.0.1:8770/verification/twin-architecture-20261110/prototype/?renderer=${variant}&asset=${asset}&appearance=${appearance}&depth=${depth}&shadow=${shadow}&cull=${cull}&order=${order}&pbr=${pbr}&capture=${capture}&prepass=${prepass}&aa=${aa}`});
  for(let n=0;n<120;n++){if(await evaluate('!!window.__architecture'))break;await sleep(500)}
  await evaluate(`knightEPSTwin.ready.then(async()=>{knightEPSTwin.setQuality('studio');return knightEPSTwin.readyForImage})`);await sleep(700);
  output.reload=await evaluate('({triangles:__architecture.logicalTriangles(),parts:__architecture.parts.length,memory:__architecture.memory()})');
  if(output.reload.triangles!==874229||output.reload.parts!==95)throw Error('Reload integrity failed');
 }
 if(mode==='visual'||mode==='shadow-visual'){
  output.checks=[];
  async function check(name,expression){const passed=await evaluate(expression);output.checks.push({name,passed:!!passed});if(!passed)throw Error('Check failed: '+name)}
  output.depthChecks=[];
  async function capture(name){await sleep(200);output.depthChecks.push({name,state:await evaluate('__architecture.depthGuard?.state||null')});const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(results,`${key}-${name}.png`),Buffer.from(shot.data,'base64'))}
  await capture('assembled');
  for(const [board,face] of (mode==='shadow-visual'?[]:[['Regulator_01','top'],['Regulator_01','bottom'],['Regulator_01','oblique'],['MCU_Final','top'],['MCU_Final','bottom']])){
   await evaluate(`(async()=>{const p=__architecture;p.api.reset();p.controls.enableDamping=false;p.api.select('${board}');document.querySelector('#isolate-selected').click();p.api.focus();await new Promise(r=>setTimeout(r,500));return true})()`);
   // Use the actual original artwork basis, independent of renderer and model
   // object bounds. This keeps fine-detail views matched across candidates.
   await evaluate(`(async()=>{const p=__architecture,T=await import('three'),cfg=(await fetch('./assets/artwork-layout.json').then(r=>r.json())).find(b=>b.id==='${board}'),part=p.model.getObjectByName('${board}'),layer=cfg.layers['${face==='bottom'?'bottom':'top'}'],world=v=>new T.Vector3(...v).applyMatrix4(part.matrixWorld),mean=l=>l.positions.reduce((v,x)=>v.add(world(x)),new T.Vector3()).multiplyScalar(1/l.positions.length),center=mean(layer),normal=mean(cfg.layers.top).sub(mean(cfg.layers.bottom)).normalize();if('${face}'==='bottom')normal.negate();const lo=new T.Vector3(Infinity,Infinity,Infinity),hi=new T.Vector3(-Infinity,-Infinity,-Infinity);for(const v of layer.positions){const w=world(v);lo.min(w);hi.max(w)}const size=hi.clone().sub(lo).length();let up=null;for(let i=0;i<layer.uv.length&&!up;i++)for(let j=i+1;j<layer.uv.length;j++)if(layer.uv[i][0]===layer.uv[j][0]&&layer.uv[i][1]!==layer.uv[j][1]){up=world(layer.positions[j]).sub(world(layer.positions[i])).multiplyScalar(Math.sign(layer.uv[j][1]-layer.uv[i][1])).normalize();break}if('${face}'==='oblique')normal.addScaledVector(new T.Vector3().crossVectors(up,normal),.55).normalize();p.camera.near=.0001;p.camera.far=10;p.camera.clearViewOffset();p.camera.zoom=1;p.camera.updateProjectionMatrix();p.camera.up.copy(up);p.controls.target.copy(center);p.camera.position.copy(center).addScaledVector(normal,size*1.25);p.camera.lookAt(center);p.controls.update();p.clearSelection();p.controls.dispatchEvent({type:'change'});return true})()`);
   await sleep(400);await capture(`${board}-${face}`);
  }
  await check('component count and logical triangles',`__architecture.parts.length===95&&__architecture.logicalTriangles()===874229`);
  await check('picking/selection ownership',`(()=>{knightEPSTwin.select('MCU_Final');return knightEPSTwin.selectionProbe()?.id==='MCU_Final'})()`);
  await check('visibility',`(()=>{knightEPSTwin.setVisible('MCU_Final',false);const v=!knightEPSTwin.state().parts.find(p=>p.id==='MCU_Final').visible;knightEPSTwin.setVisible('MCU_Final',true);return v})()`);
  await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.view('miner');return true})()`);await sleep(700);await capture('acrylic');
  await check('LCD synthetic packet',`(()=>{knightEPSTwin.updateTelemetry({battery_voltage_v:15.42,temperature_c:26.5,status:'SYNTHETIC CHECK'},{source:'mock'});const s=knightEPSTwin.state().display;return s.source==='mock'&&s.readings.battery_voltage_v===15.42})()`);
  await check('LCD presentation',`(()=>{knightEPSTwin.setScreenState('standby',{title:'ARCHITECTURE TEST'});return knightEPSTwin.state().display.presentation.title==='ARCHITECTURE TEST'})()`);
  await check('X-ray and Performance switching',`(()=>{document.querySelector('#xray-toggle').click();const x=knightEPSTwin.state().xray;document.querySelector('#xray-toggle').click();knightEPSTwin.setQuality('performance');const q=knightEPSTwin.state().quality==='performance';knightEPSTwin.setQuality('studio');return x&&q})()`);
  await sleep(500);
  output.dispose=await evaluate(`(async()=>{const p=__architecture;p.api.dispose();const count=p.api.performance().renderCount;await new Promise(r=>setTimeout(r,1200));return {renderCountStable:p.api.performance().renderCount===count,ownership:p.ownership(),parts:p.parts.length,modelChildren:p.model.children.length,transport:p.api.state().display.transport}})()`);
  if(!output.dispose.renderCountStable||Object.values(output.dispose.ownership).some(Boolean)||output.dispose.parts||output.dispose.modelChildren)throw Error('Disposal retained owned resources or rendering');
 }
 if(['measure','thermal','screen','animation','load60','thermal60','screen60','animation60','hotreplay60'].includes(mode)){
  const warmMs=mode==='thermal'||mode==='thermal60'?300000:5000;
  await evaluate(`(()=>{const p=__architecture;p.api.connectTelemetry('/architecture-events',{source:'mock'});p.controls.autoRotate=true;p.controls.autoRotateSpeed=2;p.controls.dispatchEvent({type:'change'});return true})()`);
  console.log(JSON.stringify({stage:'warmup',warmMs,variant,asset}));
  if(mode==='thermal60')await evaluate(`(()=>{window.__heatCycle=setInterval(()=>document.querySelector('#explode-toggle').click(),2500);__architecture.begin();return true})()`);
  await sleep(warmMs);
  if(mode==='thermal60'){output.sustainedWarmup=await evaluate('__architecture.end()');await evaluate(`(()=>{clearInterval(window.__heatCycle);knightEPSTwin.connectTelemetry('/architecture-events',{source:'mock'});knightEPSTwin.reset();knightEPSTwin.view('iso');return true})()`);await sleep(3000)}
  if(mode==='hotreplay60'){await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.view('iso');return true})()`);await sleep(3000)}
  output.interactions=[];
  for(const [name,duration] of (['screen','screen60'].includes(mode)?[['orbit',10000]]:['animation','animation60'].includes(mode)?[['lid',15000],['explosion',15000]]:[['orbit',30000],['lid',15000],['explosion',15000]])){
   console.log(JSON.stringify({stage:name,variant,asset}));
   await evaluate(`(()=>{const p=__architecture;p.controls.autoRotate=true;p.controls.dispatchEvent({type:'change'});${name!=='orbit'?`window.__cycle=setInterval(()=>document.querySelector('${name==='lid'?'#top-toggle':'#explode-toggle'}').click(),2000);document.querySelector('${name==='lid'?'#top-toggle':'#explode-toggle'}').click();`:''}p.begin();return true})()`);
   await sleep(duration);
   const data=await evaluate(`(()=>{clearInterval(window.__cycle);const p=__architecture,r=p.end();p.controls.autoRotate=false;return r})()`);
   output.interactions.push({name,requestedDurationMs:duration,...data});
   if(name==='lid'){await evaluate(`(()=>{if(knightEPSTwin.state().topRemoved)document.querySelector('#top-toggle').click();return true})()`);await sleep(2000)}
  }
  output.finalState=await evaluate('knightEPSTwin.state()');
 }
 if(mode==='smoke'||mode==='capture'){
  // Screenshot captures the presented page, independent of canvas preservation.
  const shot=await send('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(results,`${key}-${mode}.png`),Buffer.from(shot.data,'base64'));
 }
 output.performance=await evaluate('knightEPSTwin.performance()');
 output.shadowOptimization=await evaluate('__architecture.shadowOptimization');
 output.culling=await evaluate('__architecture.culling?.state||null');
 output.renderClock=await evaluate('window.__renderClock||null');
 output.materialConstants=await evaluate('__architecture.constants?.state||null');
 output.occlusion=await evaluate('__architecture.occlusion?.state||null');
 output.fxaa=await evaluate('__architecture.fxaa?.state||null');
 if(mode==='smoke')await evaluate(`(()=>{__architecture.controls.autoRotate=false;return true})()`);
 if(logs.some(m=>m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'))throw Error('Renderer exception or console error; see saved logs.');
 output.complete=true;
}catch(error){output.error=error.stack;process.exitCode=1}
finally{
 output.logs=logs;output.finished=new Date().toISOString();
 await fs.writeFile(path.join(results,`${key}-${mode}.json`),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({complete:output.complete,error:output.error,backend:output.backend,hardware:output.hardware,geometry:output.geometry&&{triangles:output.geometry.triangles,parts:output.geometry.parts},performance:output.performance&&{draws:output.performance.drawCalls,triangles:output.performance.triangles,cpuMs:output.performance.cpuFrameMs},errors:logs.filter(m=>m.method==='Runtime.exceptionThrown').map(m=>m.params.exceptionDetails.exception?.description?.split('\n').slice(0,2))}));socket.close();
}
