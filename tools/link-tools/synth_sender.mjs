#!/usr/bin/env node
// Synthetic ESP32: emits v4 (or v5 debug) hex telemetry like main/udp_transport.c, with fault injection,
// and answers bridge JSON commands with debug_result like handle_command_payload().
// node synth_sender.mjs --target 127.0.0.1:3333 --count 60 --period 1000 [--v5 | --debug/--v6]
//   --present all|none|pv,bms,mppt   which I2C devices exist (debug firmware emulation; default all)
//   --count 0  run until SIGINT/SIGTERM
//   --drop 5,6,20   drop these seqs     --loss-pct 2   random loss (seeded)   --dup 10   send seq 10 twice
//   --reorder 30    swap seq 30 with 31  --jitter-ms 30 uniform send jitter     --start-seq 1  --seed 1
//   --wiggle  vary measurement values (demo)   --reboot-at 40  restart seq at 1 after this seq   --cmd-delay-ms 20   --cmd-drop-pct 0   --linger-ms 1500
// Debug emulation: debug_control switches v4<->v5, set_scan_period changes the send period (200..5000 ms),
// i2c_scan returns present addresses, i2c_probe reports present:true/false, i2c_read/i2c_write use a
// per-device register memory and fail with ESP_FAIL (NACK) for absent devices. Error names are emulated.
import dgram from 'node:dgram';
import { buildV4Present, buildV5, buildV6 } from './lib/packet.mjs';

const a = {}; const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) { const n = av[i + 1]; if (n === undefined || n.startsWith('--')) a[av[i].slice(2)] = true; else { a[av[i].slice(2)] = n; i++; } }
const [host, port] = String(a.target || '127.0.0.1:3333').split(':');
const list = (k) => new Set(String(a[k] || '').split(',').filter(Boolean).map(Number));
const drop = list('drop'), dup = list('dup'), reorder = list('reorder');
const count = Number(a.count ?? 30); let period = Number(a.period || 1000); const jitter = Number(a['jitter-ms'] || 0);
let seed = Number(a.seed || 1); const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const lossPct = Number(a['loss-pct'] || 0), cmdDelay = Number(a['cmd-delay-ms'] || 20), cmdDropPct = Number(a['cmd-drop-pct'] || 0);
const rebootAt = a['reboot-at'] ? Number(a['reboot-at']) : null;

export const DEVICES = [{ key: 'pv', addr: 0x40, bit: 1 }, { key: 'bms', addr: 0x08, bit: 2 }, { key: 'mppt', addr: 0x6b, bit: 4 }];
function parsePresent(v) {
  const t = String(v ?? 'all').toLowerCase();
  if (t === 'all') return 7; if (t === 'none' || t === '') return 0;
  return t.split(',').reduce((m, k) => { const d = DEVICES.find((x) => x.key === k.trim()); if (!d) throw new Error(`unknown device ${k}`); return m | d.bit; }, 0);
}
let presentMask = parsePresent(a.present);
let debug = !!(a.v5 || a.v6 || a.debug);
const legacyV5 = !!a.v5; // --v5 = old debug firmware; --debug/--v6 = current firmware (v6 Streaming Telemetry)
const errCounts = [0, 0, 0];

// Register memory, seeded with documented ID/default values (others read 0x00 until written).
const mem = new Map();
const seedReg = (addr, reg, bytes) => mem.set(`${addr}:${reg}`, bytes);
seedReg(0x40, 0x00, [0x41, 0x27]); seedReg(0x40, 0xfe, [0x54, 0x49]); seedReg(0x40, 0xff, [0x22, 0x60]); // INA226 config/mfr/die
seedReg(0x40, 0x02, [0x0f, 0xa3]); seedReg(0x40, 0x05, [0x0a, 0x00]);
seedReg(0x6b, 0x48, [0x19]); // BQ25798 part information (emulated value)
const readMem = (addr, reg, len) => { const out = []; for (let i = 0; i < len; i++) { const b = mem.get(`${addr}:${(reg + Math.floor(i / 2)) & 0xff}`); out.push(b ? (b[i % 2] ?? 0) : 0); } return out; };
const hex = (v) => '0x' + v.toString(16).toUpperCase().padStart(2, '0');
const devAt = (addr) => DEVICES.find((d) => d.addr === addr);
const isPresent = (addr) => { const d = devAt(addr); return d ? (presentMask & d.bit) !== 0 : false; };

const sock = dgram.createSocket('udp4');
const t0 = Date.now(); const stats = { sent: 0, dropped: 0, acks: 0, cmds: 0, cmd_dropped: 0, ackRtt: [] };
const sentAt = new Map();
let txErr = 0, ackTimeouts = 0, lastRtt = 0xffff;
const debugState = () => ({ debug_enabled: debug, scan_period_ms: period, probe_period_ms: 5000, present_mask: presentMask, ack_timeout_ms: Math.min(250, Math.floor(period / 4)) });

