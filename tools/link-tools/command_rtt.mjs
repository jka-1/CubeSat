#!/usr/bin/env node
// Command round-trip tester for POST /command on the telemetry bridge.
// Token comes ONLY from env COMMAND_TOKEN (never argv). Default command is a read-only INA226
// calibration read (i2c_read 0x40 reg 0x05 len 2), same non-destructive read used in LAB_HANDOFF.md.
// Usage: COMMAND_TOKEN=... node command_rtt.mjs --base http://127.0.0.1:8080 --count 50 --interval-ms 2000
//        [--command '{"type":"i2c_read","addr":"0x08","reg":"0x14","len":2}'] [--csv rtt.csv]
// Through Apache use --base https://<host>/telemetry (paths /command and /events are appended).
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { percentile } from './lib/stats.mjs';

const a = {}; const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith('--')) { const n = av[i + 1]; if (n === undefined || n.startsWith('--')) a[av[i].slice(2)] = true; else { a[av[i].slice(2)] = n; i++; } }
const base = String(a.base || 'http://127.0.0.1:8080').replace(/\/$/, '');
const count = Number(a.count || 20); const intervalMs = Number(a['interval-ms'] || 2000);
const waitMs = Number(a['wait-ms'] || 12000); // > bridge timeout (4 s) x (1 + retries)
const cmd = a.command ? JSON.parse(a.command) : { type: 'i2c_read', addr: '0x40', reg: '0x05', len: 2 };
const token = process.env.COMMAND_TOKEN || '';
if (!token) console.warn('WARNING: COMMAND_TOKEN not set; bridge will answer 401/503 unless ALLOW_UNAUTHENTICATED_COMMANDS=true');
if (cmd.type === 'i2c_write' || cmd.type === 'mppt_acdrv_control') {
  if (!a['allow-write']) { console.error('Refusing write/actuation command without --allow-write'); process.exit(1); }
}
const csvPath = a.csv || `cmd_rtt_${Date.now()}.csv`;
const lib = base.startsWith('https') ? https : http;
const waiters = new Map(); // request_id -> {resolve, statuses:[]}

function openSse() {
  return new Promise((resolve, reject) => {
    const req = lib.get(base + '/events', { headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`SSE HTTP ${res.statusCode}`));
      res.setEncoding('utf8'); let buf = ''; resolve(req);
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const d = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!d) continue; let ev; try { ev = JSON.parse(d); } catch { continue; }
          if (ev.type === 'command_status' && waiters.has(ev.request_id)) {
            const w = waiters.get(ev.request_id); w.statuses.push(ev.status);
            if (ev.status === 'retrying') w.retries = ev.retry;
            if (['completed', 'failed', 'timed_out'].includes(ev.status)) { waiters.delete(ev.request_id); w.resolve({ ev, t: Date.now() }); }
          }
        }
      });
    });
    req.on('error', reject);
  });
}

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body)); const u = new URL(base + '/command');
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Command-Token': token } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ code: res.statusCode, body: j }); });
    });
    req.on('error', reject); req.end(data);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sse = await openSse(); await sleep(300);
const out = fs.createWriteStream(csvPath);
out.write('i,request_id,sent_iso,http_code,http_ms,final_status,client_rtt_ms,bridge_rtt_ms,retries,statuses,error\n');
const rows = [];
for (let i = 0; i < count; i++) {
  const requestId = `rtt-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let resolve; const done = new Promise((r) => (resolve = r));
  const w = { resolve, statuses: [], retries: 0 }; waiters.set(requestId, w);
  const t0 = Date.now(); let res;
  try { res = await post({ ...cmd, request_id: requestId }); } catch (e) { res = { code: 0, body: { error: e.message } }; }
  const httpMs = Date.now() - t0;
  let final = 'http_error', clientRtt = '', bridgeRtt = '', err = res.body?.error || '';
  if (res.code === 202) {
    const r = await Promise.race([done, sleep(waitMs).then(() => null)]);
    if (r) { final = r.ev.status; clientRtt = r.t - t0; bridgeRtt = r.ev.round_trip_ms ?? ''; err = r.ev.error || ''; }
    else { final = 'no_status_event'; waiters.delete(requestId); }
  } else waiters.delete(requestId);
  const row = { i, requestId, sent: new Date(t0).toISOString(), code: res.code, httpMs, final, clientRtt, bridgeRtt, retries: w.retries, statuses: w.statuses.join('>'), err };
  rows.push(row);
  out.write([i, requestId, row.sent, res.code, httpMs, final, clientRtt, bridgeRtt, w.retries, row.statuses, JSON.stringify(err)].join(',') + '\n');
  console.log(`#${i} ${final} http=${res.code} bridge_rtt=${bridgeRtt}ms client_rtt=${clientRtt}ms ${err}`);
  if (i < count - 1) await sleep(intervalMs);
}
sse.destroy(); out.end();
const ok = rows.filter((r) => r.final === 'completed');
const rtts = ok.map((r) => Number(r.bridgeRtt)).filter(Number.isFinite).sort((x, y) => x - y);
const summary = {
  sent: rows.length, completed: ok.length, failed: rows.filter((r) => r.final === 'failed').length,
  timed_out: rows.filter((r) => r.final === 'timed_out').length,
  http_errors: rows.filter((r) => r.final === 'http_error').length,
  no_status_event: rows.filter((r) => r.final === 'no_status_event').length,
  retried: rows.filter((r) => r.retries > 0).length,
  success_pct: rows.length ? +(100 * ok.length / rows.length).toFixed(2) : null,
  bridge_rtt_ms: { min: rtts[0] ?? null, p50: percentile(rtts, 50), p95: percentile(rtts, 95), max: rtts[rtts.length - 1] ?? null,
    mean: rtts.length ? +(rtts.reduce((s, v) => s + v, 0) / rtts.length).toFixed(1) : null },
  command: cmd, base, csv: csvPath,
};
fs.writeFileSync(csvPath.replace(/\.csv$/, '') + '_summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
