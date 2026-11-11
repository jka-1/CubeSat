import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../../site/knight-eps-phase12/viewer/vendor/three/build/three.module.js',import.meta.url).href:specifier,context)}});
const {createDisplay}=await import('../../site/knight-eps-phase12/viewer/display.mjs');
const {telemetryHealth,wifiIndicator,normalizeTelemetry}=await import('../../site/knight-eps-phase12/viewer/telemetry.mjs');
function displayFixture(t){
 const labels=[],attributes={},ctx={fillText:(...args)=>labels.push(args),fillRect(){},beginPath(){},arc(){},stroke(){},fill(){},moveTo(){},lineTo(){}};
 const canvas={getContext:()=>ctx,setAttribute:(k,v)=>attributes[k]=v};
 const previous={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 globalThis.document={hidden:false,createElement:()=>canvas};globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
 const display=createDisplay({});t.after(()=>{display.dispose();Object.assign(globalThis,previous)});return {display,labels,attributes};
}
test('LCD shows six real readings in two columns of three with accessible text',t=>{
 const {display,labels,attributes}=displayFixture(t);labels.length=0;
 display.update({battery_voltage_v:14.976,pv_current_a:.4,temperature_c:25,light_level:.5,esp32_temperature_c:26,mppt_switch_temperature_c:15,wifi_rssi_dbm:-55});
 const values=['14.976 V','0.400 A','25.0 °C','0.50','26.0 °C','15.0 °C'].map(value=>labels.find(x=>x[0]===value));assert.ok(values.every(Boolean));
 assert.deepEqual(values.map(v=>v.slice(1,3)),[[32,253],[32,351],[32,449],[400,253],[400,351],[400,449]]);
 assert.match(attributes['aria-label'],/Wi-Fi -55 dBm/);assert.match(attributes['aria-label'],/PV current/);assert.equal(display.canvas.width,768);assert.equal(display.canvas.height,582);
});
test('display preserves source age/expiry and rejects a late snapshot',t=>{
 const {display}=displayFixture(t),now=Date.now();display.update({mppt_vbus_v:2},{receivedAt:now-4000,staleMs:5000});const before=display.state();
 assert.equal(before.receivedAt,now-4000);assert.ok(before.ageMs>=4000&&before.ageMs<5000);
 display.update({mppt_vbus_v:1},{receivedAt:now-4500});assert.equal(display.state().readings.mppt_vbus_v,2);
 const health=telemetryHealth({last:before.readings,receivedAt:before.receivedAt,now:now+1000,staleMs:5000,source:'live',transport:'dashboard'});assert.equal(health.health,'stale');
});
test('new snapshots clear unavailable readings without preserving old numbers',t=>{
 const {display}=displayFixture(t);display.update({battery_voltage_v:15,mppt_vbus_v:5});display.update({temperature_c:25},{snapshot:true});
 assert.deepEqual(display.state().readings,{temperature_c:25});display.update({},{snapshot:true});assert.deepEqual(display.state().readings,{});assert.throws(()=>normalizeTelemetry({}),/no supported/);
});
test('Wi-Fi bars require fresh device RSSI and cannot imply measured signal from SSE alone',()=>{
 const state={source:'live',health:'fresh',transport:'connected',readings:{wifi_rssi_dbm:-55}};assert.equal(wifiIndicator(state).levels,3);
 for(const changed of [{health:'stale'},{transport:'disconnected'},{source:'mock'},{readings:{}}])assert.equal(wifiIndicator({...state,...changed}).active,false);
 assert.equal(wifiIndicator({...state,readings:{wifi_rssi_dbm:-80}}).levels,1);
});
test('custom LCD presentation survives status refresh and validates timing',t=>{
 const {display}=displayFixture(t);display.update({temperature_c:25});display.setScreenState('standby',{title:'BENCH CHECK',message:'READY'});display.setTransport('disconnected');display.refresh();
 assert.equal(display.state().presentation.title,'BENCH CHECK');assert.throws(()=>display.update({temperature_c:25},{receivedAt:NaN}),/receivedAt/);assert.throws(()=>display.update({temperature_c:25},{staleMs:0}),/staleMs/);
});
