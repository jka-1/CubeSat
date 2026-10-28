import { apiFetch, canOperate } from './auth.js?v=20261028a';
import { analyzeWindow } from './link-stats.mjs?v=20261013a';
import { convert, parseValueInput } from './register-conversions.mjs?v=20261014a';
import { parseRegisterAddress, validateRegisterWrite, commandErrorDetail, registerWriteFeedback } from './register-policy.mjs?v=20261027b';
import { parseSequenceLine, formatScanGrid, describeResult } from './debug-commands.mjs?v=20261027c';
import { isStreamingMode, setStreamingMode } from './streaming-telemetry.mjs?v=20261019b';
import { mountStreamingView } from './streaming-view.mjs?v=20261028a';

let streamView = null;
function applyStreamingToggle(on) {
  $('dmStreamToggle').checked = on; $('dmStreamToggleText').textContent = on ? 'On' : 'Off';
  $('dmStreamOffNote').hidden = on;
  if (on && !streamView) streamView = mountStreamingView($('dmStreamRoot'), { url: $('dmStreamUrl').value.trim() || '/telemetry/events' });
  if (!on && streamView) { streamView.destroy(); streamView = null; }
}

const REPLAY_AGE_MS = 2_000;
const DEVICES = [['pv', 'PV / INA226'], ['bms', 'BMS / BQ76942'], ['mppt', 'MPPT / BQ25798']];
const state = { es: null, status: null, debug: null, map: null, events: [], commands: [], link: null,
  log: [], busy: false, stop: false, sseOpen: false, timer: null, healthTimer: null, lastKey: null, skew: 0 };
const $ = (id) => document.getElementById(id);

function log(kind, text) {
  const line = `${new Date().toISOString()}  ${kind.padEnd(4)} ${text}`;
  state.log.push(line);
  const el = $('dmLog'); if (el) { el.textContent = state.log.slice(-400).join('\n'); el.scrollTop = el.scrollHeight; }
}

