// Streaming Telemetry view: present-only device cards with sparklines, driven by streaming-telemetry.mjs.
// Shared by the Debug Mode page and the I²C telemetry page. Vanilla DOM + canvas.
import { WINDOWS, getStoredWindowMs, setStoredWindowMs, subscribe } from './streaming-telemetry.mjs?v=20261019b';

const CELL_RANGE = { min: 3.0, max: 4.3 };
const CELL_REGS = ['0x14', '0x16', '0x18', '0x1A'];

// Per-card visibility toggles (by IC / ADC device), persisted in localStorage. Default: all on.
export const CARD_TOGGLES = [
  { key: 'pv', label: 'INA226' }, { key: 'bms', label: 'BQ76942' }, { key: 'mppt', label: 'BQ25798' },
{ key: 'mcp9700', label: 'MCP9700' }, { key: 'temt6000', label: 'TEMT6000' }
];
export const CARD_TOGGLE_KEY = 'cubesat.streamingCards';
function toggleStore(storage) { try { return storage ?? globalThis.localStorage ?? null; } catch { return null; } }
export function getCardToggles(storage) {
  let saved = {};
  try { saved = JSON.parse(toggleStore(storage)?.getItem(CARD_TOGGLE_KEY) || '{}') || {}; } catch { saved = {}; }
  return Object.fromEntries(CARD_TOGGLES.map((t) => [t.key, saved[t.key] !== false]));
}
export function setCardToggle(key, on, storage) {
  const next = { ...getCardToggles(storage), [key]: !!on };
  toggleStore(storage)?.setItem(CARD_TOGGLE_KEY, JSON.stringify(next));
  return next;
}
const fmt = (v, d = 2, u = '') => (v === null || v === undefined || !Number.isFinite(v) ? '--' : `${v.toFixed(d)}${u}`);
// Auto-scaled SI formatting for small currents / powers (A -> mA -> uA, W -> mW -> uW) at constant width.
export function fmtSI(v, unit) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  const a = Math.abs(v);
  if (a === 0 || a >= 1) return `${v.toFixed(3)} ${unit}`;
  if (a >= 1e-3) return `${(v * 1e3).toFixed(2)} m${unit}`;
  return `${(v * 1e6).toFixed(1)} µ${unit}`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function css(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }

export function drawSparkline(canvas, series, { color } = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth || 120; const h = canvas.clientHeight || 30;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const pts = series.points.filter((p) => p[1] !== null && Number.isFinite(p[1]));
  if (pts.length < 2) { g.fillStyle = 'rgba(237,232,217,0.35)'; g.fillRect(0, h / 2, w, 1); return; }
  let lo = Math.min(...pts.map((p) => p[1])); let hi = Math.max(...pts.map((p) => p[1]));
  if (hi - lo < 1e-9) { hi += Math.abs(hi) * 0.01 + 0.001; lo -= Math.abs(lo) * 0.01 + 0.001; }
  // Fit the x axis to the data while history is shorter than the window (no squashed sparklines after connect).
  const start = Math.max(series.start, series.points[0][0]); const span = Math.max(1, series.end - start);
  const x = (t) => ((t - start) / span) * (w - 4) + 2;
  const y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (h - 6);
  const c = color || css('--gold', '#d4af37');
  g.strokeStyle = c; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath();
  let pen = false;
  for (const [t, v] of series.points) {
    if (v === null || !Number.isFinite(v)) { pen = false; continue; }
    if (pen) g.lineTo(x(t), y(v)); else { g.moveTo(x(t), y(v)); pen = true; }
  }
  g.stroke();
  const last = pts[pts.length - 1]; g.fillStyle = c; g.beginPath(); g.arc(x(last[0]), y(last[1]), 2.2, 0, 7); g.fill();
}

const metric = (key, label, unit, digits) => ({ key, label, unit, digits });
const PV_METRICS = [metric('pv.busV', 'Bus voltage · 0x02', ' V', 3), metric('pv.powerMw', 'Power · 0x03', ' mW', 2),
  metric('pv.currentMa', 'Current · 0x04', ' mA', 2), metric('pv.shuntMv', 'Shunt · 0x01', ' mV', 3)];
