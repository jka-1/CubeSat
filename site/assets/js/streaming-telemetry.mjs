// Streaming Telemetry: shared state + conversions for the Debug Mode page and the I²C telemetry page.
// Pure model (testable in Node) plus a small browser stream manager (one EventSource shared by all subscribers).
import { normalizePeripheralTelemetry } from './telemetry-model.mjs?v=20261019b';

export const STREAM_MODE_KEY = 'cubesat.streamingTelemetry';
export const STREAM_URL_KEY = 'cubesat.streamingTelemetry.url';
export const STREAM_WINDOW_KEY = 'cubesat.streamingTelemetry.windowMs';
export const DEFAULT_STALE_MS = 5000;
export const MAX_HISTORY_MS = 60 * 60 * 1000;
export const WINDOWS = [{ ms: 60_000, label: '1 min' }, { ms: 300_000, label: '5 min' }, { ms: 900_000, label: '15 min' }, { ms: 3_600_000, label: '60 min' }];

export const DEVICES = Object.freeze([
  { key: 'pv', label: 'PV / INA226', addr: '0x40', mask: 0x01 },
  { key: 'bms', label: 'BMS / BQ76942', addr: '0x08', mask: 0x02 },
  { key: 'mppt', label: 'MPPT / BQ25798', addr: '0x6B', mask: 0x04 }
]);
// Packet cells (v3+ words 9-12) are BQ76942 cells 1-4 (direct commands 0x14/0x16/0x18/0x1A).
// Firmware before the v6 update packed cell 10 (0x26) into word 12; v6 firmware packs the real cell 4.
export const BMS_CELL_LABELS = ['Cell 1', 'Cell 2', 'Cell 3', 'Cell 4'];
// BQ25798 REG20 FAULT_Status_0 bit order, same default names as telemetry-bridge/server.js.
export const MPPT_FAULT_BITS = ['VAC1_OVP_STAT', 'VAC2_OVP_STAT', 'CONV_OCP_STAT', 'BAT_OCP_STAT',
  'IBUS_OCP_STAT', 'VBAT_OVP_STAT', 'VBUS_OVP_STAT', 'BAT_REG_STAT'];
export const INA226_BUS_LSB_V = 0.00125; // INA226 bus-voltage register: 1.25 mV/LSB

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------------------------------------------------------------- persistence
function store(storage) { try { return storage ?? globalThis.localStorage ?? null; } catch { return null; } }
export function isStreamingMode(storage) { return store(storage)?.getItem(STREAM_MODE_KEY) === 'on'; }
export function setStreamingMode(on, storage) {
  const s = store(storage); if (s) s.setItem(STREAM_MODE_KEY, on ? 'on' : 'off');
  globalThis.dispatchEvent?.(new CustomEvent('streaming-telemetry-mode', { detail: { on: !!on } }));
}
export function getStoredWindowMs(storage) { const v = Number(store(storage)?.getItem(STREAM_WINDOW_KEY)); return WINDOWS.some((w) => w.ms === v) ? v : 300_000; }
export function setStoredWindowMs(ms, storage) { store(storage)?.setItem(STREAM_WINDOW_KEY, String(ms)); }

// ---------------------------------------------------------------- presence
// Returns {key: {state, visible, source}}. state: present | absent | error | paused | not_polled | unknown.
export function deviceVisibility(packet) {
  const out = {};
  const debug = packet?.debug;
  const mask = Number.isInteger(packet?.sensor_polling?.active_sensor_mask) ? packet.sensor_polling.active_sensor_mask : null;
  for (const d of DEVICES) {
    const t = packet?.telemetry?.[d.key];
    let state; let source;
    if (debug && debug.devices?.[d.key]) {
      source = 'v5';
      state = debug.devices[d.key].state || 'unknown';
      if (state === 'unknown' && !debug.devices[d.key].probed) state = 'present'; // not probed yet: data words are live
    } else if (mask !== null) {
      source = 'polling-mask';
      state = (mask & d.mask) ? 'present' : 'not_polled';
    } else {
      source = 'assumed';
      state = 'present';
    }
    if (t && t.available === false) state = state === 'present' ? 'absent' : state;
    if (!t) state = 'absent';
    out[d.key] = { state, visible: state === 'present', source };
  }
  return out;
}

