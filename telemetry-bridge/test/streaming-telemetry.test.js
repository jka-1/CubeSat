// Shared Streaming Telemetry model (site/assets/js/streaming-telemetry.mjs): present-only filtering for v4 and v5,
// conversions, stale handling, replay dedupe and persistence. Fixture envelopes were captured from the real bridge.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { StreamingModel, deviceVisibility, decodeDevices, isStreamingMode, setStreamingMode, STREAM_MODE_KEY }
  from '../../site/assets/js/streaming-telemetry.mjs';

const fx = JSON.parse(await readFile(new URL('./fixtures/streaming-envelopes.json', import.meta.url)));
const T0 = Date.parse(fx.v5_all.received_at);
const at = (env, ms) => ({ ...env, received_at: new Date(ms).toISOString() });
const status = (ms, extra = {}) => ({ type: 'status', server_time: new Date(ms).toISOString(), telemetry_stale_after_ms: 5000, telemetry_connected: true, ...extra });
const keys = (snap) => snap.devices.map((d) => d.key);

const CASES = [
  ['all', ['pv', 'bms', 'mppt']], ['subset_pv_mppt', ['pv', 'mppt']], ['single_bms', ['bms']], ['none', []]
];

for (const fmt of ['v4', 'v5']) {
  for (const [name, expected] of CASES) {
    test(`${fmt} ${name}: only present devices are shown`, () => {
      const m = new StreamingModel();
      m.ingest(status(T0), T0);
      assert.equal(m.ingest(at(fx[`${fmt}_${name}`], T0), T0), true);
      const s = m.snapshot(T0 + 100);
      assert.deepEqual(keys(s), expected);
      assert.deepEqual(s.hidden.map((d) => d.key).sort(), ['bms', 'mppt', 'pv'].filter((k) => !expected.includes(k)).sort());
      for (const h of s.hidden) assert.equal(h.state, fmt === 'v5' ? 'absent' : 'not_polled');
      assert.equal(s.devices.every((d) => d.source === (fmt === 'v5' ? 'v5' : 'polling-mask')), true);
      assert.equal(s.stale, false);
      assert.equal(Object.hasOwn(s, 'mcu'), false);
      assert.equal(s.peripheral.relativeLightLevel, 0.5);
      // absent devices never feed sparkline series
      for (const k of ['pv', 'bms', 'mppt']) {
        const pt = m.series[k === 'pv' ? 'pv.currentA' : k === 'bms' ? 'bms.cell0' : 'mppt.faults'].at(-1);
        assert.equal(pt[1] === null, !expected.includes(k), `${k} series`);
      }
    });
  }
}

test('conversions: INA226 bus V from raw, BMS min/max/delta, MPPT ACDRV and fault bits', () => {
  const d = decodeDevices(fx.v5_all.packet);
  assert.equal(d.pv.busV, 4003 * 0.00125);
  assert.equal(d.pv.currentA, fx.v5_all.packet.telemetry.pv.currentA);
  assert.deepEqual(d.bms.cells.map((c) => c.label), ['Cell 1', 'Cell 2', 'Cell 3', 'Cell 4']);
  assert.equal(d.bms.minV, 3.676); assert.equal(d.bms.maxV, 3.813); assert.equal(d.bms.deltaMv, 137);
  assert.equal(d.bms.packV, null);
  assert.equal(d.mppt.acdrv, 'acdrv1'); assert.equal(d.mppt.reg13, 0x61);
  assert.equal(d.mppt.faults.length, 8); assert.equal(d.mppt.activeFaults, 0);
  const faulty = structuredClone(fx.v4_all.packet); faulty.raw.mppt.fault20 = 0b10000101;
  const f = decodeDevices(faulty).mppt.faults.filter((x) => x.active).map((x) => x.name);
  assert.deepEqual(f, ['VAC1_OVP_STAT', 'CONV_OCP_STAT', 'BAT_REG_STAT']);
});

test('v5 probe timeout hides the device as error; legacy packets without a mask assume present', () => {
  const v = deviceVisibility(fx.v5_pv_timeout.packet);
  assert.deepEqual([v.pv.state, v.pv.visible, v.bms.visible, v.mppt.visible], ['error', false, true, true]);
  const legacy = { packet_format: 'hex-v2-engineering', telemetry: { pv: {}, bms: { cellVoltagesV: [4, 4, 4, 4] }, mppt: { switchState: 'on', faults: [] } } };
  const lv = deviceVisibility(legacy);
  assert.deepEqual(Object.values(lv).map((x) => [x.state, x.source]), [['present', 'assumed'], ['present', 'assumed'], ['present', 'assumed']]);
});

