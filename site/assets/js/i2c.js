const initialTelemetry = {
  mcu: {
    temperatureC: 36.4
  },
  pv: {
    shuntVoltageMv: 2.2,
    powerW: 48.7,
    currentA: 1.24
  },
  mppt: {
    switchState: 'on',
    faults: []
  },
  bms: {
    cellVoltagesV: [4.02, 4.01, 3.99, 4.00]
  },
  load: {
    shuntVoltageMv: 1.8,
    powerW: 21.3,
    currentA: 0.98
  }
};

const meterRanges = {
  mcuTemperatureC: { min: 0, max: 100 },
  shuntVoltageMv: { min: 0, max: 10 },
  powerW: { min: 0, max: 100 },
  currentA: { min: 0, max: 5 },
  cellVoltageV: { min: 3.0, max: 4.3 }
};

const mockMetadata = {
  deviceId: 'Mock source',
  sequence: '--',
  transmittedAt: 'Mock mode',
  receivedAt: 'Local render'
};

const sensorDefaults = {
  pv: '0x40',
  bms: '0x08',
  mppt: '0x6B',
  all: ''
};
const sensorGroups = [
  { key: 'pv', label: 'PV / INA226', mask: 0x01 },
  { key: 'bms', label: 'BMS / BQ76942', mask: 0x02 },
  { key: 'mppt', label: 'MPPT / BQ25798', mask: 0x04 }
];
const allSensorMask = sensorGroups.reduce((mask, group) => mask | group.mask, 0);

let state = structuredClone(initialTelemetry);
let streamMetadata = { ...mockMetadata };
let mockTimer = null;
let eventSource = null;
let streamErrorLogged = false;
let sensorPollingState = null;
let bridgeCommandReady = false;
let commandAuthRequired = true;
const pendingCommandIds = new Set();
const finishedCommandIds = new Set();

const commandButtonIds = [
  'sendDebugCommandButton',
  'pauseSensorButton',
  'resumeSensorButton',
  'applyAcdrvButton',
  'ledOnButton',
  'ledOffButton'
];

function deriveCommandUrl(streamUrl) {
  if (typeof streamUrl !== 'string' || !streamUrl.trim()) {
    return '/telemetry/command';
  }

  const trimmed = streamUrl.trim();
  if (trimmed.endsWith('/events')) {
    return `${trimmed.slice(0, -'/events'.length)}/command`;
  }

  return '/telemetry/command';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
  const number = numericValue(value);
  return number === null ? '--' : number.toFixed(digits);
}

function formatValue(value, unit, digits = 2) {
  return `${formatNumber(value, digits)} ${unit}`;
}

