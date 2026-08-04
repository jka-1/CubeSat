const initialTelemetry = {
  cells: [
    { id: 1, voltage: 4.02, temperature: 31.2, soc: 91, status: 'nominal' },
    { id: 2, voltage: 4.01, temperature: 30.8, soc: 90, status: 'nominal' },
    { id: 3, voltage: 3.99, temperature: 32.1, soc: 88, status: 'watch' },
    { id: 4, voltage: 4.00, temperature: 31.5, soc: 89, status: 'nominal' }
  ],
  panels: [
    { id: 1, string: 'A', voltage: 10.9, current: 0.42 },
    { id: 2, string: 'A', voltage: 10.8, current: 0.41 },
    { id: 3, string: 'B', voltage: 11.1, current: 0.39 },
    { id: 4, string: 'B', voltage: 11.0, current: 0.40 },
    { id: 5, string: 'C', voltage: 10.7, current: 0.38 },
    { id: 6, string: 'C', voltage: 10.8, current: 0.37 },
    { id: 7, string: 'D', voltage: 11.2, current: 0.43 },
    { id: 8, string: 'D', voltage: 11.1, current: 0.42 }
  ]
};

let state = structuredClone(initialTelemetry);
let mockTimer = null;
let eventSource = null;
let streamErrorLogged = false;

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '--';
}

