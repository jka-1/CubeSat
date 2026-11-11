// Bounded CDP driver for our local prototype in a dedicated temporary profile.
// No package dependencies, personal browser profile or external model upload.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.join(here,'results');
const root=path.resolve(here,'../..'),source=await fs.readFile(path.join(root,'site/knight-eps-phase12/viewer/main.mjs'),'utf8');
await fs.mkdir(results,{recursive:true});
const [mode='smoke']=process.argv.slice(2);
const variant='legacy',asset='compact',appearance='display-space-acrylic',depth='bounded',shadow='ortho',cull='certified',prepass='cheap',aa='fxaa';
const clock=['load60','thermal60','screen60','animation60','hotreplay60'].includes(mode)?'timer60':'raf';
const rgba=process.env.KNIGHT_ARTWORK_CONTROL==='rgba';
const key='replacement-production'+(rgba?'-rgba-control':'')+(clock==='raf'?'':'-timer60-clock');
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map(),logs=[];let id=0,sessionId;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
socket.onmessage=async e=>{const m=JSON.parse(e.data);
 if(m.method==='Fetch.requestPaused'){
  let body=source.replace('renderReady=true;controls.enabled=true;', "instrument({renderer,scene,camera,controls,api,parts:meshes,display,model,clearSelection:()=>select(null),pipeline});renderReady=true;controls.enabled=true;");
  body="import {instrument} from '/verification/twin-integration-20261111/instrument.mjs';\nimport {requestRenderTick,cancelRenderTick} from '/verification/twin-architecture-20261110/prototype/render-clock.mjs';\n"+body.replaceAll('requestAnimationFrame(', 'requestRenderTick(').replaceAll('cancelAnimationFrame(', 'cancelRenderTick(').replace('const frameStart=performance.now();','const frameStart=performance.now();renderer.__integrationFrameStart=frameStart;').replace('metrics.cpuFrameMs=performance.now()-frameStart;','metrics.cpuFrameMs=performance.now()-frameStart;renderer.__integrationFrameStart=null;');
  await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(body).toString('base64')});return;
 }if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result)}else if(['Runtime.exceptionThrown','Log.entryAdded','Runtime.consoleAPICalled','Target.targetCrashed','Target.targetDestroyed','Target.detachedFromTarget','Inspector.targetCrashed'].includes(m.method)){if(logs.length<80)logs.push(m)}};