test('stale handling, replay dedupe, clock skew and windowed series', () => {
  const m = new StreamingModel();
  const skew = 30_000; // client clock 30 s ahead of the bridge
  m.ingest(status(T0), T0 + skew);
  for (let i = 0; i < 10; i++) m.ingest({ ...at(fx.v5_all, T0 + i * 1000), packet: { ...fx.v5_all.packet, seq: 100 + i } }, T0 + skew + i * 1000);
  assert.equal(m.packets, 10);
  assert.equal(m.ingest({ ...at(fx.v5_all, T0 + 9000), packet: { ...fx.v5_all.packet, seq: 109 } }, T0 + skew + 9500), false, 'SSE replay ignored');
  assert.equal(m.ageMs(T0 + skew + 9500), 500);
  assert.equal(m.snapshot(T0 + skew + 9500).stale, false);
  const s = m.snapshot(T0 + skew + 9000 + 5001);
  assert.equal(s.stale, true); assert.ok(s.devices.every((d) => d.state === 'stale'));
  assert.equal(m.seriesWindow('pv.busV', 4000, T0 + skew + 9000).points.length, 5);
  assert.equal(m.seriesWindow('pv.busV', 60_000, T0 + skew + 9000).points.length, 10);
  // device disappears: next snapshot hides it, history keeps a gap (null)
  m.ingest({ ...at(fx.v5_subset_pv_mppt, T0 + 10_000), packet: { ...fx.v5_subset_pv_mppt.packet, seq: 200 } }, T0 + skew + 10_000);
  assert.deepEqual(keys(m.snapshot(T0 + skew + 10_100)), ['pv', 'mppt']);
  assert.equal(m.series['bms.cell0'].at(-1)[1], null);
  assert.equal(m.ingest({ type: 'telemetry' }), false);
});

test('mode persists in storage', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(isStreamingMode(storage), false);
  setStreamingMode(true, storage); assert.equal(mem.get(STREAM_MODE_KEY), 'on'); assert.equal(isStreamingMode(storage), true);
  setStreamingMode(false, storage); assert.equal(isStreamingMode(storage), false);
});

test('view formatting: auto-scaled SI units for small PV currents/powers', async () => {
  const { fmtSI } = await import('../../site/assets/js/streaming-view.mjs');
  assert.equal(fmtSI(0.0000008, 'A'), '0.8 µA');
  assert.equal(fmtSI(0.0123, 'W'), '12.30 mW');
  assert.equal(fmtSI(1.5, 'A'), '1.500 A');
  assert.equal(fmtSI(null, 'A'), '--');
});

// ---------------------------------------------------------------- v6 Streaming Telemetry packet
for (const [name, expected] of CASES) {
  test(`v6 ${name}: present-only cards + new fields, absent -> null`, () => {
    const m = new StreamingModel();
    m.ingest(status(T0), T0);
    assert.equal(m.ingest(at(fx[`v6_${name}`], T0), T0), true);
    const s = m.snapshot(T0 + 100);
    assert.equal(s.format, 'hex-v6-streaming');
    assert.deepEqual(keys(s), expected);
    const d = decodeDevices(fx[`v6_${name}`].packet);
    if (expected.includes('pv')) {
      assert.equal(d.pv.busV, 5.00375);
      assert.ok(d.pv.currentMa !== null && d.pv.powerMw !== null);
    } else assert.equal(d.pv.busV, null);
    if (expected.includes('bms')) {
      assert.deepEqual(d.bms.cells.map((c) => c.label), ['Cell 1', 'Cell 2', 'Cell 3', 'Cell 4']);
      assert.equal(d.bms.packV, 14.98); assert.equal(d.bms.intTempC, 24.75);
    } else { assert.equal(d.bms.packV, null); assert.equal(d.bms.intTempC, null); }
    if (expected.includes('mppt')) {
      assert.deepEqual([d.mppt.vbusV, d.mppt.vac1V, d.mppt.vbatV, d.mppt.vsysV, d.mppt.ibusMa, d.mppt.dieTempC],
        [5.024, 5.04, 14.553, 12.806, 250, 19]);
      assert.equal(d.mppt.adcEnabled, true);
    } else {
      assert.deepEqual([d.mppt.vbusV, d.mppt.vac1V, d.mppt.vbatV, d.mppt.vsysV, d.mppt.ibusMa, d.mppt.dieTempC],
        [null, null, null, null, null, null]);
    }
    assert.equal(s.adc.temp.mv, 750); assert.equal(s.adc.temp.gpio, 1); assert.equal(s.adc.light.gpio, 2);
    assert.equal(s.adc.temp.tempC, 25); assert.equal(s.adc.light.mv, 1550);
  });
}

test('v5 packets: v6-only fields stay null and are flagged as not carried', () => {
  const d = decodeDevices(fx.v5_all.packet);
  assert.equal(d.bms.packV, null); assert.equal(d.bms.hasExt, false);
  assert.equal(d.mppt.vbusV, null); assert.equal(d.mppt.hasExt, false);
});

test('TEMT6000 light level bands and MCP9700 conversion', async () => {
  const { lightLevelFromMv, mcp9700TempCFromMv, LIGHT_BRIGHT_MIN_MV, LIGHT_VERY_BRIGHT_MIN_MV } = await import('../../site/assets/js/telemetry-model.mjs');
  assert.equal(LIGHT_BRIGHT_MIN_MV, 800); assert.equal(LIGHT_VERY_BRIGHT_MIN_MV, 1800);
  assert.deepEqual([0, 799, 800, 1517, 1800, 1801, 3300].map(lightLevelFromMv),
    ['Lightly Lit', 'Lightly Lit', 'Bright', 'Bright', 'Bright', 'Very Bright', 'Very Bright']);
  assert.equal(lightLevelFromMv(null), null);
  assert.equal(mcp9700TempCFromMv(750), 25); assert.equal(mcp9700TempCFromMv(500), 0);
  const d = decodeDevices(fx.v6_all.packet);
  assert.equal(d.adc.light.mv, 1550); assert.equal(d.adc.light.level, 'Bright');
  assert.equal(d.adc.temp.tempC, (750 - 500) / 10);
});