function formatTime(value) {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function writeLog(message) {
  const telemetryLog = document.getElementById('telemetryLog');
  if (!telemetryLog) return;
  const timestamp = new Date().toLocaleTimeString();
  telemetryLog.textContent = `[${timestamp}] ${message}\n${telemetryLog.textContent}`;
}

function writeCommandResult(message) {
  const commandResultLog = document.getElementById('commandResultLog');
  if (!commandResultLog) return;
  const timestamp = new Date().toLocaleTimeString();
  commandResultLog.textContent = `[${timestamp}] ${message}\n${commandResultLog.textContent}`;
}

function setStreamStatus(text, online = false) {
  const streamStatus = document.getElementById('i2cBusStatus');
  if (!streamStatus) return;
  streamStatus.textContent = text;
  streamStatus.classList.toggle('offline', !online);
  streamStatus.classList.toggle('online', online);
}

function setDetailNote(text) {
  const detailDataNote = document.getElementById('detailDataNote');
  if (detailDataNote) detailDataNote.textContent = text;
}

function setCommandTargetNote(text) {
  const commandTargetNote = document.getElementById('commandTargetNote');
  if (commandTargetNote) commandTargetNote.textContent = text;
}

function setNodeAddressNote(text) {
  const nodeAddressNote = document.getElementById('nodeAddressNote');
  if (nodeAddressNote) nodeAddressNote.textContent = text;
}

function setSensorPollingNote(text) {
  const sensorPollingNote = document.getElementById('sensorPollingNote');
  if (sensorPollingNote) sensorPollingNote.textContent = text;
}

function setCommandAvailabilityNote(text) {
  const commandAvailabilityNote = document.getElementById('commandAvailabilityNote');
  if (commandAvailabilityNote) commandAvailabilityNote.textContent = text;
}

function commandTokenValue() {
  return document.getElementById('commandTokenInput')?.value?.trim() || '';
}

function updateCommandControls() {
  const credentialReady = !commandAuthRequired || commandTokenValue().length > 0;
  const noCommandPending = pendingCommandIds.size === 0;
  const enabled = bridgeCommandReady && credentialReady && noCommandPending;

  commandButtonIds.forEach((buttonId) => {
    const button = document.getElementById(buttonId);
    if (button) button.disabled = !enabled;
  });

  if (!bridgeCommandReady) {
    setCommandAvailabilityNote(
      'Debug controls are locked until the bridge has a fresh ESP32 command target.'
    );
  } else if (!credentialReady) {
    setCommandAvailabilityNote(
      'Enter the temporary lab command token to unlock pause, resume, read, and write controls.'
    );
  } else if (!noCommandPending) {
    setCommandAvailabilityNote(
      'Waiting for the ESP32 to finish the current command before another command is sent.'
    );
  } else {
    setCommandAvailabilityNote(
      'Debug, verified ACDRV, and GPIO-38 RGB LED controls are ready.'
    );
  }
}

function trackPendingCommand(requestId, summary) {
  if (!requestId) return;
  if (finishedCommandIds.has(requestId)) return;
  if (pendingCommandIds.has(requestId)) {
    updateCommandControls();
    return;
  }
  pendingCommandIds.add(requestId);
  writeCommandResult(`${summary || 'Command'} request ${requestId} pending ESP32 response.`);
  updateCommandControls();
}

function finishPendingCommand(requestId) {
  if (requestId) {
    pendingCommandIds.delete(requestId);
    finishedCommandIds.add(requestId);
    if (finishedCommandIds.size > 100) {
      finishedCommandIds.delete(finishedCommandIds.values().next().value);
    }
  }
  updateCommandControls();
}

function formatEndpoint(endpoint) {
  if (!endpoint?.address || !endpoint?.port) return null;
  return `${endpoint.address}:${endpoint.port}`;
}

function normalizeSensorMask(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed & allSensorMask;
}

function createSensorPollingState(activeMask, source = 'node-response', updatedAt = null) {
  const normalizedMask = activeMask & allSensorMask;
  const pausedSensors = sensorGroups
    .filter((group) => (normalizedMask & group.mask) === 0)
    .map((group) => group.label);

  return {
    activeMask: normalizedMask,
    pausedSensors,
    allEnabled: pausedSensors.length === 0,
    source,
    updatedAt
  };
}

function applySensorPollingState(candidate) {
  const activeMask = normalizeSensorMask(
    candidate?.active_sensor_mask ?? candidate?.activeSensorMask ?? candidate?.activeMask
  );

  if (activeMask === null) return;

  sensorPollingState = createSensorPollingState(
    activeMask,
    candidate?.source || 'node-response',
    candidate?.updated_at || candidate?.updatedAt || null
  );

  if (sensorPollingState.allEnabled) {
    const suffix = sensorPollingState.source === 'firmware-default'
      ? ' (firmware default after boot).'
      : '.';
    setSensorPollingNote(`Automatic polling is active for all sensor groups${suffix}`);
    return;
  }

  setSensorPollingNote(
    `Automatic polling is paused for ${sensorPollingState.pausedSensors.join(', ')}. ` +
      'Displayed telemetry for paused groups is held until polling resumes.'
  );
}

function applyDebugCommandMode() {
  const commandType = document.getElementById('debugCommandType');
  const lenInput = document.getElementById('debugLenInput');
  const dataInput = document.getElementById('debugDataInput');

  if (!commandType || !lenInput || !dataInput) return;

  const isRead = commandType.value === 'i2c_read';
  lenInput.disabled = !isRead;
  dataInput.disabled = isRead;

  if (isRead) {
    dataInput.placeholder = 'Write data is not used for reads';
  } else {
    dataInput.placeholder = 'Write bytes, for example 0x0A 0x00';
  }
}

function onSensorControlSelectChange() {
  const sensorSelect = document.getElementById('sensorControlSelect');
  const addrInput = document.getElementById('debugAddrInput');

  if (!sensorSelect || !addrInput) return;

  const defaultAddress = sensorDefaults[sensorSelect.value];
  if (defaultAddress) {
    addrInput.value = defaultAddress;
  }
}

function statusColor(status) {
  if (status === 'fault') return 'var(--danger)';
  if (status === 'watch') return 'var(--warning)';
  if (status === 'idle') return 'var(--white-soft)';
  return 'var(--success)';
}

function normalizePercent(value, range) {
  const number = numericValue(value);
  if (number === null) return 0;
  return clamp(((number - range.min) / (range.max - range.min)) * 100, 0, 100);
}

function normalizeSwitchState(value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value === 0 ? 'off' : 'on';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['on', 'enabled', 'closed', '1', 'true'].includes(normalized)) return 'on';
    if (['off', 'disabled', 'open', '0', 'false'].includes(normalized)) return 'off';
    return normalized || 'unknown';
  }
  return 'unknown';
}

function normalizeFaults(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .filter((entry) => entry.toLowerCase() !== 'none');
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || normalized.toLowerCase() === 'none') return [];
    return [normalized];
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, isActive]) => Boolean(isActive))
      .map(([faultName]) => faultName);
  }

  return [];
}

function hasPowerTelemetry(section) {
  if (!section || typeof section !== 'object') return false;

  return [
    numericValue(section.shuntVoltageMv),
    numericValue(section.powerW),
    numericValue(section.currentA)
  ].some((value) => value !== null);
}

function summarizeCellVoltage(voltage) {
  const number = numericValue(voltage);
  if (number === null) return 'idle';
  if (number < 3.5 || number > 4.2) return 'fault';
  if (number < 3.75 || number > 4.1) return 'watch';
  return 'nominal';
}

function summarizeTemperature(temperatureC) {
  const number = numericValue(temperatureC);
  if (number === null) return 'idle';
  if (number >= 75) return 'fault';
  if (number >= 60) return 'watch';
  return 'nominal';
}

function summarizeMeter(value, range) {
  const number = numericValue(value);
  if (number === null) return 'idle';
  if (number >= range.max) return 'watch';
  return 'nominal';
}

