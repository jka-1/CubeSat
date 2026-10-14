// Debug mode (v5 packet, presence, debug commands, synchronous wait) against the real bridge process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bridgeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'debug-test-token';
const V4 = '4353000403B30A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507000309C4060E1388';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors main/debug_mode.c: 20 v4 words (version 0x0005) + 16 debug words.
function buildV5(seq, { present = 7, probed = 7, status = null, errors = [0, 0, 0], period = 1000, rssi = -55, rtt = 12, cycle = 37 } = {}) {
  const w = [];
  for (let i = 0; i < V4.length; i += 4) w.push(parseInt(V4.slice(i, i + 4), 16));
  w[1] = 5; w[2] = seq;
  if (!(present & 1)) [4, 5, 6, 7, 8].forEach((i) => { w[i] = 0; });
  if (!(present & 2)) [9, 10, 11, 12].forEach((i) => { w[i] = 0; });
  if (!(present & 4)) [13, 14].forEach((i) => { w[i] = 0; });
  const st = status || [0, 1, 2].map((i) => ((present >> i) & 1 ? 0 : 1));
  w.push(rssi & 0xffff, 0, 5000, 1, 2, 3, 3, present | (probed << 8), period, 5000, ...errors,
    st[0] | (st[1] << 4) | (st[2] << 8), cycle, rtt);
  return w.map((v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0')).join('');
}

async function freePort(kind) {
  if (kind === 'udp') { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1'); await once(s, 'listening'); const { port } = s.address(); s.close(); return port; }
  const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const { port } = s.address(); s.close(); await once(s, 'close'); return port;
}

async function startBridge(context) {
  const http = await freePort('tcp'); const udp = await freePort('udp');
  const bridge = spawn(process.execPath, [path.join(bridgeDirectory, 'server.js')], {
    cwd: bridgeDirectory,
    env: { ...process.env, HTTP_PORT: String(http), UDP_PORT: String(udp), HTTP_BIND_ADDRESS: '127.0.0.1', UDP_BIND_ADDRESS: '127.0.0.1',
      COMMAND_TOKEN: token, COMMAND_TIMEOUT_MS: '300', TELEMETRY_STALE_MS: '3000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = ''; bridge.stdout.on('data', (c) => { out += c; }); bridge.stderr.on('data', (c) => { out += c; });
  context.after(async () => { if (bridge.exitCode === null) { bridge.kill('SIGTERM'); await once(bridge, 'exit'); } });
  const base = `http://127.0.0.1:${http}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await delay(25); }
  const device = dgram.createSocket('udp4'); device.bind(0, '127.0.0.1'); await once(device, 'listening');
  context.after(() => device.close());
  const inbox = []; device.on('message', (m) => inbox.push(JSON.parse(m.toString())));
  const send = (text) => new Promise((res, rej) => device.send(Buffer.from(text), udp, '127.0.0.1', (e) => (e ? rej(e) : res())));
  const nextCommand = async () => { for (let i = 0; i < 80; i++) { const k = inbox.findIndex((m) => m.type !== 'ack'); if (k >= 0) return inbox.splice(k, 1)[0]; await delay(25); } throw new Error('no command'); };
  const health = async () => (await fetch(`${base}/health`)).json();
  const post = (body, wait = false) => fetch(`${base}/command${wait ? '?wait=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Command-Token': token }, body: JSON.stringify(body) });
  return { base, send, nextCommand, health, post, out: () => out };
}

async function waitHealth(b, pred) { for (let i = 0; i < 80; i++) { const h = await b.health(); if (pred(h)) return h; await delay(25); } throw new Error('health condition not met'); }

test('v5 debug packet decodes presence for all, subset, single and none', async (t) => {
  const b = await startBridge(t);
  const cases = [
    { present: 7, expect: { pv: 'present', bms: 'present', mppt: 'present' } },
    { present: 5, expect: { pv: 'present', bms: 'absent', mppt: 'present' } },
    { present: 1, expect: { pv: 'present', bms: 'absent', mppt: 'absent' } },
    { present: 0, expect: { pv: 'absent', bms: 'absent', mppt: 'absent' } }
  ];
  let seq = 10;
  for (const c of cases) {
    await b.send(buildV5(++seq, { present: c.present, period: 750 }));
    const h = await waitHealth(b, (x) => x.debug_mode?.present_mask === c.present && x.telemetry_packet_format === 'hex-v5-debug');
    assert.equal(h.debug_mode.enabled, true);
    assert.equal(h.debug_mode.scan_period_ms, 750);
    assert.equal(h.debug_mode.i2c_cycle_ms, 3.7);
    assert.equal(h.debug_mode.link.rssi_dbm, -55);
    assert.equal(h.debug_mode.link.last_ack_rtt_ms, 12);
    for (const [k, v] of Object.entries(c.expect)) assert.equal(h.debug_mode.devices[k].state, v, `mask ${c.present} ${k}`);
    const latest = await (await fetch(`${b.base}/latest`)).json();
    const tel = latest.latest.packet.telemetry;
    assert.equal(tel.pv.available === false, !(c.present & 1));
    if (!(c.present & 1)) assert.equal(tel.pv.currentA, null);
    if (!(c.present & 2)) assert.deepEqual(tel.bms.cellVoltagesV, [null, null, null, null]);
    if (c.present & 2) assert.equal(tel.bms.cellVoltagesV[0], 3.813);
  }
});

test('probe timeout is reported as error, not absent; v4 after v5 still decodes', async (t) => {
  const b = await startBridge(t);
  await b.send(buildV5(20, { present: 6, status: [3, 0, 0], errors: [4, 0, 0] }));
  let h = await waitHealth(b, (x) => x.debug_mode?.devices?.pv);
  assert.equal(h.debug_mode.devices.pv.state, 'error');
  assert.equal(h.debug_mode.devices.pv.last_status, 'timeout');
  assert.equal(h.debug_mode.devices.pv.error_count, 4);
  await b.send(V4);
  h = await waitHealth(b, (x) => x.telemetry_packet_format === 'hex-v4-peripheral-sensors');
  assert.equal(h.debug_mode.enabled, false);
});

test('debug commands validate, route, and support ?wait=1', async (t) => {
  const b = await startBridge(t);
  await b.send(buildV5(30));
  await waitHealth(b, (x) => x.command_ready);
  for (const bad of [{ type: 'set_scan_period', period_ms: 100 }, { type: 'set_scan_period', period_ms: 6000 },
    { type: 'set_scan_period', period_ms: 'x' }, { type: 'i2c_probe', addr: '0x05' }, { type: 'debug_control' }]) {
    assert.equal((await b.post(bad)).status, 400, JSON.stringify(bad));
  }
  const unauth = await fetch(`${b.base}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"i2c_scan"}' });
  assert.equal(unauth.status, 401);

  const respond = async (extra) => { const cmd = await b.nextCommand(); await b.send(JSON.stringify({ version: 1, type: 'debug_result', command_type: cmd.type, request_id: cmd.request_id, ok: true, status: 'ok', ...extra(cmd) })); return cmd; };

  let pending = b.post({ type: 'debug_control', enabled: false }, true);
  let cmd = await respond((c) => ({ enabled: c.enabled, debug_enabled: c.enabled }));
  assert.equal(cmd.enabled, false);
  let r = await (await pending).json();
  assert.equal(r.status, 'completed'); assert.equal(r.result.enabled, false);

  pending = b.post({ type: 'set_scan_period', period_ms: 250 }, true);
  cmd = await respond((c) => ({ requested_period_ms: c.period_ms, period_ms: c.period_ms }));
  r = await (await pending).json();
  assert.equal(r.result.period_ms, 250);

  pending = b.post({ type: 'i2c_scan' }, true);
  await respond(() => ({ addresses: ['0x08', '0x40'], count: 2, scan_us: 20000 }));
  r = await (await pending).json();
  assert.deepEqual(r.result.addresses, ['0x08', '0x40']); assert.equal(r.result.count, 2);

  pending = b.post({ type: 'i2c_probe', addr: '0x6B' }, true);
  cmd = await respond((c) => ({ addr: c.addr, present: false, probe_result: 'ESP_ERR_NOT_FOUND' }));
  assert.equal(cmd.addr, '0x6B');
  r = await (await pending).json();
  assert.equal(r.result.present, false);

  pending = b.post({ type: 'i2c_read', addr: '0x08', reg: '0x14', len: 2 }, true);
  const c2 = await b.nextCommand();
  await b.send(JSON.stringify({ version: 1, type: 'debug_result', command_type: 'i2c_read', request_id: c2.request_id, ok: false, status: 'error', error: 'ESP_FAIL' }));
  r = await (await pending).json();
  assert.equal(r.status, 'failed'); assert.equal(r.result.error, 'ESP_FAIL');

  // No device answer: synchronous call returns timed_out after the command timeout.
  pending = b.post({ type: 'i2c_scan' }, true);
  await b.nextCommand();
  r = await (await pending).json();
  assert.equal(r.status, 'timed_out');
});
