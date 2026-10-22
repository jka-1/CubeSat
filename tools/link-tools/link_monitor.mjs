#!/usr/bin/env node
// Per-packet link monitor for the CubeSat ESP32 -> bridge UDP telemetry stream.
// Modes (pick one):
//   --mode listen  --port 3334                 bind a UDP port and log packets (bench: point firmware here; no ACKs sent
//                                              unless --ack, so firmware will log ACK timeouts)
//   --mode tee     --port 3334 --forward 127.0.0.1:3333
//                                              transparent UDP relay in front of the bridge: logs every MCU packet,
//                                              forwards it to the bridge, and relays ACKs/commands back to the MCU.
//   --mode sse     --url http://127.0.0.1:8080/events
//                                              passive: tail the bridge's SSE stream (no port conflict with 3333).
//   --mode taplog  --file /var/log/cubesat-udp-tap.csv [--follow]
//                                              read the CSV written by the proposed bridge UDP_TAP_LOG patch.
// Common: --csv out.csv --summary out.json --period 1000 --duration-s N
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { parseHexPacket } from './lib/packet.mjs';
import { SeqTracker, formatSummary } from './lib/stats.mjs';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2); const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const mode = args.mode || 'listen';
const period = Number(args.period || 1000);
const csvPath = args.csv || `link_${mode}_${Date.now()}.csv`;
const summaryPath = args.summary || csvPath.replace(/\.csv$/, '') + '_summary.json';
const tracker = new SeqTracker({ expectedPeriodMs: period });
const csv = fs.createWriteStream(csvPath);
const COLS = ['arrival_iso', 'arrival_ms', 'source', 'kind', 'version', 'seq', 'delta_seq', 'gap', 'duplicate',
  'out_of_order', 'reset', 'inter_arrival_ms', 'jitter_ms', 'bytes', 'rssi_dbm', 'fw_uptime_ms', 'tx_errors',
  'ack_timeouts', 'wifi_reconnects', 'bridge_received_at'];
csv.write(COLS.join(',') + '\n');
const quiet = Boolean(args.quiet);

function record({ arrivalMs, source, payload, bytes, parsed = null, bridgeReceivedAt = '' }) {
  const p = parsed || parseHexPacket(payload);
  if (p.kind !== 'telemetry') {
    // commands/results/acks are written but don't feed sequence stats
    csv.write([new Date(arrivalMs).toISOString(), arrivalMs, source, p.kind, '', '', '', '', '', '', '', '', '', bytes,
      '', '', '', '', '', bridgeReceivedAt].join(',') + '\n');
    return;
  }
  const row = tracker.add({ seq: p.seq, arrivalMs, bytes, link: p.link || null });
  const l = p.link || {};
  csv.write([new Date(arrivalMs).toISOString(), arrivalMs, source, 'telemetry', p.version, p.seq, row.delta_seq, row.gap,
    row.duplicate, row.out_of_order, row.reset, row.inter_arrival_ms, row.jitter_ms, bytes, l.rssi_dbm ?? '',
    l.uptime_ms ?? '', l.tx_errors ?? '', l.ack_timeouts ?? '', l.wifi_reconnects ?? '', bridgeReceivedAt].join(',') + '\n');
  if (!quiet && (row.gap || row.duplicate || row.out_of_order || row.reset)) {
    console.log(`[${new Date(arrivalMs).toISOString()}] seq=${p.seq} gap=${row.gap} dup=${row.duplicate} ooo=${row.out_of_order} reset=${row.reset}`);
  }
}

let finished = false;
function finish() {
  if (finished) return; finished = true;
  const s = tracker.summary();
  s.mode = mode; s.csv = csvPath; s.generated_at = new Date().toISOString();
  fs.writeFileSync(summaryPath, JSON.stringify(s, null, 2));
  console.log(formatSummary(s, `Link summary (${mode})`));
  console.log(`CSV: ${csvPath}\nSummary: ${summaryPath}`);
  csv.end(() => process.exit(0));
}
process.on('SIGINT', finish); process.on('SIGTERM', finish);
if (args['duration-s']) setTimeout(finish, Number(args['duration-s']) * 1000);