function meterRow(title, valueText, percent, status, subtitle = '') {
  return `
    <article class="cell-row">
      <div class="cell-top">
        <div>${title}</div>
        <span style="color: ${statusColor(status)}">${status.toUpperCase()}</span>
      </div>
      <div class="bar" aria-hidden="true">
        <div class="bar-fill" style="width: ${clamp(percent, 0, 100)}%"></div>
      </div>
      <div class="cell-meta">
        <span><strong>${valueText}</strong></span>
        ${subtitle ? `<span>${subtitle}</span>` : ''}
      </div>
    </article>
  `;
}

function renderMetadata(metadata) {
  document.getElementById('summaryDeviceId').textContent = metadata.deviceId || 'Unknown device';
  document.getElementById('summarySequence').textContent = metadata.sequence ?? '--';
  document.getElementById('summaryTransmittedAt').textContent = metadata.transmittedAt || 'Not supplied';
  document.getElementById('summaryReceivedAt').textContent = metadata.receivedAt || 'Not supplied';
}

function renderSystemSummary(telemetry) {
  const pvPower = numericValue(telemetry.pv.powerW);
  const loadAvailable = hasPowerTelemetry(telemetry.load);
  const loadPower = loadAvailable ? numericValue(telemetry.load.powerW) : null;
  const netPower =
    pvPower !== null && loadPower !== null ? (pvPower - loadPower).toFixed(2) : '--';

  document.getElementById('summaryMcuTemp').textContent = formatValue(telemetry.mcu.temperatureC, '°C', 1);
  document.getElementById('summaryMpptState').textContent = String(telemetry.mppt.switchState || '--').toUpperCase();
  document.getElementById('summaryPvPower').textContent = formatValue(telemetry.pv.powerW, 'W', 2);
  document.getElementById('summaryLoadPower').textContent = loadAvailable
    ? formatValue(telemetry.load.powerW, 'W', 2)
    : 'Not wired';
  document.getElementById('summaryNetPower').textContent = loadAvailable
    ? `${netPower} W`
    : 'PV only';
}

function renderMcuCard(telemetry) {
  const mcuMeters = document.getElementById('mcuMeters');
  if (!mcuMeters) return;

  const temperature = telemetry.mcu.temperatureC;
  const status = summarizeTemperature(temperature);

  document.getElementById('mcuTemperatureValue').textContent = formatValue(temperature, '°C', 1);
  document.getElementById('mcuTemperatureStatus').textContent = status.toUpperCase();

  mcuMeters.innerHTML = meterRow(
    'ESP32 Temperature Sensor',
    formatValue(temperature, '°C', 1),
    normalizePercent(temperature, meterRanges.mcuTemperatureC),
    status,
    status === 'idle' ? 'Waiting for live packet data.' : 'MCU internal temperature.'
  );
}

function renderPowerCard(prefix, label, telemetrySection) {
  const shuntValueId = `${prefix}ShuntValue`;
  const powerValueId = `${prefix}PowerValue`;
  const currentValueId = `${prefix}CurrentValue`;
  const metersId = `${prefix}Meters`;
  const metersElement = document.getElementById(metersId);
  if (!metersElement) return;

  if (!hasPowerTelemetry(telemetrySection)) {
    document.getElementById(shuntValueId).textContent = '-- mV';
    document.getElementById(powerValueId).textContent = '-- W';
    document.getElementById(currentValueId).textContent = '-- A';

    metersElement.innerHTML = meterRow(
      `${label} Telemetry`,
      'UNAVAILABLE',
      0,
      'idle',
      'This sensor is not present in the current validated hardware build.'
    );
    return;
  }

  const shuntVoltageMv = telemetrySection.shuntVoltageMv;
  const powerW = telemetrySection.powerW;
  const currentA = telemetrySection.currentA;

  document.getElementById(shuntValueId).textContent = formatValue(shuntVoltageMv, 'mV', 2);
  document.getElementById(powerValueId).textContent = formatValue(powerW, 'W', 2);
  document.getElementById(currentValueId).textContent = formatValue(currentA, 'A', 2);

  metersElement.innerHTML = [
    meterRow(
      `${label} Shunt Voltage`,
      formatValue(shuntVoltageMv, 'mV', 2),
      normalizePercent(shuntVoltageMv, meterRanges.shuntVoltageMv),
      summarizeMeter(shuntVoltageMv, meterRanges.shuntVoltageMv),
      'Reported directly from INA226 telemetry.'
    ),
    meterRow(
      `${label} Power`,
      formatValue(powerW, 'W', 2),
      normalizePercent(powerW, meterRanges.powerW),
      summarizeMeter(powerW, meterRanges.powerW)
    ),
    meterRow(
      `${label} Current`,
      formatValue(currentA, 'A', 2),
      normalizePercent(currentA, meterRanges.currentA),
      summarizeMeter(currentA, meterRanges.currentA)
    )
  ].join('');
}

