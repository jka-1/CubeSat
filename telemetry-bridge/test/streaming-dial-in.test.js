// t57u: card toggles, no notes on live cards, no simulated data while live, I²C wording.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(path.join(root, p), 'utf8');
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('streaming card toggles default on and persist per IC / ADC device', async () => {
  globalThis.window ??= {};
  const v = await import('../../site/assets/js/streaming-view.mjs');
  assert.deepEqual(v.CARD_TOGGLES.map((t) => t.key), ['pv', 'bms', 'mppt', 'mcu', 'mcp9700', 'temt6000']);
  const s = memStore();
  assert.ok(Object.values(v.getCardToggles(s)).every(Boolean));
  v.setCardToggle('temt6000', false, s);
  v.setCardToggle('bms', false, s);
  const t = v.getCardToggles(s);
  assert.equal(t.temt6000, false); assert.equal(t.bms, false); assert.equal(t.mcp9700, true); assert.equal(t.pv, true);
});

test('live cards carry register addresses and no explanatory notes', async () => {
  const src = await read('site/assets/js/streaming-view.mjs');
  for (const reg of ['0x02', '0x03', '0x04', '0x14', '0x16', '0x18', '0x1A', '0x36', '0x68', '0x13', '0x20', '0x31', '0x35', '0x37', '0x3B', '0x3D', '0x41', 'GPIO1', 'GPIO2']) {
    assert.ok(src.includes(reg), reg);
  }
  assert.doesNotMatch(src, /need v6 firmware|st-note|ADC off|not in packet/);
});

test('I²C page never starts simulated data when the bridge reports live', async () => {
  const src = await read('site/assets/js/i2c.js');
  assert.match(src, /health\.live_mode === true \|\| health\.telemetry_connected === true/);
  assert.match(src, /if \(live\) connectTelemetryStream\(\);\s*else startMockData\(\);/);
  assert.match(src, /state = blankTelemetry\(\);/);
});

test('user-visible text uses I²C', async () => {
  for (const f of ['site/index.html', 'site/modules/home.html', 'site/modules/communication.html', 'site/modules/debug-mode.html']) {
    const html = await read(f);
    assert.doesNotMatch(html.replace(/value="i2c_\w+"/g, ''), /(?<![\w/.-])I2C(?!\w)/, f);
  }
  assert.match(await read('site/index.html'), /I²C Telemetry/);
});
