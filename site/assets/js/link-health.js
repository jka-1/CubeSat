import { apiFetch } from './auth.js?v=20261028d';
import { analyzeWindow } from './link-stats.mjs?v=20261013a';

const MAX_AGE_MS = 3_600_000;
const REPLAY_AGE_MS = 2_000;
const state = { es: null, events: [], commands: [], lastEndpoint: null, portChanges: 0, status: null,
  lastReceivedAt: null, lastKey: null, timer: null, healthTimer: null, lastRssi: null, sseOpen: false };
const $ = (id) => document.getElementById(id);

function css(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function drawChart(canvas, datasets, { yLabel = '', bars = false, start, end, yMin = null } = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300; const h = canvas.clientHeight || 170;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const L = 44, R = 10, T = 10, B = 22;
  const pts = datasets.flatMap((d) => d.points.filter((p) => p[1] !== null && Number.isFinite(p[1])));
  g.font = '11px Arial'; g.fillStyle = css('--white-soft', '#ede8d9');
  if (!pts.length) { g.fillText('no data in window', L + 8, h / 2); return; }
  let lo = yMin ?? Math.min(...pts.map((p) => p[1])); let hi = Math.max(...pts.map((p) => p[1]));
  if (hi === lo) { hi += 1; lo -= yMin === null ? 1 : 0; }
  const pad = (hi - lo) * 0.08; hi += pad; if (yMin === null) lo -= pad;
  const x = (t) => L + ((t - start) / (end - start)) * (w - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  g.strokeStyle = 'rgba(212,175,55,0.18)'; g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3; const yy = y(v);
    g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke();
    g.fillText(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1), 4, yy + 4);
  }
  const span = end - start; g.fillText(`-${Math.round(span / 60000)} min`, L, h - 6); g.fillText('now', w - R - 22, h - 6);
  datasets.forEach((d, di) => {
    g.strokeStyle = d.color; g.fillStyle = d.color; g.lineWidth = 1.6;
    const p = d.points.filter((q) => q[1] !== null && Number.isFinite(q[1]));
    if (bars || d.bars) {
      const bw = Math.max(2, ((w - L - R) / (d.buckets || 60)) / datasets.length - 1);
      p.forEach(([t, v]) => { if (v) g.fillRect(x(t) - bw * (datasets.length - di), y(v), bw, y(lo) - y(v)); });
    } else {
      g.beginPath(); p.forEach(([t, v], i) => (i ? g.lineTo(x(t), y(v)) : g.moveTo(x(t), y(v)))); g.stroke();
      if (p.length < 80) p.forEach(([t, v]) => { g.beginPath(); g.arc(x(t), y(v), 2, 0, 7); g.fill(); });
    }
    if (d.label) { g.fillText(d.label, w - R - 70, T + 12 + di * 13); }
  });
}

const fmt = (v, u = '') => (v === null || v === undefined || Number.isNaN(v) ? '--' : `${v}${u}`);