function renderMpptCard(telemetry) {
  const mpptFaults = document.getElementById('mpptFaults');
  if (!mpptFaults) return;

  const switchState = normalizeSwitchState(telemetry.mppt.switchState);
  const faults = normalizeFaults(telemetry.mppt.faults);
  const isFaulted = faults.length > 0;
  const switchStatus =
    switchState === 'unknown'
      ? 'idle'
      : isFaulted
        ? 'fault'
        : ['on', 'acdrv1', 'acdrv2'].includes(switchState)
          ? 'nominal'
          : 'watch';
  const switchLabel =
    switchState === 'acdrv1' ? 'ACDRV1' :
    switchState === 'acdrv2' ? 'ACDRV2' :
    switchState.toUpperCase();

  document.getElementById('mpptStateValue').textContent = switchLabel;
  document.getElementById('mpptFaultCount').textContent = String(faults.length);

  const switchRow = meterRow(
    'Selected Input',
    switchLabel,
    switchState === 'on' ? 100 : 0,
    switchStatus,
    isFaulted ? 'Faults active below.' : 'ACDRV1 or ACDRV2 selection reported by firmware.'
  );

  const faultRows = faults.length
    ? faults.map((faultName) =>
        meterRow('Fault', faultName, 100, 'fault', 'Active fault bit from MPPT packet.')
      ).join('')
    : meterRow('Fault Status', 'CLEAR', 0, 'nominal', 'No MPPT faults active.');

  mpptFaults.innerHTML = `${switchRow}${faultRows}`;
}

function renderBmsCard(telemetry) {
  const bmsCells = document.getElementById('bmsCells');
  if (!bmsCells) return;

  const cells = telemetry.bms.cellVoltagesV.slice(0, 4);
  const validCells = cells.map((value) => numericValue(value)).filter((value) => value !== null);

  const packVoltage = validCells.length
    ? validCells.reduce((sum, value) => sum + value, 0)
    : null;
  const averageVoltage = validCells.length ? packVoltage / validCells.length : null;
  const lowestVoltage = validCells.length ? Math.min(...validCells) : null;
  const highestVoltage = validCells.length ? Math.max(...validCells) : null;
  const deltaMv =
    lowestVoltage !== null && highestVoltage !== null ? (highestVoltage - lowestVoltage) * 1000 : null;

  document.getElementById('bmsPackVoltage').textContent = formatValue(packVoltage, 'V', 2);
  document.getElementById('bmsAverageVoltage').textContent = formatValue(averageVoltage, 'V', 3);
  document.getElementById('bmsLowestCell').textContent = formatValue(lowestVoltage, 'V', 3);
  document.getElementById('bmsCellDelta').textContent = formatValue(deltaMv, 'mV', 0);

  bmsCells.innerHTML = cells.map((voltage, index) => {
    const status = summarizeCellVoltage(voltage);
    return meterRow(
      `Battery ${index + 1}`,
      formatValue(voltage, 'V', 3),
      normalizePercent(voltage, meterRanges.cellVoltageV),
      status,
      status === 'idle' ? 'Waiting for live packet data.' : `Cell ${index + 1} of 4`
    );
  }).join('');
}

function renderTelemetry(telemetry, metadata = streamMetadata) {
  renderSystemSummary(telemetry);
  renderMetadata(metadata);
  renderMcuCard(telemetry);
  renderPowerCard('pv', 'PV', telemetry.pv);
  renderMpptCard(telemetry);
  renderBmsCard(telemetry);
  renderPowerCard('load', 'Load', telemetry.load);
}

function normalizeCellArray(candidate) {
  if (Array.isArray(candidate)) {
    return candidate.slice(0, 4).map((value) => numericValue(value));
  }

  return [
    numericValue(firstDefined(candidate?.battery1VoltageV, candidate?.battery_1_voltage_v, candidate?.battery1, candidate?.battery_1)),
    numericValue(firstDefined(candidate?.battery2VoltageV, candidate?.battery_2_voltage_v, candidate?.battery2, candidate?.battery_2)),
    numericValue(firstDefined(candidate?.battery3VoltageV, candidate?.battery_3_voltage_v, candidate?.battery3, candidate?.battery_3)),
    numericValue(firstDefined(candidate?.battery4VoltageV, candidate?.battery_4_voltage_v, candidate?.battery4, candidate?.battery_4))
  ];
}

function extractMetadata(envelope) {
  const packetMeta = envelope?.packet && typeof envelope.packet === 'object' ? envelope.packet : envelope;
  return {
    deviceId: firstDefined(packetMeta?.device_id, packetMeta?.deviceId, envelope?.source, 'Unknown device'),
    sequence: firstDefined(packetMeta?.seq, packetMeta?.sequence, '--'),
    transmittedAt: formatTime(firstDefined(packetMeta?.transmitted_at, packetMeta?.transmittedAt)),
    receivedAt: formatTime(firstDefined(envelope?.received_at, envelope?.receivedAt))
  };
}

function normalizeFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const mcuTemperature = firstDefined(
    candidate?.mcu?.temperatureC,
    candidate?.mcu?.temperature_c,
    candidate?.mcu_temp_c,
    candidate?.mcuTemperatureC,
    candidate?.esp32?.temperatureSensor,
    candidate?.esp32_temperature_c
  );

  const pvShuntVoltageMv = firstDefined(
    candidate?.pv?.shuntVoltageMv,
    candidate?.pv?.shunt_voltage_mv,
    candidate?.pv?.shunt_mv,
    candidate?.pv_shunt_voltage_mv
  );

  const pvPowerW = firstDefined(
    candidate?.pv?.powerW,
    candidate?.pv?.power_w,
    candidate?.pv_power_w
  );

  const pvCurrentA = firstDefined(
    candidate?.pv?.currentA,
    candidate?.pv?.current_a,
    candidate?.pv_current_a
  );

  const mpptSwitchState = firstDefined(
    candidate?.mppt?.switchState,
    candidate?.mppt?.switch_state,
    candidate?.mppt?.switchStateValue,
    candidate?.mppt_switch_state
  );

  const mpptFaults = firstDefined(
    candidate?.mppt?.faults,
    candidate?.mppt?.fault_conditions,
    candidate?.mppt?.fault_conditions_state,
    candidate?.mpptFaults,
    candidate?.mppt_faults
  );

  const bmsCells = firstDefined(
    candidate?.bms?.cellVoltagesV,
    candidate?.bms?.cell_voltages_v,
    candidate?.bms?.cells,
    candidate?.bms?.batteryVoltages,
    candidate?.bms?.battery_voltages,
    candidate?.battery_v,
    candidate?.batteryVoltages,
    candidate?.bms
  );

  const loadShuntVoltageMv = firstDefined(
    candidate?.load?.shuntVoltageMv,
    candidate?.load?.shunt_voltage_mv,
    candidate?.load?.shunt_mv,
    candidate?.load_shunt_voltage_mv
  );

  const loadPowerW = firstDefined(
    candidate?.load?.powerW,
    candidate?.load?.power_w,
    candidate?.load_power_w
  );

  const loadCurrentA = firstDefined(
    candidate?.load?.currentA,
    candidate?.load?.current_a,
    candidate?.load_current_a
  );

  const hasLoadTelemetry = [
    loadShuntVoltageMv,
    loadPowerW,
    loadCurrentA
  ].some((value) => value !== undefined);

  const normalizedCells = normalizeCellArray(bmsCells);

  if (
    mcuTemperature === undefined ||
    pvShuntVoltageMv === undefined ||
    pvPowerW === undefined ||
    pvCurrentA === undefined ||
    mpptSwitchState === undefined ||
    normalizedCells.filter((value) => value !== null).length < 4 ||
    (hasLoadTelemetry && (
      loadShuntVoltageMv === undefined ||
      loadPowerW === undefined ||
      loadCurrentA === undefined
    ))
  ) {
    return null;
  }

  return {
    mcu: {
      temperatureC: numericValue(mcuTemperature)
    },
    pv: {
      shuntVoltageMv: numericValue(pvShuntVoltageMv),
      powerW: numericValue(pvPowerW),
      currentA: numericValue(pvCurrentA)
    },
    mppt: {
      switchState: normalizeSwitchState(mpptSwitchState),
      faults: normalizeFaults(mpptFaults)
    },
    bms: {
      cellVoltagesV: normalizedCells
    },
    load: hasLoadTelemetry
      ? {
          shuntVoltageMv: numericValue(loadShuntVoltageMv),
          powerW: numericValue(loadPowerW),
          currentA: numericValue(loadCurrentA)
        }
      : null
  };
}

function normalizePacket(envelope) {
  const candidates = [
    envelope?.packet?.telemetry,
    envelope?.telemetry,
    envelope?.packet,
    envelope
  ];

  for (const candidate of candidates) {
    const normalized = normalizeFromCandidate(candidate);
    if (normalized) {
      return {
        telemetry: normalized,
        metadata: extractMetadata(envelope)
      };
    }
  }

  return null;
}

