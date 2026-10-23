export const RUN_METRICS = Object.freeze([
  { id: 'pv.busVoltageV', label: 'PV bus voltage', unit: 'V', digits: 3 },
  { id: 'pv.currentA', label: 'PV current', unit: 'A', digits: 3 },
  { id: 'pv.powerW', label: 'PV power', unit: 'W', digits: 3 },
  { id: 'bms.cell1V', label: 'BMS cell 1', unit: 'V', digits: 3 },
  { id: 'bms.cell2V', label: 'BMS cell 2', unit: 'V', digits: 3 },
  { id: 'bms.cell3V', label: 'BMS cell 3', unit: 'V', digits: 3 },
  { id: 'bms.cellSlot4V', label: 'BMS cell slot 4', unit: 'V', digits: 3 },
  { id: 'bms.packVoltageV', label: 'BMS pack voltage', unit: 'V', digits: 3 },
  { id: 'mppt.vbusV', label: 'MPPT bus voltage', unit: 'V', digits: 3 },
  { id: 'mppt.vbatV', label: 'MPPT battery voltage', unit: 'V', digits: 3 },
  { id: 'mppt.ibusA', label: 'MPPT bus current', unit: 'A', digits: 3 },
  { id: 'peripheral.temperatureC', label: 'Peripheral temperature', unit: '°C', digits: 1 },
  { id: 'peripheral.lightVoltageMv', label: 'Light sensor voltage', unit: 'mV', digits: 0 }
]);

export const MAX_SERIES_WINDOW_MS = 24 * 60 * 60 * 1000;

export function runEnd(run, now = Date.now()) {
  return Math.max(run.ended_ms ?? now + 1, (run.last_received_ms ?? run.started_ms) + 1);
}

export function windowForPreset(run, preset, now = Date.now()) {
  const fullEnd = runEnd(run, now);
  const lengths = { '30s': 30_000, '1m': 60_000, '5m': 300_000, '15m': 900_000 };
  const length = preset === 'full'
    ? Math.min(MAX_SERIES_WINDOW_MS, fullEnd - run.started_ms)
    : lengths[preset] ?? lengths['1m'];
  return { start: Math.max(run.started_ms, fullEnd - Math.max(1, length)), end: fullEnd };
}

export function runMatches(run, query, filter = 'all') {
  if (filter !== 'all' && filter !== run.status && filter !== run.run_type) return false;
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [run.name, run.id, run.device_id, run.run_type, run.current_source, run.end_reason, run.status]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));
}

export function metricValue(sample, metricId) {
  const packet = sample?.envelope?.packet;
  if (!packet) return null;
  const values = {
    'pv.busVoltageV': packet.telemetry?.pv?.busVoltageV,
    'pv.currentA': packet.telemetry?.pv?.currentA,
    'pv.powerW': packet.telemetry?.pv?.powerW,
    'bms.cell1V': packet.telemetry?.bms?.cellVoltagesV?.[0],
    'bms.cell2V': packet.telemetry?.bms?.cellVoltagesV?.[1],
    'bms.cell3V': packet.telemetry?.bms?.cellVoltagesV?.[2],
    'bms.cellSlot4V': packet.telemetry?.bms?.cellVoltagesV?.[3],
    'bms.packVoltageV': packet.telemetry?.bms?.packVoltageV,
    'mppt.vbusV': packet.telemetry?.mppt?.vbusV,
    'mppt.vbatV': packet.telemetry?.mppt?.vbatV,
    'mppt.ibusA': packet.telemetry?.mppt?.ibusA,
    'peripheral.temperatureC': packet.telemetry?.peripheral?.temperatureC,
    'peripheral.lightVoltageMv': packet.telemetry?.peripheral?.lightVoltageMv
  };
  return Number.isFinite(values[metricId]) ? values[metricId] : null;
}

export function seriesExtent(points) {
  const values = points.flatMap((point) => [point.min, point.max]).filter(Number.isFinite);
  if (!values.length) return null;
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 0.5);
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

export function nearestBucket(points, atMs) {
  if (!points.length) return null;
  return points.reduce((best, point) => {
    const middle = (point.start_ms + point.end_ms) / 2;
    const distance = Math.abs(middle - atMs);
    return distance < best.distance ? { point, distance } : best;
  }, { point: points[0], distance: Infinity }).point;
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h ${minutes}m ${seconds}s` : minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
