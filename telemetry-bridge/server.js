import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import { Recorder } from './recording/client.mjs';
import { Sessions } from './auth/session.mjs';
import { archivePayload } from './recording/raw.mjs';
import { SignedTelemetryVerifier } from './telemetry-auth.mjs';

const sessions = new Sessions();

const httpPort = readPort('HTTP_PORT', 8080);
const udpPort = readPort('UDP_PORT', 3333);
const httpBindAddress = process.env.HTTP_BIND_ADDRESS || '127.0.0.1';
const udpBindAddress = process.env.UDP_BIND_ADDRESS || '0.0.0.0';
const telemetryToken = process.env.TELEMETRY_TOKEN || '';
const requireSignedTelemetry = readBoolean('REQUIRE_SIGNED_TELEMETRY', false);
const signedTelemetry = new SignedTelemetryVerifier({
  key: process.env.TELEMETRY_HMAC_KEY || '',
  required: requireSignedTelemetry
});
const maxUdpBytes = Number(process.env.MAX_UDP_BYTES || 4096);
const hexDeviceId = process.env.HEX_DEVICE_ID || 'esp32-telemetry';
const hexPacketMagic = 0x4353;
const hexPacketVersionRawIna226 = 0x0001;
const hexPacketVersionEngineering = 0x0002;
const hexPacketVersionValidatedRaw = 0x0003;
const hexPacketVersionPeripheralSensors = 0x0004;
const hexPacketLegacyWordCount = 16;
const hexPacketPeripheralWordCount = 20;
// v5 = v4 + 16 debug words: link stats (RSSI, uptime, tx errors, ACK timeouts, reconnects)
// and per-device presence/status. Sent by the firmware only while debug mode is on.
const hexPacketVersionDebug = 0x0005;
const hexPacketDebugWordCount = 36;
// v6 = v5 + 12 Streaming Telemetry words: BQ76942 PACK pin voltage (0x36) and Int Temperature (0x68),
// BQ25798 power-path ADC (IBUS/VBUS/VAC1/VBAT/VSYS/TDIE, REG2E readback) and the ADC device GPIOs.
const hexPacketVersionStreaming = 0x0006;
// TEMT6000 LIGHT_OUT level bands (same constants as site/assets/js/telemetry-model.mjs).
const lightBrightMinMv = 800;
const lightVeryBrightMinMv = 1800;
function lightLevelFromMv(mv) {
  if (!Number.isFinite(mv)) return null;
  if (mv < lightBrightMinMv) return 'Lightly Lit';
  if (mv <= lightVeryBrightMinMv) return 'Bright';
  return 'Very Bright';
}
const hexPacketStreamingWordCount = 48;
const bmsUserVoltLsbV = readFiniteNumber('BMS_USER_VOLT_LSB_V', 0.01); // BQ76942 userV (DA Configuration), default 10 mV
const debugDeviceGroups = Object.freeze([
  { key: 'pv', label: 'PV / INA226', addr: '0x40', mask: 0x01 },
  { key: 'bms', label: 'BMS / BQ76942', addr: '0x08', mask: 0x02 },
  { key: 'mppt', label: 'MPPT / BQ25798', addr: '0x6B', mask: 0x04 }
]);
const debugStatusNames = Object.freeze({
  0x0: 'ok', 0x1: 'absent', 0x2: 'nack', 0x3: 'timeout', 0x4: 'paused', 0x5: 'error', 0xf: 'unknown'
});
const scanPeriodMinMs = 200;
const scanPeriodMaxMs = 5000;
const hexPacketByteCounts = new Set([
  hexPacketLegacyWordCount * 2,
  hexPacketPeripheralWordCount * 2,
  hexPacketDebugWordCount * 2,
  hexPacketStreamingWordCount * 2
]);
const pvCurrentLsbA = readFiniteNumber('PV_INA226_CURRENT_LSB_A', 0.001);
// Effective INA226 shunt as seen by the chip. Bench data (CAL 0x0A00=2560, shunt reg 65 = 162.5 uV
// at 81 mA) gives 2 mOhm, i.e. Current_LSB = 0.00512/(2560*0.002) = 1 mA, matching the Registers tab.
// The 100 Ohm figure is not across IN+/IN- (0.08 A x 100 Ohm = 8 V, far beyond the 81.92 mV shunt range).
const pvShuntOhms = readFiniteNumber('PV_INA226_SHUNT_OHMS', 0.002);
const commandTargetHost = String(process.env.COMMAND_TARGET_HOST || '').trim();
const commandTargetPort = readOptionalPort('COMMAND_TARGET_PORT');
const configuredCommandPacketFormat = 'json';
const commandToken = String(process.env.COMMAND_TOKEN || '');
// Opt-in until the history/JWT UI milestone is ready. Never reuse the public site root.
const recordingPath = process.env.RECORDING_DB_PATH || '';
const recorder = recordingPath ? new Recorder(recordingPath) : null;
if (recorder) await recorder.ready;
const allowUnauthenticatedCommands = readBoolean(
  'ALLOW_UNAUTHENTICATED_COMMANDS',
  false
);
const telemetryStaleMs = readPositiveInteger('TELEMETRY_STALE_MS', 5_000);
const commandTimeoutMs = readPositiveInteger('COMMAND_TIMEOUT_MS', 4_000);
const sensorGroups = Object.freeze([
  { key: 'pv', label: 'PV / INA226', mask: 0x01 },
  { key: 'bms', label: 'BMS / BQ76942', mask: 0x02 },
  { key: 'mppt', label: 'MPPT / BQ25798', mask: 0x04 }
]);
const allSensorMask = sensorGroups.reduce((mask, group) => mask | group.mask, 0);
const supportedI2cDevices = new Map([
  [0x08, 'BMS / BQ76942'],
  [0x40, 'INA226 (PV)'],
  [0x6b, 'MPPT / BQ25798']
]);
// Writable entries from cubesat-i2c-tool/cubesat_i2c/registers.py. Keep this
// self-contained: production deploys server.js separately from the public site.
const writableRegisterWidths = new Map([
  ['0x08', new Map([['0x3E', 2]])],
  ['0x6B', new Map([['0x0F', 1], ['0x10', 1], ['0x12', 1], ['0x13', 1], ['0x14', 1], ['0x2E', 1], ['0x30', 1]])],
  ['0x40', new Map([['0x00', 2], ['0x05', 2], ['0x06', 2], ['0x07', 2]])]
]);
const sensorMaskTag = 0xa500;
const defaultMpptFaultBitNames = [
  'VAC1_OVP_STAT',
  'VAC2_OVP_STAT',
  'CONV_OCP_STAT',
  'BAT_OCP_STAT',
  'IBUS_OCP_STAT',
  'VBAT_OVP_STAT',
  'VBUS_OVP_STAT',
  'BAT_REG_STAT'
];
const mpptFaultBitNames = (() => {
  const configured = String(process.env.MPPT_FAULT_BIT_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : defaultMpptFaultBitNames;
})();

let latestEnvelope = null;
let latestDebugEnvelope = null;
let latestCommandEnvelope = null;
let lastTelemetryEndpoint = null;
let latestDebugState = null;
let sensorPollingState = null;
let generatedSequence = 1_000_000;
let lastBroadcastTelemetryConnected = null;
const sseClients = new Set();
const pendingCommands = new Map();

function readPort(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  return value;
}

function readOptionalPort(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer from 1 through 65535`);
  }
  return value;
}

function readFiniteNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createGeneratedRequestId() {
  return `debug-${generatedSequence++}`;
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asFiniteNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return parsed;
}

function normalizeSwitchState(value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value === 0 ? 'off' : 'on';

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['on', 'enabled', 'closed', '1', 'true'].includes(normalized)) return 'on';
    if (['off', 'disabled', 'open', '0', 'false'].includes(normalized)) return 'off';
    if (normalized.length > 0) return normalized;
  }

  throw new Error('mppt.switchState must be supplied');
}

function normalizeFaults(value) {
  if (value === undefined || value === null || value === '' || value === 'none') {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .filter((entry) => entry.toLowerCase() !== 'none');
  }

  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, active]) => Boolean(active))
      .map(([name]) => String(name));
  }

  throw new Error('mppt.faults must be an array, string, or object');
}

function normalizeOptionalBoolean(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 0 || value === 1) return value === 1;
    throw new Error(`${fieldName} numeric values must be 0 or 1`);
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', 'enable', 'enabled', 'resume', 'resumed', '1'].includes(normalized)) {
      return true;
    }

    if (['false', 'off', 'disable', 'disabled', 'pause', 'paused', '0'].includes(normalized)) {
      return false;
    }
  }

  throw new Error(`${fieldName} must be a recognized boolean value`);
}

function normalizeOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

function createSensorPollingState(activeMask, source = 'node-response', updatedAt = null) {
  const normalizedMask = activeMask & allSensorMask;
  const pausedSensors = sensorGroups
    .filter((group) => (normalizedMask & group.mask) === 0)
    .map((group) => ({
      key: group.key,
      label: group.label
    }));

  return {
    active_sensor_mask: normalizedMask,
    paused_sensors: pausedSensors,
    all_enabled: pausedSensors.length === 0,
    source,
    updated_at: updatedAt || new Date().toISOString()
  };
}

function telemetryAgeMs(now = Date.now()) {
  if (!lastTelemetryEndpoint?.last_seen) return null;
  const lastSeenMs = Date.parse(lastTelemetryEndpoint.last_seen);
  if (!Number.isFinite(lastSeenMs)) return null;
  return Math.max(0, now - lastSeenMs);
}

function isTelemetryConnected(now = Date.now()) {
  const ageMs = telemetryAgeMs(now);
  return ageMs !== null && ageMs <= telemetryStaleMs;
}

// Live-telemetry mode flag, set by the Windows app (POST /live-mode with the command token) when its
// Debug (Wireless) / Streaming source goes live. Web pages read it (status SSE + /health) and never show
// simulated data while it is on or while real telemetry is arriving.
const liveMode = { on: false, source: null, since: null };

function setLiveMode(on, source) {
  liveMode.on = !!on;
  liveMode.source = on ? String(source || 'app').slice(0, 40) : null;
  liveMode.since = on ? new Date().toISOString() : null;
}

function isCommandAuthorizationConfigured() {
  return (!sessions.enabled && allowUnauthenticatedCommands) || commandToken.length > 0;
}

function assertCommandAuthorized(request) {
  if (allowUnauthenticatedCommands && !sessions.enabled) return;

  if (!commandToken) {
    throw createHttpError(
      503,
      'Command control is disabled until COMMAND_TOKEN is configured on the bridge.'
    );
  }

  const suppliedToken = String(request.headers['x-command-token'] || '');
  const expectedDigest = crypto.createHash('sha256').update(commandToken).digest();
  const suppliedDigest = crypto.createHash('sha256').update(suppliedToken).digest();

  if (!crypto.timingSafeEqual(expectedDigest, suppliedDigest)) {
    throw createHttpError(401, 'A valid command token is required.');
  }
}

function asByte(value, fieldName) {
  if (typeof value !== 'number' &&
      (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim()))) {
    throw new Error(`${fieldName} must be a byte from 0 through 255`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xff) {
    throw new Error(`${fieldName} must be a byte from 0 through 255`);
  }
  return parsed;
}

function formatHexByte(value) {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function normalizeDeviceAddress(value) {
  const address = asByte(value, 'addr');
  if (address > 0x7f) {
    throw new Error('addr must be a seven-bit I2C address');
  }

  if (!supportedI2cDevices.has(address)) {
    const supported = [...supportedI2cDevices.entries()]
      .map(([deviceAddress, label]) => `${formatHexByte(deviceAddress)} (${label})`)
      .join(', ');
    throw new Error(`addr is not configured on this firmware build. Supported devices: ${supported}`);
  }

  return formatHexByte(address);
}

function normalizeRegisterAddress(value) {
  return formatHexByte(asByte(value, 'reg'));
}

function normalizeWriteData(value) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 32) {
    throw new Error('i2c_write data must contain 1 through 32 bytes');
  }

  return values.map((entry, index) =>
    formatHexByte(asByte(entry, `data[${index}]`))
  );
}

function validateRegisterWrite(address, registerAddress, data) {
  const width = writableRegisterWidths.get(address)?.get(registerAddress);
  if (!width) throw new Error(`Register ${registerAddress} on ${address} is not approved for writing.`);
  if (data.length !== width) throw new Error(`Register ${registerAddress} requires exactly ${width} byte(s).`);
  if (address === '0x6B' && registerAddress === '0x14' && (Number(data[0]) & 0x40)) {
    throw new Error('BQ25798 register 0x14 bit 6 is reserved and must be 0.');
  }
}

function normalizeSensorName(value) {
  const sensorName = String(value || '').trim().toLowerCase();
  if (![...sensorGroups.map((group) => group.key), 'all'].includes(sensorName)) {
    throw new Error('sensor must be pv, bms, mppt, or all');
  }
  return sensorName;
}

function endpointsMatch(remoteInfo, target) {
  return Boolean(
    remoteInfo &&
    target &&
    remoteInfo.port === target.port &&
    (target.source === 'configured' || remoteInfo.address === target.address)
  );
}

function byteValuesMatch(left, right) {
  try {
    return asByte(left, 'response byte') === asByte(right, 'expected byte');
  } catch {
    return false;
  }
}

function debugResultMatchesPending(packet, pending) {
  if (!packet || !pending || packet.command_type !== pending.commandType) {
    return false;
  }

  // Failed device operations may not have parsed enough fields to echo them.
  if (!packet.ok) return true;

  const expected = pending.expectedResult;
  if (!expected || expected.type !== packet.command_type) return false;

  if (expected.type === 'sensor_control') {
    return packet.sensor === expected.sensor &&
      packet.enabled === expected.enabled &&
      Number.isInteger(packet.active_sensor_mask);
  }

  if (expected.type === 'led_control') {
    return packet.enabled === expected.enabled &&
      Number.isInteger(packet.gpio);
  }

  if (expected.type === 'mppt_acdrv_control') {
    return packet.state === expected.state &&
      packet.verified === true;
  }

  if (expected.type === 'debug_control') {
    return packet.enabled === expected.enabled;
  }

  if (expected.type === 'set_scan_period') {
    return Number.isInteger(packet.period_ms);
  }

  if (expected.type === 'i2c_scan') {
    return Array.isArray(packet.addresses);
  }

  if (expected.type === 'i2c_probe') {
    return byteValuesMatch(packet.addr, expected.addr) && typeof packet.present === 'boolean';
  }

  if (!byteValuesMatch(packet.addr, expected.addr) ||
      !byteValuesMatch(packet.reg, expected.reg)) {
    return false;
  }

  if (expected.type === 'i2c_read') {
    return packet.len === expected.len &&
      packet.data.length === expected.len;
  }

  return packet.len === expected.data.length &&
    packet.write_data.length === expected.data.length &&
    packet.write_data.every((value, index) =>
      byteValuesMatch(value, expected.data[index])
    );
}

function normalizeCellVoltages(value) {
  let cells = null;

  if (Array.isArray(value)) {
    cells = value.slice(0, 4);
  } else if (value && typeof value === 'object') {
    cells = [
      pickFirst(value.battery1VoltageV, value.battery_1_voltage_v, value.battery1, value.battery_1),
      pickFirst(value.battery2VoltageV, value.battery_2_voltage_v, value.battery2, value.battery_2),
      pickFirst(value.battery3VoltageV, value.battery_3_voltage_v, value.battery3, value.battery_3),
      pickFirst(value.battery4VoltageV, value.battery_4_voltage_v, value.battery4, value.battery_4)
    ];
  }

  if (!Array.isArray(cells) || cells.length < 4) {
    throw new Error('bms.cellVoltagesV must contain four cell voltages');
  }

  return cells.slice(0, 4).map((cellVoltage, index) =>
    asFiniteNumber(cellVoltage, `bms.cellVoltagesV[${index}]`)
  );
}

function decodeSignedWord(word) {
  return (word & 0x8000) === 0 ? word : word - 0x10000;
}

function decodeIna226ShuntMv(word) {
  return decodeSignedWord(word) * 0.0025;
}

function decodeIna226CurrentA(word, currentLsbA) {
  return decodeSignedWord(word) * currentLsbA;
}

function decodeIna226PowerW(word, currentLsbA) {
  return word * 25 * currentLsbA;
}

function decodeIna226CurrentLsbA(calibrationWord, shuntOhms, fallbackCurrentLsbA) {
  if (
    Number.isInteger(calibrationWord) &&
    calibrationWord > 0 &&
    Number.isFinite(shuntOhms) &&
    shuntOhms > 0
  ) {
    return 0.00512 / (calibrationWord * shuntOhms);
  }

  return fallbackCurrentLsbA;
}

function formatHexWord(value) {
  return Number(value).toString(16).toUpperCase().padStart(4, '0');
}

function decodeCentiMilliVolts(word) {
  return decodeSignedWord(word) / 100;
}

function decodeCentiWatts(word) {
  return word / 100;
}

function decodeMilliamps(word) {
  return decodeSignedWord(word) / 1000;
}

function decodeFaultMask(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff) {
    throw new Error('mppt fault word must be a 16-bit unsigned value');
  }

  const faults = [];

  for (let bit = 0; bit < 16; bit += 1) {
    if ((mask & (1 << bit)) !== 0) {
      faults.push(mpptFaultBitNames[bit] || `fault_bit_${bit}`);
    }
  }

  return faults;
}

function decodeMpptSwitchStateFromReg13(word) {
  const registerValue = word & 0xff;
  const acdrv2Enabled = (registerValue & 0x80) !== 0;
  const acdrv1Enabled = (registerValue & 0x40) !== 0;

  if (acdrv1Enabled && !acdrv2Enabled) return 'acdrv1';
  if (acdrv2Enabled && !acdrv1Enabled) return 'acdrv2';
  if (acdrv1Enabled && acdrv2Enabled) return 'both';
  return 'off';
}

function decodeSensorPollingMask(word) {
  return (word & 0xff00) === sensorMaskTag
    ? word & allSensorMask
    : null;
}

function looksLikeHexPacketText(text) {
  return typeof text === 'string' &&
    /^[0-9a-fA-FxX\s,_:-]+$/.test(text) &&
    /[0-9a-fA-F]/.test(text);
}

function extractHexWordsFromText(text) {
  if (!looksLikeHexPacketText(text)) {
    throw new Error('packet is not valid hex text');
  }

  const compact = text
    .replace(/0x/gi, '')
    .replace(/[^0-9a-fA-F]/g, '');

  if (compact.length % 4 !== 0 || compact.length < 8) {
    throw new Error('hex packet must contain complete 16-bit words');
  }

  const words = [];

  for (let offset = 0; offset < compact.length; offset += 4) {
    words.push(Number.parseInt(compact.slice(offset, offset + 4), 16));
  }

  return words;
}

function extractHexWordsFromRawBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !hexPacketByteCounts.has(buffer.length)) {
    throw new Error('raw hex packet must contain 32, 40, 72, or 96 bytes');
  }

  const words = [];

  for (let offset = 0; offset < buffer.length; offset += 2) {
    words.push(buffer.readUInt16BE(offset));
  }

  return words;
}

function normalizeHexPacketWords(words) {
  if (!Array.isArray(words) || words.length < 2) {
    throw new Error('hex packet must contain a header');
  }

  if (words[0] !== hexPacketMagic) {
    throw new Error(`invalid hex packet magic 0x${words[0].toString(16).padStart(4, '0')}`);
  }

  const versionWord = words[1];
  const expectedWordCount = versionWord === hexPacketVersionStreaming
    ? hexPacketStreamingWordCount
    : versionWord === hexPacketVersionDebug
    ? hexPacketDebugWordCount
    : versionWord === hexPacketVersionPeripheralSensors
      ? hexPacketPeripheralWordCount
      : hexPacketLegacyWordCount;

  if (words.length !== expectedWordCount) {
    throw new Error(
      `hex packet version 0x${versionWord.toString(16).padStart(4, '0')} ` +
      `must contain ${expectedWordCount} words`
    );
  }

  if (versionWord === hexPacketVersionRawIna226) {
    return {
      version: 1,
      type: 'telemetry',
      packet_format: 'hex-v1-raw-ina226',
      device_id: hexDeviceId,
      seq: words[2],
      device_uptime_ms: 0,
      sample_counter: words[2],
      transmitted_at: null,
      telemetry: {
        mcu: {
          temperatureC: null
        },
        pv: {
          shuntVoltageMv: decodeIna226ShuntMv(words[4]),
          powerW: decodeIna226PowerW(words[5], pvCurrentLsbA),
          currentA: decodeIna226CurrentA(words[6], pvCurrentLsbA)
        },
        mppt: {
          switchState: words[7] === 0 ? 'off' : 'on',
          faults: decodeFaultMask(words[8])
        },
        bms: {
          cellVoltagesV: [
            words[9] / 1000,
            words[10] / 1000,
            words[11] / 1000,
            words[12] / 1000
          ]
        },
        load: null
      }
    };
  }

  if (versionWord === hexPacketVersionEngineering) {
    return {
      version: 1,
      type: 'telemetry',
      packet_format: 'hex-v2-engineering',
      device_id: hexDeviceId,
      seq: words[2],
      device_uptime_ms: 0,
      sample_counter: words[2],
      transmitted_at: null,
      telemetry: {
        mcu: {
          temperatureC: null
        },
        pv: {
          shuntVoltageMv: decodeCentiMilliVolts(words[4]),
          powerW: decodeCentiWatts(words[5]),
          currentA: decodeMilliamps(words[6])
        },
        mppt: {
          switchState: words[7] === 0 ? 'off' : 'on',
          faults: decodeFaultMask(words[8])
        },
        bms: {
          cellVoltagesV: [
            words[9] / 1000,
            words[10] / 1000,
            words[11] / 1000,
            words[12] / 1000
          ]
        },
        load: null
      }
    };
  }

  if (versionWord === hexPacketVersionValidatedRaw) {
    const pvCalibrationWord = words[4];
    const activeSensorMask = decodeSensorPollingMask(words[15]);
    const pvResolvedCurrentLsbA = decodeIna226CurrentLsbA(
      pvCalibrationWord,
      pvShuntOhms,
      pvCurrentLsbA
    );

    return {
      version: 1,
      type: 'telemetry',
      packet_format: 'hex-v3-validated-raw',
      device_id: hexDeviceId,
      seq: words[2],
      device_uptime_ms: 0,
      sample_counter: words[2],
      transmitted_at: null,
      telemetry: {
        mcu: {
          temperatureC: null
        },
        pv: {
          shuntVoltageMv: decodeIna226ShuntMv(words[5]),
          busVoltageV: +(words[6] * 0.00125).toFixed(5),
          powerW: decodeIna226PowerW(words[7], pvResolvedCurrentLsbA),
          currentA: decodeIna226CurrentA(words[8], pvResolvedCurrentLsbA)
        },
        mppt: {
          switchState: decodeMpptSwitchStateFromReg13(words[13]),
          faults: decodeFaultMask(words[14] & 0x00ff)
        },
        bms: {
          cellVoltagesV: [
            words[9] / 1000,
            words[10] / 1000,
            words[11] / 1000,
            words[12] / 1000
          ]
        },
        load: null
      },
      raw: {
        pv: {
          calibration: pvCalibrationWord,
          shunt: words[5],
          bus: words[6],
          power: words[7],
          current: words[8]
        },
        mppt: {
          reg13: words[13] & 0x00ff,
          fault20: words[14] & 0x00ff
        },
        reserved: words[15]
      },
      sensor_polling: activeSensorMask === null
        ? null
        : {
            active_sensor_mask: activeSensorMask
          }
    };
  }

  if (versionWord === hexPacketVersionPeripheralSensors) {
    const v3Words = words.slice(0, hexPacketLegacyWordCount);
    v3Words[1] = hexPacketVersionValidatedRaw;
    const packet = normalizeHexPacketWords(v3Words);
    const flags = words[16];
    const temperatureValid = (flags & 0x0001) !== 0;
    const lightValid = (flags & 0x0002) !== 0;

    if (lightValid && words[19] > 10_000) {
      throw new Error('v4 relative light level exceeds 10000 basis points');
    }

    packet.packet_format = 'hex-v4-peripheral-sensors';
    packet.telemetry.peripheral = {
      temperatureC: temperatureValid
        ? decodeSignedWord(words[17]) / 100
        : null,
      temperatureSaturated: temperatureValid
        ? (flags & 0x0004) !== 0
        : null,
      lightVoltageMv: lightValid ? words[18] : null,
      lightLevel: lightValid ? lightLevelFromMv(words[18]) : null,
      relativeLightLevel: lightValid ? words[19] / 10_000 : null,
      lightSaturated: lightValid
        ? (flags & 0x0008) !== 0
        : null
    };
    packet.raw.peripheral = {
      flags,
      temperature_centi_c: words[17],
      light_voltage_mv: words[18],
      relative_light_basis_points: words[19]
    };
    return packet;
  }

  if (versionWord === hexPacketVersionDebug) {
    const v4Words = words.slice(0, hexPacketPeripheralWordCount);
    v4Words[1] = hexPacketVersionPeripheralSensors;
    const packet = normalizeHexPacketWords(v4Words);
    const debug = decodeDebugWords(words.slice(hexPacketPeripheralWordCount));
    packet.packet_format = 'hex-v5-debug';
    packet.link = debug.link;
    packet.device_uptime_ms = debug.link.uptime_ms;
    packet.debug = debug.debug;
    applyDevicePresence(packet, debug.debug);
    return packet;
  }

  if (versionWord === hexPacketVersionStreaming) {
    const v5Words = words.slice(0, hexPacketDebugWordCount);
    v5Words[1] = hexPacketVersionDebug;
    const packet = normalizeHexPacketWords(v5Words);
    packet.packet_format = 'hex-v6-streaming';
    applyStreamingWords(packet, words.slice(hexPacketDebugWordCount));
    return packet;
  }

  throw new Error(`unsupported hex packet version 0x${versionWord.toString(16).padStart(4, '0')}`);
}

function decodeDebugWords(w) {
  const flags = w[6];
  const presentMask = w[7] & 0x00ff;
  const probedMask = (w[7] >> 8) & 0x00ff;
  const devices = {};
  debugDeviceGroups.forEach((group, index) => {
    const code = (w[13] >> (index * 4)) & 0x0f;
    const probed = (probedMask & group.mask) !== 0;
    const present = (presentMask & group.mask) !== 0;
    let state = 'unknown';
    if (probed && !present) state = (code === 0x3 || code === 0x5) ? 'error' : 'absent';
    else if (code === 0x0) state = 'present';
    else if (code === 0x4) state = 'paused';
    else if (code === 0xf) state = probed ? 'present' : 'unknown';
    else if (code !== 0x1) state = 'error';
    else state = 'absent';
    devices[group.key] = {
      label: group.label,
      addr: group.addr,
      present,
      probed,
      state,
      last_status: debugStatusNames[code] || `code_${code}`,
      last_status_code: code,
      error_count: w[10 + index]
    };
  });
  return {
    link: {
      rssi_dbm: w[0] === 0x8000 ? null : decodeSignedWord(w[0]),
      uptime_ms: (w[1] * 0x10000) + w[2],
      tx_errors: w[3],
      ack_timeouts: w[4],
      wifi_reconnects: w[5],
      last_ack_rtt_ms: w[15] === 0xffff ? null : w[15]
    },
    debug: {
      enabled: (flags & 0x0001) !== 0,
      presence_detection: (flags & 0x0002) !== 0,
      present_mask: presentMask,
      probed_mask: probedMask,
      scan_period_ms: w[8],
      probe_period_ms: w[9],
      i2c_cycle_ms: w[14] === 0xffff ? null : w[14] / 10,
      devices
    }
  };
}

// Absent devices carry zero words in v5; expose them as unavailable instead of as measurements.
function applyDevicePresence(packet, debug) {
  const t = packet.telemetry;
  if (!debug.devices.pv.present && debug.devices.pv.probed) {
    t.pv = { shuntVoltageMv: null, busVoltageV: null, powerW: null, currentA: null, available: false };
  }
  if (!debug.devices.bms.present && debug.devices.bms.probed) {
    t.bms = { cellVoltagesV: [null, null, null, null], available: false };
  }
  if (!debug.devices.mppt.present && debug.devices.mppt.probed) {
    t.mppt = { switchState: null, faults: [], available: false };
  }
}

// v6 words 36..47 (see main/debug_mode.c debug_mode_build_v6_words). Invalid -> null, never zero.
function applyStreamingWords(packet, w) {
  const flags = w[0];
  const ok = (bit) => (flags & (1 << bit)) !== 0;
  const t = packet.telemetry;
  const r3 = (v) => +v.toFixed(3);
  const gpio = (b) => (b === 0xff ? null : b);
  if (t.bms && t.bms.available !== false) {
    t.bms.packVoltageV = ok(0) ? r3(w[1] * bmsUserVoltLsbV) : null;
    t.bms.internalTempC = ok(1) ? +((w[2] * 0.1) - 273.15).toFixed(2) : null;
  } else if (t.bms) {
    t.bms.packVoltageV = null; t.bms.internalTempC = null;
  }
  const mpptLive = t.mppt && t.mppt.available !== false;
  const m = (bit, value) => (mpptLive && ok(bit) ? value : null);
  if (t.mppt) {
    t.mppt.ibusA = m(2, r3(decodeSignedWord(w[3]) / 1000));
    t.mppt.vbusV = m(3, r3(w[4] / 1000));
    t.mppt.vac1V = m(4, r3(w[5] / 1000));
    t.mppt.vbatV = m(5, r3(w[6] / 1000));
    t.mppt.vsysV = m(6, r3(w[7] / 1000));
    t.mppt.dieTempC = m(7, decodeSignedWord(w[8]) * 0.5);
    t.mppt.adcEnabled = mpptLive && ok(8) ? (w[9] & 0x80) !== 0 : null;
  }
  t.peripheral = t.peripheral || {};
  t.peripheral.temperatureVoltageMv = ok(9) ? w[10] : null;
  t.adc = {
    temp: { device: 'MCP9700', signal: 'TEMP_OUT', gpio: gpio(w[11] & 0xff) },
    light: { device: 'TEMT6000', signal: 'LIGHT_OUT', gpio: gpio((w[11] >> 8) & 0xff) }
  };
  packet.raw.streaming = {
    flags,
    bms_pack_0x36: w[1], bms_int_temp_0x68: w[2],
    mppt_ibus_0x31: w[3], mppt_vbus_0x35: w[4], mppt_vac1_0x37: w[5],
    mppt_vbat_0x3b: w[6], mppt_vsys_0x3d: w[7], mppt_tdie_0x41: w[8],
    mppt_adc_control_0x2e: w[9] & 0xff,
    adc_temp_mv: w[10], adc_gpios: w[11]
  };
}

function normalizeHexPacketText(text) {
  return normalizeHexPacketWords(extractHexWordsFromText(text));
}

function normalizeLegacyTelemetry(value) {
  const telemetry = {
    solar_panel_current_a: Number(value.solar_panel_current_a),
    battery_voltage_v: Number(value.battery_voltage_v),
    mppt_switch_temperature_c: Number(value.mppt_switch_temperature_c)
  };

  for (const [name, fieldValue] of Object.entries(telemetry)) {
    if (!isFiniteNumber(fieldValue)) {
      return null;
    }
  }

  const peripheral = normalizeOptionalPeripheral(value.peripheral);
  return peripheral === undefined ? telemetry : { ...telemetry, peripheral };
}

function normalizeOptionalPeripheral(value) {
  if (value === undefined) return undefined;
  if (value === null) {
    return {
      temperatureC: null,
      temperatureSaturated: null,
      lightVoltageMv: null,
      relativeLightLevel: null,
      lightSaturated: null
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('peripheral must be an object or null');
  }

  const optionalNumber = (fieldName) => {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined || fieldValue === null) return null;
    return asFiniteNumber(fieldValue, `peripheral.${fieldName}`);
  };
  const optionalBoolean = (fieldName) => {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined || fieldValue === null) return null;
    if (typeof fieldValue !== 'boolean') {
      throw new Error(`peripheral.${fieldName} must be a boolean or null`);
    }
    return fieldValue;
  };

  const relativeLightLevel = optionalNumber('relativeLightLevel');
  if (relativeLightLevel !== null &&
      (relativeLightLevel < 0 || relativeLightLevel > 1)) {
    throw new Error('peripheral.relativeLightLevel must be between 0 and 1');
  }

  return {
    temperatureC: optionalNumber('temperatureC'),
    temperatureSaturated: optionalBoolean('temperatureSaturated'),
    lightVoltageMv: optionalNumber('lightVoltageMv'),
    relativeLightLevel,
    lightSaturated: optionalBoolean('lightSaturated')
  };
}

function normalizeGroupedTelemetry(value) {
  const pvShuntVoltageMv = pickFirst(
    value?.pv?.shuntVoltageMv,
    value?.pv?.shunt_voltage_mv,
    value?.pv?.shunt_mv,
    value?.pv_shunt_voltage_mv
  );

  const pvPowerW = pickFirst(
    value?.pv?.powerW,
    value?.pv?.power_w,
    value?.pv_power_w
  );

  const pvCurrentA = pickFirst(
    value?.pv?.currentA,
    value?.pv?.current_a,
    value?.pv_current_a
  );

  const mpptSwitchState = pickFirst(
    value?.mppt?.switchState,
    value?.mppt?.switch_state,
    value?.mppt_switch_state
  );

  const mpptFaults = pickFirst(
    value?.mppt?.faults,
    value?.mppt?.fault_conditions,
    value?.mppt?.fault_conditions_state,
    value?.mppt_faults
  );

  const bmsCellVoltages = pickFirst(
    value?.bms?.cellVoltagesV,
    value?.bms?.cell_voltages_v,
    value?.bms?.batteryVoltages,
    value?.bms?.battery_voltages,
    value?.batteryVoltages,
    value?.battery_v,
    value?.bms
  );

  const normalized = {
    mcu: {
      temperatureC: null
    },
    pv: {
      shuntVoltageMv: asFiniteNumber(pvShuntVoltageMv, 'pv.shuntVoltageMv'),
      powerW: asFiniteNumber(pvPowerW, 'pv.powerW'),
      currentA: asFiniteNumber(pvCurrentA, 'pv.currentA')
    },
    mppt: {
      switchState: normalizeSwitchState(mpptSwitchState),
      faults: normalizeFaults(mpptFaults)
    },
    bms: {
      cellVoltagesV: normalizeCellVoltages(bmsCellVoltages)
    },
    load: null
  };

  const peripheral = normalizeOptionalPeripheral(value?.peripheral);
  if (peripheral !== undefined) normalized.peripheral = peripheral;
  return normalized;
}

function normalizeTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('telemetry must be an object');
  }

  const legacyTelemetry = normalizeLegacyTelemetry(value);
  if (legacyTelemetry) return legacyTelemetry;

  return normalizeGroupedTelemetry(value);
}

function normalizeTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid date/time string`);
  }
  return new Date(parsed).toISOString();
}

function normalizeIncomingPacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('packet must be a JSON object');
  }

  if (telemetryToken && value.auth_token !== telemetryToken) {
    throw new Error('invalid telemetry authentication token');
  }

  const hexText = pickFirst(
    value.hex,
    value.packet_hex,
    value.telemetry_hex
  );

  if (typeof hexText === 'string') {
    return normalizeHexPacketText(hexText);
  }

  if (value.type !== undefined && value.type !== 'telemetry') {
    throw new Error('packet type must be telemetry');
  }

  const rawSequence = value.seq;
  const sequence = rawSequence === undefined || rawSequence === null
    ? generatedSequence++
    : Number(rawSequence);

  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error('seq must be a non-negative integer when supplied');
  }

  const transmittedAt = normalizeTimestamp(
    value.transmitted_at,
    'transmitted_at'
  );

  return {
    version: Number(value.version || 1),
    type: 'telemetry',
    device_id: String(value.device_id || 'unknown-telemetry-device'),
    seq: sequence,
    device_uptime_ms: Number(value.device_uptime_ms || 0),
    sample_counter: Number(value.sample_counter || 0),
    transmitted_at: transmittedAt,
    telemetry: normalizeTelemetry(value.telemetry || value)
  };
}

function normalizeDebugByteList(value, fieldName) {
  if (value === undefined || value === null || value === '') return [];

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array when supplied`);
  }

  return value.map((entry, index) => {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 0xff) {
      return `0x${entry.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }

    throw new Error(`${fieldName}[${index}] must be a byte string or integer`);
  });
}