function applyTelemetryPacket(packetEnvelope) {
  if (packetEnvelope?.type === 'status') {
    const telemetryConnected = Boolean(packetEnvelope.telemetry_connected);
    bridgeCommandReady = Boolean(packetEnvelope.command_ready);
    commandAuthRequired = packetEnvelope.command_auth_required !== false;
    setStreamStatus(
      telemetryConnected ? 'Live ESP32 telemetry' : 'ESP32 telemetry stale or unavailable',
      telemetryConnected
    );
    if (packetEnvelope.telemetry_endpoint?.address && packetEnvelope.telemetry_endpoint?.port) {
      const ageText = Number.isFinite(Number(packetEnvelope.telemetry_age_ms))
        ? `; last packet ${Math.round(Number(packetEnvelope.telemetry_age_ms) / 1000)}s ago`
        : '';
      setNodeAddressNote(
        `ESP32 node: ${formatEndpoint(packetEnvelope.telemetry_endpoint)}${ageText}`
      );
      setCommandTargetNote(packetEnvelope.command_target
        ? `Bridge command target: ${formatEndpoint(packetEnvelope.command_target)} (${packetEnvelope.command_target.source})`
        : 'Last ESP32 endpoint is stale; commands are locked until fresh telemetry arrives.');
    } else if (packetEnvelope.command_ready) {
      setNodeAddressNote(
        'ESP32 node address will appear here once live telemetry is received from the bridge target.'
      );
      setCommandTargetNote(
        'Bridge command target is configured on the server and ready to use.'
      );
    } else {
      setNodeAddressNote(
        'ESP32 node address will appear here once live telemetry arrives.'
      );
      setCommandTargetNote(
        'Commands will be sent to the last telemetry source once the ESP32 starts streaming.'
      );
    }
    if (packetEnvelope.sensor_polling) {
      applySensorPollingState(packetEnvelope.sensor_polling);
      if (!telemetryConnected) {
        setSensorPollingNote(
          'ESP32 telemetry is stale. The polling state shown here is the last confirmed state.'
        );
      }
    } else if (!telemetryConnected) {
      sensorPollingState = null;
      setSensorPollingNote(
        'Sensor polling status will appear here once the ESP32 starts streaming.'
      );
    }
    writeLog(
      `Bridge status: ${telemetryConnected ? 'telemetry source seen' : 'waiting for telemetry source'}; ` +
        `${packetEnvelope.web_clients ?? 0} web client(s).`
    );
    updateCommandControls();
    return;
  }

  if (packetEnvelope?.type === 'command_status') {
    const requestId = packetEnvelope.request_id || null;
    const commandStatus = String(packetEnvelope.status || 'unknown');

    if (commandStatus === 'pending') {
      if (requestId && !pendingCommandIds.has(requestId)) {
        trackPendingCommand(requestId, packetEnvelope.summary);
      }
      return;
    }

    if (commandStatus === 'timed_out') {
      finishPendingCommand(requestId);
      const message = `${packetEnvelope.summary || 'Command'} request ${requestId || 'unknown'} timed out: ` +
        `${packetEnvelope.error || 'no ESP32 response received'}`;
      writeCommandResult(message);
      writeLog(message);
      return;
    }

    if (['completed', 'failed'].includes(commandStatus)) {
      finishPendingCommand(requestId);
    }
    return;
  }

  if (packetEnvelope?.type === 'debug_result') {
    const packet = packetEnvelope?.packet || packetEnvelope;
    const commandType = String(packet?.command_type || 'command');
    const requestId = packet?.request_id ? ` request ${packet.request_id}` : '';
    const status = packet?.ok === false || packet?.status === 'error' ? 'failed' : 'ok';
    finishPendingCommand(packet?.request_id);
    const targetText = commandType === 'sensor_control' && packet?.sensor
      ? ` ${String(packet.sensor).toUpperCase()}`
      : commandType === 'mppt_acdrv_control' && packet?.state
        ? ` ${String(packet.state).toUpperCase()}`
        : commandType === 'led_control' && Number.isInteger(packet?.gpio)
          ? ` GPIO${packet.gpio}`
      : packet?.addr && packet?.reg
        ? ` ${packet.addr}/${packet.reg}`
        : '';
    const pollingMaskText = commandType === 'sensor_control' &&
      normalizeSensorMask(packet?.active_sensor_mask) !== null
      ? ` [active mask 0x${normalizeSensorMask(packet.active_sensor_mask).toString(16).toUpperCase()}]`
      : '';
    const byteText = Array.isArray(packet?.data) && packet.data.length > 0
      ? ` -> ${packet.data.join(' ')}`
      : Array.isArray(packet?.write_data) && packet.write_data.length > 0
        ? ` (${packet.write_data.join(' ')})`
        : '';
    const acdrvText = commandType === 'mppt_acdrv_control'
      ? ` [REG12 ${packet?.register_12_before || '?'} -> ${packet?.register_12_after || '?'}, ` +
        `REG13 ${packet?.register_13_before || '?'} -> ${packet?.register_13_after || '?'}, ` +
        `ACRB ${packet?.acrb_status || '?'}]`
      : '';
    const extraText = packet?.error
      ? ` (${packet.error})`
      : packet?.note
        ? ` (${packet.note})`
        : '';

    if (commandType === 'sensor_control') {
      applySensorPollingState({
        active_sensor_mask: packet?.active_sensor_mask,
        source: 'node-response',
        updated_at: packetEnvelope?.received_at
      });
    }

    const message =
      `${commandType}${targetText}${requestId} ${status}${byteText}${pollingMaskText}${acdrvText}${extraText}`;

    writeCommandResult(message);
    writeLog(`Debug response: ${message}`);
    return;
  }

  const normalizedPacket = normalizePacket(packetEnvelope);

  if (!normalizedPacket) {
    writeLog(
      'Rejected packet: expected I2C telemetry groups { mcu, pv, mppt, bms } with optional load.'
    );
    return;
  }

  state = normalizedPacket.telemetry;
  streamMetadata = normalizedPacket.metadata;
  renderTelemetry(state, streamMetadata);
  if (packetEnvelope?.network?.remote_address && packetEnvelope?.network?.remote_port) {
    setNodeAddressNote(
      `ESP32 node: ${packetEnvelope.network.remote_address}:${packetEnvelope.network.remote_port}`
    );
  }
  setDetailNote('Live packet applied from the droplet event stream.');
  writeLog(
    `Telemetry packet applied from ${streamMetadata.deviceId} ` +
      `(seq ${streamMetadata.sequence}).`
  );
}

function randomizeMockTelemetry() {
  const packet = structuredClone(initialTelemetry);

  packet.mcu.temperatureC += (Math.random() - 0.5) * 4.0;
  packet.pv.shuntVoltageMv += (Math.random() - 0.5) * 0.8;
  packet.pv.powerW += (Math.random() - 0.5) * 8.0;
  packet.pv.currentA += (Math.random() - 0.5) * 0.18;

  packet.load.shuntVoltageMv += (Math.random() - 0.5) * 0.6;
  packet.load.powerW += (Math.random() - 0.5) * 5.0;
  packet.load.currentA += (Math.random() - 0.5) * 0.15;

  packet.bms.cellVoltagesV = packet.bms.cellVoltagesV.map((voltage) =>
    voltage + (Math.random() - 0.5) * 0.03
  );

  const faults = [];
  if (numericValue(packet.load.currentA) > 1.1) faults.push('LOAD_OVERCURRENT');
  if (numericValue(packet.mcu.temperatureC) > 55) faults.push('THERMAL_WARNING');
  if (numericValue(packet.pv.powerW) < 35) faults.push('PV_INPUT_LOW');

  packet.mppt.switchState = faults.includes('THERMAL_WARNING') ? 'off' : 'on';
  packet.mppt.faults = faults;

  streamMetadata = { ...mockMetadata };
  renderTelemetry(packet, streamMetadata);
  writeLog('Mock telemetry frame rendered.');
}

function closeLiveStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function startMockData() {
  closeLiveStream();
  if (mockTimer) clearInterval(mockTimer);

  streamMetadata = { ...mockMetadata };
  bridgeCommandReady = false;
  pendingCommandIds.clear();
  finishedCommandIds.clear();
  setStreamStatus('Mock data active', false);
  sensorPollingState = null;
  setDetailNote(
    'Mock data is active by default. Use Connect Live when the firmware begins sending the new I2C telemetry packet.'
  );
  setCommandTargetNote(
    'Commands are idle in mock mode. Connect to the live bridge before using MPPT, pause/resume, or debug controls.'
  );
  setNodeAddressNote('ESP32 node address is unavailable in mock mode.');
  setSensorPollingNote('Sensor polling status is unavailable in mock mode.');
  updateCommandControls();
  writeLog('Mock telemetry enabled.');
  randomizeMockTelemetry();
  mockTimer = setInterval(randomizeMockTelemetry, 2400);
}

function stopMockData() {
  if (mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }
}

function connectTelemetryStream() {
  const urlElement = document.getElementById('streamUrl');
  if (!urlElement) return;
  const url = urlElement.value.trim();
  const commandUrlElement = document.getElementById('commandUrl');

  if (!url) {
    writeLog('Missing telemetry event-stream URL.');
    return;
  }

  if (commandUrlElement) {
    const existingCommandUrl = commandUrlElement.value.trim();
    if (!existingCommandUrl || existingCommandUrl === '/telemetry/command') {
      commandUrlElement.value = deriveCommandUrl(url);
    }
  }

  if (typeof EventSource === 'undefined') {
    writeLog('This browser does not support EventSource / server-sent events.');
    return;
  }

  stopMockData();
  closeLiveStream();
  streamErrorLogged = false;
  setDetailNote('Waiting for live packets from the droplet event stream.');

  try {
    eventSource = new EventSource(url);
  } catch (error) {
    writeLog(`Event stream creation failed: ${error.message}`);
    startMockData();
    return;
  }

  eventSource.addEventListener('open', () => {
    streamErrorLogged = false;
    setStreamStatus('Live stream connected', true);
    writeLog(`Connected to ${url}`);
  });

  eventSource.addEventListener('message', (event) => {
    try {
      applyTelemetryPacket(JSON.parse(event.data));
    } catch (error) {
      writeLog(`Packet parse error: ${error.message}`);
    }
  });

  eventSource.addEventListener('error', () => {
    setStreamStatus('Stream reconnecting', false);
    bridgeCommandReady = false;
    updateCommandControls();
    if (!streamErrorLogged) {
      writeLog('Telemetry stream interrupted. The browser will retry automatically.');
      streamErrorLogged = true;
    }
  });
}

function onConnectClick() {
  connectTelemetryStream();
}

function onMockClick() {
  startMockData();
}

async function sendCommandRequest(payload) {
  const commandUrlElement = document.getElementById('commandUrl');
  const commandUrl = commandUrlElement?.value?.trim() || '/telemetry/command';
  const commandToken = commandTokenValue();

  if (!bridgeCommandReady) {
    writeLog('Command blocked: wait for a fresh ESP32 command target.');
    updateCommandControls();
    return;
  }

  if (commandAuthRequired && !commandToken) {
    writeLog('Command blocked: enter the temporary lab command token.');
    updateCommandControls();
    return;
  }

  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (commandToken) headers['X-Command-Token'] = commandToken;

    const response = await fetch(commandUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Command request failed');
    }

    const targetText = result?.target?.address && result?.target?.port
      ? `${result.target.address}:${result.target.port}`
      : 'bridge default target';

    const requestIdText = result?.request_id ? ` request ${result.request_id}` : '';
    trackPendingCommand(result?.request_id, result?.summary);
    writeLog(`Command accepted (${result.summary})${requestIdText} for ${targetText}; waiting for ESP32 execution.`);
    setCommandTargetNote(`Last command target: ${targetText}`);
  } catch (error) {
    writeLog(`Command send failed: ${error.message}`);
  }
}

function parseByteInputTokens(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const parsed = token.toLowerCase().startsWith('0x')
        ? Number.parseInt(token, 16)
        : Number(token);

      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xff) {
        throw new Error(`Invalid byte value: ${token}`);
      }

      return `0x${parsed.toString(16).toUpperCase().padStart(2, '0')}`;
    });
}

