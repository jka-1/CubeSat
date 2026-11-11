// Restore the ordinary standalone viewer and verify its explicit mock demonstration.
import fs from 'node:fs/promises';
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json()),socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map();let id=0,session;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const send=(method,params={},s=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(s?{sessionId:s}:{})}))});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
try{
 const pages=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');for(const p of pages.filter(p=>p.url.startsWith('http://127.0.0.1:8770/site/?syncRegression=1')))await send('Target.closeTarget',{targetId:p.targetId},null);const page=pages.find(p=>!p.url.includes('syncRegression=1'));session=(await send('Target.attachToTarget',{targetId:page.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Fetch.disable');await send('Emulation.clearDeviceMetricsOverride');await send('Network.setCacheDisabled',{cacheDisabled:false});await send('Page.navigate',{url:'http://127.0.0.1:8770/site/knight-eps-phase12/viewer/'});await send('Page.bringToFront');
 for(let n=0;n<120;n++){if(await evaluate('!!window.knightEPSTwin'))break;await new Promise(r=>setTimeout(r,250))}await evaluate('knightEPSTwin.ready.then(()=>knightEPSTwin.readyForImage)');
 const mock=await evaluate(`(()=>{knightEPSTwin.startMockTelemetry();const s=knightEPSTwin.state().display;const result={source:s.source,six:['battery_voltage_v','pv_current_a','temperature_c','light_level','esp32_temperature_c','mppt_switch_temperature_c'].every(key=>Number.isFinite(s.readings[key])),lightInRange:s.readings.light_level>=0&&s.readings.light_level<=1,label:document.querySelector('#screen-preview canvas').getAttribute('aria-label')};knightEPSTwin.stopMockTelemetry();return result})()`);
 if(mock.source!=='mock'||!mock.six||!mock.lightInRange||!mock.label.includes('MOCK'))throw Error('Mock display regression');
 const publicApi=await evaluate(`(()=>{knightEPSTwin.updateTelemetry({battery_voltage_v:14.9},{source:'live'});const s=knightEPSTwin.state().display;knightEPSTwin.resetTelemetry();return s.source==='live'&&s.readings.battery_voltage_v===14.9})()`);if(!publicApi)throw Error('Standalone public API regression');
 const normal=await evaluate(`({url:location.href,loaded:knightEPSTwin.state().loaded,parts:knightEPSTwin.state().parts.length,source:knightEPSTwin.state().display.source,quality:knightEPSTwin.state().quality,instrumented:typeof __architecture!=='undefined',testTransport:typeof __streams!=='undefined'})`);
 if(normal.parts!==95||normal.instrumented||normal.testTransport||normal.source!=='none')throw Error('Normal preview not restored');
 await fs.writeFile(new URL('normal-preview.json',import.meta.url),JSON.stringify({mock,publicApi,normal},null,2)+'\n');console.log(JSON.stringify({mock,publicApi,normal}));
}finally{socket.close()}
