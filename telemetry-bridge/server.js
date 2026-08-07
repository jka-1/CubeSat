import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';

const httpPort = readPort('HTTP_PORT', 8080);
const udpPort = readPort('UDP_PORT', 3333);
const httpBindAddress = process.env.HTTP_BIND_ADDRESS || '127.0.0.1';
const udpBindAddress = process.env.UDP_BIND_ADDRESS || '0.0.0.0';
const telemetryToken = process.env.TELEMETRY_TOKEN || '';
const maxUdpBytes = Number(process.env.MAX_UDP_BYTES || 4096);
const hexDeviceId = process.env.HEX_DEVICE_ID || 'esp32-telemetry';
const hexPacketMagic = 0x4353;
const hexPacketVersionRawIna226 = 0x0001;
const hexPacketVersionEngineering = 0x0002;
const hexPacketVersionValidatedRaw = 0x0003;
const hexPacketWordCount = 16;
const hexPacketByteCount = hexPacketWordCount * 2;
const pvCurrentLsbA = readFiniteNumber('PV_INA226_CURRENT_LSB_A', 0.001);
const pvShuntOhms = readFiniteNumber('PV_INA226_SHUNT_OHMS', 100);
const loadCurrentLsbA = readFiniteNumber('LOAD_INA226_CURRENT_LSB_A', 0.001);
const commandTargetHost = String(process.env.COMMAND_TARGET_HOST || '').trim();
const commandTargetPort = readOptionalPort('COMMAND_TARGET_PORT');
const commandToken = String(process.env.COMMAND_TOKEN || '');
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
  [0x40, 'PV / INA226'],
  [0x6b, 'MPPT / BQ25798']
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

function isCommandAuthorizationConfigured() {
  return allowUnauthenticatedCommands || commandToken.length > 0;
}

function assertCommandAuthorized(request) {
  if (allowUnauthenticatedCommands) return;

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
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error(`${fieldName} must not be blank`);
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

function decodeOptionalTemperatureC(word) {
  return word === 0x8000 ? null : decodeSignedWord(word) / 100;
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

  if (compact.length !== hexPacketWordCount * 4) {
    throw new Error(
      `hex packet must contain exactly ${hexPacketWordCount} words`
    );
  }

  const words = [];

  for (let offset = 0; offset < compact.length; offset += 4) {
    words.push(Number.parseInt(compact.slice(offset, offset + 4), 16));
  }

  return words;
}

function extractHexWordsFromRawBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== hexPacketByteCount) {
    throw new Error(
      `raw hex packet must contain exactly ${hexPacketByteCount} bytes`
    );
  }

  const words = [];

  for (let offset = 0; offset < buffer.length; offset += 2) {
    words.push(buffer.readUInt16BE(offset));
  }

  return words;
}

function normalizeHexPacketWords(words) {
  if (!Array.isArray(words) || words.length !== hexPacketWordCount) {
    throw new Error(`hex packet must contain ${hexPacketWordCount} words`);
  }

  if (words[0] !== hexPacketMagic) {
    throw new Error(`invalid hex packet magic 0x${words[0].toString(16).padStart(4, '0')}`);
  }

  const versionWord = words[1];

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
          temperatureC: decodeSignedWord(words[3]) / 100
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
        load: {
          shuntVoltageMv: decodeIna226ShuntMv(words[13]),
          powerW: decodeIna226PowerW(words[14], loadCurrentLsbA),
          currentA: decodeIna226CurrentA(words[15], loadCurrentLsbA)
        }
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
          temperatureC: decodeSignedWord(words[3]) / 100
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
        load: {
          shuntVoltageMv: decodeCentiMilliVolts(words[13]),
          powerW: decodeCentiWatts(words[14]),
          currentA: decodeMilliamps(words[15])
        }
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
          temperatureC: decodeOptionalTemperatureC(words[3])
        },
        pv: {
          shuntVoltageMv: decodeIna226ShuntMv(words[5]),
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

  throw new Error(`unsupported hex packet version 0x${versionWord.toString(16).padStart(4, '0')}`);
}

function normalizeHexPacketText(text) {
  return normalizeHexPacketWords(extractHexWordsFromText(text));
}

function normalizeLegacyTelemetry(value) {
  const telemetry = {
    solar_panel_current_a: Number(value.solar_panel_current_a),
    battery_voltage_v: Number(value.battery_voltage_v),
    mppt_switch_temperature_c: Number(value.mppt_switch_temperature_c),
    esp32_temperature_c: Number(value.esp32_temperature_c)
  };

  for (const [name, fieldValue] of Object.entries(telemetry)) {
    if (!isFiniteNumber(fieldValue)) {
      return null;
    }
  }

  return telemetry;
}