function send(method,params={},session=sessionId){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(session?{sessionId:session}:{})}))})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targetId,output={mode,variant,asset,appearance,depth,shadow,cull,prepass,aa,clock,started:new Date().toISOString(),browser:version.Browser};
try{
 // Reuse one test target and close all other targets in this temporary profile.
 const targets=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');
 targetId=targets[0]?.targetId||(await send('Target.createTarget',{url:'about:blank'},null)).targetId;
 for(const t of targets.slice(1))await send('Target.closeTarget',{targetId:t.targetId},null);
 sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
 await send('Target.setDiscoverTargets',{discover:true},null);await send('Runtime.enable');await send('Page.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:mode==='mobile'?390:1290,height:mode==='mobile'?844:720,deviceScaleFactor:2,mobile:mode==='mobile'});
 await send('Page.bringToFront');
 if(rgba)await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.DecompressionStream=undefined'});
 await send('Fetch.enable',{patterns:[{urlPattern:'*site/knight-eps-phase12/viewer/main.mjs*',requestStage:'Request'}]});
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
  await send('Page.navigate',{url:`http://127.0.0.1:8770/site/knight-eps-phase12/viewer/?clock=${clock}`});
  if(mode==='early-dispose'){
   for(let n=0;n<100;n++){if(await evaluate('!!window.knightEPSTwin'))break;await sleep(50)}
   output.earlyDispose=await evaluate(`(async()=>{const p=knightEPSTwin;p.dispose();p.dispose();await p.ready;await new Promise(r=>setTimeout(r,1200));return {parts:p.state().parts.length,loaded:p.state().loaded,transport:p.state().display.transport,renderCount:p.performance().renderCount}})()`);
   if(output.earlyDispose.parts||output.earlyDispose.loaded||output.earlyDispose.transport!=='disconnected'||logs.some(m=>m.method==='Runtime.exceptionThrown'||m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'))throw Error('Early disposal failed');
   output.complete=true;output.logs=logs;output.finished=new Date().toISOString();await fs.writeFile(path.join(results,'production-early-dispose.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output.earlyDispose));socket.close();process.exit(0);
  }
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){const state=await evaluate(`({ready:!!window.__architecture,error:document.querySelector('#render-error')?.textContent})`);if(state.error)throw Error(state.error);if(state.ready)break;await sleep(500)}
  await evaluate(`window.knightEPSTwin.ready.then(async()=>{window.knightEPSTwin.setQuality('studio');return window.knightEPSTwin.readyForImage})`);
  await sleep(2500);
 }
 output.startupPerformance=await evaluate('knightEPSTwin.performance()');
 output.hardware=await evaluate('window.__architecture.hardware()');
 output.depthSupport=await evaluate(`(()=>{const r=__architecture.renderer,g=r.getContext?.()||r.backend?.gl;return typeof g?.getExtension==='function'?{clipControl:!!g.getExtension('EXT_clip_control'),depthBits:g.getParameter(g.DEPTH_BITS),requested:r.__prototypeDepth,reverse:r.capabilities.reverseDepthBuffer}:null})()`);
 output.backend=await evaluate('window.__architecture.backend');
 output.modelPackage=await evaluate('__architecture.model.userData.displayPackage');
 output.geometry=await evaluate('({triangles:__architecture.logicalTriangles(),parts:__architecture.parts.length,boards:knightEPSTwin.geometryAudit()})');
 output.state=await evaluate('knightEPSTwin.state()');
 output.memory=await evaluate('__architecture.memory()');output.artwork=await evaluate('window.__artworkPreparation||null');output.costDiagnostic=await evaluate('window.__costDiagnostic||null');
 output.diagnosticOverlay=await evaluate(`(()=>{const e=document.querySelector('[data-architecture-diagnostic]')||[...document.querySelectorAll('div')].find(e=>!e.children.length&&e.textContent.startsWith('DIAGNOSTIC ·'));return e?.getBoundingClientRect().toJSON()||null})()`);
 output.uiOverlays=await evaluate(`['.viewport header','.preset-controls','.framing-controls','.instructions','#sidebar-toggle','[data-architecture-diagnostic]'].map(selector=>({selector,rect:document.querySelector(selector)?.getBoundingClientRect().toJSON()})).filter(x=>x.rect)`);
 if(mode==='mobile'){
  output.mobile=await evaluate(`(async()=>{const p=__architecture;const hidden=document.body.classList.contains('panel-hidden'),width=document.documentElement.scrollWidth;document.querySelector('#sidebar-toggle').click();await new Promise(r=>setTimeout(r,300));const rect=document.querySelector('#viewer-sidebar').getBoundingClientRect().toJSON(),open=!document.querySelector('#viewer-sidebar').inert;document.querySelector('#sidebar-toggle').click();await new Promise(r=>setTimeout(r,300));return {hidden,open,rect,width,viewport:[innerWidth,innerHeight],quality:p.api.state().quality,canvas:[p.renderer.domElement.clientWidth,p.renderer.domElement.clientHeight],buffer:[p.renderer.domElement.width,p.renderer.domElement.height]}})()`);
  const m=output.mobile;if(!m.hidden||!m.open||m.width>m.viewport[0]||m.rect.left<0||m.rect.right>m.viewport[0]+1||m.quality!=='studio')throw Error('Mobile layout/quality failed');
  const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:390,height:844,scale:.5}});await fs.writeFile(path.join(results,'production-mobile.png'),Buffer.from(shot.data,'base64'));
 }
 if(mode==='fixture-focus'){
  await evaluate(`(()=>{knightEPSTwin.select('BMS_BQ76942');knightEPSTwin.focus();return true})()`);await sleep(700);
  output.fixtureFocus=await evaluate(`(()=>{const p=__architecture,ghosts=p.api.state().focusReveal.map(id=>p.model.getObjectByName(id)).filter(o=>o.name.startsWith('Mount_'));return {ghosts:ghosts.map(o=>({id:o.name,ownDraw:o.layers.isEnabled(0),transparent:o.material.transparent,instancedCount:p.scene.children.find(b=>b.isInstancedMesh&&b.geometry===o.geometry)?.count}))}})()`);
  if(!output.fixtureFocus.ghosts.length||output.fixtureFocus.ghosts.some(o=>!o.ownDraw||!o.transparent||o.instancedCount>=26))throw Error('Ghosted fixture still renders opaque in its instance batch');
  await evaluate('knightEPSTwin.reset()');await sleep(700);
  output.fixtureFocus.restored=await evaluate(`__architecture.scene.children.filter(o=>o.isInstancedMesh).map(o=>o.count)`);
  if(output.fixtureFocus.restored.some(n=>n!==26))throw Error('Fixture instancing did not restore');
 }
 if(mode==='orbit-return'){
  output.orbitReturn=[];
  const settle=()=>sleep(700);
  async function emptyClick(){
   const point=await evaluate(`(async()=>{const p=__architecture,T=await import('three'),r=p.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.layers.enable(1);const ghosts=new Set(p.api.state().focusReveal);for(const x of [15,r.width-15,50,r.width-50])for(const y of [150,r.height-100,300]){ray.setFromCamera(new T.Vector2(x/r.width*2-1,1-y/r.height*2),p.camera);if(!ray.intersectObjects(p.parts.filter(m=>m.visible&&!ghosts.has(m.name)),true).length)return {x:x+r.left,y:y+r.top}}throw Error('No empty canvas point')})()`);
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  }
  for(const id of ['INA226','Regulator_01','Regulator_02','BMS_BQ76942','Charger_BMS034A_EVM','MCU_Final','BatteryPack_4x18650','NerdMiner_Heltec_V2']){
   await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('${id}');knightEPSTwin.focus()})()`);await settle();
   const focused=await evaluate('knightEPSTwin.state().camera');await emptyClick();await settle();
   const returned=await evaluate(`(()=>{const p=__architecture,s=p.api.state(),offset=p.camera.position.clone().sub(p.controls.target);return {selected:s.selected,target:s.camera.target,center:s.camera.chassisCenter,up:s.camera.up,distance:offset.length(),poleClearance:Math.hypot(offset.x,offset.z)/offset.length(),reveal:s.focusReveal.length,position:s.camera.position,quaternion:p.camera.quaternion.toArray()}})()`);
   const row={id,focused,returned};output.orbitReturn.push(row);
   if(returned.selected||returned.reveal||returned.target.some((v,i)=>Math.abs(v-returned.center[i])>1e-7)||returned.up.some((v,i)=>Math.abs(v-[0,1,0][i])>1e-7)||returned.poleClearance<.08)throw Error('Unstable orbit handoff: '+id);
   const drag=await evaluate(`(()=>{const r=__architecture.renderer.domElement.getBoundingClientRect();return {x:r.left+r.width*.35,y:r.top+r.height*.5}})()`);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...drag,button:'left',buttons:1,clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+90,y:drag.y+30,button:'left',buttons:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+90,y:drag.y+30,button:'left',buttons:0,clickCount:1});await settle();
   row.dragged=await evaluate(`(()=>{const p=__architecture,s=p.api.state();return {target:s.camera.target,up:s.camera.up,rightY:p.camera.matrix.elements[1],quaternion:p.camera.quaternion.toArray(),selected:s.selected}})()`);
   if(row.dragged.selected||Math.abs(row.dragged.rightY)>1e-7||row.dragged.target.some((v,i)=>Math.abs(v-returned.target[i])>1e-7)||row.dragged.quaternion.every((v,i)=>Math.abs(v-returned.quaternion[i])<.01))throw Error('Native orbit drag failed: '+id);
  }
  for(const id of ['Charger_BMS034A_EVM','BatteryPack_4x18650']){
   await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('${id}');document.querySelector('#isolate-selected').click();knightEPSTwin.focus()})()`);await settle();
   const before=await evaluate('knightEPSTwin.state()');await emptyClick();await settle();const after=await evaluate('knightEPSTwin.state()');
   if(after.selected||after.camera.target.some((v,i)=>Math.abs(v-before.camera.target[i])>1e-7)||after.camera.up.some((v,i)=>Math.abs(v-before.camera.up[i])>1e-7)||JSON.stringify(after.parts.filter(p=>p.visible).map(p=>p.id))!==JSON.stringify(before.parts.filter(p=>p.visible).map(p=>p.id)))throw Error('Isolated framing changed: '+id);
   output.orbitReturn.push({id,isolated:true,preserved:true});
  }
 }
 if(mode==='rgba-compat'){
  if(!rgba||output.modelPackage.coverageImages!==0||output.geometry.parts!==95||output.geometry.triangles!==871131)throw Error('RGBA compatibility path failed');
  output.rgbaCompatibility=[];
  for(const id of ['BMS_BQ76942','Charger_BMS034A_EVM']){
   await evaluate(`(()=>{knightEPSTwin.select('${id}');document.querySelector('#isolate-selected').click();knightEPSTwin.focus()})()`);await sleep(650);
   const probe=await evaluate('knightEPSTwin.selectionProbe()');if(probe?.id!==id)throw Error('RGBA fallback picking failed: '+id);output.rgbaCompatibility.push({id,pickable:true});await evaluate('knightEPSTwin.reset()');await sleep(650);
  }
 }
 if(mode==='pack-repro'){
  output.packRepro=await evaluate(`(()=>{knightEPSTwin.reset();document.querySelector('[data-name="BatteryCell_01"]').click();document.querySelector('#isolate-selected').click();return {selected:knightEPSTwin.state().selected,members:knightEPSTwin.state().selectionMembers,visible:knightEPSTwin.state().parts.filter(p=>p.visible).map(p=>p.id)}})()`);
  console.log(JSON.stringify(output.packRepro));
 }
 if(mode==='inspection'||mode==='replacements'||mode==='replacements-remaining'){
  output.inspection={pcbs:[],checks:[]};
  const check=(name,passed)=>{output.inspection.checks.push({name,passed});if(!passed)throw Error(name)};
  const settle=()=>sleep(650);
  async function capture(name){const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:name==='mobile'?390:1290,height:name==='mobile'?844:720,scale:.5}});await fs.writeFile(path.join(results,`replacement-${name}.png`),Buffer.from(shot.data,'base64'))}
  if(mode!=='replacements-remaining'){
  await capture('floor-above');
  await evaluate(`(()=>{const p=__architecture;p.controls.enableDamping=false;const offset=p.camera.position.clone().sub(p.controls.target).normalize().multiplyScalar(4.5);p.camera.position.copy(p.controls.target).add(offset);p.controls.update();p.controls.dispatchEvent({type:'change'});return true})()`);await settle();await capture('floor-far');
  await evaluate(`knightEPSTwin.view('bottom')`);await settle();await capture('floor-under');
  output.inspection.floor=await evaluate(`(()=>{const p=__architecture,T=p.scene.getObjectByName('Display_ShadowFloor');return {material:T.material.type,transparent:T.material.transparent,side:T.material.side,background:p.renderer.getClearColor(new (T.material.color.constructor)()).getHexString()}})()`);
  check('shadow-only front-sided receiver',output.inspection.floor.material==='ShadowMaterial'&&output.inspection.floor.transparent&&output.inspection.floor.side===0);
  output.inspection.payload=await evaluate(`(()=>{const p=__architecture;p.api.reset();const ids=p.api.state().parts.filter(x=>x.assembly==='NerdMiner_Heltec_V2').map(x=>x.id),selections=ids.map(id=>p.api.select(id)),members=p.api.state().selectionMembers;document.querySelector('#isolate-selected').click();const isolated=p.api.state().parts.filter(x=>x.visible).map(x=>x.id),rows=[...document.querySelectorAll('#parts button')].filter(b=>b.dataset.name.startsWith('NerdMiner'));p.api.focus();return {ids,selections,members,isolated,rows:rows.map(b=>b.dataset.name),selected:p.api.state().selected}})()`);
  const pl=output.inspection.payload;check('all payload leaves select the same complete assembly',pl.ids.length===20&&pl.selections.every(id=>id==='NerdMiner_Heltec_V2')&&pl.members.length===20&&pl.isolated.length===20&&pl.isolated.every(id=>pl.ids.includes(id))&&pl.rows.length===1);
  await settle();await capture('payload');
  const payloadClick=await evaluate(`(()=>{const p=knightEPSTwin.selectionProbe(),r=document.querySelector('#canvas canvas').getBoundingClientRect();__architecture.clearSelection();return {x:p.x+r.left,y:p.y+r.top}})()`);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...payloadClick,button:'left',clickCount:1});
  check('native payload picking selects the entire assembly',await evaluate(`knightEPSTwin.state().selected==='NerdMiner_Heltec_V2'&&knightEPSTwin.state().selectionMembers.length===20`));
  output.inspection.payloadVisibility=await evaluate(`(()=>{const p=__architecture;p.api.setVisible('NerdMiner_Case_Front',false);const hidden=p.api.state().parts.filter(x=>x.assembly==='NerdMiner_Heltec_V2').every(x=>!x.visible);p.api.setVisible('NerdMiner_Heltec_V2',true);const shown=p.api.state().parts.filter(x=>x.assembly==='NerdMiner_Heltec_V2').every(x=>x.visible);return {hidden,shown}})()`);check('payload aliases share visibility',Object.values(output.inspection.payloadVisibility).every(Boolean));
  await evaluate('knightEPSTwin.reset()');await settle();
  for(const id of ['MCU_Final','INA226','Regulator_01','Regulator_02','BMS_BQ76942','Charger_BMS034A_EVM','TemperatureSensor']){
   const cpu=await evaluate(`(()=>{const start=performance.now();knightEPSTwin.select('${id}');knightEPSTwin.focus();return performance.now()-start})()`);await settle();
   const result=await evaluate(`(async()=>{const p=__architecture,T=await import('three'),meta=await fetch('/site/knight-eps-phase12/docs/component_manifest.json').then(r=>r.json()),normal=new T.Vector3(...meta.components['${id}'].mounting_normal).transformDirection(p.model.getObjectByName('world').matrixWorld),direction=p.camera.position.clone().sub(p.controls.target).normalize();return {id:'${id}',dot:direction.dot(normal),upDot:Math.abs(p.camera.up.dot(normal)),focus:p.api.state().orbitMode,revealed:p.api.state().focusReveal,probe:p.api.selectionProbe()}})()`);
   output.inspection.pcbs.push({...result,cpuMs:cpu});check(id+' is head-on and pickable',result.dot>.9999&&result.upDot<.001&&result.focus==='focus'&&!!result.probe);
   if(['MCU_Final','Regulator_01'].includes(id))await capture(id);
  }
  await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('MCU_Final');document.querySelector('#isolate-selected').click();knightEPSTwin.focus();return true})()`);await settle();
  const click=await evaluate(`(()=>{const p=knightEPSTwin.selectionProbe(),r=document.querySelector('#canvas canvas').getBoundingClientRect();__architecture.clearSelection();return {x:p.x+r.left,y:p.y+r.top}})()`);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:click.x,y:click.y,button:'left',clickCount:1});
  const single=await evaluate(`({selected:knightEPSTwin.state().selected,mode:knightEPSTwin.state().orbitMode})`);
  check('single click selects without focusing',single.selected==='MCU_Final'&&single.mode==='satellite');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:click.x,y:click.y,button:'left',clickCount:2});await settle();
  check('native double click enters focus',await evaluate(`knightEPSTwin.state().orbitMode==='focus'&&knightEPSTwin.state().selected==='MCU_Final'`));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:20,y:300,button:'left',clickCount:2});await sleep(100);
  check('empty double click does not focus',await evaluate(`knightEPSTwin.state().selected===null&&knightEPSTwin.state().orbitMode==='satellite'`));
  await evaluate(`(()=>{knightEPSTwin.reset();document.querySelector('#top-toggle').click();return true})()`);await sleep(1300);
  await evaluate(`(()=>{knightEPSTwin.select('LightSensor');knightEPSTwin.focus();return true})()`);await settle();
  output.inspection.coverPCB=await evaluate(`(async()=>{const p=__architecture,T=await import('three'),part=p.model.getObjectByName('LightSensor'),normal=new T.Vector3(0,0,1).transformDirection(part.parent.matrixWorld),direction=p.camera.position.clone().sub(p.controls.target).normalize();return {cover:p.api.state().coverProgress,normal:normal.toArray(),direction:direction.toArray(),dot:normal.dot(direction)}})()`);
  check('cover PCB focus follows the opened lid',output.inspection.coverPCB.cover>.99&&output.inspection.coverPCB.dot>.9999);
  await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('BatteryCell_01');knightEPSTwin.focus();return true})()`);await settle();
  output.inspection.battery=await evaluate(`(()=>{const p=__architecture;return {outward:p.camera.position.x>p.controls.target.x,probe:p.api.selectionProbe(),reveal:p.api.state().focusReveal,mode:p.api.state().orbitMode}})()`);check('battery focus approaches outside and exposes the cell',output.inspection.battery.outward&&!!output.inspection.battery.probe);await capture('battery');
  await evaluate(`knightEPSTwin.reset()`);await settle();check('leaving focus restores context',await evaluate(`knightEPSTwin.state().focusReveal.length===0&&!knightEPSTwin.state().xray&&knightEPSTwin.state().parts.every(p=>p.visible)`));
  check('reset returns to the isometric direction',await evaluate(`(()=>{const p=__architecture;return p.camera.position.clone().sub(p.controls.target).normalize().dot(new (p.camera.position.constructor)(-1,1.05,1.25).normalize())>.9999})()`));
  }
  if(mode==='replacements'||mode==='replacements-remaining'){
   output.regressions=[];
   const checkRegression=(name,passed)=>{output.regressions.push({name,passed:!!passed});if(!passed)throw Error(name)};
   async function deselectEmpty(){
    const point=await evaluate(`(async()=>{const p=__architecture,T=await import('three'),r=p.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.layers.enable(1);const ghosts=new Set(p.api.state().focusReveal);for(const x of [15,r.width-15,50,r.width-50])for(const y of [150,r.height-100,300]){ray.setFromCamera(new T.Vector2(x/r.width*2-1,1-y/r.height*2),p.camera);if(!ray.intersectObjects(p.parts.filter(m=>m.visible&&!ghosts.has(m.name)),true).length)return {x:x+r.left,y:y+r.top}}throw Error('No empty canvas probe')})()`);
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
   }
   if(mode!=='replacements-remaining'){
   for(const id of ['Charger_BMS034A_EVM','BatteryPack_4x18650','NerdMiner_Heltec_V2']){
    await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('${id}');knightEPSTwin.focus()})()`);await settle();
    const before=await evaluate(`(()=>{const p=__architecture;return {target:p.controls.target.toArray(),offset:p.camera.position.clone().sub(p.controls.target).toArray(),position:p.camera.position.toArray()}})()`);
    await deselectEmpty();
    const immediate=await evaluate(`({position:__architecture.camera.position.toArray(),reveal:knightEPSTwin.state().focusReveal.length})`);await settle();output.orbitPoses??=[];output.orbitPoses.push({id,before,immediate,after:await evaluate('knightEPSTwin.state().camera')});
    checkRegression(id+' deselect returns an upright chassis orbit smoothly and preserves distance',await evaluate(`(()=>{const p=__architecture,b=${JSON.stringify(before)},immediate=${JSON.stringify(immediate)},offset=p.camera.position.clone().sub(p.controls.target);return !p.api.state().selected&&p.controls.target.distanceTo(new (p.camera.position.constructor)(...p.api.state().camera.chassisCenter))<1e-7&&Math.abs(offset.length()-new (offset.constructor)(...b.offset).length())<1e-6&&p.camera.up.distanceTo(new (offset.constructor)(0,1,0))<1e-7&&Math.hypot(offset.x,offset.z)/offset.length()>.08&&new (offset.constructor)(...immediate.position).distanceTo(new (offset.constructor)(...b.position))<new (offset.constructor)(...b.target).distanceTo(p.controls.target)*.5&&immediate.reveal===0})()`));
    await evaluate(`(()=>{knightEPSTwin.select('${id}');document.querySelector('#isolate-selected').click();knightEPSTwin.focus()})()`);await settle();
    const isolated=await evaluate(`({target:__architecture.controls.target.toArray(),visible:knightEPSTwin.state().parts.filter(p=>p.visible).map(p=>p.id)})`);
    await deselectEmpty();await settle();
    checkRegression(id+' isolated deselect preserves local pivot, geometry and exit control',await evaluate(`(()=>{const old=${JSON.stringify(isolated)},s=knightEPSTwin.state();return !s.selected&&s.camera.target.every((v,i)=>Math.abs(v-old.target[i])<1e-7)&&JSON.stringify(s.parts.filter(p=>p.visible).map(p=>p.id))===JSON.stringify(old.visible)&&!document.querySelector('#isolate-selected').disabled})()`));
    await evaluate(`document.querySelector('#isolate-selected').click()`);
   }
   output.batteryPack=await evaluate(`(()=>{const a=knightEPSTwin;a.reset();a.setVisible('MCU_Final',false);a.setVisible('NerdMiner_Heltec_V2',false);document.querySelector('[data-group="panels"]').click();const before=a.state().parts.filter(p=>p.visible).map(p=>p.id);document.querySelector('[data-name="BatteryPack_4x18650"]').click();document.querySelector('#isolate-selected').click();a.focus();const state=a.state();let highlighted=0;for(const id of state.selectionMembers){let on=true;__architecture.model.getObjectByName(id).traverse(m=>{if(m.isMesh)for(const mat of [m.material].flat())on&&=mat.emissiveIntensity===.16});highlighted+=on?1:0}return {before,members:state.selectionMembers,visible:state.parts.filter(p=>p.visible).map(p=>p.id),highlighted,probe:a.selectionProbe()}})()`);await settle();
   const pack=output.batteryPack;checkRegression('list battery pack isolation and highlighting retain holder and all four cells',pack.members.length===5&&pack.visible.length===5&&pack.highlighted===5&&pack.visible.every(id=>pack.members.includes(id)));
   const packClick=await evaluate(`(()=>{const p=knightEPSTwin.selectionProbe(),r=document.querySelector('#canvas canvas').getBoundingClientRect();__architecture.clearSelection();return {x:p.x+r.left,y:p.y+r.top}})()`);
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...packClick,button:'left',clickCount:1});
   checkRegression('canvas battery pack selection retains all five members',await evaluate(`knightEPSTwin.state().selected==='BatteryPack_4x18650'&&knightEPSTwin.state().selectionMembers.length===5`));
   await evaluate(`document.querySelector('#isolate-selected').click()`);
   checkRegression('leaving battery isolation restores exact previous visibility',await evaluate(`JSON.stringify(knightEPSTwin.state().parts.filter(p=>p.visible).map(p=>p.id))===${JSON.stringify(JSON.stringify(pack.before))}`));
   checkRegression('battery physical aliases share pack selection and visibility',await evaluate(`(()=>{const a=knightEPSTwin;const ids=['BatteryHolder_4x18650_CAD','BatteryCell_01','BatteryCell_02','BatteryCell_03','BatteryCell_04'];const selections=ids.map(id=>a.select(id));a.setVisible('BatteryCell_04',false);const hidden=a.state().parts.filter(p=>ids.includes(p.id)).every(p=>!p.visible);a.setVisible('BatteryHolder_4x18650_CAD',true);return hidden&&selections.every(id=>id==='BatteryPack_4x18650')&&a.state().parts.filter(p=>ids.includes(p.id)).every(p=>p.visible)})()`));
   }
   async function waitState(expression){for(let n=0;n<60;n++){if(await evaluate(expression))return;await sleep(100)}throw Error('Timed out: '+expression+' '+JSON.stringify(await evaluate('knightEPSTwin.state()')))}
   // Track the actual loopback synthetic EventSource across Reset View.
   await evaluate(`(()=>{const Native=window.EventSource;window.__resetStream={created:0,closed:0};window.EventSource=class extends Native{constructor(...args){super(...args);window.__resetStream.created++;window.__resetStream.stream=this}close(){window.__resetStream.closed++;super.close()}};knightEPSTwin.connectTelemetry('/architecture-events',{source:'mock'});window.EventSource=Native;knightEPSTwin.setQuality('performance');knightEPSTwin.reset();document.querySelector('#top-toggle').click()})()`);await waitState('knightEPSTwin.state().coverProgress>.99');
   checkRegression('lid opens before reset',await evaluate('knightEPSTwin.state().coverProgress>.99'));
   await evaluate(`document.querySelector('#reset-camera').click()`);await waitState('knightEPSTwin.state().coverProgress===0');await settle();
   checkRegression('Reset View closes lid and returns chassis orbit',await evaluate(`(()=>{const s=knightEPSTwin.state();return s.coverProgress===0&&!s.topRemoved&&s.camera.target.every((v,i)=>Math.abs(v-s.camera.chassisCenter[i])<1e-7)})()`));
   await evaluate(`(()=>{const a=knightEPSTwin;a.setVisible('BatteryPack_4x18650',false);a.setVisible('NerdMiner_Heltec_V2',false);a.setVisible('MCU_Final',false);document.querySelector('[data-group="panels"]').click();a.select('Charger_BMS034A_EVM');document.querySelector('#isolate-selected').click();a.focus();document.querySelector('#xray-toggle').click();document.querySelector('#explode-toggle').click();document.querySelector('#filter').value='no matching parts';document.querySelector('#filter').dispatchEvent(new Event('input'));document.querySelector('#include-fixtures').checked=true})()`);await waitState('knightEPSTwin.state().coverLiftProgress>.99');
   output.resetBefore=await evaluate('knightEPSTwin.state()');
   output.resetImmediate=await evaluate(`(()=>{const a=knightEPSTwin;a.updateTelemetry({battery_voltage_v:15.42,status:'SYNTHETIC RESET CHECK'},{source:'mock'});a.setScreenState('standby',{title:'RESET RETAINS LCD',message:'SYNTHETIC CHECK'});const before=a.state().display;document.querySelector('#reset-camera').click();const after=a.state().display;return {samePresentation:JSON.stringify(before.presentation)===JSON.stringify(after.presentation),sameReadings:JSON.stringify(before.readings)===JSON.stringify(after.readings),sameSource:before.source===after.source,sameTransport:before.transport===after.transport,stream:{created:__resetStream.created,closed:__resetStream.closed,open:__resetStream.stream.readyState===1}}})()`);await waitState('knightEPSTwin.state().coverLiftProgress===0');await settle();
   checkRegression('Reset View preserves LCD readings/presentation and the same SSE subscription',Object.values(output.resetImmediate).slice(0,4).every(Boolean)&&output.resetImmediate.stream.created===1&&output.resetImmediate.stream.closed===0&&output.resetImmediate.stream.open);
   checkRegression('Reset View restores every component, control and assembled default orbit',await evaluate(`(()=>{const p=__architecture,s=p.api.state();return s.parts.length===95&&s.parts.every(p=>p.visible)&&!s.selected&&!s.xray&&!s.exploded&&!s.extracted&&!s.topRemoved&&s.coverProgress===0&&s.coverLiftProgress===0&&s.focusReveal.length===0&&s.quality==='performance'&&s.camera.target.every((v,i)=>Math.abs(v-s.camera.chassisCenter[i])<1e-7)&&p.camera.position.clone().sub(p.controls.target).normalize().dot(new (p.camera.position.constructor)(-1,1.05,1.25).normalize())>.9999&&document.querySelector('#filter').value===''&&[...document.querySelectorAll('#visibility input,#parts input')].every(p=>p.checked)&&['#top-toggle','#explode-toggle','#xray-toggle','#isolate-selected'].every(id=>document.querySelector(id).getAttribute('aria-pressed')==='false')&&!document.querySelector('#top-toggle').disabled&&document.querySelector('#focus-selected').disabled})()`));
   await evaluate(`(()=>{knightEPSTwin.disconnectTelemetry();knightEPSTwin.setQuality('studio');knightEPSTwin.reset()})()`);await settle();
   for(const board of ['Charger_BMS034A_EVM','BMS_BQ76942']){
    await evaluate(`(()=>{knightEPSTwin.select('${board}');document.querySelector('#isolate-selected').click();knightEPSTwin.focus()})()`);await settle();await capture(board+'-top');
    checkRegression(board+' telemetry fields preserved',await evaluate(`document.querySelectorAll('#selected-readings p').length===${board==='Charger_BMS034A_EVM'?2:1}`));
    await evaluate(`(()=>{const p=__architecture;p.clearSelection();const offset=p.camera.position.clone().sub(p.controls.target);p.camera.position.copy(p.controls.target).sub(offset);p.camera.lookAt(p.controls.target);p.controls.update();p.controls.dispatchEvent({type:'change'})})()`);await settle();await capture(board+'-bottom');
    await evaluate(`(()=>{const p=__architecture,offset=p.camera.position.clone().sub(p.controls.target);offset.applyAxisAngle(p.camera.up,.65);p.camera.position.copy(p.controls.target).add(offset);p.camera.lookAt(p.controls.target);p.controls.update();p.controls.dispatchEvent({type:'change'})})()`);await settle();await capture(board+'-oblique');
    await evaluate('knightEPSTwin.reset()');await settle();
   }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await settle();await capture('mobile');
  check('mobile has no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await send('Emulation.setDeviceMetricsOverride',{width:1290,height:720,deviceScaleFactor:2,mobile:false});await evaluate('knightEPSTwin.reset()');await settle();
 }
 if(mode==='review'||mode==='qualify'){
  if(mode==='qualify'){
   output.firstSelection=await evaluate(`(async()=>{const p=__architecture;p.begin();p.api.select('MCU_Final');await new Promise(r=>setTimeout(r,350));const r=p.end();p.clearSelection();return r})()`);
   output.depthFallback=await evaluate(`(async()=>{const p=__architecture,T=await import('three');p.controls.autoRotate=false;p.controls.enableDamping=false;p.api.reset();p.api.view('iso');await new Promise(r=>setTimeout(r,600));const position=p.camera.position.clone(),up=p.camera.up.clone(),target=p.controls.target.clone();p.begin();p.camera.position.copy(target).add(new T.Vector3(.035,0,0));p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));const fallback={...p.depthGuard.state},transitionCosts=p.end();let boundedMaterials=0;p.scene.traverseVisible(m=>{if(m.isMesh)for(const mat of [m.material].flat())if('KNIGHT_BOUNDED_DEPTH' in (mat.defines||{}))boundedMaterials++});p.camera.position.copy(position);p.camera.up.copy(up);p.controls.target.copy(target);p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));return {fallback,transitionCosts,boundedMaterials,restored:{...p.depthGuard.state}}})()`);
   if(output.depthFallback.fallback.active!=='logarithmic-fallback'||output.depthFallback.boundedMaterials||output.depthFallback.restored.active!=='bounded')throw Error('Depth fallback/restoration failed');
   if(true){
    output.cullingFallback=await evaluate(`(async()=>{const p=__architecture,T=await import('three');let mesh;p.model.traverseVisible(m=>{if(!mesh&&m.isMesh&&m.userData.certifiedClosed)mesh=m});if(!mesh)throw Error('Missing certified solid');const position=p.camera.position.clone(),up=p.camera.up.clone(),target=p.controls.target.clone(),center=mesh.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld);p.camera.position.copy(center);p.controls.target.copy(center).add(new T.Vector3(.05,0,0));p.camera.lookAt(p.controls.target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));const insideSide=[mesh.material].flat()[0].side,insideDepth=p.depthGuard.state.active,insideCallbackCpuMs=p.api.performance().cpuFrameMs;p.camera.position.copy(position);p.camera.up.copy(up);p.controls.target.copy(target);p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,200));return {insideSide,insideDepth,insideCallbackCpuMs,restoredSide:[mesh.material].flat()[0].side,expectedInside:T.DoubleSide,expectedOutside:T.FrontSide}})()`);
    if(output.cullingFallback.insideSide!==output.cullingFallback.expectedInside||output.cullingFallback.restoredSide!==output.cullingFallback.expectedOutside)throw Error('Closed-solid interior fallback/restoration failed');
   }
  }
  if(mode==='qualify'){
   output.aaResize=await evaluate(`(async()=>{const p=__architecture,read=()=>({buffer:[p.renderer.domElement.width,p.renderer.domElement.height],filter:[p.fxaa.state.width,p.fxaa.state.height],copies:p.memory().viewportCopies.length,shadowShader:(()=>{let value;p.model.traverse(m=>{if(!value&&m.isMesh&&m.material.name?.startsWith('Chassis_Body')){const program=p.renderer.properties.get(m.material).currentProgram;value=program&&p.renderer.getContext().getShaderSource(program.fragmentShader).includes('#define USE_SHADOWMAP')}});return value})()});p.api.setQuality('performance');await new Promise(r=>setTimeout(r,500));const smaller=read();p.api.setQuality('studio');await new Promise(r=>setTimeout(r,500));return {smaller,restored:read()}})()`);
   const {smaller,restored}=output.aaResize;
   if(smaller.shadowShader!==false||restored.shadowShader!==true||smaller.buffer[0]>=restored.buffer[0]||[smaller,restored].some(s=>s.buffer.some((v,i)=>v!==s.filter[i])||s.copies>2))throw Error('AA resize or capture resource reuse failed');
  }
  output.dispose=await evaluate(`(async()=>{const p=__architecture;p.api.dispose();p.api.dispose();const count=p.api.performance().renderCount;await new Promise(r=>setTimeout(r,1200));return {renderCountStable:p.api.performance().renderCount===count,ownership:p.ownership(),parts:p.parts.length,modelChildren:p.model.children.length}})()`);
  if(!output.dispose.renderCountStable||Object.values(output.dispose.ownership).some(Boolean)||output.dispose.parts||output.dispose.modelChildren)throw Error('Cleanup check failed');
  await send('Page.navigate',{url:`http://127.0.0.1:8770/site/knight-eps-phase12/viewer/`});
  for(let n=0;n<120;n++){if(await evaluate('!!window.__architecture'))break;await sleep(500)}
  await evaluate(`knightEPSTwin.ready.then(async()=>{knightEPSTwin.setQuality('studio');return knightEPSTwin.readyForImage})`);await sleep(700);
  output.reload=await evaluate('({triangles:__architecture.logicalTriangles(),parts:__architecture.parts.length,memory:__architecture.memory()})');
  if(output.reload.triangles!==871131||output.reload.parts!==95)throw Error('Reload integrity failed');
 }
 if(mode==='visual'||mode==='shadow-visual'){
  output.checks=[];
  async function check(name,expression){const passed=await evaluate(expression);output.checks.push({name,passed:!!passed});if(!passed)throw Error('Check failed: '+name)}
  output.depthChecks=[];
  async function capture(name){await sleep(200);output.depthChecks.push({name,state:await evaluate('__architecture.depthGuard?.state||null')});const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1290,height:720,scale:.5}});await fs.writeFile(path.join(results,`${key}-${name}.png`),Buffer.from(shot.data,'base64'))}
  await capture('assembled');
  for(const [board,face] of (mode==='shadow-visual'?[]:[['Regulator_01','top'],['Regulator_01','bottom'],['Regulator_01','oblique'],['MCU_Final','top'],['MCU_Final','bottom']])){
   await evaluate(`(async()=>{const p=__architecture;p.api.reset();p.controls.enableDamping=false;p.api.select('${board}');document.querySelector('#isolate-selected').click();p.api.focus();await new Promise(r=>setTimeout(r,500));return true})()`);
   // Use the actual original artwork basis, independent of renderer and model
   // object bounds. This keeps fine-detail views matched across candidates.
   await evaluate(`(async()=>{const p=__architecture,T=await import('three'),cfg=(await fetch('/verification/twin-architecture-20261110/prototype/assets/artwork-layout.json').then(r=>r.json())).find(b=>b.id==='${board}'),part=p.model.getObjectByName('${board}'),layer=cfg.layers['${face==='bottom'?'bottom':'top'}'],world=v=>new T.Vector3(...v).applyMatrix4(part.matrixWorld),mean=l=>l.positions.reduce((v,x)=>v.add(world(x)),new T.Vector3()).multiplyScalar(1/l.positions.length),center=mean(layer),normal=mean(cfg.layers.top).sub(mean(cfg.layers.bottom)).normalize();if('${face}'==='bottom')normal.negate();const lo=new T.Vector3(Infinity,Infinity,Infinity),hi=new T.Vector3(-Infinity,-Infinity,-Infinity);for(const v of layer.positions){const w=world(v);lo.min(w);hi.max(w)}const size=hi.clone().sub(lo).length();let up=null;for(let i=0;i<layer.uv.length&&!up;i++)for(let j=i+1;j<layer.uv.length;j++)if(layer.uv[i][0]===layer.uv[j][0]&&layer.uv[i][1]!==layer.uv[j][1]){up=world(layer.positions[j]).sub(world(layer.positions[i])).multiplyScalar(Math.sign(layer.uv[j][1]-layer.uv[i][1])).normalize();break}if('${face}'==='oblique')normal.addScaledVector(new T.Vector3().crossVectors(up,normal),.55).normalize();p.camera.near=.0001;p.camera.far=10;p.camera.clearViewOffset();p.camera.zoom=1;p.camera.updateProjectionMatrix();p.camera.up.copy(up);p.controls.target.copy(center);p.camera.position.copy(center).addScaledVector(normal,size*1.25);p.camera.lookAt(center);p.controls.update();p.clearSelection();p.controls.dispatchEvent({type:'change'});return true})()`);
   await sleep(400);await capture(`${board}-${face}`);
  }
  await check('component count and logical triangles',`__architecture.parts.length===95&&__architecture.logicalTriangles()===871131`);
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
  const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1290,height:720,scale:.5}});
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
