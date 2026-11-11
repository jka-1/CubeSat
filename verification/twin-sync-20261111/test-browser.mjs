// Dedicated local Chrome profile only. Synthetic viewer auth and SSE; no hardware.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const legacy=process.argv.includes('--expect-legacy');
const blocked=process.argv.includes('--expect-blocked');
const here=new URL('./',import.meta.url);
const oldAdapter=execFileSync('git',['show','6cde17de:site/assets/js/twin.js'],{encoding:'utf8'});
const originalViewer=legacy?execFileSync('git',['show','c5113f5c:site/knight-eps-phase12/viewer/main.mjs'],{encoding:'utf8'}):null;
const fixture=JSON.parse(await fs.readFile(new URL('../../telemetry-bridge/test/fixtures/streaming-envelopes.json',import.meta.url),'utf8')).v6_all;
const {webSocketDebuggerUrl}=await fetch('http://127.0.0.1:9227/json/version').then(r=>r.json());
const socket=new WebSocket(webSocketDebuggerUrl),pending=new Map(),errors=[];let id=0,session,oldLoads=0,injected,target;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
const send=(method,params={},s=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params,...(s?{sessionId:s}:{})}))});
socket.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}
 else if(m.method==='Fetch.requestPaused'){
  const auth=m.params.request.url.includes('/telemetry/auth/me');
  const adapter=m.params.request.url.includes('/assets/js/twin.js');
  const oldViewer=legacy&&m.params.request.url.includes('/viewer/main.mjs');
  if(auth||oldViewer||adapter&&(oldLoads++===0||blocked))await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:auth?'application/json':'text/javascript'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(auth?JSON.stringify({enabled:true,user:{username:'LOCAL SYNTHETIC CHECK',role:'viewer'}}):oldViewer?originalViewer:oldAdapter).toString('base64')});
  else await send('Fetch.continueRequest',{requestId:m.params.requestId});
 }
 else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
};
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(expression){for(let n=0;n<250;n++){try{if(await evaluate(expression))return}catch(error){if(!/context|Cannot find/.test(error.message))throw error}await pause(100)}throw Error('Timed out: '+expression)}
const output={synthetic:true,checks:[]};
async function check(name,expression){const passed=await evaluate(expression);output.checks.push({name,passed:!!passed});if(!passed)throw Error(name)}
const viewer="document.querySelector('#knight-eps-twin').contentWindow";
async function ready(){await wait(`!!document.querySelector('#knight-eps-twin')?.contentWindow?.knightEPSTwin`);await evaluate(`${viewer}.knightEPSTwin.ready`);await wait('window.__streams.length===1')}
async function sample(){await evaluate(`(()=>{const f=${JSON.stringify(fixture)};f.received_at=new Date().toISOString();f.packet.telemetry.pv.currentA=.211;f.packet.telemetry.mcu.temperatureC=35.2;f.packet.telemetry.mppt.dieTempC=15;window.__streams[0].emit('message',{data:JSON.stringify(f)});return true})()`)}
try{
 target=(await send('Target.createTarget',{url:'about:blank'},null)).targetId;
 session=(await send('Target.attachToTarget',{targetId:target,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Fetch.enable',{patterns:[{urlPattern:'*telemetry/auth/me*'},{urlPattern:'*assets/js/twin.js*'},...(legacy?[{urlPattern:'*viewer/main.mjs*'}]:[])]});
 injected=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__streams=[];window.EventSource=class{constructor(url){this.url=url;this.listeners=new Map();this.closed=false;window.__streams.push(this);queueMicrotask(()=>this.emit('open',{}))}addEventListener(n,fn){this.listeners.set(n,fn)}emit(n,data){this.listeners.get(n)?.(data)}close(){this.closed=true}}`});
 await send('Page.navigate',{url:'http://127.0.0.1:8770/site/?syncRegression=1#twin'});await ready();await sample();
 if(legacy){
  await check('old adapter with the new LCD reproduces exactly the three populated screenshot fields',`(()=>{const r=${viewer}.knightEPSTwin.state().display.readings;return Object.keys(r).sort().join(',')==='battery_voltage_v,light_level,temperature_c'})()`);
 }else{
  await wait(`new URL(location.href).searchParams.get('twinTelemetry')==='20261111-sync'`);await ready();await sample();
  await check('legacy parent upgrades once and preserves the twin route',`location.hash==='#twin'&&new URL(location.href).searchParams.get('syncRegression')==='1'`);
  if(blocked)await check('persistently old adapter is blocked with a visible update message and no false live readings',`(()=>{const w=${viewer},s=w.knightEPSTwin.state().display;return s.source==='none'&&s.readings===null&&s.presentation.message==='Dashboard update required'&&w.document.querySelector('#screen-preview canvas').getAttribute('aria-label').includes('Dashboard update required')})()`);
  else await check('all six overview values and device Wi-Fi reach the replacement dashboard',`(()=>{const r=${viewer}.knightEPSTwin.state().display.readings;return r.battery_voltage_v===14.98&&r.pv_current_a===.211&&r.temperature_c===25&&r.light_level===.5&&r.esp32_temperature_c===35.2&&r.mppt_switch_temperature_c===15&&r.wifi_rssi_dbm===-55})()`);
  if(!blocked){const data=await evaluate(`${viewer}.document.querySelector('#screen-preview canvas').toDataURL('image/png')`);await fs.writeFile(new URL('lcd-recovered.png',here),Buffer.from(data.split(',')[1],'base64'))}
  await check('replacement uses one shared dashboard stream and none inside the iframe',`window.__streams.length===1&&${viewer}.__streams.length===0`);
  await pause(1000);await check('the updated bridge does not reload repeatedly',`location.search.includes('twinTelemetry=20261111-sync')`);
  if(oldLoads!==2)throw Error(`Expected two dashboard adapter loads, received ${oldLoads}`);
 }
 output.readings=await evaluate(`${viewer}.knightEPSTwin.state().display.readings`);
 if(errors.length)throw Error(errors.join('\n'));output.complete=true;
}catch(error){output.error=error.stack;process.exitCode=1}
finally{
 output.errors=errors;output.adapterLoads=oldLoads;
 await fs.writeFile(new URL(legacy?'legacy-results.json':blocked?'blocked-results.json':'browser-results.json',here),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
 if(injected)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier});
 await send('Fetch.disable');await send('Network.setCacheDisabled',{cacheDisabled:false});if(target)await send('Target.closeTarget',{targetId:target},null);socket.close();
}