function normalizeDebugPacket(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('debug packet must be a JSON object');
  }

  const requestId = pickFirst(value.request_id, value.requestId, null);
  const commandType = String(
    pickFirst(value.command_type, value.commandType, value.command, 'unknown')
  ).trim().toLowerCase();
  const statusText = String(pickFirst(value.status, value.result, 'ok'))
    .trim()
    .toLowerCase();
  const okValue = pickFirst(
    value.ok,
    statusText === 'ok' ? true : statusText === 'error' ? false : undefined
  );
  const readLength = pickFirst(value.len, value.length, value.read_length, value.readLength, null);
  const address = pickFirst(value.addr, value.address, null);
  const registerAddress = pickFirst(value.reg, value.register, null);
  const sensorName = pickFirst(value.sensor, value.sensor_name, value.sensorName, null);
  const requestedState = pickFirst(value.state, value.requested_state, value.requestedState, null);
  const enabledValue = pickFirst(
    value.enabled,
    ['sensor_control', 'led_control'].includes(commandType)
      ? value.state
      : undefined
  );
  const sensorMask = normalizeOptionalInteger(
    pickFirst(value.sensor_mask, value.sensorMask),
    'sensor_mask'
  );
  const activeSensorMask = normalizeOptionalInteger(
    pickFirst(value.active_sensor_mask, value.activeSensorMask),
    'active_sensor_mask'
  );

  return {
    version: Number(value.version || 1),
    type: 'debug_result',
    device_id: String(value.device_id || hexDeviceId),
    request_id: requestId ? String(requestId) : null,
    command_type: commandType || 'unknown',
    status: statusText || 'ok',
    ok: typeof okValue === 'boolean' ? okValue : statusText !== 'error',
    issued_at: normalizeTimestamp(
      pickFirst(value.issued_at, value.issuedAt),
      'issued_at'
    ),
    responded_at: normalizeTimestamp(
      pickFirst(value.responded_at, value.respondedAt),
      'responded_at'
    ),
    addr: address === null || address === undefined ? null : String(address),
    reg: registerAddress === null || registerAddress === undefined ? null : String(registerAddress),
    len: readLength === null || readLength === undefined ? null : Number(readLength),
    sensor: sensorName ? String(sensorName).trim().toLowerCase() : null,
    enabled: normalizeOptionalBoolean(
      enabledValue,
      'enabled'
    ),
    state: requestedState === null || requestedState === undefined
      ? null
      : String(requestedState).trim().toLowerCase(),
    gpio: normalizeOptionalInteger(value.gpio, 'gpio'),
    register_12_before: pickFirst(value.register_12_before, value.register12Before, null),
    register_12_after: pickFirst(value.register_12_after, value.register12After, null),
    register_13_before: pickFirst(value.register_13_before, value.register13Before, null),
    register_13_after: pickFirst(value.register_13_after, value.register13After, null),
    acrb_status: pickFirst(value.acrb_status, value.acrbStatus, null),
    acrb1_present: normalizeOptionalBoolean(
      pickFirst(value.acrb1_present, value.acrb1Present),
      'acrb1_present'
    ),
    acrb2_present: normalizeOptionalBoolean(
      pickFirst(value.acrb2_present, value.acrb2Present),
      'acrb2_present'
    ),
    verified: normalizeOptionalBoolean(value.verified, 'verified'),
    sensor_mask: sensorMask,
    active_sensor_mask: activeSensorMask,
    data: normalizeDebugByteList(
      pickFirst(value.data, value.read_data, value.readData),
      'data'
    ),
    write_data: normalizeDebugByteList(
      pickFirst(value.write_data, value.writeData),
      'write_data'
    ),
    addresses: Array.isArray(value.addresses) ? value.addresses.map(String) : undefined,
    count: Number.isInteger(value.count) ? value.count : undefined,
    scan_us: Number.isFinite(value.scan_us) ? value.scan_us : undefined,
    present: typeof value.present === 'boolean' ? value.present : undefined,
    probe_result: typeof value.probe_result === 'string' ? value.probe_result : undefined,
    debug_enabled: typeof value.debug_enabled === 'boolean' ? value.debug_enabled : undefined,
    period_ms: Number.isInteger(value.period_ms) ? value.period_ms : undefined,
    requested_period_ms: Number.isInteger(value.requested_period_ms) ? value.requested_period_ms : undefined,
    scan_period_ms: Number.isInteger(value.scan_period_ms) ? value.scan_period_ms : undefined,
    probe_period_ms: Number.isInteger(value.probe_period_ms) ? value.probe_period_ms : undefined,
    present_mask: Number.isInteger(value.present_mask) ? value.present_mask : undefined,
    ack_timeout_ms: Number.isInteger(value.ack_timeout_ms) ? value.ack_timeout_ms : undefined,
    device_time_ms: Number.isFinite(value.device_time_ms) ? value.device_time_ms : undefined,
    note: pickFirst(value.note, value.message, null)
      ? String(pickFirst(value.note, value.message))
      : null,
    error: pickFirst(value.error, value.error_name, null)
      ? String(pickFirst(value.error, value.error_name))
      : null
  };
}

