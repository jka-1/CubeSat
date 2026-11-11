// Check restored camera/depth appearance, then open the uninstrumented site.
import fs from 'node:fs/promises';
const results=new URL('./results/',import.meta.url);
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map();let id=0,session;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const send=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}))});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
const pages=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');
session=(await send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true},null)).sessionId;
await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
await evaluate(`(()=>{const p=__architecture;p.controls.enableDamping=false;return true})()`);
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1290,height:720,scale:.5}});await fs.writeFile(new URL(name,results),Buffer.from(r.data,'base64'))}
const snapshot=()=>evaluate(`(()=>{const p=__architecture,g=p.renderer.getContext(),rows=[];p.model.traverse(m=>{if(!m.isMesh)return;for(const mat of [m.material].flat()){if(!mat.name.startsWith('Chassis_Body'))continue;const pr=p.renderer.properties.get(mat).currentProgram;if(!pr)return;const uniforms={};for(const name of ['directionalLights[0].direction','directionalLights[1].direction','cameraPosition','viewMatrix','projectionMatrix','envMapIntensity','directionalShadowMatrix[0]','receiveShadow','roughness','metalness','diffuse']){const loc=g.getUniformLocation(pr.program,name);if(loc!==null){const value=g.getUniform(pr.program,loc);uniforms[name]=ArrayBuffer.isView(value)?Array.from(value):value}}rows.push({mesh:m.name,side:mat.side,defines:mat.defines,program:pr.id,uniforms})}});return {camera:p.api.state().camera,quaternion:p.camera.quaternion.toArray(),rows}})()`);
const beforeSnapshot=await snapshot();
await shot('before-depth-transition.png');
const transition=await evaluate(`(async()=>{const p=__architecture,T=await import('three'),position=p.camera.position.clone(),up=p.camera.up.clone(),target=p.controls.target.clone();p.camera.position.copy(target).add(new T.Vector3(.035,0,0));p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,250));const inside=p.depthGuard.state.active;p.camera.position.copy(position);p.camera.up.copy(up);p.controls.target.copy(target);p.camera.lookAt(target);p.controls.update();p.controls.dispatchEvent({type:'change'});await new Promise(r=>setTimeout(r,250));return {inside,restored:p.depthGuard.state.active}})()`);
await shot('after-depth-transition.png');
await fs.writeFile(new URL('uniform-restoration.json',results),JSON.stringify({before:beforeSnapshot,after:await snapshot()},null,2)+'\n');
await fs.writeFile(new URL('depth-transition-restoration.json',results),JSON.stringify(transition,null,2)+'\n');
if(transition.inside!=='logarithmic-fallback'||transition.restored!=='bounded')throw Error('Depth transition failed');
await send('Emulation.clearDeviceMetricsOverride');
await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Page.navigate',{url:'http://127.0.0.1:8770/site/knight-eps-phase12/viewer/'});
for(let n=0;n<360;n++){if(await evaluate('!!window.knightEPSTwin'))break;await new Promise(r=>setTimeout(r,250))}
await evaluate('knightEPSTwin.ready');
const preview=await evaluate(`({url:location.href,version:knightEPSTwin.version,quality:knightEPSTwin.state().quality,parts:knightEPSTwin.state().parts.length,rendering:knightEPSTwin.performance().rendering,hasTestInstrumentation:typeof window.__architecture!=='undefined',hasTestClock:typeof window.__renderClock!=='undefined'})`);
await fs.writeFile(new URL('normal-site-preview.json',results),JSON.stringify(preview,null,2)+'\n');
if(preview.hasTestInstrumentation||preview.hasTestClock||preview.parts!==95||preview.quality!=='studio')throw Error('Normal site preview failed');
console.log(JSON.stringify({transition,preview}));socket.close();
