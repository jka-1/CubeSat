// Local-only CDP regression check. Requires the preview on 8766 and an isolated Chrome profile on 9238.
import fs from 'node:fs/promises';
const version=await fetch('http://127.0.0.1:9238/json/version').then(r=>r.json());
const ws=new WebSocket(version.webSocketDebuggerUrl),pending=new Map();let sequence=0,session;
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}))});
const targets=(await send('Target.getTargets')).targetInfos.filter(t=>t.type==='page');
session=(await send('Target.attachToTarget',{targetId:targets[0].targetId,flatten:true})).sessionId;
await send('Runtime.enable');await send('Page.enable');
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(250)}throw Error('Timed out: '+expression)}
for(let i=0;i<90;i++){if(await evaluate('!!window.knightEPSTwin'))break;await pause(500)}
await evaluate('knightEPSTwin.ready');
await until(`performance.getEntriesByType('resource').some(x=>x.name.endsWith('/appearance.glb'))`);
const out={checks:[],errors:[]};
async function check(name,expression){const result=await evaluate(expression);out.checks.push({name,result});if(!result)throw Error(name)}
async function capture(name){const url=await evaluate('knightEPSTwin.capture()');await fs.writeFile(new URL(name+'.png',import.meta.url),Buffer.from(url.split(',')[1],'base64'))}
try{
 await check('all 95 components and bound LCD retained',`knightEPSTwin.state().parts.length===95&&knightEPSTwin.state().display.display==='bound'`);
 await capture('desktop-model');
 const ids=['MCU_Final','INA226','Regulator_01','Regulator_02','BMS_BQ76942','Charger_BMS034A_EVM','LightSensor','TemperatureSensor','SolarPanel_01','SolarPanel_02','BatteryPack_4x18650','NerdMiner_Heltec_V2'];
 for(const id of ids){
  await evaluate(`(()=>{knightEPSTwin.reset();knightEPSTwin.select('${id}');document.querySelector('#isolate-selected').click();knightEPSTwin.focus()})()`);await pause(800);
  await check(id+' focus, isolate and raycast',`knightEPSTwin.state().selected==='${id}'&&!!knightEPSTwin.selectionProbe()`);
 }
 await evaluate('knightEPSTwin.reset()');await pause(1000);
 await evaluate("document.querySelector('#top-toggle').click()");await until('knightEPSTwin.state().coverProgress>.999');
 await check('lid opens',`knightEPSTwin.state().coverProgress>.999`);await capture('lid-open');
 await evaluate("document.querySelector('#explode-toggle').click()");await until('knightEPSTwin.state().coverLiftProgress>.999');
 await check('exploded assembly',`knightEPSTwin.state().exploded&&knightEPSTwin.state().coverLiftProgress>.999`);
 await capture('exploded');
 for(const view of ['top','bottom','front','rear','side','iso']){
  await evaluate(`knightEPSTwin.view('${view}')`);await pause(700);
  await check(view+' framing',`(()=>{const b=knightEPSTwin.projectedBounds();return b.min.every(x=>x>-.999)&&b.max.every(x=>x<.999)})()`);
 }
 await evaluate('knightEPSTwin.reset()');await pause(1000);
 await evaluate(`knightEPSTwin.updateTelemetry({battery_voltage_v:15.42,pv_current_a:0,temperature_c:26.5,light_level:.73},{source:'live'})`);
 await check('live LCD accepts existing telemetry API, including zero',`knightEPSTwin.state().display.readings.battery_voltage_v===15.42&&knightEPSTwin.state().display.readings.pv_current_a===0`);
 await evaluate('knightEPSTwin.startMockTelemetry()');
 await check('mock data provenance',`knightEPSTwin.state().display.source==='mock'`);
 await evaluate('knightEPSTwin.stopMockTelemetry();knightEPSTwin.resetTelemetry();knightEPSTwin.setQuality("performance")');await pause(300);
 await check('performance quality',`knightEPSTwin.state().quality==='performance'`);
 await evaluate('knightEPSTwin.setQuality("studio")');await pause(300);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await pause(500);
 await check('mobile width and collapsed controls',`document.documentElement.scrollWidth<=innerWidth&&document.body.classList.contains('panel-hidden')`);
 await capture('mobile-model');
 await evaluate('document.querySelector("#sidebar-toggle").click()');await pause(200);
 await check('mobile panel opens',`!document.querySelector('#viewer-sidebar').inert`);
 await evaluate('document.querySelector("#sidebar-toggle").click()');
 out.performance=await evaluate('knightEPSTwin.performance()');out.complete=true;
}catch(e){out.error=e.stack;process.exitCode=1}
await fs.writeFile(new URL('browser-checks.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({complete:out.complete,checks:out.checks,error:out.error}));
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});await evaluate('knightEPSTwin.reset()');ws.close();