function decodeUdpPacket(message) {
  const text = message.toString('utf8').trim();

  if (text.startsWith('{')) {
    const parsed = JSON.parse(text);
    if (parsed?.type === 'debug_result') {
      return normalizeDebugPacket(parsed);
    }
    const verified = signedTelemetry.verify(parsed);
    if (verified) {
      const packet = normalizeHexPacketText(verified.hex);
      if (packet.device_id !== verified.provenance.device_id) {
        throw new Error('signed telemetry device_id does not match HEX_DEVICE_ID');
      }
      if (packet.seq !== verified.provenance.seq) {
        throw new Error('signed telemetry sequence does not match hex payload');
      }
      packet.device_uptime_ms = verified.uptime_ms;
      packet.transport_provenance = verified.provenance;
      return packet;
    }
    return normalizeIncomingPacket(parsed);
  }

  if (looksLikeHexPacketText(text)) {
    if (requireSignedTelemetry) throw new Error('signed telemetry is required');
    return normalizeHexPacketText(text);
  }

  if (hexPacketByteCounts.has(message.length)) {
    if (requireSignedTelemetry) throw new Error('signed telemetry is required');
    return normalizeHexPacketWords(
      extractHexWordsFromRawBuffer(message)
    );
  }

  throw new Error('packet is neither JSON nor a supported hex payload');
}

