// Hex telemetry packet helpers (matches TELEMETRY_PACKET_V1.md / server.js normalizeHexPacketWords).
export const MAGIC = 0x4353;
export const WORDS_BY_VERSION = { 1: 16, 2: 16, 3: 16, 4: 20, 5: 36 }; // v5 = debug-mode packet (v4 words + 16 link/debug words)

export function parseHexPacket(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8').trim() : String(input).trim();
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      return { kind: j.type === 'debug_result' ? 'debug_result' : (j.type || 'json'), json: j,
        seq: Number.isInteger(j.seq ?? j.sequence) ? (j.seq ?? j.sequence) : null };
    } catch { return { kind: 'invalid', error: 'bad json' }; }
  }
  const compact = text.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (!compact || compact.length % 4 !== 0) return { kind: 'invalid', error: 'not whole hex words' };
  const w = [];
  for (let i = 0; i < compact.length; i += 4) w.push(parseInt(compact.slice(i, i + 4), 16));
  if (w[0] !== MAGIC) return { kind: 'invalid', error: 'bad magic' };
  const version = w[1];
  if (WORDS_BY_VERSION[version] !== w.length) return { kind: 'invalid', error: `v${version} wrong length ${w.length}` };
  const out = { kind: 'telemetry', version, seq: w[2], words: w };
  if (version === 5) {
    out.link = {
      rssi_dbm: w[20] & 0x8000 ? w[20] - 0x10000 : w[20],
      uptime_ms: ((w[21] << 16) >>> 0) + w[22],
      tx_errors: w[23], ack_timeouts: w[24], wifi_reconnects: w[25],
      last_ack_rtt_ms: w[35] === 0xffff ? null : w[35],
    };
    out.debug = { enabled: !!(w[26] & 1), presence_detection: !!(w[26] & 2), present_mask: w[27] & 0xff, probed_mask: w[27] >> 8,
      scan_period_ms: w[28], probe_period_ms: w[29], error_counts: [w[30], w[31], w[32]],
      status_codes: [w[33] & 0xf, (w[33] >> 4) & 0xf, (w[33] >> 8) & 0xf], i2c_cycle_ms: w[34] === 0xffff ? null : w[34] / 10 };
    if (out.link.rssi_dbm === -32768) out.link.rssi_dbm = null; // 0x8000 = unavailable
  }
  return out;
}

const KNOWN_GOOD_V4 = '4353000403B30A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507000309C4060E1388';

export function buildV4(seq, template = KNOWN_GOOD_V4) {
  const s = (seq & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return template.slice(0, 8) + s + template.slice(12);
}

// Device groups in v5 masks: bit0 PV/INA226 0x40, bit1 BMS/BQ76942 0x08, bit2 MPPT/BQ25798 0x6B.
// Mirrors main/debug_mode.c debug_mode_build_v5_words(); absent groups carry zero data words.
export function buildV5(seq, link = {}, dbg = {}) {
  const w = [];
  const v4 = buildV4(seq);
  for (let i = 0; i < v4.length; i += 4) w.push(parseInt(v4.slice(i, i + 4), 16));
  w[1] = 5;
  const present = dbg.present_mask ?? 7;
  if (!(present & 1)) for (const i of [4, 5, 6, 7, 8]) w[i] = 0;       // PV cal/shunt/bus/power/current
  if (!(present & 2)) for (const i of [9, 10, 11, 12]) w[i] = 0;       // BMS cells
  if (!(present & 4)) for (const i of [13, 14]) w[i] = 0;               // MPPT reg13/fault20
  w[15] = 0xa500 | (present & 7); // word 15 polled-sensor mask = enabled & present (firmware)
  const rssi = link.rssi_dbm == null ? 0x8000 : link.rssi_dbm & 0xffff;
  const up = (link.uptime_ms ?? 0) >>> 0;
  const st = dbg.status_codes ?? [0, 1, 2].map((i) => (present >> i) & 1 ? 0 : 1);
  w.push(rssi, up >>> 16, up & 0xffff, link.tx_errors ?? 0, link.ack_timeouts ?? 0, link.wifi_reconnects ?? 0,
    (dbg.enabled === false ? 0 : 1) | 2, (present & 0xff) | ((dbg.probed_mask ?? 7) << 8), dbg.scan_period_ms ?? 1000,
    dbg.probe_period_ms ?? 5000, ...(dbg.error_counts ?? [0, 0, 0]), st[0] | (st[1] << 4) | (st[2] << 8),
    dbg.i2c_cycle_tenths ?? 37, link.last_ack_rtt_ms ?? 0xffff);
  return w.map((v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0')).join('');
}
// Normal-mode (v4) packet from firmware with presence detection: absent groups zeroed and cleared in word 15.
export function buildV4Present(seq, present = 7) {
  if (present === 7) return buildV4(seq);
  const w = []; const v4 = buildV4(seq);
  for (let i = 0; i < v4.length; i += 4) w.push(parseInt(v4.slice(i, i + 4), 16));
  if (!(present & 1)) for (const i of [4, 5, 6, 7, 8]) w[i] = 0;
  if (!(present & 2)) for (const i of [9, 10, 11, 12]) w[i] = 0;
  if (!(present & 4)) for (const i of [13, 14]) w[i] = 0;
  w[15] = 0xa500 | (present & 7);
  return w.map((v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0')).join('');
}
export { KNOWN_GOOD_V4 };

// v6 Streaming Telemetry packet (firmware debug mode): v5 + 12 words (see main/debug_mode.c).
// Defaults mirror the register-map sheet bench values: PACK 0x05DA (14.98 V), Int temp 0x0BA3 (24.75 C),
// IBUS 250 mA, VBUS 5.024 V, VAC1 5.040 V, VBAT 14.553 V, VSYS 12.806 V, TDIE 0x26 (19.0 C), REG2E 0xB0.
export function buildV6(seq, link = {}, dbg = {}, s = {}) {
  const w = []; const v5 = buildV5(seq, link, dbg);
  for (let i = 0; i < v5.length; i += 4) w.push(parseInt(v5.slice(i, i + 4), 16));
  w[1] = 6;
  const present = dbg.present_mask ?? 7;
  const bms = (present & 2) !== 0; const mppt = (present & 4) !== 0;
  const adc = s.adc ?? true;
  let f = 0;
  const ext = new Array(12).fill(0xffff); ext[3] = 0x8000; ext[8] = 0x8000; ext[9] = 0;
  if (bms) { f |= 0x3; ext[1] = s.pack ?? 0x05da; ext[2] = s.intTemp ?? 0x0ba3; }
  if (mppt) {
    f |= 0x1fc; ext[3] = (s.ibus ?? 250) & 0xffff; ext[4] = s.vbus ?? 5024; ext[5] = s.vac1 ?? 5040;
    ext[6] = s.vbat ?? 14553; ext[7] = s.vsys ?? 12806; ext[8] = (s.tdie ?? 0x26) & 0xffff; ext[9] = 0xb0;
  }
  if (adc) { f |= 0x600; ext[10] = s.tempMv ?? 750; }
  ext[11] = adc ? (1 | (2 << 8)) : 0xffff;
  ext[0] = f;
  w.push(...ext);
  return w.map((v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0')).join('');
}
