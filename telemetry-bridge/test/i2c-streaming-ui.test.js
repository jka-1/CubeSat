// Real DOM/module integration with fixture SSE only; no bridge, hardware or production access.
// Set CHROME_BIN on platforms where Chrome is not installed at the macOS default path.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available = await access(chrome).then(() => true, () => false);
const fixtures = JSON.parse(await readFile(new URL('./fixtures/streaming-envelopes.json', import.meta.url)));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('I²C streaming preserves panels, readings, availability and power units', { skip: !available, timeout: 30000 }, async (t) => {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/telemetry/auth/me') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ enabled: true, user: { username: 'Fixture viewer', role: 'viewer' } }));
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(path.join(root, 'site') + path.sep)) { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(file.endsWith(path.sep) ? file + 'index.html' : file);
      const ext = path.extname(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'i2c-streaming-test-'));
  const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    if (browser.exitCode === null) { browser.kill(); await once(browser, 'exit'); }
    await rm(profile, { recursive: true, force: true });
  });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    browser.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    browser.once('error', reject);
    browser.once('exit', () => reject(Error(stderr)));
  });
  const socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  t.after(() => socket.close());
  const pending = new Map(); const errors = []; let id = 0; let session;
  const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const p = pending.get(message.id); pending.delete(message.id);
      if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(JSON.stringify(message.params.args));
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(25); }
    throw Error(`Timed out: ${expression}`);
  };
  const targets = await send('Target.getTargets');
  session = (await send('Target.attachToTarget', { targetId: targets.targetInfos.find((item) => item.type === 'page').targetId, flatten: true })).sessionId;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__streams = []; window.__maxActiveStreams = 0;
    window.EventSource = class {
      constructor(url) { this.url = url; this.listeners = {}; this.closed = false; __streams.push(this); __maxActiveStreams = Math.max(__maxActiveStreams, __streams.filter(s => !s.closed).length); queueMicrotask(() => this.emit('open', {})); }
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
      close() { this.closed = true; }
      emit(type, event) { for (const fn of this.listeners[type] || []) fn(event); }
    };
    window.__emit = (value) => __streams.filter(s => !s.closed).forEach(s => s.emit('message', { data: JSON.stringify(value) }));
  ` });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/site/index.html#communication` });
  await waitFor('!!document.querySelector("#i2cStreamToggle") && __streams.length === 1');
  await checkWaiting();
  async function checkWaiting() {
    await t.test('waiting readings are unavailable rather than a clear fault report', async () => {
      assert.equal(await evaluate('document.querySelector("#mpptFaultCount").textContent'), '--');
    });
  }
  const sample = (seq, changes = '', age = 0) => evaluate(`(() => {
    const f = ${JSON.stringify(fixtures.v6_all)};
    f.received_at = new Date(Date.now() - ${age}).toISOString(); f.packet.seq = ${seq}; ${changes}
    __emit(f);
  })()`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const check = async (name, expression) => t.test(name, async () => assert.equal(await evaluate(expression), true));
  await sample(1);
  await evaluate('document.querySelector("[data-detail-target=bms]").click(); document.querySelector("#i2cStreamToggle").click()');
  await waitFor('__streams.filter(s => !s.closed).length === 1 && !!document.querySelector("[data-toggle=pv]")');
  await sample(2, 'f.packet.telemetry.bms.packVoltageV = 15.42; f.packet.telemetry.bms.internalTempC = 29.5; f.packet.telemetry.mppt.vbusV = 6.123; f.packet.telemetry.mppt.ibusA = .321; f.packet.telemetry.mppt.dieTempC = 22.5;');
  await check('streaming keeps the open detail panel and all tiles available', 'document.querySelector("#i2cDetailLayer").classList.contains("is-open") && !document.querySelector("[data-detail-panel=bms]").hidden && [...document.querySelectorAll(".topology-tile")].every(e => !e.hidden)');
  await check('streaming retains fresh BMS and MPPT extension readings', 'document.querySelector("#bmsPackVoltage").textContent === "15.42 V" && document.querySelector("#bmsCells").textContent.includes("29.5 °C") && document.querySelector("#mpptFaults").textContent.includes("6.123 V") && document.querySelector("#mpptFaults").textContent.includes("321 mA") && document.querySelector("#mpptFaults").textContent.includes("22.5 °C")');
  await evaluate('document.querySelector("[data-toggle=pv]").click(); document.querySelector("[data-toggle=bms]").click()');
  await sample(3, 'f.packet.telemetry.pv.powerW = 1.075; f.packet.telemetry.bms.packVoltageV = 15.67;');
  await check('card toggles only hide their own cards and other panels keep updating', 'document.querySelector("[data-card=pv]").hidden && document.querySelector("[data-card=bms]").hidden && !document.querySelector("[data-card=mppt]").hidden && [...document.querySelectorAll(".topology-tile")].every(e => !e.hidden) && document.querySelector("#bmsPackVoltage").textContent === "15.67 V" && document.querySelector("#pvPowerValue").textContent === "1.075 W"');
  await evaluate('document.querySelector("[data-toggle=pv]").click()');
  await evaluate('document.querySelector("[data-toggle=mcp9700]").click(); document.querySelector("[data-toggle=temt6000]").click()');
  await sample(30, 'f.packet.telemetry.pv.powerW = 1.075; f.packet.telemetry.peripheral.temperatureC = 28.4; f.packet.telemetry.peripheral.lightVoltageMv = 1900;');
  await check('ADC card toggles leave the environment detail updating', 'document.querySelector("[data-card=peripheral]").hidden && document.querySelector("#peripheralTemperatureValue").textContent === "28.4 °C" && document.querySelector("#lightVoltageValue").textContent === "1900 mV" && !document.querySelector("[data-detail-target=environment]").hidden');
  await t.test('1075 mW is 1.075 W in register 0x03 and the overview', async () => {
    assert.equal(await text('[data-v="pv.powerMw"]'), '1.075 W');
    assert.equal(await text('#summaryPvPower'), '1.075 W');
  });
  await sample(4, 'f.packet.telemetry.pv.powerW = .999;');
  await check('below 1000 mW stays in mW', 'document.querySelector("[data-v=\\"pv.powerMw\\"]").textContent === "999.00 mW" && document.querySelector("#summaryPvPower").textContent === "999.00 mW"');
  await sample(5, 'f.packet.telemetry.pv.powerW = 1;');
  await check('1000 mW switches to W', 'document.querySelector("[data-v=\\"pv.powerMw\\"]").textContent === "1.000 W" && document.querySelector("#summaryPvPower").textContent === "1.000 W"');
  await sample(6, 'f.packet.debug.devices.pv.state = "error"; f.packet.debug.devices.bms.state = "paused"; f.packet.telemetry.mppt.available = false; f.packet.telemetry.peripheral.temperatureC = null; f.packet.telemetry.peripheral.temperatureVoltageMv = null;');
  await check('unavailable devices remain reachable without fresh numbers or ACK labels', '[...document.querySelectorAll(".device-tile")].every(e => !e.hidden && !e.textContent.includes("ACK · live")) && document.querySelector("#pvPowerValue").textContent.includes("--") && document.querySelector("#bmsPackVoltage").textContent.includes("--") && document.querySelector("#mpptFaults").textContent.includes("UNAVAILABLE") && document.querySelector("#mpptFaultCount").textContent === "--" && document.querySelector("#peripheralTemperatureStatus").textContent === "UNAVAILABLE"');
  await sample(7, '', 6000);
  await check('stale age is reflected outside streaming cards without a status event', 'document.querySelector("#i2cBusStatus").textContent.includes("stale") && [...document.querySelectorAll(".device-ack")].every(e => !e.textContent.includes("ACK · live")) && document.querySelector("[data-st=indicator]").classList.contains("stale")');
  await sample(8);
  await evaluate('__emit({type: "status", telemetry_connected: true, telemetry_stale_after_ms: 100})');
  await waitFor('document.querySelector("#i2cBusStatus").textContent.includes("stale")');
  await check('shared age ticks mark retained readings stale without any new packet', 'document.querySelector("#peripheralTemperatureStatus").textContent === "STALE" && document.querySelector("#summarySequence").textContent === "8" && [...document.querySelectorAll(".device-ack")].every(e => !e.textContent.includes("ACK · live"))');
  await evaluate('__emit({type: "status", telemetry_connected: true, telemetry_stale_after_ms: 5000})');
  await sample(80);
  await evaluate('__streams.find(s => !s.closed).emit("error", {})');
  await check('a disconnected stream does not label retained readings live', '!document.querySelector("#i2cBusStatus").classList.contains("online") && [...document.querySelectorAll(".device-ack")].every(e => !e.textContent.includes("ACK · live"))');
  await evaluate('document.querySelector("#i2cStreamToggle").click()');
  await sample(9, 'f.packet.telemetry.pv.powerW = .875;');
  await check('turning streaming off resumes normal updates with one connection', '__streams.filter(s => !s.closed).length === 1 && !document.querySelector("#i2cStreamToggle").checked && document.querySelector("#summaryPvPower").textContent === "875.00 mW" && [...document.querySelectorAll(".topology-tile")].every(e => !e.hidden)');
  await check('stream subscribers never open overlapping SSE connections', '__maxActiveStreams === 1 && __streams.length === 3');
  assert.deepEqual(errors, [], 'browser exceptions');
});