function createEnvelope(packet, source, network = null) {
  const receivedAt = new Date();
  let transmissionAgeMs = null;

  if (packet.transmitted_at) {
    transmissionAgeMs = Math.max(
      0,
      receivedAt.getTime() - Date.parse(packet.transmitted_at)
    );
  }

  return {
    type: packet.type === 'debug_result' ? 'debug_result' : 'telemetry',
    source,
    received_at: receivedAt.toISOString(),
    transmission_age_ms: transmissionAgeMs,
    network,
    provenance: packet.transport_provenance || {
      authenticated: false,
      scheme: null
    },
    packet
  };
}

function sendSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function broadcast(value) {
  for (const response of sseClients) {
    if (!response.destroyed) sendSse(response, value);
  }
}

function createStatusMessage() {
  const telemetryConnected = isTelemetryConnected();
  const fixedTargetReady = Boolean(commandTargetHost && commandTargetPort);
  const commandTransportReady = telemetryConnected || fixedTargetReady;
  const activeCommandTarget = fixedTargetReady
    ? {
        address: commandTargetHost,
        port: commandTargetPort,
        source: 'configured',
        packet_format: configuredCommandPacketFormat
      }
    : telemetryConnected
      ? {
          address: lastTelemetryEndpoint.address,
          port: lastTelemetryEndpoint.port,
          source: 'telemetry',
          packet_format: lastTelemetryEndpoint.packet_format
        }
      : null;

  return {
    type: 'status',
    server_time: new Date().toISOString(),
    udp_port: udpPort,
    web_clients: sseClients.size,
    telemetry_connected: telemetryConnected,
    telemetry_age_ms: telemetryAgeMs(),
    telemetry_stale_after_ms: telemetryStaleMs,
    telemetry_endpoint: lastTelemetryEndpoint,
    telemetry_packet_format: latestEnvelope?.packet?.packet_format || null,
    telemetry_provenance: latestEnvelope?.provenance || null,
    telemetry_auth_required: requireSignedTelemetry,
    telemetry_auth_configured: Boolean(signedTelemetry.key),
    sensor_polling: sensorPollingState,
    command_auth_required: sessions.enabled || !allowUnauthenticatedCommands,
    command_auth_configured: isCommandAuthorizationConfigured(),
    command_transport_ready: commandTransportReady,
    command_ready: commandTransportReady && isCommandAuthorizationConfigured(),
    command_target: activeCommandTarget,
    pending_commands: pendingCommands.size,
    debug_mode: latestDebugState,
    live_mode: liveMode.on,
    live_mode_source: liveMode.source,
    live_mode_since: liveMode.since,
    recording: recorder?.status() || { enabled: false }
  };
}