// ---------------------------------------------------------------- conversions
export function decodeDevices(packet) {
  const t = packet?.telemetry || {}; const raw = packet?.raw || {};
  const pv = t.pv || {};
  const busRaw = num(raw.pv?.bus);
  const cells = Array.isArray(t.bms?.cellVoltagesV) ? t.bms.cellVoltagesV.slice(0, 4).map(num) : [null, null, null, null];
  const valid = cells.filter((v) => v !== null);
  const fault20 = Number.isInteger(raw.mppt?.fault20) ? raw.mppt.fault20 : null;
  const activeNames = new Set(Array.isArray(t.mppt?.faults) ? t.mppt.faults : []);
  const faults = MPPT_FAULT_BITS.map((name, bit) => ({ name, bit, active: fault20 !== null ? ((fault20 >> bit) & 1) === 1 : activeNames.has(name) }));
  for (const n of activeNames) if (!MPPT_FAULT_BITS.includes(n)) faults.push({ name: n, bit: null, active: true });
  const per = normalizePeripheralTelemetry(t);
  const m = t.mppt || {};
  const currentA = num(pv.currentA); const powerW = num(pv.powerW);
  const adcGpio = t.adc || null;
  return {
    pv: {
      // INA226 0x02 bus voltage (1.25 mV/LSB), 0x03 power (25 x Current_LSB), 0x04 current (Current_LSB)
      busV: pv.available === false ? null : num(pv.busVoltageV) ?? (busRaw === null ? null : +(busRaw * INA226_BUS_LSB_V).toFixed(5)),
      currentA, powerW, shuntMv: num(pv.shuntVoltageMv),
      currentMa: currentA === null ? null : +(currentA * 1000).toFixed(3),
      powerMw: powerW === null ? null : +(powerW * 1000).toFixed(3)
    },
    bms: {
      cells: cells.map((v, i) => ({ label: BMS_CELL_LABELS[i], v })),
      minV: valid.length ? Math.min(...valid) : null,
      maxV: valid.length ? Math.max(...valid) : null,
      deltaMv: valid.length ? Math.round((Math.max(...valid) - Math.min(...valid)) * 1000) : null,
      packV: num(t.bms?.packVoltageV), // 0x36 PACK pin voltage (v6 packets only)
      intTempC: num(t.bms?.internalTempC), // 0x68 internal temperature (v6 packets only)
      hasExt: t.bms?.packVoltageV !== undefined || t.bms?.internalTempC !== undefined
    },
    mppt: {
      acdrv: t.mppt?.switchState ?? null,
      reg13: Number.isInteger(raw.mppt?.reg13) ? raw.mppt.reg13 : null,
      fault20,
      faults,
      activeFaults: faults.filter((f) => f.active).length,
      // BQ25798 power path ADC (v6 packets only): REG31 IBUS, REG35 VBUS, REG37 VAC1, REG3B VBAT, REG3D VSYS, REG41 TDIE
      ibusMa: num(m.ibusA) === null ? null : +(num(m.ibusA) * 1000).toFixed(0),
      vbusV: num(m.vbusV), vac1V: num(m.vac1V), vbatV: num(m.vbatV), vsysV: num(m.vsysV),
      dieTempC: num(m.dieTempC), adcEnabled: typeof m.adcEnabled === 'boolean' ? m.adcEnabled : null,
      hasExt: m.vbusV !== undefined
    },
    mcu: { tempC: num(t.mcu?.temperatureC) },
    peripheral: per,
    // The two ADC1 devices: TEMP_OUT (MCP9700) and LIGHT_OUT (TEMT6000).
    adc: {
      temp: { tempC: per.temperatureC, mv: num(t.peripheral?.temperatureVoltageMv), saturated: per.temperatureSaturated, gpio: adcGpio?.temp?.gpio ?? null },
      light: { level: per.lightLevel, relative: per.relativeLightLevel, mv: per.lightVoltageMv, saturated: per.lightSaturated, gpio: adcGpio?.light?.gpio ?? null },
      gpiosKnown: !!adcGpio
    }
  };
}

