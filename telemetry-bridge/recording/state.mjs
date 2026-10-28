export const SOURCE_LABELS = { pv: 'PV', bat_secondary: 'BAT/secondary' };

// ACDRV is a reported selector state, not an independent measurement of power flow.
export function confirmedSource(packet) {
  const mppt = packet.telemetry?.mppt;
  if (!mppt || mppt.available === false) return null;
  const status = packet.debug?.devices?.mppt?.state;
  if (status && status !== 'present') return null;
  const mask = packet.sensor_polling?.active_sensor_mask;
  if (Number.isInteger(mask) && !(mask & 4)) return null;
  // Require actual register evidence: legacy 'on/off' values are not ACDRV readbacks.
  const reg = packet.raw?.mppt?.reg13;
  if (!Number.isInteger(reg) || reg < 0 || reg > 255) return null;
  const bits = reg & 0xc0;
  if (bits === 0xc0) return null;
  return bits === 0x40 ? 'pv' : 'bat_secondary';
}

export function confirmedMode(packet) {
  if (typeof packet.debug?.enabled === 'boolean') {
    return packet.debug.enabled ? 'debug' : 'live_telemetry';
  }
  if (['hex-v1-raw-ina226', 'hex-v2-engineering', 'hex-v3-validated-raw',
    'hex-v4-peripheral-sensors'].includes(packet.packet_format)) return 'live_telemetry';
  return null;
}

export function transition(previous, mode, source) {
  const modeChanged = mode !== null && mode !== previous.current_mode;
  const sourceChanged = source !== null && previous.current_source !== null && source !== previous.current_source;
  const leavingDebug = modeChanged && previous.current_mode === 'debug' && mode === 'live_telemetry';
  // Never rotate when debug state is unknown. Entering debug keeps the same run.
  const rotate = leavingDebug || (mode === 'live_telemetry' && sourceChanged);
  return { modeChanged, sourceChanged, rotate,
    reason: leavingDebug ? 'debug_exit' : sourceChanged ? 'source_switch' : null };
}

export function packetOrder(previousSequence, sequence) {
  if (!Number.isInteger(previousSequence) || !Number.isInteger(sequence) ||
      previousSequence < 1 || previousSequence > 65535 || sequence < 1 || sequence > 65535) return 'unsequenced';
  const delta = (sequence - previousSequence + 65535) % 65535;
  return delta === 0 ? 'duplicate' : delta > 32767 ? 'out_of_order' : 'forward';
}

export function deviceReboot(previousSequence, sequence, previousUptimeMs, uptimeMs) {
  if (!Number.isInteger(previousSequence) || !Number.isInteger(sequence) ||
      previousSequence < 1 || previousSequence > 65535 || sequence < 1 || sequence > 65535) return false;
  const haveUptime = Number.isSafeInteger(previousUptimeMs) && Number.isSafeInteger(uptimeMs) &&
    previousUptimeMs > 0 && uptimeMs >= 0;
  const uptimeReset = haveUptime && uptimeMs < 120_000 &&
    previousUptimeMs - uptimeMs >= 5_000 && sequence <= 32 && previousSequence > sequence;
  if (haveUptime) return uptimeReset;
  // Live v4 packets do not carry uptime. Only classify a large, non-wrap sequence reset;
  // smaller backwards jumps remain ordinary out-of-order UDP delivery.
  return packetOrder(previousSequence, sequence) === 'out_of_order' &&
    previousSequence > 1024 && previousSequence < 65_000 && sequence <= 32;
}