function formatTime(value) {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function writeLog(message) {
  const telemetryLog = document.getElementById('telemetryLog');
  if (!telemetryLog) return;
  const timestamp = new Date().toLocaleTimeString();
  telemetryLog.textContent = `[${timestamp}] ${message}\n` + telemetryLog.textContent;
}

function setStreamStatus(text, online = false) {
  const streamStatus = document.getElementById('streamStatus');
  if (!streamStatus) return;
  streamStatus.textContent = text;
  streamStatus.classList.toggle('offline', !online);
  streamStatus.classList.toggle('online', online);
}

function setDetailNote(text) {
  const detailDataNote = document.getElementById('detailDataNote');
  if (detailDataNote) detailDataNote.textContent = text;
}

function statusColor(status) {
  if (status === 'fault') return 'var(--danger)';
  if (status === 'watch') return 'var(--warning)';
  return 'var(--success)';
}

function renderCells(cells) {
  const cellsElement = document.getElementById('cells');
  if (!cellsElement || cells.length === 0) return;

  const voltages = cells.map((cell) => Number(cell.voltage));
  const temps = cells.map((cell) => Number(cell.temperature));
  const socValues = cells.map((cell) => Number(cell.soc));

  const packVoltage = voltages.reduce((sum, value) => sum + value, 0);
  const avgSoc = socValues.reduce((sum, value) => sum + value, 0) / socValues.length;
  const maxTemp = Math.max(...temps);
  const cellDelta = (Math.max(...voltages) - Math.min(...voltages)) * 1000;

  document.getElementById('packVoltage').textContent = `${formatNumber(packVoltage, 2)} V`;
  document.getElementById('packSoc').textContent = `${formatNumber(avgSoc, 0)}%`;
  document.getElementById('packTemp').textContent = `${formatNumber(maxTemp, 1)} °C`;
  document.getElementById('cellDelta').textContent = `${formatNumber(cellDelta, 0)} mV`;

  cellsElement.innerHTML = cells.map((cell) => `
    <article class="cell-row">
      <div class="cell-top">
        <div>Cell ${cell.id}</div>
        <span style="color: ${statusColor(cell.status)}">${cell.status.toUpperCase()}</span>
      </div>
      <div class="bar" aria-hidden="true">
        <div class="bar-fill" style="width: ${Math.max(0, Math.min(100, cell.soc))}%"></div>
      </div>
      <div class="cell-meta">
        <span>Voltage: <strong>${formatNumber(cell.voltage, 3)} V</strong></span>
        <span>Temp: <strong>${formatNumber(cell.temperature, 1)} °C</strong></span>
        <span>SOC: <strong>${formatNumber(cell.soc, 0)}%</strong></span>
      </div>
    </article>
  `).join('');
}

function calculateStringSummary(panels) {
  const strings = {};

  panels.forEach((panel) => {
    if (!strings[panel.string]) {
      strings[panel.string] = {
        string: panel.string,
        panels: [],
        voltageTotal: 0,
        currentTotal: 0
      };
    }

    strings[panel.string].panels.push(panel);
    strings[panel.string].voltageTotal += panel.voltage;
    strings[panel.string].currentTotal += panel.current;
  });

  return Object.values(strings).map((entry) => {
    const averageVoltage = entry.voltageTotal / entry.panels.length;
    return {
      ...entry,
      averageVoltage,
      power: averageVoltage * entry.currentTotal
    };
  });
}

function renderPanels(panels) {
  const panelsElement = document.getElementById('panels');
  const stringsElement = document.getElementById('strings');
  if (!panelsElement || !stringsElement) return;

  panelsElement.innerHTML = panels.map((panel) => {
    const power = panel.voltage * panel.current;
    return `
      <article class="panel-card">
        <h3>Panel ${panel.id}<span class="string-label">String ${panel.string}</span></h3>
        <div class="large-value">${formatNumber(panel.voltage, 2)} <small>V</small></div>
        <div class="large-value">${formatNumber(panel.current, 2)} <small>A</small></div>
        <div class="panel-meta">
          <span>Power: <strong>${formatNumber(power, 2)} W</strong></span>
        </div>
      </article>
    `;
  }).join('');

  const summaries = calculateStringSummary(panels);
  stringsElement.innerHTML = summaries.map((entry) => `
    <article class="string-card">
      <h3>String ${entry.string} · ${entry.panels.length} panels parallel</h3>
      <div class="large-value">${formatNumber(entry.averageVoltage, 2)} <small>V avg</small></div>
      <div class="panel-meta">
        <span>Current: <strong>${formatNumber(entry.currentTotal, 2)} A</strong></span>
        <span>Power: <strong>${formatNumber(entry.power, 2)} W</strong></span>
      </div>
    </article>
  `).join('');
}

function renderLiveTelemetry(envelope) {
  const packet = envelope?.packet || envelope;
  const telemetry = packet?.telemetry || envelope?.telemetry;

  if (!telemetry || typeof telemetry !== 'object') return false;

  const requiredValues = [
    telemetry.solar_panel_current_a,
    telemetry.battery_voltage_v,
    telemetry.mppt_switch_temperature_c,
    telemetry.esp32_temperature_c
  ].map(Number);

  if (!requiredValues.every(Number.isFinite)) return false;

  document.getElementById('liveSolarCurrent').textContent =
    `${formatNumber(telemetry.solar_panel_current_a, 3)} A`;
  document.getElementById('liveBatteryVoltage').textContent =
    `${formatNumber(telemetry.battery_voltage_v, 2)} V`;
  document.getElementById('liveMpptTemp').textContent =
    `${formatNumber(telemetry.mppt_switch_temperature_c, 1)} °C`;
  document.getElementById('liveEsp32Temp').textContent =
    `${formatNumber(telemetry.esp32_temperature_c, 1)} °C`;

  document.getElementById('liveReceivedAt').textContent =
    formatTime(envelope.received_at);
  document.getElementById('liveTransmittedAt').textContent =
    formatTime(packet.transmitted_at);
  document.getElementById('liveDeviceId').textContent =
    packet.device_id || 'Unknown device';
  document.getElementById('liveSequence').textContent =
    Number.isInteger(Number(packet.seq)) ? String(packet.seq) : '--';

  writeLog(
    `Live telemetry applied from ${packet.device_id || envelope.source || 'source'} ` +
    `(seq ${packet.seq ?? '--'}).`
  );
  return true;
}

function applyTelemetryPacket(packet) {
  if (packet?.type === 'status') {
    writeLog(
      `Bridge status: ${packet.telemetry_connected ? 'telemetry source seen' : 'waiting for telemetry source'}; ` +
      `${packet.web_clients ?? 0} web client(s).`
    );
    return;
  }

  if (renderLiveTelemetry(packet)) return;

  if (packet && Array.isArray(packet.cells) && Array.isArray(packet.panels)) {
    state.cells = packet.cells.slice(0, 4);
    state.panels = packet.panels.slice(0, 8);
    renderCells(state.cells);
    renderPanels(state.panels);
    writeLog(`Demo telemetry applied: ${state.cells.length} cells, ${state.panels.length} panels.`);
    return;
  }

  writeLog('Rejected packet: unsupported telemetry format.');
}

function randomizeMockTelemetry() {
  const packet = structuredClone(initialTelemetry);

  packet.cells = packet.cells.map((cell) => {
    const voltage = cell.voltage + (Math.random() - 0.5) * 0.045;
    const temperature = cell.temperature + (Math.random() - 0.5) * 1.2;
    const soc = Math.max(0, Math.min(100, cell.soc + (Math.random() - 0.5) * 2));

    return {
      ...cell,
      voltage,
      temperature,
      soc,
      status: voltage < 3.95 || temperature > 36 ? 'watch' : 'nominal'
    };
  });

  packet.panels = packet.panels.map((panel) => ({
    ...panel,
    voltage: panel.voltage + (Math.random() - 0.5) * 0.35,
    current: Math.max(0, panel.current + (Math.random() - 0.5) * 0.08)
  }));

  applyTelemetryPacket(packet);
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

  setStreamStatus('Mock data active', false);
  setDetailNote('Detailed cell and panel channels are simulated in mock mode.');
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

  if (!url) {
    writeLog('Missing telemetry event-stream URL.');
    return;
  }

  stopMockData();
  closeLiveStream();
  streamErrorLogged = false;
  setDetailNote(
    'The current live packet contains aggregate values only. Detailed cell and panel values below remain demo values.'
  );

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

export function initDashboardPage() {
  state = structuredClone(initialTelemetry);
  renderCells(state.cells);
  renderPanels(state.panels);

  document.getElementById('connectButton')?.addEventListener('click', onConnectClick);
  document.getElementById('mockButton')?.addEventListener('click', onMockClick);

  startMockData();
}

export function destroyDashboardPage() {
  document.getElementById('connectButton')?.removeEventListener('click', onConnectClick);
  document.getElementById('mockButton')?.removeEventListener('click', onMockClick);

  if (mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }

  closeLiveStream();
}