// Series keys drawn as sparklines.
export const SERIES = {
  'pv.busV': (d) => d.pv.busV, 'pv.currentA': (d) => d.pv.currentA, 'pv.powerW': (d) => d.pv.powerW, 'pv.shuntMv': (d) => d.pv.shuntMv,
  'pv.currentMa': (d) => d.pv.currentMa, 'pv.powerMw': (d) => d.pv.powerMw,
  'bms.packV': (d) => d.bms.packV, 'bms.intTempC': (d) => d.bms.intTempC,
  'mppt.ibusMa': (d) => d.mppt.ibusMa, 'mppt.vbusV': (d) => d.mppt.vbusV, 'mppt.vac1V': (d) => d.mppt.vac1V,
  'mppt.vbatV': (d) => d.mppt.vbatV, 'mppt.vsysV': (d) => d.mppt.vsysV, 'mppt.dieTempC': (d) => d.mppt.dieTempC,
  'per.tempMv': (d) => d.adc.temp.mv, 'per.lightMv': (d) => d.adc.light.mv,
  'bms.cell0': (d) => d.bms.cells[0].v, 'bms.cell1': (d) => d.bms.cells[1].v, 'bms.cell2': (d) => d.bms.cells[2].v,
  'bms.cell3': (d) => d.bms.cells[3].v, 'bms.deltaMv': (d) => d.bms.deltaMv,
  'mppt.faults': (d) => d.mppt.activeFaults,
  'mcu.tempC': (d) => d.mcu.tempC, 'per.tempC': (d) => d.peripheral.temperatureC, 'per.light': (d) => d.peripheral.lightVoltageMv
};
const SERIES_DEVICE = (k) => k.split('.')[0];