const BMS_EXT = [metric('bms.packV', 'Pack voltage · 0x36', ' V', 2), metric('bms.intTempC', 'Internal temp · 0x68', ' °C', 1)];
const MPPT_PATH = [metric('mppt.vbusV', 'VBUS · 0x35', ' V', 3), metric('mppt.vac1V', 'VAC1 · 0x37', ' V', 3),
  metric('mppt.vbatV', 'VBAT · 0x3B', ' V', 3), metric('mppt.vsysV', 'VSYS · 0x3D', ' V', 3),
  metric('mppt.ibusMa', 'IBUS · 0x31', ' mA', 0), metric('mppt.dieTempC', 'Die temp · 0x41', ' °C', 1)];

function metricRow(m) {
  return `<div class="st-metric" data-metric="${m.key}"><span class="st-label">${m.label}</span>
    <strong class="st-value" data-v="${m.key}">--</strong><canvas class="st-spark" data-s="${m.key}"></canvas></div>`;
}

function template() {
  return `
  <div class="st-bar">
    <span class="st-indicator" data-st="indicator"><i></i>Streaming Telemetry</span>
    <span class="st-meta" data-st="meta">waiting for packets</span>
    <span class="st-toggles" data-st="toggles">${CARD_TOGGLES.map((t) => `<label class="st-toggle"><input type="checkbox" data-toggle="${t.key}" checked />${t.label}</label>`).join('')}</span>
    <label class="st-window">Window <select data-st="window">${WINDOWS.map((w) => `<option value="${w.ms}">${w.label}</option>`).join('')}</select></label>
  </div>
  <div class="st-hidden" data-st="hidden"></div>
  <div class="st-empty" data-st="empty">No data</div>
  <div class="st-grid">
    <section class="st-card" data-card="pv" hidden>
      <header><h4>PV · INA226</h4><small>0x40</small><span class="st-age" data-age></span></header>
      ${PV_METRICS.map(metricRow).join('')}
    </section>
    <section class="st-card" data-card="bms" hidden>
      <header><h4>BMS · BQ76942</h4><small>0x08</small><span class="st-age" data-age></span></header>
      <div class="st-cells">${[0, 1, 2, 3].map((i) => `
        <div class="st-cell"><span class="st-label"><span data-cell-label="${i}">Cell</span> · ${CELL_REGS[i]}</span>
          <div class="st-gauge"><i data-gauge="${i}"></i></div>
          <strong class="st-value" data-v="bms.cell${i}">--</strong><canvas class="st-spark" data-s="bms.cell${i}"></canvas></div>`).join('')}
      </div>
      <div class="st-stats"><span>min <b data-v="bms.min">--</b></span><span>max <b data-v="bms.max">--</b></span>
        <span>Δ <b data-v="bms.deltaMv">--</b></span></div>
      ${BMS_EXT.map(metricRow).join('')}
      <div class="st-metric"><span class="st-label">Cell spread</span><strong class="st-value" data-v="bms.deltaMv2">--</strong><canvas class="st-spark" data-s="bms.deltaMv"></canvas></div>
    </section>
    <section class="st-card" data-card="mppt" hidden>
      <header><h4>MPPT · BQ25798</h4><small>0x6B</small><span class="st-age" data-age></span></header>
      <div class="st-acdrv"><span class="st-label">ACDRV path · 0x13</span><strong data-v="mppt.acdrv" class="st-pill">--</strong>
        <small data-v="mppt.reg13">REG13 --</small></div>
      <div class="st-faults" data-v="mppt.faults"></div>
      <div class="st-metric"><span class="st-label">Active faults · 0x20</span><strong class="st-value" data-v="mppt.activeFaults">--</strong><canvas class="st-spark" data-s="mppt.faults"></canvas></div>
      <h5 class="st-sub">Power path</h5>
      <div class="st-path">
        <div class="st-flow"><span>VAC1 <b data-v="mppt.vac1">--</b></span><i>→</i><span>VBUS <b data-v="mppt.vbus">--</b></span><i>→</i><span>VSYS <b data-v="mppt.vsys">--</b></span><i>→</i><span>VBAT <b data-v="mppt.vbat">--</b></span></div>
        ${MPPT_PATH.map(metricRow).join('')}
      </div>
    </section>
    <section class="st-card st-small" data-card="peripheral" hidden>
      <header><h4>ADC devices</h4><small>ESP32-S3 ADC1</small></header>
      <div data-per="temp"><h5 class="st-sub">MCP9700 · TEMP_OUT <small data-v="adc.tempGpio">GPIO1</small></h5>
        ${metricRow(metric('per.tempC', 'Temperature', ' °C', 1))}${metricRow(metric('per.tempMv', 'Output', ' mV', 0))}</div>
      <div data-per="light"><h5 class="st-sub">TEMT6000 · LIGHT_OUT <small data-v="adc.lightGpio">GPIO2</small></h5>
        ${metricRow(metric('per.light', 'Light level', '', 0))}</div>
    </section>
  </div>`;
}