sock.on('message', (msg) => {
  let j; try { j = JSON.parse(msg.toString()); } catch { return; }
  if (j.type === 'ack') { stats.acks++; const s = sentAt.get(j.seq); if (s) { lastRtt = Date.now() - s; stats.ackRtt.push(lastRtt); } return; }
  if (!['i2c_read', 'i2c_write', 'sensor_control', 'led_control', 'mppt_acdrv_control', 'debug_control', 'set_scan_period', 'i2c_scan', 'i2c_probe'].includes(j.type)) return;
  stats.cmds++;
  if (rnd() * 100 < cmdDropPct) { stats.cmd_dropped++; return; }
  const r = { version: 1, type: 'debug_result', device_id: 'esp32-telemetry', command_type: j.type,
    device_time_ms: Date.now() - t0, request_id: j.request_id, issued_at: j.issued_at };
  let ok = true, err = null;
  const addr = j.addr ? parseInt(j.addr, 16) : null; const reg = j.reg ? parseInt(j.reg, 16) : null;
  if (j.type === 'i2c_read') {
    if (!isPresent(addr)) { ok = false; err = 'ESP_FAIL'; }
    else Object.assign(r, { addr: j.addr, reg: j.reg, len: j.len, data: readMem(addr, reg, j.len).map(hex) });
  }
  if (j.type === 'i2c_write') {
    if (!isPresent(addr)) { ok = false; err = 'ESP_FAIL'; }
    else { const bytes = j.data.map((x) => parseInt(x, 16)); for (let i = 0; i < bytes.length; i += 2) seedReg(addr, (reg + i / 2) & 0xff, bytes.slice(i, i + 2));
      Object.assign(r, { addr: j.addr, reg: j.reg, len: j.data.length, write_data: j.data }); }
  }
  if (j.type === 'sensor_control') Object.assign(r, { sensor: j.sensor, enabled: j.enabled, active_sensor_mask: 7 });
  if (j.type === 'led_control') Object.assign(r, { enabled: j.enabled, gpio: 38 });
  if (j.type === 'mppt_acdrv_control') Object.assign(r, { state: j.state, verified: true });
  if (j.type === 'debug_control') { debug = !!j.enabled; Object.assign(r, { enabled: debug, ...debugState() }); }
  if (j.type === 'set_scan_period') { const req = j.period_ms; period = Math.min(5000, Math.max(200, req)); Object.assign(r, { requested_period_ms: req, period_ms: period, ...debugState() }); }
  if (j.type === 'i2c_scan') { const found = DEVICES.filter((d) => presentMask & d.bit).map((d) => d.addr).sort((x, y) => x - y);
    Object.assign(r, { addresses: found.map(hex), count: found.length, scan_us: 112 * 180 + found.length * 40, ...debugState() }); }
  if (j.type === 'i2c_probe') { const p = isPresent(addr); Object.assign(r, { addr: j.addr, present: p, probe_result: p ? 'ESP_OK' : 'ESP_ERR_NOT_FOUND', ...debugState() }); }
  r.ok = ok; r.status = ok ? 'ok' : 'error'; if (err) r.error = err;
  setTimeout(() => sock.send(Buffer.from(JSON.stringify(r)), Number(port), host), cmdDelay);
});

const send = (seq) => {
  let pkt = debug
    ? (legacyV5 ? buildV5 : buildV6)(seq, { rssi_dbm: -40 - Math.round(rnd() * 30), uptime_ms: Date.now() - t0, tx_errors: txErr, ack_timeouts: ackTimeouts, wifi_reconnects: 0, last_ack_rtt_ms: lastRtt },
      { enabled: true, present_mask: presentMask, probed_mask: 7, scan_period_ms: period, error_counts: errCounts })
    : buildV4Present(seq, presentMask);
  if (a.wiggle) pkt = wiggle(pkt, seq);
  sentAt.set(seq, Date.now()); stats.sent++;
  sock.send(Buffer.from(pkt), Number(port), host);
};

// --wiggle: deterministic slow variation of live measurement words (non-zero ones only) for UI demos.
function wiggle(hex, seq) {
  const w = []; for (let i = 0; i < hex.length; i += 4) w.push(parseInt(hex.slice(i, i + 4), 16));
  const ph = seq / 12; const add = (i, amp, f = 1) => { if (w[i]) w[i] = Math.max(1, Math.round(w[i] + amp * Math.sin(ph * f + i))) & 0xffff; };
  add(5, 12); add(6, 60); add(7, 4, 1.3); add(8, 30, 0.7); [9, 10, 11, 12].forEach((i) => add(i, 25, 0.5));
  add(17, 120, 0.3); add(19, 1500, 0.4); add(18, 400, 0.4);
  if (w.length >= 48) { add(37, 30, 0.2); add(38, 20, 0.1); if (w[39] !== 0x8000) add(39, 120, 0.6); [40, 41, 42, 43].forEach((i) => add(i, 150, 0.35)); if (w[44] !== 0x8000) add(44, 4, 0.1); add(46, 40, 0.3); }
  if (w[14] !== undefined && (presentMask & 4) && seq % 40 > 30) w[14] |= 0x0004; // brief CONV_OCP fault blip
  return w.map((v) => v.toString(16).toUpperCase().padStart(4, '0')).join('');
}

let stop = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true; });
sock.bind(0, async () => {
  let seq = Number(a['start-seq'] || 1); let held = null;
  for (let i = 0; (count === 0 || i < count) && !stop; i++) {
    const cur = seq; seq = seq >= 65535 ? 1 : seq + 1;
    if (rebootAt !== null && cur === rebootAt) seq = 1;
    if (drop.has(cur) || (lossPct && rnd() * 100 < lossPct)) { stats.dropped++; }
    else if (reorder.has(cur)) { held = cur; }
    else { send(cur); if (held !== null) { send(held); held = null; } if (dup.has(cur)) send(cur); }
    const wait = period + (jitter ? Math.round((rnd() * 2 - 1) * jitter) : 0);
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  if (held !== null) send(held);
  setTimeout(() => { console.log(JSON.stringify({ ...stats, ackRtt: undefined, ack_rtt_max_ms: Math.max(0, ...stats.ackRtt), present_mask: presentMask, debug })); sock.close(); process.exit(0); }, stop ? 0 : Number(a['linger-ms'] || 1500));
});