// ---------------------------------------------------------------- model
export class StreamingModel {
  constructor({ staleMs = DEFAULT_STALE_MS, maxHistoryMs = MAX_HISTORY_MS } = {}) {
    this.staleMs = staleMs; this.maxHistoryMs = maxHistoryMs; this.reset();
  }
  reset() {
    this.latest = null; this.decoded = null; this.visibility = null; this.lastReceivedAt = null;
    this.skewMs = 0; this.status = null; this.series = Object.fromEntries(Object.keys(SERIES).map((k) => [k, []]));
    this.lastKey = null; this.packets = 0; this.connected = false;
  }
  // Ingest one SSE JSON event. `now` = client clock ms. Returns true if the view should update.
  ingest(ev, now = Date.now()) {
    if (!ev || typeof ev !== 'object') return false;
    if (ev.type === 'status') {
      this.status = ev;
      if (ev.server_time) this.skewMs = now - Date.parse(ev.server_time);
      if (Number.isFinite(ev.telemetry_stale_after_ms)) this.staleMs = ev.telemetry_stale_after_ms;
      return true;
    }
    if (ev.type !== 'telemetry' || !ev.packet) return false;
    const t = Date.parse(ev.received_at);
    if (!Number.isFinite(t)) return false;
    const key = `${ev.received_at}|${ev.packet.seq}`;
    if (key === this.lastKey) return false; // replay of the same envelope after an SSE reconnect
    this.lastKey = key;
    this.latest = ev; this.lastReceivedAt = t; this.packets++;
    this.visibility = deviceVisibility(ev.packet);
    this.decoded = decodeDevices(ev.packet);
    for (const [k, f] of Object.entries(SERIES)) {
      const dev = SERIES_DEVICE(k);
      const visible = this.visibility[dev] ? this.visibility[dev].visible : true;
      const v = visible ? f(this.decoded) : null;
      const arr = this.series[k];
      arr.push([t, v === null || v === undefined ? null : v]);
      while (arr.length && arr[0][0] < t - this.maxHistoryMs) arr.shift();
    }
    return true;
  }
  serverNow(now = Date.now()) { return now - this.skewMs; }
  ageMs(now = Date.now()) { return this.lastReceivedAt === null ? null : Math.max(0, this.serverNow(now) - this.lastReceivedAt); }
  isStale(now = Date.now()) { const a = this.ageMs(now); return a === null || a > this.staleMs; }
  seriesWindow(key, windowMs, now = Date.now()) {
    const end = this.serverNow(now); const start = end - windowMs;
    return { start, end, points: (this.series[key] || []).filter((p) => p[0] >= start) };
  }
  // View snapshot: only present devices are listed in `devices`; the rest are summarized in `hidden`.
  snapshot(now = Date.now()) {
    const pkt = this.latest?.packet || null;
    const stale = this.isStale(now);
    const vis = this.visibility || {};
    const devices = []; const hidden = [];
    for (const d of DEVICES) {
      const v = vis[d.key];
      if (!v) continue;
      if (v.visible) devices.push({ ...d, state: stale ? 'stale' : 'present', source: v.source, data: this.decoded[d.key] });
      else hidden.push({ ...d, state: v.state, source: v.source });
    }
    const per = this.decoded?.peripheral || null;
    return {
      hasData: !!pkt, stale, ageMs: this.ageMs(now), packets: this.packets,
      format: pkt?.packet_format || null, seq: pkt?.seq ?? null,
      debug: pkt?.debug || null, link: pkt?.link || null,
      devices, hidden,
      mcu: this.decoded && this.decoded.mcu.tempC !== null ? this.decoded.mcu : null,
      peripheral: per && (per.temperatureC !== null || per.lightVoltageMv !== null) ? per : null,
      adc: per && (per.temperatureC !== null || per.lightVoltageMv !== null) ? this.decoded.adc : null,
      bridgeConnected: this.status ? !!this.status.telemetry_connected : null
    };
  }
}

// ---------------------------------------------------------------- browser stream manager
const shared = { es: null, url: null, model: new StreamingModel(), subs: new Set(), open: false, timer: null };
export function sharedModel() { return shared.model; }
export function streamUrl(storage) { return store(storage)?.getItem(STREAM_URL_KEY) || '/telemetry/events'; }
export function isStreamOpen() { return shared.open; }

function notify() { for (const fn of shared.subs) { try { fn(shared.model, { open: shared.open }); } catch (e) { console.error(e); } } }

function ensureStream(url) {
  if (shared.es && shared.url === url) return;
  if (shared.es) shared.es.close();
  if (shared.url !== url) shared.model.reset();
  shared.url = url; shared.open = false;
  if (typeof EventSource === 'undefined') return;
  shared.es = new EventSource(url);
  shared.es.addEventListener('open', () => { shared.open = true; notify(); });
  shared.es.addEventListener('error', () => { shared.open = false; notify(); });
  shared.es.addEventListener('message', (m) => { try { if (shared.model.ingest(JSON.parse(m.data))) notify(); } catch { /* ignore malformed */ } });
  clearInterval(shared.timer); shared.timer = setInterval(notify, 1000); // age / stale ticking
}

// Subscribe a view; returns an unsubscribe function. The EventSource closes when the last subscriber leaves.
export function subscribe(fn, url = streamUrl()) {
  store()?.setItem(STREAM_URL_KEY, url);
  shared.subs.add(fn); ensureStream(url); fn(shared.model, { open: shared.open });
  return () => {
    shared.subs.delete(fn);
    if (!shared.subs.size) { shared.es?.close(); shared.es = null; shared.open = false; clearInterval(shared.timer); }
  };
}
