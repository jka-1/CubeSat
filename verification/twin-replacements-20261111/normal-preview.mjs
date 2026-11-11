// Restore the ordinary viewer in the dedicated local test profile; no instrumentation.
import fs from 'node:fs/promises';
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map();let id=0,session;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const send=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}))});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
try{
 const pages=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');
 session=(await send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Fetch.disable');
 await send('Network.setCacheDisabled',{cacheDisabled:false});await send('Emulation.clearDeviceMetricsOverride');
 await send('Page.navigate',{url:'http://127.0.0.1:8770/site/knight-eps-phase12/viewer/'});await send('Page.bringToFront');
 for(let n=0;n<120;n++){if(await evaluate('!!window.knightEPSTwin'))break;await new Promise(r=>setTimeout(r,250))}
 await evaluate('knightEPSTwin.ready.then(()=>knightEPSTwin.readyForImage)');
 const result=await evaluate(`({url:location.href,quality:knightEPSTwin.state().quality,parts:knightEPSTwin.state().parts.length,selected:knightEPSTwin.state().selected,modelResponseBytes:knightEPSTwin.performance().loading.modelResponseBytes,hasInstrumentation:typeof window.__architecture!=='undefined',hasTestClock:typeof window.__renderClock!=='undefined',normalDecompression:typeof DecompressionStream==='function'})`);
 if(result.hasInstrumentation||result.hasTestClock||result.parts!==95||result.quality!=='studio'||!result.normalDecompression)throw Error('Normal preview failed');
 await fs.writeFile(new URL('normal-preview.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{socket.close()}
