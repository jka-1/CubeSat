// End-to-end against the real bridge from the cloned repo (and the patched copy for v5/tap tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(here, '..');
const STOCK = process.env.STOCK_BRIDGE || fileURLToPath(new URL('../../../telemetry-bridge/server.js', import.meta.url));
const PATCHED = process.env.PATCHED_BRIDGE || '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linkchar-'));
const TOKEN = 'e2e-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tcpPort() { const s = net.createServer().listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; s.close(); return p; }
async function udpPort() { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; s.close(); return p; }
function run(file, args, env = {}) {
  const c = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, cwd: tmp });
  c.out = ''; c.stdout.on('data', (d) => (c.out += d)); c.stderr.on('data', (d) => (c.out += d)); return c;
}
async function startBridge(file, env = {}) {
  const http = await tcpPort(), udp = await udpPort();
  const b = run(file, [], { HTTP_PORT: http, UDP_PORT: udp, UDP_BIND_ADDRESS: '127.0.0.1', COMMAND_TOKEN: TOKEN, ...env });
  for (let i = 0; i < 50 && !/HTTP\] listening/.test(b.out); i++) await sleep(100);
  return { b, http, udp };
}
const done = (c) => new Promise((r) => (c.exitCode !== null ? r() : c.on('exit', r)));
const summ = (p) => JSON.parse(fs.readFileSync(path.join(tmp, p), 'utf8'));

test('tee + sse monitors vs stock bridge with injected faults, plus command RTT through tee', { timeout: 60000 }, async () => {
  const { b, http, udp } = await startBridge(STOCK);
  const teePort = await udpPort();
  const tee = run(path.join(tools, 'link_monitor.mjs'), ['--mode', 'tee', '--port', String(teePort), '--bind', '127.0.0.1', '--forward', `127.0.0.1:${udp}`, '--period', '100', '--csv', 'tee.csv', '--quiet']);
  const sse = run(path.join(tools, 'link_monitor.mjs'), ['--mode', 'sse', '--url', `http://127.0.0.1:${http}/events`, '--period', '100', '--csv', 'sse.csv', '--quiet']);
  await sleep(500);
  const synth = run(path.join(tools, 'synth_sender.mjs'), ['--target', `127.0.0.1:${teePort}`, '--count', '80', '--period', '100',
    '--drop', '5,6,40', '--dup', '10', '--reorder', '20', '--jitter-ms', '10', '--linger-ms', '9000']);
  await sleep(1500);
  const rtt = run(path.join(tools, 'command_rtt.mjs'), ['--base', `http://127.0.0.1:${http}`, '--count', '5', '--interval-ms', '300', '--csv', 'rtt.csv'], { COMMAND_TOKEN: TOKEN });
  await done(rtt); await done(synth);
  tee.kill('SIGINT'); sse.kill('SIGINT'); await done(tee); await done(sse);
  b.kill(); await done(b);
  console.log(tee.out, sse.out, rtt.out, synth.out);
  const t = summ('tee_summary.json');
  assert.equal(t.lost, 3); assert.equal(t.duplicates, 1); assert.equal(t.out_of_order, 1); assert.equal(t.expected_seq, 80);
  const s = summ('sse_summary.json');
  // SSE view: bridge accepts duplicates and reordered packets; first replayed envelope is skipped
  assert.equal(s.lost, 3); assert.equal(s.duplicates, 1); assert.equal(s.out_of_order, 1);
  const r = summ('rtt_summary.json');
  assert.equal(r.completed, 5); assert.equal(r.timed_out, 0);
  assert.match(JSON.parse(synth.out.trim().split('\n').pop()).acks.toString(), /^7[78]$/); // 77 sent+1 dup ACKed through tee
});

test('command timeout + retry accounting when MCU drops commands', { timeout: 60000 }, async () => {
  const { b, http, udp } = await startBridge(STOCK, { COMMAND_TIMEOUT_MS: '600' });
  const synth = run(path.join(tools, 'synth_sender.mjs'), ['--target', `127.0.0.1:${udp}`, '--count', '60', '--period', '100', '--cmd-drop-pct', '100', '--linger-ms', '500']);
  await sleep(800);
  const rtt = run(path.join(tools, 'command_rtt.mjs'), ['--base', `http://127.0.0.1:${http}`, '--count', '2', '--interval-ms', '100', '--wait-ms', '3000', '--csv', 'rtt_to.csv'], { COMMAND_TOKEN: TOKEN });
  await done(rtt); synth.kill(); b.kill(); await done(b);
  console.log(rtt.out);
  const r = summ('rtt_to_summary.json'); assert.equal(r.timed_out, 2); assert.equal(r.completed, 0);
});

test('bad token gives http_error, not success', { timeout: 30000 }, async () => {
  const { b, http } = await startBridge(STOCK);
  const rtt = run(path.join(tools, 'command_rtt.mjs'), ['--base', `http://127.0.0.1:${http}`, '--count', '1', '--csv', 'rtt_bad.csv'], { COMMAND_TOKEN: 'wrong' });
  await done(rtt); b.kill(); await done(b);
  assert.equal(summ('rtt_bad_summary.json').http_errors, 1);
});

test('listen mode with --ack (bench, no bridge) + reboot detection', { timeout: 30000 }, async () => {
  const p = await udpPort();
  const mon = run(path.join(tools, 'link_monitor.mjs'), ['--mode', 'listen', '--port', String(p), '--bind', '127.0.0.1', '--ack', '--period', '50', '--csv', 'listen.csv', '--quiet']);
  await sleep(400);
  const synth = run(path.join(tools, 'synth_sender.mjs'), ['--target', `127.0.0.1:${p}`, '--count', '40', '--period', '50', '--start-seq', '500', '--loss-pct', '10', '--seed', '7', '--reboot-at', '515', '--linger-ms', '300']);
  await done(synth); mon.kill('SIGINT'); await done(mon);
  const sy = JSON.parse(synth.out.trim().split('\n').pop());
  const s = summ('listen_summary.json');
  console.log(mon.out, synth.out);
  assert.equal(s.packets_received, sy.sent); assert.equal(sy.acks, sy.sent);
  assert.equal(s.seq_resets, 1);
});

test('patched bridge: v5 link stats via UDP_TAP_LOG + taplog mode', { timeout: 30000, skip: !PATCHED && 'set PATCHED_BRIDGE' }, async () => {
  const tap = path.join(tmp, 'tap.csv');
  const { b, http, udp } = await startBridge(PATCHED, { UDP_TAP_LOG: tap });
  const synth = run(path.join(tools, 'synth_sender.mjs'), ['--target', `127.0.0.1:${udp}`, '--count', '30', '--period', '50', '--v5', '--drop', '7', '--linger-ms', '500']);
  await done(synth);
  const health = await (await fetch(`http://127.0.0.1:${http}/latest`)).json();
  b.kill(); await done(b);
  assert.equal(health.latest.packet.packet_format, 'hex-v5-debug');
  assert.ok(health.latest.packet.link.rssi_dbm <= -40);
  const mon = run(path.join(tools, 'link_monitor.mjs'), ['--mode', 'taplog', '--file', tap, '--period', '50', '--csv', 'tap_out.csv', '--quiet']);
  await done(mon); console.log(mon.out);
  const s = summ('tap_out_summary.json');
  assert.equal(s.lost, 1); assert.equal(s.packets_received, 29); assert.ok(s.rssi_dbm.min <= -40);
});
