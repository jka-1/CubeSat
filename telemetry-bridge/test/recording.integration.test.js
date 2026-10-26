import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import dgram from 'node:dgram';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder } from '../recording/client.mjs';
import { RunStore } from '../recording/store.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn) {
  for (let i = 0; i < 150; i++) { try { const v = await fn(); if (v) return v; } catch {} await delay(20); }
  throw new Error('Timed out waiting for bridge state');
}
async function freePort(udp = false) {
  const s = udp ? dgram.createSocket('udp4') : net.createServer();
  if (udp) s.bind(0, '127.0.0.1'); else s.listen(0, '127.0.0.1');
  await once(s, 'listening'); const port = s.address().port;
  const closed = once(s, 'close'); s.close(); await closed; return port;
}
function hex(seq, debug, reg) {
  const words = '4353000403B30A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507000309C4060E1388'
    .match(/.{4}/g).map((v) => parseInt(v, 16));
  words[1] = 6; words[2] = seq; words[13] = reg;
  words.push(0xffce, Math.floor(seq * 1000 / 65536), (seq * 1000) & 0xffff, 0, 0, 0, debug ? 3 : 2, 0x0707, 1000, 5000, 0, 0, 0, 0, 84, 100);
  words.push(0x3ff, 1508, 2981, 100, 5000, 5000, 14940, 14950, 35, 0x80, 736, 0x0201);
  return words.map((v) => v.toString(16).padStart(4, '0')).join('');
}

test('opt-in bridge recording authenticates history, persists UDP runs and exposes linked end markers', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'record-api-'));
  const file = join(dir, 'runs.sqlite');
  const http = await freePort(), udp = await freePort(true);
  const token = 'recording-integration-only';
  const base = `http://127.0.0.1:${http}`;
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { ...process.env, HTTP_PORT: String(http), UDP_PORT: String(udp),
      HTTP_BIND_ADDRESS: '127.0.0.1', UDP_BIND_ADDRESS: '127.0.0.1',
      RECORDING_DB_PATH: file, COMMAND_TOKEN: token, ALLOW_UNAUTHENTICATED_COMMANDS: 'false',
      COMMAND_TARGET_HOST: '', COMMAND_TARGET_PORT: '', TELEMETRY_STALE_MS: '5000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stderr.on('data', (d) => { logs += d; }); server.stdout.resume();
  const device = dgram.createSocket('udp4'); device.bind(0, '127.0.0.1'); await once(device, 'listening');
  t.after(async () => {
    device.close();
    if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
    rmSync(dir, { recursive: true, force: true });
  });
  await poll(async () => (await fetch(`${base}/health`)).ok).catch((e) => { throw new Error(e.message + logs); });
  const request = (path, body, supplied = token) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(supplied ? { 'X-Command-Token': supplied } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = async (path) => { const r = await request(path); assert.equal(r.status, 200); return r.json(); };
  const send = async (seq, debug = false, reg = 0x40) => {
    const payload = hex(seq, debug, reg);
    await new Promise((res, rej) => device.send(payload, udp, '127.0.0.1', (e) => e ? rej(e) : res()));
    await poll(async () => (await (await fetch(base + '/latest')).json()).latest?.packet?.seq === seq);
    return payload;
  };
  assert.equal((await request('/runs', undefined, '')).status, 401);
  assert.equal((await request('/runs/start', { name: 'Test' })).status, 409);
  await send(1);
  const started = await request('/runs/start', { name: 'Initialization and power switching' });
  assert.equal(started.status, 201);
  const first = (await started.json()).run;
  const step = await request('/runs/events', { sequence_name: 'Startup', step_index: 0,
    step_text: 'debug on', phase: 'started', ok: null });
  assert.equal(step.status, 201);
  assert.equal((await step.json()).marker.run_id, first.id);
  assert.equal((await request('/runs/start', { name: 'Concurrent' })).status, 409);
  const raw = await send(2);
  await send(3, true);
  await send(4, true, 0);
  assert.equal((await json('/runs')).runs.length, 1);
  await send(5, false, 0);
  const second = (await json('/runs')).runs.find((r) => r.status === 'recording');
  assert.equal(second.previous_run_id, first.id);
  await send(6, false, 0x40);
  const runs = (await json('/runs')).runs;
  assert.equal(runs.length, 3);
  const last = runs.find((r) => r.status === 'recording');
  const markers = (await json(`/runs/${second.id}/events`)).items;
  const end = markers.find((e) => e.type === 'run_ended');
  assert.equal(end.details.reason, 'source_switch');
  assert.equal(end.details.next_run_id, last.id);
  assert.equal(end.details.from_source, 'bat_secondary');
  assert.equal(end.details.to_source, 'pv');
  const firstMarkers = (await json(`/runs/${first.id}/events`)).items;
  assert.equal(firstMarkers.find((event) => event.type === 'sequence_step').details.step_text, 'debug on');
  const samples = (await json(`/runs/${first.id}/samples`)).items;
  assert.equal(samples.length, 3);
  assert.equal(samples[0].raw_base64, Buffer.from(raw).toString('base64'));
  assert.deepEqual(samples.map((s) => s.mode), ['live_telemetry', 'debug', 'debug']);
  // Legacy injection remains separate and cannot silently contaminate the archive.
  assert.equal((await request('/input', { hex: hex(99, false, 0) }, '')).status, 200);
  assert.equal((await json(`/runs/${last.id}`)).run.sample_count, 1);
  const series = await json(`/runs/${first.id}/series?metric=pv.currentA&points=1`);
  assert.equal(series.points[0].sample_count, 3);
  assert.equal((await request(`/runs/${first.id}/samples?limit=100000`)).status, 400);
  assert.equal((await request(`/runs/${first.id}`, undefined, 'wrong')).status, 401);
  assert.equal((await request('/runs/stop', {})).status, 200);
  await send(7);
  assert.equal((await json(`/runs/${last.id}`)).run.sample_count, 1);
  assert.equal((await json('/runs')).recording.active_run_id, null);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('bounded worker queue interrupts recording visibly and flushes the admitted sample', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'record-queue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'runs.sqlite');
  const recorder = new Recorder(file, { maxPending: 1 });
  await recorder.ready;
  const e = structuredClone(JSON.parse(readFileSync(new URL('./fixtures/streaming-envelopes.json', import.meta.url))).v6_all);
  e.received_at = new Date().toISOString();
  const run = await recorder.call('start', { name: 'Queue test', envelope: e, now: Date.now() - 1000 });
  recorder.capture('ingest', { envelope: e, rawBase64: 'one' });
  recorder.capture('ingest', { envelope: e, rawBase64: 'two' });
  assert.match(recorder.status().error, /overflow/);
  assert.equal(recorder.status().ready, false);
  assert.equal(recorder.status().dropped_records, 1);
  await recorder.close();
  const store = new RunStore(file);
  try {
    assert.equal(store.get(run.id).status, 'interrupted');
    assert.equal(store.get(run.id).end_reason, 'queue_overflow');
    assert.equal(store.get(run.id).sample_count, 1);
  } finally { store.close(); }
});

test('recording startup preserves the worker failure cause', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'record-startup-error-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const blocker = join(dir, 'not-a-directory');
  writeFileSync(blocker, 'file');
  const recorder = new Recorder(join(blocker, 'runs.sqlite'));
  await assert.rejects(recorder.ready, /Recording worker failed:.*(EEXIST|ENOTDIR|not a directory)/i);
  assert.match(recorder.status().error, /(EEXIST|ENOTDIR|not a directory)/i);
  await recorder.close();
});
