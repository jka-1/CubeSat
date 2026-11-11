// Actual dashboard, shared decoder and viewer; isolated fake auth/SSE in a temporary profile.
// No production server, hardware, credentials or persistent auth changes.
import fs from 'node:fs/promises';
const here=new URL('./',import.meta.url),fixture=JSON.parse(await fs.readFile(new URL('../../telemetry-bridge/test/fixtures/streaming-envelopes.json',import.meta.url),'utf8')).v6_all;
const version=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0,session;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
const send=(method,params={},s=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(s?{sessionId:s}:{})}))});
socket.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 else if(m.method==='Fetch.requestPaused')await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({enabled:true,user:{username:'LOCAL SYNTHETIC CHECK',role:'viewer'}})).toString('base64')});
 else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
};
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const viewer=`document.querySelector('#knight-eps-twin').contentWindow`;
const output={checks:[],synthetic:true};
async function check(name,expression){const passed=await evaluate(expression);output.checks.push({name,passed:!!passed});if(!passed)throw Error(name)}
async function wait(expression){for(let n=0;n<200;n++){if(await evaluate(expression))return;await pause(100)}throw Error('Timed out: '+expression)}
async function capture(name){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(new URL(name,here),Buffer.from(shot.data,'base64'))}
async function sample(seq,age=0,changes=''){
 await evaluate(`(()=>{const f=${JSON.stringify(fixture)};f.received_at=new Date(Date.now()-${age}).toISOString();f.packet.seq=${seq};${changes};window.__streams[0].emit('message',{data:JSON.stringify(f)});return true})()`);
}
try{
 const pages=(await send('Target.getTargets',{},null)).targetInfos.filter(t=>t.type==='page');const target=pages[0]?.targetId||(await send('Target.createTarget',{url:'about:blank'},null)).targetId;
 session=(await send('Target.attachToTarget',{targetId:target,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Fetch.enable',{patterns:[{urlPattern:'*telemetry/auth/me*'}]});
 const injected=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__streams=[];window.EventSource=class{constructor(url){this.url=url;this.listeners=new Map();this.closed=false;window.__streams.push(this);queueMicrotask(()=>this.emit('open',{}))}addEventListener(n,fn){this.listeners.set(n,fn)}emit(n,data){this.listeners.get(n)?.(data)}close(){this.closed=true}}`});
 await send('Page.navigate',{url:'http://127.0.0.1:8770/site/#twin'});
 await wait(`!!document.querySelector('#knight-eps-twin')?.contentWindow?.knightEPSTwin`);
 await evaluate(`${viewer}.knightEPSTwin.ready.then(()=>${viewer}.knightEPSTwin.readyForImage)`);await wait('window.__streams.length===1');
 await check('current dashboard needs no compatibility refresh',`!new URL(location.href).searchParams.has('twinTelemetry')`);
 await check('dashboard and embedded viewer share one stream',`window.__streams.length===1&&${viewer}.__streams.length===0`);
 await sample(1,0,`Object.assign(f.packet.telemetry.pv,{currentA:.426});Object.assign(f.packet.telemetry.mppt,{vbusV:.002,vac1V:2.823,vbatV:14.976,vsysV:14.990,ibusA:0,dieTempC:15});f.packet.telemetry.mcu.temperatureC=35.2;f.packet.telemetry.peripheral.temperatureC=25.6;f.packet.telemetry.peripheral.relativeLightLevel=.65;`);
 await check('all six screenshot MPPT values reach the live Twin snapshot',`(()=>{const s=${viewer}.knightEPSTwin.state().display.readings;return s.mppt_vbus_v===.002&&s.mppt_vac1_v===2.823&&s.mppt_vbat_v===14.976&&s.mppt_vsys_v===14.990&&s.mppt_ibus_a===0&&s.mppt_switch_temperature_c===15&&s.esp32_temperature_c===35.2&&s.pv_current_a===.426})()`);
 await evaluate(`${viewer}.knightEPSTwin.select('Charger_BMS034A_EVM')`);
 await check('selected MPPT shows all six actual fields with their correct units',`(()=>{const d=${viewer}.document,rows=d.querySelector('#selected-readings').innerText;return d.querySelectorAll('#selected-readings p').length===6&&rows.includes('0.002 V')&&rows.includes('2.823 V')&&rows.includes('14.976 V')&&rows.includes('14.990 V')&&rows.includes('0 mA')&&rows.includes('15.0 °C')})()`);
 await check('LCD exposes all six overview values and device RSSI',`(()=>{const text=${viewer}.document.querySelector('#screen-preview canvas').getAttribute('aria-label');return ['14.980 V','0.426 A','25.6 °C','0.65','35.2 °C','15.0 °C','Wi-Fi -55 dBm'].every(v=>text.includes(v))})()`);
 const data=await evaluate(`${viewer}.document.querySelector('#screen-preview canvas').toDataURL('image/png')`);await fs.writeFile(new URL('lcd-overview.png',here),Buffer.from(data.split(',')[1],'base64'));
 await evaluate(`(()=>{const d=${viewer}.document;d.querySelector('#screen-preview').closest('details').open=true;d.querySelector('#screen-preview').scrollIntoView({block:'center'})})()`);await pause(150);await capture('desktop.png');
 // A fresh complete snapshot replaces unavailable channels rather than retaining old numbers.
 await sample(2,0,`f.packet.debug.devices.bms.state='absent';f.packet.telemetry.bms.available=false;f.packet.debug.devices.mppt.state='paused';`);
 await check('new unavailable-device snapshot clears previous readings on both UI and LCD',`(()=>{const w=${viewer},s=w.knightEPSTwin.state().display.readings;return !('battery_voltage_v' in s)&&!('mppt_vbus_v' in s)&&!('mppt_switch_temperature_c' in s)&&w.document.querySelector('[data-reading="mppt_vbus_v"]').textContent==='—'&&w.document.querySelector('#screen-preview canvas').getAttribute('aria-label').includes('Battery pack: —')})()`);
 // Advance the source timeline: a four-second-old sample must still be newer
 // than sample 2, otherwise rejecting it is the correct behavior.
 await pause(4100);await sample(3,4000);
 await check('forwarding preserves four seconds of sample age',`${viewer}.knightEPSTwin.state().display.ageMs>=4000&&${viewer}.knightEPSTwin.state().display.ageMs<5000`);
 await wait(`${viewer}.document.querySelector('#telemetry-status').dataset.state==='stale'`);
 await check('the same sample becomes stale at the shared source threshold',`${viewer}.knightEPSTwin.state().display.health==='stale'`);
 // Refresh, then reject an otherwise recent but older envelope.
 await sample(4);await sample(5,1000,`f.packet.telemetry.mppt.vbusV=123;`);
 await check('older arrival cannot overwrite the freshest MPPT value',`${viewer}.knightEPSTwin.state().display.readings.mppt_vbus_v===5.024`);
 await check('transport reconnect alone does not rewrite sample time',`(()=>{const w=${viewer},before=w.knightEPSTwin.state().display.receivedAt;window.__streams[0].emit('error',{});window.__streams[0].emit('open',{});return w.knightEPSTwin.state().display.receivedAt===before})()`);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await pause(400);
 await evaluate(`(()=>{const w=${viewer};w.document.querySelector('#sidebar-toggle').click();const d=w.document;d.querySelector('#screen-preview').closest('details').open=true;d.querySelector('#screen-preview').scrollIntoView({block:'center'})})()`);await pause(300);
 await check('parent and viewer fit mobile width',`document.documentElement.scrollWidth<=innerWidth&&${viewer}.document.documentElement.scrollWidth<=${viewer}.innerWidth`);await capture('mobile.png');
 output.final=await evaluate(`${viewer}.knightEPSTwin.state().display`);if(errors.length)throw Error(errors.join('\n'));output.complete=true;
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier});
} catch(error){output.error=error.stack;process.exitCode=1}
finally{
 output.errors=errors;await fs.writeFile(new URL('current-browser-results.json',here),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({complete:output.complete,error:output.error,checks:output.checks,errors}));
 await send('Fetch.disable');socket.close();
}