function normalizeGroupedTelemetry(value) {
  const mcuTemperature = pickFirst(
    value?.mcu?.temperatureC,
    value?.mcu?.temperature_c,
    value?.mcu_temp_c,
    value?.mcuTemperatureC,
    value?.esp32_temperature_c
  );

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

  const loadShuntVoltageMv = pickFirst(
    value?.load?.shuntVoltageMv,
    value?.load?.shunt_voltage_mv,
    value?.load?.shunt_mv,
    value?.load_shunt_voltage_mv
  );

  const loadPowerW = pickFirst(
    value?.load?.powerW,
    value?.load?.power_w,
    value?.load_power_w
  );

  const loadCurrentA = pickFirst(
    value?.load?.currentA,
    value?.load?.current_a,
    value?.load_current_a
  );

  return {
    mcu: {
      temperatureC: asFiniteNumber(mcuTemperature, 'mcu.temperatureC')
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
    load: {
      shuntVoltageMv: asFiniteNumber(loadShuntVoltageMv, 'load.shuntVoltageMv'),
      powerW: asFiniteNumber(loadPowerW, 'load.powerW'),
      currentA: asFiniteNumber(loadCurrentA, 'load.currentA')
    }
  };
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
    return normalizeIncomingPacket(parsed);
  }

  if (looksLikeHexPacketText(text)) {
    return normalizeHexPacketText(text);
  }

  if (message.length === hexPacketByteCount) {
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
        source: 'configured'
      }
    : telemetryConnected
      ? {
          address: lastTelemetryEndpoint.address,
          port: lastTelemetryEndpoint.port,
          source: 'telemetry'
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
    sensor_polling: sensorPollingState,
    command_auth_required: !allowUnauthenticatedCommands,
    command_auth_configured: isCommandAuthorizationConfigured(),
    command_transport_ready: commandTransportReady,
    command_ready: commandTransportReady && isCommandAuthorizationConfigured(),
    command_target: activeCommandTarget,
    pending_commands: pendingCommands.size
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

function publishCommandStatus(status, command, extra = {}) {
  latestCommandEnvelope = createCommandEnvelope(status, command, extra);
  broadcast(latestCommandEnvelope);
  broadcastStatus();
}

function registerPendingCommand(command) {
  if (pendingCommands.has(command.requestId)) {
    throw createHttpError(409, 'request_id is already pending');
  }

  const timeoutHandle = setTimeout(() => {
    const pending = pendingCommands.get(command.requestId);
    if (!pending) return;

    pendingCommands.delete(command.requestId);
    publishCommandStatus('timed_out', pending, {
      error: `No ESP32 response arrived within ${commandTimeoutMs} ms.`
    });
  }, commandTimeoutMs);
  timeoutHandle.unref();

  pendingCommands.set(command.requestId, {
    ...command,
    timeoutHandle
  });
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
      source: 'configured'
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
      source: 'telemetry'
    };
  }

  throw new Error(
    'No live command target is available. Wait for fresh telemetry or configure COMMAND_TARGET_HOST and COMMAND_TARGET_PORT.'
  );
}

function buildCommandMessage(body) {
  const issuedAt = new Date().toISOString();
  const directCommandType = String(body?.type || '')
    .trim()
    .toLowerCase();

  if (![
    'i2c_read',
    'i2c_write',
    'sensor_control',
    'mppt_acdrv_control',
    'led_control'
  ].includes(directCommandType)) {
    throw new Error(
      'type must be i2c_read, i2c_write, sensor_control, mppt_acdrv_control, or led_control'
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

  if (directCommandType === 'sensor_control') {
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
    if (request.method === 'GET' && requestUrl.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      response.write(': CubeSat telemetry event stream\n\n');
      sseClients.add(response);
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
        sensor_polling: sensorPollingState,
        command_auth_required: status.command_auth_required,
        command_auth_configured: status.command_auth_configured,
        command_transport_ready: status.command_transport_ready,
        command_ready: status.command_ready,
        pending_commands: pendingCommands.size,
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
      const packet = normalizeIncomingPacket(body);
      latestEnvelope = createEnvelope(packet, 'http-input', null);
      broadcast(latestEnvelope);
      sendJson(response, 200, { accepted: true, envelope: latestEnvelope });
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
      const commandMessage = buildCommandMessage(body);
      const pendingCommand = {
        ...commandMessage,
        target
      };

      registerPendingCommand(pendingCommand);

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
    last_seen: new Date(serverReceiveTime).toISOString()
  };

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
  } else if (allowUnauthenticatedCommands) {
    console.warn('[HTTP] command control is running without authentication');
  }
});

function shutdown(signal) {
  console.log(`[SYSTEM] received ${signal}; shutting down`);
  clearInterval(heartbeatTimer);
  clearInterval(statusTimer);

  for (const pending of pendingCommands.values()) {
    clearTimeout(pending.timeoutHandle);
  }
  pendingCommands.clear();

  for (const response of sseClients) response.end();
  sseClients.clear();

  udpSocket.close(() => {
    httpServer.close(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