function broadcastStatus() {
  const status = createStatusMessage();
  lastBroadcastTelemetryConnected = status.telemetry_connected;
  broadcast(status);
}

function createCommandEnvelope(status, command, extra = {}) {
  return {
    type: 'command_status',
    status,
    request_id: command.requestId,
    command_type: command.commandType,
    summary: command.summary,
    target: command.target,
    issued_at: command.issuedAt,
    updated_at: new Date().toISOString(),
    ...extra
  };
}

const commandWaiters = new Map();

function waitForCommandResult(requestId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      commandWaiters.delete(requestId);
      resolve({ status: 'timed_out', error: 'No final command status before the wait limit.' });
    }, timeoutMs);
    timer.unref();
    commandWaiters.set(requestId, (value) => {
      clearTimeout(timer);
      commandWaiters.delete(requestId);
      resolve(value);
    });
  });
}

function publishCommandStatus(status, command, extra = {}) {
  if (['completed', 'failed', 'timed_out'].includes(status) && commandWaiters.has(command.requestId)) {
    const candidate = latestDebugEnvelope?.packet;
    const result = candidate && candidate.request_id === command.requestId ? candidate : null;
    commandWaiters.get(command.requestId)({ status, ...extra, result });
  }
  latestCommandEnvelope = createCommandEnvelope(status, command, extra);
  recorder?.capture('command', { envelope: latestCommandEnvelope });
  broadcast(latestCommandEnvelope);
  broadcastStatus();
}

function schedulePendingCommandTimeout(pending) {
  pending.timeoutHandle = setTimeout(() => {
    if (pendingCommands.get(pending.requestId) !== pending) return;

    if (pending.retriesUsed < pending.maxRetries) {
      pending.retriesUsed += 1;
      sendUdpMessage(pending.payloadBuffer, pending.target)
        .then(() => {
          if (pendingCommands.get(pending.requestId) !== pending) return;
          publishCommandStatus('retrying', pending, {
            retry: pending.retriesUsed,
            max_retries: pending.maxRetries
          });
          schedulePendingCommandTimeout(pending);
        })
        .catch((error) => {
          if (pendingCommands.get(pending.requestId) !== pending) return;
          pendingCommands.delete(pending.requestId);
          publishCommandStatus('failed', pending, {
            error: error instanceof Error ? error.message : 'UDP command retry failed'
          });
        });
      return;
    }

    pendingCommands.delete(pending.requestId);
    publishCommandStatus('timed_out', pending, {
      error: `No ESP32 response arrived after ${pending.retriesUsed + 1} attempt(s).`
    });
  }, commandTimeoutMs);
  pending.timeoutHandle.unref();
}

function registerPendingCommand(command) {
  if (pendingCommands.has(command.requestId)) {
    throw createHttpError(409, 'request_id is already pending');
  }

  const pending = {
    ...command,
    maxRetries: Number.isInteger(command.maxRetries) ? command.maxRetries : 0,
    retriesUsed: 0,
    timeoutHandle: null
  };
  pendingCommands.set(command.requestId, pending);
  schedulePendingCommandTimeout(pending);
}

function cancelPendingCommand(requestId) {
  const pending = pendingCommands.get(requestId);
  if (!pending) return null;
  clearTimeout(pending.timeoutHandle);
  pendingCommands.delete(requestId);
  return pending;
}

async function readJsonBody(request, limitBytes = 64 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) throw new Error('request body is too large');
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

function resolveCommandTarget() {
  if (commandTargetHost && commandTargetPort) {
    return {
      address: commandTargetHost,
      port: commandTargetPort,
      source: 'configured',
      packet_format: configuredCommandPacketFormat
    };
  }

  if (
    isTelemetryConnected() &&
    lastTelemetryEndpoint?.address &&
    lastTelemetryEndpoint?.port
  ) {
    return {
      address: lastTelemetryEndpoint.address,
      port: lastTelemetryEndpoint.port,
      source: 'telemetry',
      packet_format: lastTelemetryEndpoint.packet_format
    };
  }

  throw new Error(
    'No live command target is available. Wait for fresh telemetry or configure COMMAND_TARGET_HOST and COMMAND_TARGET_PORT.'
  );
}

function buildJsonCommandMessage(body) {
  const issuedAt = new Date().toISOString();
  const directCommandType = String(body?.type || '')
    .trim()
    .toLowerCase();

  if (![
    'i2c_read',
    'i2c_write',
    'sensor_control',
    'mppt_acdrv_control',
    'led_control',
    'debug_control',
    'set_scan_period',
    'i2c_scan',
    'i2c_probe'
  ].includes(directCommandType)) {
    throw new Error(
      'type must be i2c_read, i2c_write, sensor_control, mppt_acdrv_control, led_control, ' +
      'debug_control, set_scan_period, i2c_scan, or i2c_probe'
    );
  }

  const requestId = String(
    pickFirst(body?.request_id, body?.requestId, createGeneratedRequestId())
  ).trim();
  if (!requestId || requestId.length > 128) {
    throw new Error('request_id must contain 1 through 128 characters');
  }

  const payloadObject = {
    version: 1,
    type: directCommandType,
    issued_at: issuedAt,
    request_id: requestId
  };

  let summary;

  if (directCommandType === 'debug_control') {
    const enabled = normalizeOptionalBoolean(
      pickFirst(body?.enabled, body?.state),
      'enabled'
    );
    if (enabled === null) {
      throw new Error('debug_control must include enabled');
    }
    payloadObject.enabled = enabled;
    summary = `DEBUG_MODE ${enabled ? 'ON' : 'OFF'}`;
  } else if (directCommandType === 'set_scan_period') {
    const periodMs = Number(pickFirst(body?.period_ms, body?.periodMs));
    if (!Number.isInteger(periodMs) || periodMs < scanPeriodMinMs || periodMs > scanPeriodMaxMs) {
      throw new Error(`set_scan_period period_ms must be an integer from ${scanPeriodMinMs} through ${scanPeriodMaxMs}`);
    }
    payloadObject.period_ms = periodMs;
    summary = `SET_SCAN_PERIOD ${periodMs} ms`;
  } else if (directCommandType === 'i2c_scan') {
    summary = 'I2C_SCAN 0x08-0x77';
  } else if (directCommandType === 'i2c_probe') {
    const address = asByte(pickFirst(body?.addr, body?.address), 'addr');
    if (address < 0x08 || address > 0x77) {
      throw new Error('i2c_probe addr must be 0x08 through 0x77');
    }
    payloadObject.addr = formatHexByte(address);
    summary = `I2C_PROBE ${payloadObject.addr}`;
  } else if (directCommandType === 'sensor_control') {
    const sensorName = normalizeSensorName(
      pickFirst(body?.sensor, body?.sensor_name, body?.sensorName)
    );
    const enabled = normalizeOptionalBoolean(
      pickFirst(body?.enabled, body?.state),
      'enabled'
    );
    if (enabled === null) {
      throw new Error('sensor_control must include enabled or state');
    }

    payloadObject.sensor = sensorName;
    payloadObject.enabled = enabled;
    summary = `SENSOR_CONTROL ${sensorName.toUpperCase()} ${enabled ? 'RESUME' : 'PAUSE'}`;
  } else if (directCommandType === 'led_control') {
    const enabled = normalizeOptionalBoolean(
      pickFirst(body?.enabled, body?.state),
      'enabled'
    );
    if (enabled === null) {
      throw new Error('led_control must include enabled or state');
    }

    payloadObject.enabled = enabled;
    summary = `LED_CONTROL ${enabled ? 'ON' : 'OFF'}`;
  } else if (directCommandType === 'mppt_acdrv_control') {
    const requestedState = String(body?.state || '').trim().toLowerCase();
    if (!['acdrv1', 'acdrv2', 'disabled'].includes(requestedState)) {
      throw new Error('mppt_acdrv_control state must be acdrv1, acdrv2, or disabled');
    }

    payloadObject.state = requestedState;
    summary = `MPPT_ACDRV_CONTROL ${requestedState.toUpperCase()}`;
  } else {
    const address = normalizeDeviceAddress(pickFirst(
      body?.addr,
      body?.address,
      body?.device_address,
      body?.deviceAddress
    ));
    const registerAddress = normalizeRegisterAddress(pickFirst(
      body?.reg,
      body?.register,
      body?.register_address,
      body?.registerAddress
    ));

    payloadObject.addr = address;
    payloadObject.reg = registerAddress;

    if (directCommandType === 'i2c_read') {
      const requestedLength = Number(pickFirst(body?.len, body?.length, 1));
      if (!Number.isInteger(requestedLength) || requestedLength < 1 || requestedLength > 32) {
        throw new Error('i2c_read len must be an integer from 1 through 32');
      }
      payloadObject.len = requestedLength;
      summary = `I2C_READ ${address} reg ${registerAddress} (${requestedLength} byte${requestedLength === 1 ? '' : 's'})`;
    } else {
      const writePayload = pickFirst(body?.data, body?.value, body?.values);
      if (writePayload === undefined) {
        throw new Error('i2c_write must include data, value, or values');
      }
      payloadObject.data = normalizeWriteData(writePayload);
      validateRegisterWrite(address, registerAddress, payloadObject.data);
      summary = `I2C_WRITE ${address} reg ${registerAddress} (${payloadObject.data.length} byte${payloadObject.data.length === 1 ? '' : 's'})`;
    }
  }

  const payloadPreview = JSON.stringify(payloadObject);

  return {
    transport: 'json',
    payloadBuffer: Buffer.from(payloadPreview, 'utf8'),
    payloadPreview,
    summary,
    requestId,
    commandType: directCommandType,
    issuedAt,
    expectedResult: payloadObject
  };
}