function downloadLog() {
  const header = [`CubeSat debug session log`, `exported ${new Date().toISOString()}`,
    `bridge ${$('dmCommandUrl').value}`, `debug ${JSON.stringify(state.debug ? { enabled: state.debug.enabled, present_mask: state.debug.present_mask, scan_period_ms: state.debug.scan_period_ms } : null)}`, ''];
  const blob = new Blob([header.concat(state.log).join('\r\n') + '\r\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `cubesat-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function token() { return $('dmToken')?.value.trim() || ''; }

function updateControls() {
  const st = state.status;
  const needsToken = st ? st.command_auth_required !== false : true;
  const ready = canOperate() && !!st?.command_ready && (!needsToken || token().length > 0) && !state.busy;
  document.querySelectorAll('.debug-mode-page [data-cmd]').forEach((b) => { b.disabled = !ready; });
  const reg = currentRegister();
  if ($('dmWrite') && reg && !String(reg.access).includes('W')) $('dmWrite').disabled = true;
  if ($('dmAddRegister')) $('dmAddRegister').disabled = !canOperate() || state.busy;
  $('dmAuthPill').textContent = !st ? 'token --' : needsToken ? (token() ? 'token entered' : 'token required') : 'open commands';
  $('dmSeqPill').textContent = state.busy ? 'running' : 'idle';
}

async function sendCommand(body) {
  if (!canOperate()) {
    const error = 'An operator account is required.';
    log('ERR', error);
    if (body.type === 'i2c_write') $('dmRegisterFeedback').textContent = error;
    return { status: 'rejected', error };
  }
  const url = $('dmCommandUrl').value.trim() || '/telemetry/command';
  const headers = { 'Content-Type': 'application/json' };
  if (token()) headers['X-Command-Token'] = token();
  const started = performance.now();
  log('TX', JSON.stringify(body));
  if (body.type === 'i2c_write') $('dmRegisterFeedback').textContent = 'Write submitted; waiting for ESP32 response.';
  let res; let j;
  try {
    res = await apiFetch(`${url}${url.includes('?') ? '&' : '?'}wait=1`, { method: 'POST', headers, body: JSON.stringify(body) });
    j = await res.json().catch(() => ({}));
  } catch { const error = 'Bridge unreachable or session expired.'; log('ERR', error); if (body.type === 'i2c_write') $('dmRegisterFeedback').textContent = error; return { status: 'error', error }; }
  const ms = Math.round(performance.now() - started);
  if (!res.ok) {
    const error = commandErrorDetail(j.error);
    log('ERR', `HTTP ${res.status}: ${error}`);
    if (body.type === 'i2c_write') $('dmRegisterFeedback').textContent = `Write rejected (HTTP ${res.status}): ${error}`;
    return { status: 'rejected', error };
  }
  if (body.type === 'i2c_write') $('dmRegisterFeedback').textContent = registerWriteFeedback(j);
  log(j.status === 'completed' ? 'RX' : j.status === 'pending' ? 'INFO' : 'ERR', `${describeResult(body, j)}  [${ms} ms]`);
  return j;
}

function currentDevice() { return state.map?.devices.find((d) => d.addr === $('dmDevice')?.value) || null; }
function currentRegister() { const d = currentDevice(); return d?.registers[Number($('dmRegister')?.value)] || null; }

function fillRegisters() {
  const d = currentDevice(); const sel = $('dmRegister'); if (!d || !sel) return;
  sel.innerHTML = d.registers.map((r, i) => `<option value="${i}">${r.addr}  ${r.name} (${r.access}, ${r.width} B)</option>`).join('');
  showRegInfo();
}

function addRegister() {
  if (!canOperate()) { $('dmRegisterFeedback').textContent = 'An operator account is required to add registers.'; return; }
  const device = currentDevice();
  if (!device) { $('dmRegisterFeedback').textContent = 'Select a supported device first.'; return; }
  try {
    const address = parseRegisterAddress($('dmNewRegister').value);
    let index = device.registers.findIndex((register) => register.addr === address);
    if (index < 0) {
      const width = Number($('dmNewRegisterWidth').value);
      if (![1, 2].includes(width)) throw new Error('Read width must be 1 or 2 bytes.');
      device.registers.push({ addr: address, name: 'Custom register', access: 'R', width,
        endian: device.addr === '0x08' ? 'little' : 'big', scale: null,
        notes: 'Temporary read-only entry. Writes require a verified register definition.' });
      index = device.registers.length - 1;
    }
    fillRegisters();
    $('dmRegister').value = String(index);
    showRegInfo();
    $('dmRegisterFeedback').textContent = `${device.addr} ${address} available. ${device.registers[index].access.includes('W') ? 'Write permission follows the register definition.' : 'Read only.'}`;
  } catch (error) { $('dmRegisterFeedback').textContent = error.message; }
}

function showRegInfo() {
  const r = currentRegister(); if (!r) return;
  const conv = r.scale === null || r.scale === undefined ? 'raw/bitfields' : `x ${r.scale}${r.offset ? ` + ${r.offset}` : ''} ${r.unit}`;
  $('dmRegInfo').textContent = `${r.width} byte(s), ${r.endian}-endian${r.signed ? ', signed' : ''}, ${conv}. ${r.notes || ''}`;
  $('dmRegPill').textContent = `${currentDevice().addr} ${r.addr}`;
  updateControls();
}

function showRead(reg, data) {
  const bytes = data.map((x) => (typeof x === 'string' ? parseInt(x, 16) : x));
  $('dmRawBytes').textContent = bytes.map((b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');
  try {
    const out = convert(reg, bytes);
    $('dmRawValue').textContent = `${out.raw} (0x${(out.raw >>> 0).toString(16).toUpperCase()})`;
    $('dmConverted').textContent = out.text;
    log('VAL', `${currentDevice()?.addr} ${reg.name} = ${out.text}`);
  } catch (e) { $('dmConverted').textContent = e.message; }
}

async function readRegister() {
  const d = currentDevice(); const r = currentRegister(); if (!d || !r) return;
  state.busy = true; updateControls();
  const j = await sendCommand({ type: 'i2c_read', addr: d.addr, reg: r.addr, len: Number(r.width) });
  state.busy = false; updateControls();
  if (j.status === 'completed' && j.result?.data) showRead(r, j.result.data);
  else { $('dmRawBytes').textContent = '--'; $('dmRawValue').textContent = '--'; $('dmConverted').textContent = `read failed: ${commandErrorDetail(j.result?.error || j.error || j.status)}`; }
}

async function writeRegister() {
  const d = currentDevice(); const r = currentRegister(); if (!d || !r) return;
  let data;
  try {
    if (!canOperate()) throw new Error('An operator account is required to write registers.');
    if (/^\s*-/.test($('dmValue').value)) throw new Error('Write value must be non-negative and fit the register width.');
    data = parseValueInput($('dmValue').value, Number(r.width), r.endian);
    validateRegisterWrite(state.map, d.addr, r.addr, data);
  } catch (e) { log('ERR', e.message); $('dmRegisterFeedback').textContent = e.message; return; }
  state.busy = true; updateControls();
  await sendCommand({ type: 'i2c_write', addr: d.addr, reg: r.addr, data: data.map((b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`) });
  state.busy = false; updateControls();
}

async function runSimple(body, after) {
  state.busy = true; updateControls();
  const j = await sendCommand(body);
  state.busy = false; updateControls();
  if (after) after(j);
  return j;
}

function showScan(j) {
  if (j.status !== 'completed') { $('dmScanPill').textContent = 'failed'; return; }
  $('dmScanGrid').textContent = formatScanGrid(j.result.addresses);
  $('dmScanPill').textContent = `${j.result.count} found · ${(j.result.scan_us / 1000).toFixed(1)} ms`;
}

async function runSequence() {
  const lines = $('dmSeq').value.split('\n');
  state.busy = true; state.stop = false; updateControls();
  log('SEQ', `start (${lines.length} lines)`);
  let okCount = 0; let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (state.stop) { log('SEQ', 'aborted by user'); break; }
    let step;
    try { step = parseSequenceLine(lines[i]); } catch (e) { log('ERR', `line ${i + 1}: ${e.message}`); failed++; if ($('dmStopOnError').checked) break; continue; }
    if (!step) continue;
    if (step.kind === 'delay') { log('SEQ', `delay ${step.ms} ms`); await new Promise((r) => setTimeout(r, step.ms)); continue; }
    if (step.kind === 'config') { log('SEQ', `line ${i + 1}: i2cconfig ignored (bus is fixed in firmware)`); continue; }
    const j = await sendCommand(step.body);
    if (step.body.type === 'i2c_scan') showScan(j);
    if (j.status === 'completed') okCount++; else { failed++; if ($('dmStopOnError').checked) { log('SEQ', `stopped on error at line ${i + 1}`); break; } }
  }
  log('SEQ', `end: ${okCount} ok, ${failed} failed`);
  state.busy = false; updateControls();
}

function renderTiles() {
  const d = state.debug; const box = $('dmTiles'); if (!box) return;
  box.innerHTML = DEVICES.map(([key, label]) => {
    const dev = d?.devices?.[key];
    const st = !d || !d.enabled ? 'unknown' : dev?.state || 'unknown';
    const text = { present: 'Present', absent: 'Absent', error: 'Bus error', paused: 'Paused', unknown: d?.enabled ? 'Unknown' : 'n/a' }[st] || st;
    return `<div class="dm-tile ${st}" data-device="${key}"><h4>${label}</h4><strong>${text}</strong>
      <small>${dev ? `addr ${dev.addr} · status ${dev.last_status}` : 'addr --'}</small>
      <small>${dev ? `errors ${dev.error_count}${dev.probed ? '' : ' · not probed'}` : 'enable debug for presence'}</small></div>`;
  }).join('');
  const pill = $('dmDebugPill');
  if (!d) { pill.textContent = 'debug --'; $('dmDebugDetail').textContent = 'waiting for telemetry'; return; }
  pill.textContent = d.enabled ? 'debug ON (v5)' : 'debug OFF';
  pill.className = `status-pill ${d.enabled ? 'online' : ''}`;
  $('dmDebugDetail').textContent = d.enabled
    ? `scan ${d.scan_period_ms} ms · probe every ${d.probe_period_ms} ms · I²C cycle ${d.i2c_cycle_ms ?? '--'} ms · present mask 0x${d.present_mask.toString(16)}`
    : `firmware sending ${d.packet_format || 'non-debug'} packets`;
}

function renderLink() {
  const r = analyzeWindow(state.events, state.commands, { periodMs: state.debug?.scan_period_ms || 1000, windowMs: 300000, now: Date.now() - state.skew, buckets: 60 });
  const s = r.summary; const ia = s.inter_arrival_ms; const f = (v, u = '') => (v === null || v === undefined ? '--' : `${v}${u}`);
  $('dmLhPackets').textContent = `${s.packets_received} / ${s.lost}`;
  $('dmLhLoss').textContent = `loss ${f(s.loss_pct, '%')} · dup ${s.duplicates} · ooo ${s.out_of_order}`;
  $('dmLhInterval').textContent = `${f(ia.p50)} / ${f(ia.p95)} ms`;
  $('dmLhJitter').textContent = `jitter ${f(s.rfc3550_jitter_ms, ' ms')}`;
  const l = state.link;
  $('dmLhRssi').textContent = l?.rssi_dbm === null || l?.rssi_dbm === undefined ? 'n/a' : `${l.rssi_dbm} dBm`;
  $('dmLhRssiDetail').textContent = s.rssi_dbm ? `min ${s.rssi_dbm.min} · mean ${s.rssi_dbm.mean}` : 'needs debug (v5) packets';
  $('dmLhAck').textContent = l ? (l.last_ack_rtt_ms === null ? 'timeout' : `${l.last_ack_rtt_ms} ms`) : '--';
  $('dmLhLinkErr').textContent = l ? `tx err ${l.tx_errors} · ack timeouts ${l.ack_timeouts}` : '--';
  $('dmLhCmd').textContent = f(s.commands.rtt_ms.p50, ' ms');
  $('dmLhCmdDetail').textContent = `${s.commands.completed} ok · ${s.commands.failed} failed · ${s.commands.timed_out} timeout`;
  $('dmLhReconnects').textContent = l ? String(l.wifi_reconnects) : '--';
  $('dmLhUptime').textContent = l ? `uptime ${(l.uptime_ms / 1000).toFixed(0)} s` : '--';
  drawRssi(r);
}

function drawRssi(r) {
  const c = $('dmLhChart'); if (!c) return;
  const dpr = window.devicePixelRatio || 1; const w = c.clientWidth || 600; const h = c.clientHeight || 120;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h); g.font = '11px Arial'; g.fillStyle = '#ede8d9';
  const pts = r.rows.filter((x) => x.inter_arrival_ms !== '').map((x) => [x.arrival_ms, x.inter_arrival_ms]);
  g.fillText('packet inter-arrival (ms), last 5 min', 8, 12);
  if (!pts.length) { g.fillText('no data', 8, h / 2); return; }
  const hi = Math.max(...pts.map((p) => p[1])) * 1.1 || 1;
  const x = (t) => 40 + ((t - r.start) / (r.end - r.start)) * (w - 50); const y = (v) => 18 + (1 - v / hi) * (h - 30);
  g.fillText(hi.toFixed(0), 4, 24); g.fillText('0', 4, h - 10);
  g.strokeStyle = '#d4af37'; g.lineWidth = 1.5; g.beginPath();
  pts.forEach(([t, v], i) => (i ? g.lineTo(x(t), y(v)) : g.moveTo(x(t), y(v)))); g.stroke();
}

function render() {
  const st = state.status;
  const fresh = st?.telemetry_connected;
  $('dmStatus').textContent = !state.sseOpen ? 'Bridge unreachable' : fresh ? 'ESP32 connected' : 'No fresh telemetry';
  $('dmStatus').className = `status-pill ${state.sseOpen && fresh ? 'online' : 'offline'}`;
  renderTiles(); renderLink(); updateControls();
}

function onEvent(ev) {
  if (ev.type === 'status') {
    state.status = { ...(state.status || {}), ...ev };
    if (ev.server_time) state.skew = Date.now() - Date.parse(ev.server_time);
    if ('debug_mode' in ev) state.debug = ev.debug_mode;
    return;
  }
  if (ev.type === 'command_status' && ['completed', 'failed', 'timed_out'].includes(ev.status)) {
    const t = Date.parse(ev.updated_at);
    if (Date.now() - state.skew - t > REPLAY_AGE_MS) return;
    state.commands.push({ t, status: ev.status, rtt: Number.isFinite(ev.round_trip_ms) ? ev.round_trip_ms : null });
    return;
  }
  if (ev.type !== 'telemetry' || ev.source !== 'udp') return;
  const pkt = ev.packet || {}; const t = Date.parse(ev.received_at);
  const key = `${ev.received_at}|${pkt.seq}`;
  if (!Number.isFinite(t) || key === state.lastKey || Date.now() - state.skew - t > REPLAY_AGE_MS) return;
  state.lastKey = key;
  if (pkt.debug) state.debug = { ...pkt.debug, link: pkt.link };
  else if (state.debug?.enabled) state.debug = { enabled: false, packet_format: pkt.packet_format };
  state.link = pkt.link || null;
  const rssi = Number.isFinite(pkt.link?.rssi_dbm) ? pkt.link.rssi_dbm : null;
  state.events.push({ t, seq: Number.isInteger(pkt.seq) ? pkt.seq : null, bytes: ev.network?.bytes || 0, ...(rssi !== null ? { rssi } : {}) });
  while (state.events.length && state.events[0].t < t - 300000) state.events.shift();
}

async function pollHealth() {
  try {
    const j = await (await apiFetch($('dmHealthUrl').value.trim(), { cache: 'no-store' })).json();
    state.status = { ...(state.status || {}), ...j };
    if (j.debug_mode !== undefined && (!state.debug || j.debug_mode)) state.debug = j.debug_mode;
    if (j.server_time) state.skew = Date.now() - Date.parse(j.server_time);
  } catch { /* optional */ }
}

function connect() {
  disconnect(false);
  state.es = new EventSource($('dmStreamUrl').value.trim());
  state.es.addEventListener('open', () => { state.sseOpen = true; $('dmConnect').textContent = 'Disconnect'; log('INFO', 'event stream connected'); });
  state.es.addEventListener('error', () => { state.sseOpen = false; });
  state.es.addEventListener('message', (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore */ } });
  pollHealth(); state.healthTimer = setInterval(pollHealth, 5000);
}

function disconnect(updateButton = true) {
  if (state.es) { state.es.close(); state.es = null; }
  clearInterval(state.healthTimer); state.sseOpen = false;
  if (updateButton && $('dmConnect')) $('dmConnect').textContent = 'Connect';
}

export async function initDebugModePage() {
  try { state.map = await (await apiFetch('./assets/data/register-map.json?v=20261027c')).json(); }
  catch { state.map = { devices: [] }; log('ERR', 'register map failed to load'); }
  $('dmDevice').innerHTML = state.map.devices.map((d) => `<option value="${d.addr}">${d.addr}  ${d.name}</option>`).join('');
  fillRegisters();
  $('dmDevice').addEventListener('change', fillRegisters);
  $('dmRegister').addEventListener('change', showRegInfo);
  $('dmAddRegister').addEventListener('click', addRegister);
  $('dmToken').addEventListener('input', updateControls);
  $('dmConnect').addEventListener('click', () => (state.es ? disconnect() : connect()));
  $('dmRead').addEventListener('click', readRegister);
  $('dmWrite').addEventListener('click', writeRegister);
  $('dmDebugOn').addEventListener('click', () => runSimple({ type: 'debug_control', enabled: true }));
  $('dmDebugOff').addEventListener('click', () => runSimple({ type: 'debug_control', enabled: false }));
  $('dmPeriodApply').addEventListener('click', () => {
    const ms = Number($('dmPeriod').value);
    if (!Number.isInteger(ms) || ms < 200 || ms > 5000) { log('ERR', 'scan period must be an integer 200..5000 ms'); return; }
    runSimple({ type: 'set_scan_period', period_ms: ms });
  });
  $('dmScan').addEventListener('click', () => runSimple({ type: 'i2c_scan' }, showScan));
  $('dmSeqRun').addEventListener('click', runSequence);
  $('dmSeqStop').addEventListener('click', () => { state.stop = true; });
  $('dmLogDownload').addEventListener('click', downloadLog);
  $('dmLogClear').addEventListener('click', () => { state.log = []; $('dmLog').textContent = ''; });
  const p = new URLSearchParams(location.search);
  for (const [q, id] of [['dmstream', 'dmStreamUrl'], ['dmhealth', 'dmHealthUrl'], ['dmcommand', 'dmCommandUrl']]) if (p.get(q)) $(id).value = p.get(q);
  connect();
  state.timer = setInterval(render, 1000); render();
  $('dmStreamToggle').addEventListener('change', (e) => { setStreamingMode(e.target.checked); applyStreamingToggle(e.target.checked); log('INFO', `Streaming Telemetry ${e.target.checked ? 'on' : 'off'}`); });
  applyStreamingToggle(isStreamingMode());
}

export function destroyDebugModePage() { disconnect(); clearInterval(state.timer); if (streamView) { streamView.destroy(); streamView = null; } }
export { state as debugModeState };
