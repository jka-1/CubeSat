// Regression: the I²C page rejected real v4 packets (mcu.temperatureC null) and v6 packets with an absent
// chip (BMS cells null), so live telemetry never updated. Fixtures: a live v4 envelope captured from the droplet
// (2026-10-19) and a v6 envelope from the bridge fed by synth_sender --v6 --present pv,mppt.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.window ??= {};
const { normalizePacket } = await import('../../site/assets/js/i2c.js');
const load = async (f) => JSON.parse(await readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

test('live v4 envelope with null MCU temperature is accepted', async () => {
  const env = await load('live-v4-envelope.json');
  assert.equal(env.packet.packet_format, 'hex-v4-peripheral-sensors');
  assert.equal(env.packet.telemetry.mcu.temperatureC, null);
  const out = normalizePacket(env);
  assert.ok(out, 'packet rejected');
  assert.equal(out.telemetry.mcu.temperatureC, null);
  assert.equal(out.telemetry.pv.currentA, env.packet.telemetry.pv.currentA);
  assert.deepEqual(out.telemetry.bms.cellVoltagesV, env.packet.telemetry.bms.cellVoltagesV);
  assert.equal(out.telemetry.peripheral.lightVoltageMv, env.packet.telemetry.peripheral.lightVoltageMv);
});

test('v6 envelope with an absent BMS is accepted with null cells', async () => {
  const env = await load('v6-bms-absent-envelope.json');
  assert.equal(env.packet.packet_format, 'hex-v6-streaming');
  const out = normalizePacket(env);
  assert.ok(out, 'packet rejected');
  assert.deepEqual(out.telemetry.bms.cellVoltagesV, [null, null, null, null]);
  assert.equal(out.telemetry.pv.currentA, 0.05);
});

test('non-telemetry objects are still rejected', () => {
  assert.equal(normalizePacket({ type: 'status', telemetry_connected: true }), null);
  assert.equal(normalizePacket({ packet: { telemetry: { foo: 1 } } }), null);
});
