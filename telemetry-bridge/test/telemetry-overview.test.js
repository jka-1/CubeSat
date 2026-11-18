import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TelemetryOverviewModel,flattenFields} from '../../site/assets/js/telemetry-overview-model.mjs';
const fixtures=JSON.parse(await readFile(new URL('./fixtures/streaming-envelopes.json',import.meta.url)));
const meta={deviceId:'fixture',sequence:1};
test('overview waiting state does not synthesize data or a successful fault count',()=>{
  const model=new TelemetryOverviewModel();
  model.ingest({pv:{powerW:null},bms:{cellVoltagesV:[null,null,null,null]},mppt:{faults:[]}},meta,'live',null,1000);
  assert.equal(model.stream.packets,0);assert.equal(model.value('pv.powerW'),null);assert.equal(model.value('mppt.faults'),null);
});
test('overview retains small real measurements, ADC readings and extra numeric fields',()=>{
  const model=new TelemetryOverviewModel(),event=structuredClone(fixtures.v6_all);
  event.received_at=new Date(10000).toISOString();event.packet.telemetry.mcu={temperatureC:26};
  model.ingest(event.packet.telemetry,meta,'live',event,10000);
  assert.equal(model.value('pv.powerW'),event.packet.telemetry.pv.powerW);
  assert.equal(model.value('per.lightMv'),event.packet.telemetry.peripheral.lightVoltageMv);
  assert.equal(model.value('extra:mcu.temperatureC'),26);
  assert.ok(model.metrics.some(m=>m.key==='extra:mcu.temperatureC'));
  assert.equal(model.raw.packet.raw.mppt.reg13,event.packet.raw.mppt.reg13);
  model.ingest(event.packet.telemetry,meta,'live',event,11000);
  assert.equal(model.stream.packets,1,'SSE replay does not create another sample');
});
test('overview device presence gates stale numbers while retaining raw evidence',()=>{
  const model=new TelemetryOverviewModel(),event=structuredClone(fixtures.v6_all);
  event.received_at=new Date(10000).toISOString();event.packet.debug.devices.pv.state='error';
  model.ingest(event.packet.telemetry,meta,'live',event,10000);
  assert.equal(model.value('pv.powerW'),null);assert.equal(model.series('pv.powerW',60000,10000).points[0][1],null);
  assert.equal(model.raw.packet.telemetry.pv.powerW,event.packet.telemetry.pv.powerW);
});
test('mock and live histories cannot be mixed and zero is a valid measurement',()=>{
  const model=new TelemetryOverviewModel(),telemetry={pv:{powerW:0,currentA:0},bms:{cellVoltagesV:[4,4,4,4]},mppt:{switchState:'on',faults:[]}};
  model.ingest(telemetry,meta,'mock',null,1000);assert.equal(model.value('pv.powerW'),0);
  model.ingest({...telemetry,pv:{powerW:99}},meta,'mock',null,2000);assert.equal(model.stream.packets,2);
  const live=structuredClone(fixtures.v6_all);live.received_at=new Date(3000).toISOString();
  model.ingest(live.packet.telemetry,meta,'live',live,3000);
  assert.equal(model.stream.packets,1);assert.equal(model.series('pv.powerW',60000,3000).points.length,1);
  assert.notEqual(model.value('pv.powerW'),99);
  assert.equal(model.value('bms.packV'),live.packet.telemetry.bms.packVoltageV);
});
test('flattened packet evidence preserves zeros, booleans, nulls and empty arrays',()=>{
  assert.deepEqual(flattenFields({value:0,flag:false,missing:null,empty:[],nested:{text:'<script>'}}),[['value',0],['flag',false],['missing',null],['empty','[]'],['nested.text','<script>']]);
});

test('a reported charger without fault evidence leaves a gap in the fault trend', () => {
  const model = new TelemetryOverviewModel();
  model.ingest({mppt:{vbusV:5}}, meta, 'live', null, 1000);
  assert.equal(model.value('mppt.faults'), null);
  model.ingest({mppt:{vbusV:5, faults:[]}}, meta, 'live', null, 2000);
  assert.deepEqual(model.series('mppt.faults',60000,2000).points, [[1000,null],[2000,0]]);
});