function onSendDebugCommandClick() {
  const type = document.getElementById('debugCommandType')?.value || 'i2c_read';
  const addr = document.getElementById('debugAddrInput')?.value?.trim() || '';
  const reg = document.getElementById('debugRegInput')?.value?.trim() || '';
  const lenValue = document.getElementById('debugLenInput')?.value?.trim() || '1';
  const dataValue = document.getElementById('debugDataInput')?.value?.trim() || '';

  if (!addr || !reg) {
    writeLog('Debug command requires both device address and register address.');
    return;
  }

  let normalizedAddress;
  let normalizedRegister;

  try {
    normalizedAddress = parseByteInputTokens(addr);
    normalizedRegister = parseByteInputTokens(reg);

    if (normalizedAddress.length !== 1 || normalizedRegister.length !== 1) {
      throw new Error('Address and register must each contain exactly one byte.');
    }

    if (!['0x08', '0x40', '0x6B'].includes(normalizedAddress[0])) {
      throw new Error('Supported device addresses are 0x08, 0x40, and 0x6B.');
    }
  } catch (error) {
    writeLog(`Debug command is invalid: ${error.message}`);
    return;
  }

  if (type === 'i2c_read') {
    const requestedLength = Number(lenValue);
    if (!Number.isInteger(requestedLength) || requestedLength < 1 || requestedLength > 32) {
      writeLog('Debug read size must be an integer from 1 through 32.');
      return;
    }

    sendCommandRequest({
      type: 'i2c_read',
      addr: normalizedAddress[0],
      reg: normalizedRegister[0],
      len: requestedLength
    });
    return;
  }

  try {
    const writeData = parseByteInputTokens(dataValue);
    if (writeData.length === 0) {
      writeLog('Debug write requires at least one data byte.');
      return;
    }
    if (writeData.length > 32) {
      writeLog('Debug write supports at most 32 data bytes.');
      return;
    }

    sendCommandRequest({
      type: 'i2c_write',
      addr: normalizedAddress[0],
      reg: normalizedRegister[0],
      data: writeData
    });
  } catch (error) {
    writeLog(`Debug write data is invalid: ${error.message}`);
  }
}

function sendSensorControl(enabled) {
  const sensor = document.getElementById('sensorControlSelect')?.value || 'mppt';

  sendCommandRequest({
    type: 'sensor_control',
    sensor,
    enabled
  });
}

function onPauseSensorClick() {
  sendSensorControl(false);
}

function onResumeSensorClick() {
  sendSensorControl(true);
}

function onApplyAcdrvClick() {
  const requestedState =
    document.getElementById('acdrvControlSelect')?.value || 'acdrv1';
  const label = requestedState === 'disabled'
    ? 'disable both ACDRV power paths'
    : `select ${requestedState.toUpperCase()}`;

  if (!window.confirm(
    `Confirm ${label}. The ESP32 will preserve unrelated charger bits and verify register readback, ` +
    'but PACK voltage must still be measured at the hardware.'
  )) {
    return;
  }

  sendCommandRequest({
    type: 'mppt_acdrv_control',
    state: requestedState
  });
}

function sendLedControl(enabled) {
  sendCommandRequest({
    type: 'led_control',
    enabled
  });
}

function onLedOnClick() {
  sendLedControl(true);
}

function onLedOffClick() {
  sendLedControl(false);
}

export function initI2CPage() {
  state = structuredClone(initialTelemetry);
  streamMetadata = { ...mockMetadata };
  sensorPollingState = null;
  bridgeCommandReady = false;
  commandAuthRequired = true;
  pendingCommandIds.clear();
  finishedCommandIds.clear();
  renderTelemetry(state, streamMetadata);

  const streamUrlElement = document.getElementById('streamUrl');
  const commandUrlElement = document.getElementById('commandUrl');
  if (streamUrlElement && commandUrlElement) {
    const existingCommandUrl = commandUrlElement.value.trim();
    if (!existingCommandUrl || existingCommandUrl === '/telemetry/command') {
      commandUrlElement.value = deriveCommandUrl(streamUrlElement.value);
    }
  }

  setNodeAddressNote('ESP32 node address will appear here once live telemetry arrives.');
  setSensorPollingNote('Sensor polling status will appear here once live telemetry arrives.');
  applyDebugCommandMode();
  onSensorControlSelectChange();

  document.getElementById('connectButton')?.addEventListener('click', onConnectClick);
  document.getElementById('mockButton')?.addEventListener('click', onMockClick);
  document.getElementById('debugCommandType')?.addEventListener('change', applyDebugCommandMode);
  document.getElementById('sensorControlSelect')?.addEventListener('change', onSensorControlSelectChange);
  document.getElementById('commandTokenInput')?.addEventListener('input', updateCommandControls);
  document.getElementById('sendDebugCommandButton')?.addEventListener('click', onSendDebugCommandClick);
  document.getElementById('pauseSensorButton')?.addEventListener('click', onPauseSensorClick);
  document.getElementById('resumeSensorButton')?.addEventListener('click', onResumeSensorClick);
  document.getElementById('applyAcdrvButton')?.addEventListener('click', onApplyAcdrvClick);
  document.getElementById('ledOnButton')?.addEventListener('click', onLedOnClick);
  document.getElementById('ledOffButton')?.addEventListener('click', onLedOffClick);

  startMockData();
}

export function destroyI2CPage() {
  document.getElementById('connectButton')?.removeEventListener('click', onConnectClick);
  document.getElementById('mockButton')?.removeEventListener('click', onMockClick);
  document.getElementById('debugCommandType')?.removeEventListener('change', applyDebugCommandMode);
  document.getElementById('sensorControlSelect')?.removeEventListener('change', onSensorControlSelectChange);
  document.getElementById('commandTokenInput')?.removeEventListener('input', updateCommandControls);
  document.getElementById('sendDebugCommandButton')?.removeEventListener('click', onSendDebugCommandClick);
  document.getElementById('pauseSensorButton')?.removeEventListener('click', onPauseSensorClick);
  document.getElementById('resumeSensorButton')?.removeEventListener('click', onResumeSensorClick);
  document.getElementById('applyAcdrvButton')?.removeEventListener('click', onApplyAcdrvClick);
  document.getElementById('ledOnButton')?.removeEventListener('click', onLedOnClick);
  document.getElementById('ledOffButton')?.removeEventListener('click', onLedOffClick);

  if (mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }

  closeLiveStream();
}