function render() {
  const windowMs = Number($('lhWindow')?.value || 300000);
  const periodMs = Number($('lhPeriod')?.value || 1000);
  const now = Date.now() - (state.clockSkew || 0);
  const r = analyzeWindow(state.events, state.commands, { periodMs, windowMs, now, buckets: 60 });
  const s = r.summary;
  const gold = css('--gold', '#d4af37'), ok = css('--success', '#54ef78'), warn = css('--warning', '#ffd66b'), bad = css('--danger', '#ff7b7b');
  const opt = { start: r.start, end: r.end };
  drawChart($('lhChartInterval'), [{ points: r.rows.filter((x) => x.inter_arrival_ms !== '').map((x) => [x.arrival_ms, x.inter_arrival_ms]), color: gold }], { ...opt, yMin: 0 });
  drawChart($('lhChartJitter'), [{ points: r.rows.filter((x) => x.jitter_ms !== '').map((x) => [x.arrival_ms, x.jitter_ms]), color: warn }], { ...opt, yMin: 0 });
  drawChart($('lhChartLoss'), [{ points: r.series.map((b) => [b.t, b.loss_pct]), color: bad, bars: true }], { ...opt, yMin: 0 });
  drawChart($('lhChartEvents'), [
    { points: r.series.map((b) => [b.t, b.lost]), color: bad, label: 'lost', bars: true },
    { points: r.series.map((b) => [b.t, b.duplicate]), color: warn, label: 'dup', bars: true },
    { points: r.series.map((b) => [b.t, b.out_of_order]), color: ok, label: 'ooo', bars: true }], { ...opt, yMin: 0 });
  drawChart($('lhChartRtt'), [{ points: state.commands.filter((c) => c.t >= r.start && Number.isFinite(c.rtt)).map((c) => [c.t, c.rtt]), color: ok }], { ...opt, yMin: 0 });
  drawChart($('lhChartRssi'), [{ points: r.rows.filter((x) => x.rssi !== null).map((x) => [x.arrival_ms, x.rssi]), color: gold }], opt);

  const ia = s.inter_arrival_ms; const rt = s.commands.rtt_ms;
  const rows = [
    ['Packets', s.packets_received, 'Lost', `${s.lost} (${fmt(s.loss_pct, '%')})`, 'Duplicates', s.duplicates, 'Out-of-order', s.out_of_order],
    ['Interval p50', fmt(ia.p50, ' ms'), 'p95', fmt(ia.p95, ' ms'), 'p99', fmt(ia.p99, ' ms'), 'max', fmt(ia.max, ' ms')],
    ['Jitter', fmt(s.rfc3550_jitter_ms, ' ms'), 'Outages', `${s.outages} (max ${s.longest_outage_ms} ms)`, 'Reboots', s.seq_resets, 'Rate', fmt(s.rate_pps, ' pkt/s')],
    ['Commands', `${s.commands.completed}/${s.commands.finished} ok`, 'Timed out', s.commands.timed_out, 'RTT p50 / p95', `${fmt(rt.p50)} / ${fmt(rt.p95)} ms`, 'RTT p99 / max', `${fmt(rt.p99)} / ${fmt(rt.max)} ms`],
  ];
  const tb = $('lhTable')?.querySelector('tbody');
  if (tb) tb.innerHTML = rows.map((row) => '<tr>' + row.map((c, i) => (i % 2 ? `<td>${c}</td>` : `<th>${c}</th>`)).join('') + '</tr>').join('');
  $('lhWindowLabel').textContent = $('lhWindow').selectedOptions[0].textContent;

  // tiles
  const st = state.status;
  const age = state.lastReceivedAt ? Math.max(0, Date.now() - state.clockSkew - state.lastReceivedAt) : (st?.telemetry_age_ms ?? null);
  const staleAfter = st?.telemetry_stale_after_ms ?? 5000;
  let label = 'Offline', cls = 'offline';
  if (!state.sseOpen) label = 'Bridge unreachable';
  else if (age !== null && age <= staleAfter) { label = 'Connected'; cls = 'online'; }
  else if (age !== null && age <= 60000) label = 'Stale';
  $('lhState').textContent = label; $('lhStatus').textContent = label;
  $('lhStatus').className = `status-pill ${cls}`;
  $('lhStateDetail').textContent = state.sseOpen ? `SSE open · ${st?.web_clients ?? '--'} web clients` : 'SSE closed';
  $('lhAge').textContent = age === null ? '--' : age < 10000 ? `${age} ms` : `${(age / 1000).toFixed(1)} s`;
  $('lhStale').textContent = `stale after ${staleAfter} ms`;
  const ep = st?.telemetry_endpoint || state.lastEndpoint;
  $('lhEndpoint').textContent = ep ? `${ep.address}:${ep.port}` : '--';
  $('lhEndpointChanges').textContent = `port changes ${state.portChanges} · reboots ${s.seq_resets}`;
  $('lhRssi').textContent = state.lastRssi === null ? 'n/a' : `${state.lastRssi} dBm`;
  $('lhRssiDetail').textContent = s.rssi_dbm ? `min ${s.rssi_dbm.min} · mean ${s.rssi_dbm.mean}` : 'needs v5 packets';
  $('lhPending').textContent = fmt(st?.pending_commands);
  $('lhCmdSummary').textContent = `${s.commands.completed} ok · ${s.commands.failed} failed · ${s.commands.timed_out} timeout`;
  $('lhCmdReady').textContent = st ? (st.command_ready ? 'Ready' : 'Not ready') : '--';
  $('lhCmdAuth').textContent = st ? `auth ${st.command_auth_configured ? 'configured' : 'NOT configured'} · ${st.command_auth_required ? 'token required' : 'open'}` : 'auth --';
}