function buildCommandMessage(body) {
  return buildJsonCommandMessage(body);
}

function sendUdpMessage(buffer, target) {
  return new Promise((resolve, reject) => {
    udpSocket.send(buffer, target.port, target.address, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const httpServer = http.createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url,
    `http://${request.headers.host || 'localhost'}`
  );

  try {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && requestUrl.pathname === '/auth/status') {
      sendJson(response, 200, { enabled: sessions.enabled });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      const ready = isCommandAuthorizationConfigured() && (!recorder || recorder.status().ready);
      sendJson(response, ready ? 200 : 503, {
        status: ready ? 'ok' : 'degraded',
        server_time: new Date().toISOString()
      });
      return;
    }
    if (requestUrl.pathname.startsWith('/auth/')) {
      if (!sessions.enabled) { sendJson(response, 200, { enabled: false }); return; }
      if (request.method === 'POST' && requestUrl.pathname === '/auth/login') {
        const { jwt, session } = await sessions.login(request, await readJsonBody(request));
        response.setHeader('Set-Cookie', sessions.cookie(jwt));
        sendJson(response, 200, sessions.publicSession(session));
        return;
      }
      const session = await sessions.authenticate(request);
      if (request.method === 'GET' && requestUrl.pathname === '/auth/me') {
        sendJson(response, 200, sessions.publicSession(session));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/auth/heartbeat') {
        sessions.csrfCheck(request, session);
        if (session.role !== 'operator') throw createHttpError(403, 'An operator account is required');
        sessions.renewOperator(session);
        sendJson(response, 200, sessions.publicSession(session));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/auth/logout') {
        sessions.csrfCheck(request, session);
        sessions.revoke(session.id);
        response.setHeader('Set-Cookie', sessions.cookie('', 0));
        sendJson(response, 200, { signed_out: true });
        return;
      }
      throw createHttpError(404, 'Authentication route not found');
    }
    const session = sessions.enabled ? await sessions.authorize(request) : null;
    if (requestUrl.pathname === '/runs' || requestUrl.pathname.startsWith('/runs/')) {
      if (!recorder) throw createHttpError(503, 'Recording is not enabled');
      // History access is private even when the legacy command bypass is enabled.
      if (!sessions.enabled) {
        if (!commandToken || allowUnauthenticatedCommands) throw createHttpError(503, 'Recording requires command-token authentication');
        assertCommandAuthorized(request);
      }
      response.setHeader('Cache-Control', 'no-store');
      const parts = requestUrl.pathname.split('/').filter(Boolean);
      const query = Object.fromEntries(requestUrl.searchParams);
      if (request.method === 'GET' && parts.length === 1) {
        sendJson(response, 200, { runs: await recorder.call('list', query), recording: recorder.status() });
        return;
      }
      if (request.method === 'POST' && parts.length === 2 && parts[1] === 'start') {
        const body = await readJsonBody(request);
        if (!isTelemetryConnected() || latestEnvelope?.source !== 'udp') {
          throw createHttpError(409, 'Fresh UDP telemetry is required to start recording');
        }
        const run = await recorder.call('start', { name: body.name, envelope: latestEnvelope,
          metadata: { packet_format: latestEnvelope.packet.packet_format, pv_shunt_ohms: pvShuntOhms,
            pv_current_lsb_a: pvCurrentLsbA, bms_user_volt_lsb_v: bmsUserVoltLsbV,
            decoder_revision: process.env.DEPLOYED_REVISION || 'unversioned',
            telemetry_provenance: latestEnvelope.provenance } });
        sendJson(response, 201, { run });
        broadcastStatus();
        return;
      }
      if (request.method === 'POST' && parts.length === 2 && parts[1] === 'stop') {
        const run = await recorder.call('stop', {});
        sendJson(response, 200, { run });
        broadcastStatus();
        return;
      }
      if (request.method === 'POST' && parts.length === 2 && parts[1] === 'events') {
        const body = await readJsonBody(request);
        const marker = await recorder.call('marker', { sequence_name: body.sequence_name,
          step_index: body.step_index, step_text: body.step_text, phase: body.phase,
          ok: body.ok ?? null, result: body.result ?? null, now: Date.now() });
        sendJson(response, 201, { marker });
        return;
      }
      if (request.method === 'GET' && parts.length === 2) {
        sendJson(response, 200, { run: await recorder.call('get', parts[1]) });
        return;
      }
      if (request.method === 'GET' && parts.length === 3 && ['samples', 'events', 'series'].includes(parts[2])) {
        sendJson(response, 200, await recorder.call(parts[2], { ...query, id: parts[1] }));
        return;
      }
      sendJson(response, 404, { error: 'Recording route not found' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      response.write(': CubeSat telemetry event stream\n\n');
      sseClients.add(response);
      if (session) sessions.attachStream(session, response);
      sendSse(response, createStatusMessage());
      if (latestEnvelope !== null) sendSse(response, latestEnvelope);
      if (latestDebugEnvelope !== null) sendSse(response, latestDebugEnvelope);
      if (latestCommandEnvelope !== null) sendSse(response, latestCommandEnvelope);

      request.on('close', () => {
        sseClients.delete(response);
        broadcastStatus();
      });

      broadcastStatus();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      const status = createStatusMessage();
      const healthStatusCode = status.command_auth_configured ? 200 : 503;
      sendJson(response, healthStatusCode, {
        status: status.command_auth_configured ? 'ok' : 'degraded',
        server_time: status.server_time,
        http_address: httpBindAddress,
        http_port: httpPort,
        udp_address: udpBindAddress,
        udp_port: udpPort,
        web_clients: sseClients.size,
        telemetry_connected: status.telemetry_connected,
        telemetry_age_ms: status.telemetry_age_ms,
        telemetry_stale_after_ms: telemetryStaleMs,
        telemetry_endpoint: lastTelemetryEndpoint,
        telemetry_packet_format: status.telemetry_packet_format,
        telemetry_provenance: status.telemetry_provenance,
        telemetry_auth_required: status.telemetry_auth_required,
        telemetry_auth_configured: status.telemetry_auth_configured,
        sensor_polling: sensorPollingState,
        command_auth_required: status.command_auth_required,
        command_auth_configured: status.command_auth_configured,
        command_transport_ready: status.command_transport_ready,
        command_ready: status.command_ready,
        pending_commands: pendingCommands.size,
        debug_mode: latestDebugState,
        live_mode: liveMode.on,
        live_mode_source: liveMode.source,
        live_mode_since: liveMode.since,
        recording: recorder?.status() || { enabled: false },
        default_command_target: commandTargetHost && commandTargetPort
          ? {
              address: commandTargetHost,
              port: commandTargetPort
            }
          : null
      });
      return;
    }

    if (
      request.method === 'GET' &&
      (requestUrl.pathname === '/latest' ||
       requestUrl.pathname === '/api/demo/latest')
    ) {
      sendJson(response, 200, {
        latest: latestEnvelope,
        latest_debug: latestDebugEnvelope,
        latest_command: latestCommandEnvelope,
        telemetry_endpoint: lastTelemetryEndpoint,
        sensor_polling: sensorPollingState,
        pending_commands: [...pendingCommands.values()].map((pending) => ({
          request_id: pending.requestId,
          command_type: pending.commandType,
          summary: pending.summary,
          target: pending.target,
          issued_at: pending.issuedAt
        }))
      });
      return;
    }

    if (
      request.method === 'POST' &&
      (requestUrl.pathname === '/input' ||
       requestUrl.pathname === '/api/demo/input')
    ) {
      const body = await readJsonBody(request);
      if (sessions.enabled) assertCommandAuthorized(request);
      const packet = normalizeIncomingPacket(body);
      latestEnvelope = createEnvelope(packet, 'http-input', null);
      broadcast(latestEnvelope);
      sendJson(response, 200, { accepted: true, envelope: latestEnvelope });
      return;
    }

    if (
      request.method === 'POST' &&
      (requestUrl.pathname === '/live-mode' ||
       requestUrl.pathname === '/api/demo/live-mode')
    ) {
      assertCommandAuthorized(request);
      const body = await readJsonBody(request);
      if (typeof body?.on !== 'boolean') {
        throw createHttpError(400, 'live-mode body must be {"on": true|false}');
      }
      setLiveMode(body.on, body.source);
      broadcastStatus();
      sendJson(response, 200, { live_mode: liveMode.on, live_mode_source: liveMode.source, live_mode_since: liveMode.since });
      return;
    }

    if (
      request.method === 'POST' &&
      (requestUrl.pathname === '/command' ||
       requestUrl.pathname === '/api/demo/command')
    ) {
      assertCommandAuthorized(request);
      const body = await readJsonBody(request);
      const target = resolveCommandTarget();
      const commandMessage = buildCommandMessage(body, target);
      const pendingCommand = {
        ...commandMessage,
        target
      };

      const waitForResult =
        requestUrl.searchParams.get('wait') === '1' || body?.wait === true;
      registerPendingCommand(pendingCommand);
      const resultPromise = waitForResult
        ? waitForCommandResult(
            commandMessage.requestId,
            commandTimeoutMs * ((pendingCommand.maxRetries || 0) + 1) + 1_000
          )
        : null;

      try {
        await sendUdpMessage(commandMessage.payloadBuffer, target);
      } catch (error) {
        cancelPendingCommand(commandMessage.requestId);
        throw createHttpError(
          502,
          error instanceof Error ? error.message : 'UDP command send failed'
        );
      }

      if (pendingCommands.has(commandMessage.requestId)) {
        publishCommandStatus('pending', pendingCommand);
      }

      if (resultPromise) {
        // Synchronous mode for scripted clients (Windows app, debug page sequences).
        const outcome = await resultPromise;
        sendJson(response, 200, {
          accepted: true,
          request_id: commandMessage.requestId,
          summary: commandMessage.summary,
          target,
          issued_at: commandMessage.issuedAt,
          timeout_ms: commandTimeoutMs,
          ...outcome
        });
        return;
      }

      sendJson(response, 202, {
        accepted: true,
        status: 'pending',
        target,
        summary: commandMessage.summary,
        transport: commandMessage.transport,
        bytes: commandMessage.payloadBuffer.length,
        issued_at: commandMessage.issuedAt,
        request_id: commandMessage.requestId,
        timeout_ms: commandTimeoutMs
      });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : 400;
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'invalid request'
    });
  }
});

const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (error) => {
  console.error('[UDP] socket error:', error);
});