if (mode === 'listen') {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, r) => {
    const arrivalMs = Date.now();
    const parsed = parseHexPacket(msg);
    record({ arrivalMs, source: `${r.address}:${r.port}`, payload: msg, bytes: msg.length, parsed });
    if (args.ack && parsed.kind === 'telemetry') {
      // mimic bridge ACK (server.js udp 'message' handler) so firmware stop-and-wait stays happy
      sock.send(Buffer.from(JSON.stringify({ version: 1, type: 'ack', device_id: 'esp32-telemetry', seq: parsed.seq,
        server_rx_ms: arrivalMs, received_at: new Date(arrivalMs).toISOString() })), r.port, r.address);
    }
  });
  sock.bind(Number(args.port || 3334), args.bind || '0.0.0.0', () => console.log(`listening udp ${args.bind || '0.0.0.0'}:${args.port || 3334} ack=${Boolean(args.ack)}`));
} else if (mode === 'tee') {
  const [fh, fp] = String(args.forward || '127.0.0.1:3333').split(':');
  const front = dgram.createSocket('udp4');
  const upstreams = new Map(); // mcuKey -> upstream socket (one per MCU endpoint so bridge replies route back)
  front.on('message', (msg, r) => {
    const arrivalMs = Date.now(); const key = `${r.address}:${r.port}`;
    record({ arrivalMs, source: key, payload: msg, bytes: msg.length });
    let up = upstreams.get(key);
    if (!up) {
      up = dgram.createSocket('udp4');
      up.on('message', (reply) => {
        front.send(reply, r.port, r.address);
        if (args['log-downlink']) csv.write([new Date().toISOString(), Date.now(), `bridge->${key}`, 'downlink:' + (parseHexPacket(reply).kind), '', '', '', '', '', '', '', '', '', reply.length, '', '', '', '', '', ''].join(',') + '\n');
      });
      up.bind(0); upstreams.set(key, up);
    }
    up.send(msg, Number(fp), fh);
  });
  front.bind(Number(args.port || 3334), args.bind || '0.0.0.0', () => console.log(`tee udp :${args.port || 3334} -> ${fh}:${fp}`));
} else if (mode === 'sse') {
  const url = new URL(args.url || 'http://127.0.0.1:8080/events');
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.get(url, { headers: { Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode !== 200) { console.error(`SSE HTTP ${res.statusCode}`); process.exit(2); }
    console.log(`tailing ${url}`);
    let buf = ''; let first = true;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type !== 'telemetry' || ev.source !== 'udp') continue;
        if (first) { first = false; if (!args['include-replay']) continue; } // /events replays latestEnvelope on connect
        const rx = Date.parse(ev.received_at); // bridge receive time = closest to air arrival
        const pkt = ev.packet || {};
        record({ arrivalMs: rx, source: `${ev.network?.remote_address}:${ev.network?.remote_port}`, bytes: ev.network?.bytes || 0,
          parsed: { kind: 'telemetry', version: pkt.packet_format, seq: pkt.seq, link: pkt.link || null }, bridgeReceivedAt: ev.received_at });
      }
    });
    res.on('end', () => { console.error('SSE stream ended'); finish(); });
  });
  req.on('error', (e) => { console.error('SSE error', e.message); finish(); });
} else if (mode === 'taplog') {
  // CSV lines: server_rx_ms,remote_address,remote_port,bytes,payload_hex_or_json(base64)
  let pos = 0; let rest = '';
  const readMore = () => {
    const st = fs.statSync(args.file); if (st.size < pos) pos = 0;
    if (st.size === pos) return;
    const fd = fs.openSync(args.file, 'r'); const b = Buffer.alloc(st.size - pos);
    fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd); pos = st.size;
    const lines = (rest + b.toString('utf8')).split('\n'); rest = lines.pop();
    for (const line of lines) {
      if (!line || line.startsWith('server_rx_ms')) continue;
      const [ms, addr, port, bytes, b64] = line.split(',');
      const payload = Buffer.from(b64 || '', 'base64');
      record({ arrivalMs: Number(ms), source: `${addr}:${port}`, payload, bytes: Number(bytes) });
    }
  };
  readMore();
  if (args.follow) setInterval(readMore, 500); else finish();
} else {
  console.error(`unknown --mode ${mode}`); process.exit(1);
}