function onEvent(ev) {
  if (ev.type === 'status') { state.status = { ...(state.status || {}), ...ev }; if (ev.server_time) state.clockSkew = Date.now() - Date.parse(ev.server_time); return; }
  if (ev.type === 'command_status' && ['completed', 'failed', 'timed_out'].includes(ev.status)) {
    const ct = Date.parse(ev.updated_at);
    if (Date.now() - (state.clockSkew || 0) - ct > REPLAY_AGE_MS) return; // latest command envelope replayed on connect
    state.commands.push({ t: ct, status: ev.status, rtt: Number.isFinite(ev.round_trip_ms) ? ev.round_trip_ms : null });
    return;
  }
  if (ev.type !== 'telemetry' || ev.source !== 'udp') return;
  const t = Date.parse(ev.received_at);
  const pkt = ev.packet || {}; const net = ev.network || {};
  const key = `${ev.received_at}|${pkt.seq}|${net.remote_port}`;
  const replayCheck = state.expectReplay; state.expectReplay = false;
  if (!Number.isFinite(t) || (replayCheck && key === state.lastKey)) return; // bridge replays its latest envelope on every SSE (re)connect
  state.lastKey = key;
  if (Date.now() - (state.clockSkew || 0) - t > REPLAY_AGE_MS) return; // stale envelope replayed on connect
  state.lastReceivedAt = t;
  const rssi = Number.isFinite(pkt.link?.rssi_dbm) ? pkt.link.rssi_dbm : null;
  state.lastRssi = rssi;
  state.events.push({ t, seq: Number.isInteger(pkt.seq) ? pkt.seq : null, bytes: net.bytes || 0, ...(rssi !== null ? { rssi } : {}) });
  const ep = { address: net.remote_address, port: net.remote_port };
  if (state.lastEndpoint && (ep.port !== state.lastEndpoint.port || ep.address !== state.lastEndpoint.address)) state.portChanges++;
  state.lastEndpoint = ep;
  const cutoff = t - MAX_AGE_MS;
  while (state.events.length && state.events[0].t < cutoff) state.events.shift();
  while (state.commands.length && state.commands[0].t < cutoff) state.commands.shift();
}

async function pollHealth() {
  const url = $('lhHealthUrl')?.value?.trim(); if (!url) return;
  try {
    const res = await apiFetch(url, { cache: 'no-store' });
    const j = await res.json();
    state.status = { ...(state.status || {}), ...j };
    if (j.server_time) state.clockSkew = Date.now() - Date.parse(j.server_time);
  } catch { /* health is optional */ }
}

function connect() {
  disconnect(false);
  const url = $('lhStreamUrl').value.trim();
  state.es = new EventSource(url);
  state.es.addEventListener('open', () => { state.sseOpen = true; state.expectReplay = true; $('lhConnect').textContent = 'Disconnect'; });
  state.es.addEventListener('error', () => { state.sseOpen = false; });
  state.es.addEventListener('message', (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } });
  pollHealth(); state.healthTimer = setInterval(pollHealth, 5000);
}

function disconnect(updateButton = true) {
  if (state.es) { state.es.close(); state.es = null; }
  clearInterval(state.healthTimer); state.sseOpen = false;
  if (updateButton && $('lhConnect')) $('lhConnect').textContent = 'Connect';
}

export function initLinkHealthPage() {
  state.clockSkew = state.clockSkew || 0;
  $('lhConnect').addEventListener('click', () => (state.es ? disconnect() : connect()));
  $('lhReset').addEventListener('click', () => { state.events = []; state.commands = []; state.portChanges = 0; state.lastRssi = null; render(); });
  $('lhWindow').addEventListener('change', render);
  $('lhPeriod').addEventListener('change', render);
  const params = new URLSearchParams(location.search);
  if (params.get('lhstream')) $('lhStreamUrl').value = params.get('lhstream');
  if (params.get('lhhealth')) $('lhHealthUrl').value = params.get('lhhealth');
  if (params.get('lhperiod')) $('lhPeriod').value = params.get('lhperiod');
  if (params.get('lhwindow')) $('lhWindow').value = params.get('lhwindow');
  connect();
  state.timer = setInterval(render, 1000); render();
}

export function destroyLinkHealthPage() { disconnect(); clearInterval(state.timer); }