const ACDRV_TEXT = { acdrv1: 'ACDRV1 · VIN1', acdrv2: 'ACDRV2 · VIN2', both: 'BOTH ON', off: 'OFF' };
const HIDDEN_TEXT = { absent: 'absent', error: 'bus error', paused: 'paused', not_polled: 'not polled', unknown: 'unknown' };

// Mount the view into `root`. Returns {destroy}. Options: url (SSE), compact.
export function mountStreamingView(root, { url } = {}) {
  root.classList.add('st-root'); root.innerHTML = template();
  const $ = (sel) => root.querySelector(sel); const $$ = (sel) => [...root.querySelectorAll(sel)];
  const win = $('[data-st="window"]'); win.value = String(getStoredWindowMs());
  win.addEventListener('change', () => { setStoredWindowMs(Number(win.value)); last && render(last.model, last.info); });
  const set = (k, text) => { const el = root.querySelector(`[data-v="${k}"]`); if (el && el.textContent !== text) el.textContent = text; };
  let last = null;
  let toggles = getCardToggles();
  $$('[data-toggle]').forEach((box) => {
    box.checked = toggles[box.dataset.toggle];
    box.addEventListener('change', () => { toggles = setCardToggle(box.dataset.toggle, box.checked); last && render(last.model, last.info); });
  });

  function render(model, info) {
    last = { model, info };
    const now = Date.now(); const snap = model.snapshot(now); const windowMs = Number(win.value);
    const ind = $('[data-st="indicator"]');
    const live = info.open && snap.hasData && !snap.stale;
    ind.className = `st-indicator ${live ? 'live' : snap.hasData ? 'stale' : 'off'}`;
    ind.lastChild.textContent = live ? 'Streaming Telemetry · live' : !info.open ? 'Streaming Telemetry · stream closed' : snap.hasData ? 'Streaming Telemetry · STALE' : 'Streaming Telemetry · waiting';
    const age = snap.ageMs === null ? '--' : snap.ageMs < 10000 ? `${snap.ageMs} ms` : `${(snap.ageMs / 1000).toFixed(1)} s`;
    $('[data-st="meta"]').textContent = snap.hasData ? `${snap.format} · seq ${snap.seq} · last update ${age} ago · ${snap.packets} packets` : 'waiting for packets';
    root.classList.toggle('st-is-stale', snap.hasData && snap.stale);
    $('[data-st="hidden"]').innerHTML = snap.hidden.map((d) => `<span class="st-chip ${d.state}">${esc(d.label)} · ${HIDDEN_TEXT[d.state] || d.state}</span>`).join('');
    $('[data-st="empty"]').hidden = !snap.hasData || snap.devices.length > 0 || !!snap.peripheral;
    const visible = new Set(snap.devices.map((d) => d.key));
    for (const key of ['pv', 'bms', 'mppt']) $(`[data-card="${key}"]`).hidden = !visible.has(key) || !toggles[key];
    $('[data-card="peripheral"]').hidden = !snap.peripheral || (!toggles.mcp9700 && !toggles.temt6000);
    $$('[data-age]').forEach((el) => { el.textContent = age; });
    for (const d of snap.devices) {
      const x = d.data;
      if (d.key === 'pv') {
        set('pv.busV', fmt(x.busV, 3, ' V')); set('pv.currentMa', fmt(x.currentMa, 2, ' mA'));
        set('pv.powerMw', fmt(x.powerMw, 2, ' mW')); set('pv.shuntMv', fmt(x.shuntMv, 3, ' mV'));
      }
      if (d.key === 'bms') {
        x.cells.forEach((c, i) => {
          set(`bms.cell${i}`, fmt(c.v, 3, ' V'));
          root.querySelector(`[data-cell-label="${i}"]`).textContent = c.label;
          const pct = c.v === null ? 0 : Math.max(0, Math.min(100, ((c.v - CELL_RANGE.min) / (CELL_RANGE.max - CELL_RANGE.min)) * 100));
          const gauge = root.querySelector(`[data-gauge="${i}"]`); gauge.style.width = `${pct.toFixed(1)}%`;
          gauge.className = c.v === null ? '' : c.v < 3.2 || c.v > 4.25 ? 'bad' : c.v < 3.5 ? 'warn' : 'ok';
        });
        set('bms.min', fmt(x.minV, 3, ' V')); set('bms.max', fmt(x.maxV, 3, ' V'));
        set('bms.deltaMv', x.deltaMv === null ? '--' : `${x.deltaMv} mV`); set('bms.deltaMv2', x.deltaMv === null ? '--' : `${x.deltaMv} mV`);
        set('bms.packV', fmt(x.packV, 2, ' V')); set('bms.intTempC', fmt(x.intTempC, 1, ' °C'));
      }
      if (d.key === 'mppt') {
        const a = $('[data-v="mppt.acdrv"]'); a.textContent = ACDRV_TEXT[x.acdrv] || (x.acdrv ?? '--');
        a.className = `st-pill ${x.acdrv === 'off' ? 'off' : x.acdrv === 'both' ? 'warn' : 'on'}`;
        set('mppt.reg13', x.reg13 === null ? 'REG13 --' : `REG13 0x${x.reg13.toString(16).toUpperCase().padStart(2, '0')}`);
        const fbox = $('[data-v="mppt.faults"]');
        const html = x.faults.map((f) => `<span class="st-fault ${f.active ? 'lit' : ''}" title="REG20 bit ${f.bit ?? '?'}">${esc(f.name.replace(/_STAT$/, ''))}</span>`).join('');
        if (fbox.innerHTML !== html) fbox.innerHTML = html;
        set('mppt.activeFaults', String(x.activeFaults));
        for (const [k, v] of [['vac1', x.vac1V], ['vbus', x.vbusV], ['vsys', x.vsysV], ['vbat', x.vbatV]]) set(`mppt.${k}`, fmt(v, 2, ' V'));
        set('mppt.vbusV', fmt(x.vbusV, 3, ' V')); set('mppt.vac1V', fmt(x.vac1V, 3, ' V')); set('mppt.vbatV', fmt(x.vbatV, 3, ' V'));
        set('mppt.vsysV', fmt(x.vsysV, 3, ' V')); set('mppt.ibusMa', fmt(x.ibusMa, 0, ' mA')); set('mppt.dieTempC', fmt(x.dieTempC, 1, ' °C'));
      }
    }
    if (snap.peripheral) {
      const p = snap.peripheral;
      $('[data-per="temp"]').hidden = !toggles.mcp9700; $('[data-per="light"]').hidden = !toggles.temt6000;
      set('per.tempC', fmt(p.temperatureC, 1, ' °C'));
      set('per.light', p.lightVoltageMv === null ? '--' : `${p.lightLevel ?? '--'} · ${Math.round(p.lightVoltageMv)} mV`);
      const a = snap.adc;
      if (a) {
        set('per.tempMv', fmt(a.temp.mv, 0, ' mV'));
        if (a.temp.gpio !== null) set('adc.tempGpio', `GPIO${a.temp.gpio}`);
        if (a.light.gpio !== null) set('adc.lightGpio', `GPIO${a.light.gpio}`);
      }
    }
    const color = snap.stale ? 'rgba(237,232,217,0.45)' : null;
    $$('canvas[data-s]').forEach((c) => { if (!c.closest('[hidden]')) drawSparkline(c, model.seriesWindow(c.dataset.s, windowMs, now), { color }); });
  }

  const unsubscribe = subscribe(render, url);
  return { destroy() { unsubscribe(); root.innerHTML = ''; root.classList.remove('st-root'); }, render: () => last && render(last.model, last.info) };
}
