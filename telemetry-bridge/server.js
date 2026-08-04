import dgram from 'node:dgram';
import http from 'node:http';

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
const pvShuntOhms = readFiniteNumber('PV_INA226_SHUNT_OHMS', 0.1);
const loadCurrentLsbA = readFiniteNumber('LOAD_INA226_CURRENT_LSB_A', 0.001);
const commandTargetHost = String(process.env.COMMAND_TARGET_HOST || '').trim();
const commandTargetPort = readOptionalPort('COMMAND_TARGET_PORT');
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
let lastTelemetryEndpoint = null;
let generatedSequence = 1_000_000;
const sseClients = new Set();

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

function asPort(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${fieldName} must be an integer from 1 through 65535`);
  }
  return parsed;
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

function decodeUdpPacket(message) {
  const text = message.toString('utf8').trim();

  if (text.startsWith('{')) {
    return normalizeIncomingPacket(JSON.parse(text));
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
    type: 'telemetry',
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
  return {
    type: 'status',
    server_time: new Date().toISOString(),
    udp_port: udpPort,
    web_clients: sseClients.size,
    telemetry_connected: Boolean(lastTelemetryEndpoint),
    telemetry_endpoint: lastTelemetryEndpoint,
    command_ready: Boolean(
      lastTelemetryEndpoint ||
      (commandTargetHost && commandTargetPort)
    )
  };
}

function broadcastStatus() {
  broadcast(createStatusMessage());
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

function resolveCommandTarget(body) {
  const requestedHost = String(
    pickFirst(body?.target_host, body?.targetHost, commandTargetHost || null) || ''
  ).trim();

  const requestedPort = pickFirst(
    body?.target_port,
    body?.targetPort,
    commandTargetPort
  );

  if (requestedHost && requestedPort) {
    return {
      address: requestedHost,
      port: asPort(requestedPort, 'command target port')
    };
  }

  if (lastTelemetryEndpoint?.address && lastTelemetryEndpoint?.port) {
    return {
      address: lastTelemetryEndpoint.address,
      port: lastTelemetryEndpoint.port
    };
  }

  throw new Error(
    'No command target is available yet. Connect telemetry first or provide COMMAND_TARGET_HOST and COMMAND_TARGET_PORT.'
  );
}

function buildCommandMessage(body) {
  const issuedAt = new Date().toISOString();

  if (typeof body?.payload === 'string' && body.payload.trim()) {
    return {
      transport: 'utf8',
      payloadBuffer: Buffer.from(body.payload.trim(), 'utf8'),
      payloadPreview: body.payload.trim(),
      summary: 'raw command payload'
    };
  }

  const payloadHex = String(
    pickFirst(body?.payload_hex, body?.payloadHex, '')
  ).trim();

  if (payloadHex) {
    const compact = payloadHex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
    if (compact.length === 0 || compact.length % 2 !== 0) {
      throw new Error('payload_hex must contain an even number of hex characters');
    }

    return {
      transport: 'raw-hex',
      payloadBuffer: Buffer.from(compact, 'hex'),
      payloadPreview: compact.toUpperCase(),
      summary: 'raw hex command payload'
    };
  }

  const directCommandType = String(body?.type || '')
    .trim()
    .toLowerCase();

  if (['i2c_read', 'i2c_write'].includes(directCommandType)) {
    const normalizedBody = {
      ...body,
      type: directCommandType,
      issued_at: pickFirst(body?.issued_at, body?.issuedAt, issuedAt)
    };

    const deviceAddress = pickFirst(
      body?.addr,
      body?.address,
      body?.device_address,
      body?.deviceAddress
    );
    const registerAddress = pickFirst(
      body?.reg,
      body?.register,
      body?.register_address,
      body?.registerAddress
    );

    if (deviceAddress === undefined || registerAddress === undefined) {
      throw new Error('Direct I2C commands must include both addr and reg');
    }

    if (directCommandType === 'i2c_read') {
      const requestedLength = Number(pickFirst(body?.len, body?.length, 1));
      if (!Number.isInteger(requestedLength) || requestedLength < 1 || requestedLength > 32) {
        throw new Error('i2c_read len must be an integer from 1 through 32');
      }
      normalizedBody.len = requestedLength;
    } else {
      const writePayload = pickFirst(body?.data, body?.value, body?.values);
      if (writePayload === undefined) {
        throw new Error('i2c_write must include data, value, or values');
      }
    }

    const payloadPreview = JSON.stringify(normalizedBody);

    return {
      transport: 'json',
      payloadBuffer: Buffer.from(payloadPreview, 'utf8'),
      payloadPreview,
      summary: `${directCommandType.toUpperCase()} ${String(deviceAddress)} reg ${String(registerAddress)}`
    };
  }

  const target = String(pickFirst(body?.target, body?.command_target, '') || '')
    .trim()
    .toLowerCase();
  const state = String(pickFirst(body?.state, body?.value, '') || '')
    .trim()
    .toLowerCase();

  if (!target || !state) {
    throw new Error('Command requests must include payload, payload_hex, or both target and state');
  }

  if (!['mppt', 'led'].includes(target)) {
    throw new Error('target must be either mppt or led');
  }

  if (!['on', 'off'].includes(state)) {
    throw new Error('state must be on or off');
  }

  const payloadObject = {
    version: 1,
    type: 'command',
    target,
    state,
    issued_at: issuedAt
  };

  return {
    transport: 'json',
    payloadBuffer: Buffer.from(JSON.stringify(payloadObject), 'utf8'),
    payloadPreview: JSON.stringify(payloadObject),
    summary: `${target.toUpperCase()} ${state.toUpperCase()}`
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

      request.on('close', () => {
        sseClients.delete(response);
        broadcastStatus();
      });

      broadcastStatus();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        server_time: new Date().toISOString(),
        http_address: httpBindAddress,
        http_port: httpPort,
        udp_address: udpBindAddress,
        udp_port: udpPort,
        web_clients: sseClients.size,
        telemetry_connected: Boolean(lastTelemetryEndpoint),
        telemetry_endpoint: lastTelemetryEndpoint,
        command_ready: Boolean(
          lastTelemetryEndpoint ||
          (commandTargetHost && commandTargetPort)
        ),
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
        telemetry_endpoint: lastTelemetryEndpoint
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
      const body = await readJsonBody(request);
      const target = resolveCommandTarget(body);
      const commandMessage = buildCommandMessage(body);

      await sendUdpMessage(commandMessage.payloadBuffer, target);

      sendJson(response, 200, {
        accepted: true,
        target,
        summary: commandMessage.summary,
        transport: commandMessage.transport,
        bytes: commandMessage.payloadBuffer.length,
        issued_at: new Date().toISOString(),
        payload_preview: commandMessage.payloadPreview
      });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    sendJson(response, 400, {
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
  lastTelemetryEndpoint = {
    address: remoteInfo.address,
    port: remoteInfo.port,
    last_seen: new Date(serverReceiveTime).toISOString()
  };

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

udpSocket.bind(udpPort, udpBindAddress, () => {
  const address = udpSocket.address();
  console.log(`[UDP] listening on ${address.address}:${address.port}`);
});

httpServer.listen(httpPort, httpBindAddress, () => {
  console.log(`[HTTP] listening on http://${httpBindAddress}:${httpPort}`);
  console.log(`[HTTP] events: /events`);
  console.log(`[HTTP] health: /health`);
});

function shutdown(signal) {
  console.log(`[SYSTEM] received ${signal}; shutting down`);
  clearInterval(heartbeatTimer);

  for (const response of sseClients) response.end();
  sseClients.clear();

  udpSocket.close(() => {
    httpServer.close(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
