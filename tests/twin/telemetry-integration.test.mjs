import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { normalizePeripheralTelemetry } from '../../site/assets/js/telemetry-model.mjs';
import { normalizeTelemetry } from '../../site/knight-eps-phase12/viewer/telemetry.mjs';

const [streamScript, twinScript, fixtures] = await Promise.all([
  readFile(new URL('../../site/assets/js/streaming-telemetry.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../site/assets/js/twin.js', import.meta.url), 'utf8'),
  readFile(new URL('../../telemetry-bridge/test/fixtures/streaming-envelopes.json', import.meta.url), 'utf8').then(JSON.parse)
]);

// Run the real stream manager, decoder and Twin adapter with an isolated clock,
// EventSource transport and viewer API. No server, account or hardware is used.
function harness({ ready = Promise.resolve() } = {}) {
  const clock = { now: Date.parse('2026-11-09T17:00:00Z') };
  class Clock extends Date { static now() { return clock.now; } }
  const streams = [], updates = [], transports = [], errors = [], observers = [];
  const timers = new Map(), classes = new Set(), properties = new Map(), listeners = new Map();
  let disposals = 0;
  class EventSource {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; streams.push(this); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    emit(name, data) { this.listeners.get(name)?.(data); }
    close() { this.closed = true; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() { this.callback(); }
    disconnect() { this.disconnected = true; }
  }
  const api = {
    ready,
    updateTelemetry(packet, options) { updates.push({ packet: normalizeTelemetry(packet), options }); },
    setTelemetryTransport(value) { transports.push(value); },
    dispose() { disposals++; }
  };
  const frame = {
    contentWindow: {},
    addEventListener(name, handler) { listeners.set(name, handler); }
  };
  const status = { hidden: false, textContent: '' };
  const context = vm.createContext({
    Date: Clock, EventSource, ResizeObserver, normalizePeripheralTelemetry,
    console: { error(error) { errors.push(error); } },
    setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
    document: {
      getElementById(id) { return id === 'knight-eps-twin' ? frame : status; },
      querySelector() { return { getBoundingClientRect: () => ({ height: 75 }) }; },
      body: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
      documentElement: { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } }
    }
  });
  const withoutExports = source => source.replace(/^export /gm, '');
  vm.runInContext(withoutExports(streamScript.replace(/^import .*;\n/m, '')), context);
  vm.runInContext(withoutExports(twinScript.replace(/^import .*;\n/m, 'const subscribeStreaming = subscribe;\n')), context);
  const send = (fixture = fixtures.v6_all, age = 0, seq = 1) => {
    const envelope = structuredClone(fixture);
    envelope.received_at = new Date(clock.now - age).toISOString();
    envelope.packet.seq = seq;
    streams[0].emit('message', { data: JSON.stringify(envelope) });
    return envelope;
  };
  return {
    clock, streams, updates, transports, errors, timers, observers, classes, properties, status, send,
    get disposals() { return disposals; },
    init() { context.initTwinPage(); },
    async load() { frame.contentWindow.knightEPSTwin = api; await listeners.get('load')(); },
    destroy() { context.destroyTwinPage(); },
    tick() { for (const callback of timers.values()) callback(); }
  };
}

test('opening the SSE connection alone does not create live measurements', async t => {
  const h = harness(); t.after(() => h.destroy());
  h.init(); await h.load();
  assert.equal(h.streams[0].url, '/telemetry/public/events');
  assert.deepEqual(h.transports, ['connecting']);
  h.streams[0].emit('open'); h.tick();
  assert.deepEqual(h.transports, ['connecting', 'connected']);
  assert.equal(h.updates.length, 0);
  assert.equal(h.status.hidden, true);
  assert.deepEqual(h.errors, []);
});

test('real v6 decoding reaches the Twin with confirmed measurements and ignores replay', async t => {
  const h = harness(); t.after(() => h.destroy());
  h.init(); await h.load();
  const envelope = h.send();
  assert.deepEqual(h.updates[0].packet, { battery_voltage_v: 14.98, temperature_c: 25, light_level: 0.5 });
  assert.equal(h.updates[0].options.source, 'live');
  assert.equal('solar_panel_current_a' in h.updates[0].packet, false, 'PV current must not be relabeled as panel current');
  h.streams[0].emit('message', { data: JSON.stringify(envelope) }); h.tick();
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.errors, []);
});

test('absent BMS and unavailable or malformed packets cannot fabricate readings', async t => {
  const h = harness(); t.after(() => h.destroy());
  h.init(); await h.load();
  h.send(fixtures.v6_subset_pv_mppt);
  assert.deepEqual(h.updates[0].packet, { temperature_c: 25, light_level: 0.5 });
  const empty = { type: 'telemetry', packet: { packet_format: 'hex-v6-streaming', telemetry: {}, sensor_polling: { active_sensor_mask: 0 }, raw: {} } };
  h.send(empty, 0, 2);
  h.streams[0].emit('message', { data: '{invalid JSON' });
  h.streams[0].emit('message', { data: JSON.stringify({ type: 'telemetry' }) });
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.errors, []);
});

test('stale packets are rejected and bridge clock skew is honored', async t => {
  const h = harness(); t.after(() => h.destroy());
  h.init(); await h.load();
  h.send(fixtures.v6_all, 15_000);
  assert.equal(h.updates.length, 0);
  h.send(fixtures.v6_all, 14_999, 2);
  assert.equal(h.updates.length, 1);
  // Bridge clock is 30 seconds behind the client, but the sample is current.
  h.streams[0].emit('message', { data: JSON.stringify({ type: 'status', server_time: new Date(h.clock.now - 30_000).toISOString() }) });
  h.send(fixtures.v6_all, 30_000, 3);
  assert.equal(h.updates.length, 2);
  h.streams[0].emit('error');
  assert.equal(h.transports.at(-1), 'disconnected');
  assert.deepEqual(h.errors, []);
});

test('leaving the page closes SSE, clears timers and stops late packet forwarding', async () => {
  const h = harness();
  h.init(); await h.load(); h.send();
  h.destroy();
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.disposals, 1);
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.classes.has('twin-active'), false);
  assert.equal(h.properties.has('--twin-nav-height'), false);
  h.send(fixtures.v6_all, 0, 2);
  assert.equal(h.updates.length, 1);
});

test('leaving while the model loads cannot start a late SSE subscription', async () => {
  let resolveReady;
  const h = harness({ ready: new Promise(resolve => { resolveReady = resolve; }) });
  h.init(); const loading = h.load(); h.destroy();
  resolveReady(); await loading;
  assert.equal(h.streams.length, 0);
  assert.equal(h.updates.length, 0);
  assert.equal(h.disposals, 1);
  assert.deepEqual(h.errors, []);
});