udpSocket.on('message', (message, remoteInfo) => {
  if (message.length > maxUdpBytes) {
    console.warn(
      `[UDP] rejected oversized packet from ${remoteInfo.address}:${remoteInfo.port}`
    );
    return;
  }

  let packet;

  try {
    packet = decodeUdpPacket(message);
  } catch (error) {
    console.warn(
      `[UDP] rejected packet from ${remoteInfo.address}:${remoteInfo.port}:`,
      error instanceof Error ? error.message : error
    );
    return;
  }

  const serverReceiveTime = Date.now();

  if (packet.type === 'debug_result') {
    const pending = packet.request_id
      ? pendingCommands.get(packet.request_id)
      : null;

    if (!pending) {
      console.warn(
        `[UDP] ignored unmatched debug_result request=${packet.request_id || 'n/a'} ` +
        `from ${remoteInfo.address}:${remoteInfo.port}`
      );
      return;
    }

    if (!endpointsMatch(remoteInfo, pending.target)) {
      console.warn(
        `[UDP] ignored debug_result request=${packet.request_id} from unexpected endpoint ` +
        `${remoteInfo.address}:${remoteInfo.port}`
      );
      return;
    }

    if (!debugResultMatchesPending(packet, pending)) {
      console.warn(
        `[UDP] ignored mismatched debug_result request=${packet.request_id} ` +
        `command=${packet.command_type} from ${remoteInfo.address}:${remoteInfo.port}`
      );
      return;
    }

    cancelPendingCommand(packet.request_id);
    const roundTripMs = Math.max(
      0,
      serverReceiveTime - Date.parse(pending.issuedAt)
    );
    packet.responded_at = new Date(serverReceiveTime).toISOString();
    packet.round_trip_ms = roundTripMs;

    if (
      packet.ok &&
      packet.command_type === 'sensor_control' &&
      Number.isInteger(packet.active_sensor_mask)
    ) {
      sensorPollingState = createSensorPollingState(
        packet.active_sensor_mask,
        'node-response'
      );
    }

    latestDebugEnvelope = createEnvelope(packet, 'udp', {
      remote_address: remoteInfo.address,
      remote_port: remoteInfo.port,
      bytes: remoteInfo.size
    });

    broadcast(latestDebugEnvelope);
    publishCommandStatus(packet.ok ? 'completed' : 'failed', pending, {
      round_trip_ms: roundTripMs,
      error: packet.error
    });

    console.log(
      `[UDP] debug_result ${packet.command_type} ` +
      `request=${packet.request_id || 'n/a'} ` +
      `status=${packet.status} from ${remoteInfo.address}:${remoteInfo.port}`
    );
    return;
  }

  lastTelemetryEndpoint = {
    address: remoteInfo.address,
    port: remoteInfo.port,
    last_seen: new Date(serverReceiveTime).toISOString(),
    packet_format: packet.packet_format || 'json'
  };

  latestDebugState = packet.debug
    ? { ...packet.debug, link: packet.link || null, updated_at: lastTelemetryEndpoint.last_seen }
    : { enabled: false, packet_format: packet.packet_format || 'json', updated_at: lastTelemetryEndpoint.last_seen };

  if (Number.isInteger(packet.sensor_polling?.active_sensor_mask)) {
    sensorPollingState = createSensorPollingState(
      packet.sensor_polling.active_sensor_mask,
      'telemetry-packet',
      lastTelemetryEndpoint.last_seen
    );
  } else if (sensorPollingState === null) {
    sensorPollingState = createSensorPollingState(
      allSensorMask,
      'firmware-default',
      lastTelemetryEndpoint.last_seen
    );
  }

  latestEnvelope = createEnvelope(packet, 'udp', {
    remote_address: remoteInfo.address,
    remote_port: remoteInfo.port,
    bytes: remoteInfo.size
  });

  // Persist only validated hardware UDP telemetry, never /input or browser simulation.
  if (recorder) {
    const archived = archivePayload(message);
    recorder.capture('ingest', { envelope: { ...latestEnvelope, raw_auth_redacted: archived.redacted }, rawBase64: archived.rawBase64 });
  }

  const acknowledgement = Buffer.from(JSON.stringify({
    version: 1,
    type: 'ack',
    device_id: packet.device_id,
    seq: packet.seq,
    server_rx_ms: serverReceiveTime,
    received_at: latestEnvelope.received_at
  }));

  udpSocket.send(
    acknowledgement,
    remoteInfo.port,
    remoteInfo.address,
    (error) => {
      if (error) console.error('[UDP] ACK send failed:', error);
    }
  );

  broadcast(latestEnvelope);
  broadcastStatus();

  console.log(
    `[UDP] ${packet.device_id} seq=${packet.seq} ` +
    `from ${remoteInfo.address}:${remoteInfo.port}`
  );
});

const heartbeatTimer = setInterval(() => {
  const heartbeat = `: heartbeat ${new Date().toISOString()}\n\n`;
  for (const response of sseClients) {
    if (!response.destroyed) response.write(heartbeat);
  }
}, 15_000);
heartbeatTimer.unref();

const statusTimer = setInterval(() => {
  const telemetryConnected = isTelemetryConnected();
  if (telemetryConnected !== lastBroadcastTelemetryConnected) {
    broadcastStatus();
  }
}, 500);
statusTimer.unref();

udpSocket.bind(udpPort, udpBindAddress, () => {
  const address = udpSocket.address();
  console.log(`[UDP] listening on ${address.address}:${address.port}`);
});

httpServer.listen(httpPort, httpBindAddress, () => {
  console.log(`[HTTP] listening on http://${httpBindAddress}:${httpPort}`);
  console.log(`[HTTP] events: /events`);
  console.log(`[HTTP] health: /health`);
  if (!isCommandAuthorizationConfigured()) {
    console.warn('[HTTP] command control disabled: configure COMMAND_TOKEN');
  } else if (allowUnauthenticatedCommands && !sessions.enabled) {
    console.warn('[HTTP] command control is running without authentication');
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SYSTEM] received ${signal}; shutting down`);
  clearInterval(heartbeatTimer);
  clearInterval(statusTimer);

  for (const pending of pendingCommands.values()) {
    clearTimeout(pending.timeoutHandle);
  }
  pendingCommands.clear();

  for (const response of sseClients) response.end();
  sseClients.clear();

  setTimeout(() => process.exit(1), 5_000).unref();
  if (recorder) await recorder.close().catch(() => {});

  udpSocket.close(() => {
    httpServer.close(() => process.exit(0));
  });

}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
