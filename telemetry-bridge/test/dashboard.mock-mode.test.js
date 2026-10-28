import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function dashboardHarness() {
  const script = await readFile(path.join(root, 'site/assets/js/i2c.js'), 'utf8');
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === 'streamUrl' ? '/telemetry/events' : '',
      checked: false,
      addEventListener() {},
      removeEventListener() {}
    });
    return nodes.get(id);
  };
  const streams = [];
  const frames = [];
  const statuses = [];
  const commands = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; streams.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    close() { this.closed = true; }
    emit(type, data) { this.listeners[type]?.(data); }
  }
  const context = vm.createContext({
    document: { getElementById: node },
    window: { addEventListener() {}, removeEventListener() {} },
    EventSource: FakeEventSource,
    structuredClone,
    Math,
    Set,
    Date,
    JSON,
    setInterval: () => 1,
    clearInterval: () => {},
    apiFetch: async (...args) => { commands.push(args); },
    canOperate: () => true,
    peripheralTelemetryForMode: (mode) => ({ temperatureC: mode === 'mock' ? 25 : null }),
    isStreamingMode: () => false,
    setStreamingMode: () => {},
    subscribeStreaming: () => {},
    streamingUrl: () => '',
    mountStreamingView: () => {},
    normalizePeripheralTelemetry: (value) => value,
    lightLevelFromMv: () => 'Bright'
  });
  vm.runInContext(script.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, ''), context);
  vm.runInContext(`
    renderTelemetry = (telemetry, metadata) => globalThis.frames.push({ telemetry, metadata });
    setStreamStatus = (label) => globalThis.statuses.push(label);
    setDetailNote = () => {};
    setCommandTargetNote = () => {};
    setNodeAddressNote = () => {};
    setSensorPollingNote = () => {};
    updateCommandControls = () => {};
    writeLog = () => {};
    applyDebugCommandMode = () => {};
    onSensorControlSelectChange = () => {};
  `, Object.assign(context, { frames, statuses }));
  return { context, node, streams, frames, statuses, commands };
}

test('dashboard defaults to live SSE and leaves simulated values out of waiting state', async () => {
  const html = await readFile(path.join(root, 'site/modules/communication.html'), 'utf8');
  assert.match(html, /id="mockModeToggle" type="checkbox"/);
  assert.match(html, /Mock telemetry/);
  assert.doesNotMatch(html, /Mock data is active by default/);

  const harness = await dashboardHarness();
  vm.runInContext('initI2CPage()', harness.context);
  assert.equal(harness.streams.length, 1);
  assert.equal(harness.streams[0].url, '/telemetry/events');
  assert.equal(harness.node('mockModeToggle').checked, false);
  assert.equal(harness.frames.at(-1).telemetry.pv.powerW, null);
  assert.equal(harness.frames.at(-1).telemetry.peripheral.temperatureC, null);
  assert.deepEqual(harness.commands, []);
});

test('mock switch changes frames immediately and isolates closed live stream events', async () => {
  const harness = await dashboardHarness();
  vm.runInContext('connectTelemetryStream()', harness.context);
  const oldStream = harness.streams[0];

  harness.node('mockModeToggle').checked = true;
  vm.runInContext('onMockToggle({ target: document.getElementById("mockModeToggle") })', harness.context);
  assert.equal(oldStream.closed, true);
  assert.equal(harness.statuses.at(-1), 'Mock data active');
  assert.equal(harness.frames.at(-1).metadata.deviceId, 'Mock source');
  assert.notEqual(harness.frames.at(-1).telemetry.pv.powerW, null);
  await vm.runInContext('sendCommandRequest({ type: "i2c_read" })', harness.context);
  assert.deepEqual(harness.commands, []);

  const frameCount = harness.frames.length;
  oldStream.emit('message', { data: JSON.stringify({ type: 'status', telemetry_connected: true, command_ready: true }) });
  oldStream.emit('open');
  assert.equal(harness.frames.length, frameCount);
  assert.equal(harness.statuses.at(-1), 'Mock data active');

  harness.node('mockModeToggle').checked = false;
  vm.runInContext('onMockToggle({ target: document.getElementById("mockModeToggle") })', harness.context);
  assert.equal(harness.streams.length, 2);
  assert.equal(harness.statuses.at(-1), 'Waiting for live telemetry');
  assert.equal(harness.frames.at(-1).telemetry.pv.powerW, null);
  assert.equal(harness.frames.at(-1).metadata.deviceId, 'Waiting for live data');
  assert.deepEqual(harness.commands, []);
});
