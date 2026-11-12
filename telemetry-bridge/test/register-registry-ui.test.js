// Local browser + real bridge integration. No device target or production service is configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordRecord } from '../auth/session.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available = await access(chrome).then(() => true, () => false);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port(udp = false) {
  const socket = udp ? dgram.createSocket('udp4') : net.createServer();
  if (udp) socket.bind(0, '127.0.0.1'); else socket.listen(0, '127.0.0.1');
  await once(socket, udp ? 'listening' : 'listening');
  const result = socket.address().port; await new Promise((resolve) => socket.close(resolve)); return result;
}

test('register menus propagate across live tabs, navigation, reload and independent operator sessions', { skip: !available, timeout: 60000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'register-ui-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bridgePort = await port(), udpPort = await port(true);
  const web = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/telemetry/')) {
      const upstream = http.request({ host: '127.0.0.1', port: bridgePort, path: req.url.slice('/telemetry'.length), method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => upstream.destroy()); req.pipe(upstream); return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(path.join(root, 'site') + path.sep)) { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  t.after(() => new Promise((resolve) => { web.closeAllConnections(); web.close(resolve); }));
  const origin = `http://127.0.0.1:${web.address().port}`;
  const authFile = path.join(dir, 'auth.json');
  await writeFile(authFile, JSON.stringify({ key: 'ab'.repeat(32), users: [{ username: 'operator', role: 'operator', ...await passwordRecord('test-registers') }] }), { mode: 0o600 });
  const bridge = spawn(process.execPath, [path.join(root, 'telemetry-bridge/server.js')], { env: {
    ...process.env, HTTP_PORT: String(bridgePort), UDP_PORT: String(udpPort), HTTP_BIND_ADDRESS: '127.0.0.1', UDP_BIND_ADDRESS: '127.0.0.1',
    AUTH_CONFIG_PATH: authFile, AUTH_ORIGIN: origin, AUTH_ALLOW_LOCAL_HTTP: 'true', RECORDING_DB_PATH: path.join(dir, 'runs.sqlite'), COMMAND_TOKEN: 'test-only'
  }, stdio: ['ignore', 'ignore', 'pipe'] });
  let bridgeLogs = ''; bridge.stderr.on('data', (chunk) => { bridgeLogs += chunk; });
  t.after(async () => { if (bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); } });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin + '/telemetry/auth/status')).ok) break; } catch {}
    if (i === 149) throw Error(bridgeLogs); await pause(20);
  }
  const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(dir, 'chrome')}`, '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => { if (browser.exitCode === null) { browser.kill(); await once(browser, 'exit'); } });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    browser.stderr.on('data', (chunk) => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]); });
    browser.once('error', reject); browser.once('exit', () => reject(Error(stderr)));
  });
  const socket = new WebSocket(wsUrl); await once(socket, 'open'); t.after(() => socket.close());
  const pending = new Map(), errors = []; let id = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const evaluate = async (session, expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (session, expression) => {
    for (let i = 0; i < 180; i++) { if (await evaluate(session, expression)) return; await pause(40); }
    throw Error(`Timed out: ${expression}; errors: ${errors.join('; ')}`);
  };
  const page = async (context) => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(context ? { browserContextId: context } : {}) });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: origin + '/site/index.html#home' }, sessionId);
    await wait(sessionId, '!!document.querySelector("#accountButton")'); return sessionId;
  };
  const login = (session, control) => evaluate(session, `fetch('/telemetry/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: 'test-registers', control: ${control} }) }).then(r => r.status)`);
  const route = async (session, hash, marker) => { await evaluate(session, `location.hash = ${JSON.stringify(hash)}`); await wait(session, `!!document.querySelector(${JSON.stringify(marker)})`); };
  const change = (session, selector, value, event = 'change') => evaluate(session, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const click = (session, selector) => evaluate(session, `document.querySelector(${JSON.stringify(selector)}).click()`);
  const tabA = await page(); assert.equal(await login(tabA, true), 200);
  await send('Page.reload', {}, tabA); await wait(tabA, 'document.querySelector("#accountButton")?.textContent === "operator"');
  await route(tabA, 'debug-mode', '#dmRegister');
  const tabB = await page(); await route(tabB, 'sequences', '#seqName');
  await change(tabB, '#seqName', 'Unsaved bench sequence', 'input');
  await click(tabB, '[data-add="registerRead"]'); await click(tabB, '.seq-block [data-select]');
  await change(tabB, '[data-field="addr"]', '0x6B');
  await change(tabA, '#dmDevice', '0x6B');
  await change(tabA, '#dmNewRegister', '0x2A'); await change(tabA, '#dmNewRegisterWidth', '2');
  await change(tabA, '#dmNewRegisterEndian', 'little'); await change(tabA, '#dmNewRegisterLabel', 'Shared <bench>');
  await click(tabA, '#dmAddRegister');
  await wait(tabA, 'document.querySelector("#dmRegisterFeedback").textContent.includes("saved in the shared registry")');
  await wait(tabB, '[...document.querySelector("[data-field=readRegister]").options].some(o => o.value === "0x2A/2")');
  assert.equal(await evaluate(tabB, 'document.querySelector("#seqName").value'), 'Unsaved bench sequence');
  await change(tabB, '[data-field="readRegister"]', '0x2A/2');
  await click(tabB, '#seqSave'); await wait(tabB, 'document.querySelector("#seqState").textContent.includes("Saved revision")');
  const saved = await evaluate(tabB, `fetch('/telemetry/sequences').then(r => r.json()).then(async d => (await (await fetch('/telemetry/sequences/' + d.sequences[0].id)).json()).sequence)`);
  assert.deepEqual(saved.registers, [{ id: 'user-6B-2A-2', addr: '0x6B', reg: '0x2A', len: 2, endian: 'little', label: 'Shared <bench>' }]);
  await click(tabB, '[data-add="waitUntil"]');
  await evaluate(tabB, 'document.querySelectorAll(".seq-block [data-select]")[1].click()');
  await change(tabB, '[data-field="kind"]', 'register');
  assert.equal(await evaluate(tabB, '[...document.querySelector("[data-field=register]").options].filter(o => o.value === "user-6B-2A-2").length'), 1);
  await change(tabB, '[data-field="register"]', 'user-6B-2A-2');
  // Leave an input uncommitted while a separate browser session changes the registry.
  await click(tabB, '[data-reg-open]');
  await change(tabB, '[data-regform="label"]', 'unfinished register label', 'input');
  const context = (await send('Target.createBrowserContext')).browserContextId;
  const other = await page(context); assert.equal(await login(other, false), 200);
  const remote = await evaluate(other, `(async () => { const auth = await (await fetch('/telemetry/auth/me')).json(); return fetch('/telemetry/registers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf }, body: JSON.stringify({ addr: '0x6B', reg: '0x2B', len: 1, endian: 'big', label: 'Other operator' }) }).then(r => r.status); })()`);
  assert.equal(remote, 200);
  await wait(tabB, '[...document.querySelector("[data-field=register]").options].some(o => o.value === "user-6B-2B-1")');
  assert.equal(await evaluate(tabB, 'document.querySelector("[data-regform=label]").value'), 'unfinished register label');
  assert.equal(await evaluate(tabB, 'document.querySelector("[data-field=register]").value'), 'user-6B-2A-2');
  await wait(tabA, 'document.querySelector("#dmRegister").textContent.includes("Other operator")');
  await change(tabB, '[data-regform="addr"]', '0x40');
  await change(tabB, '[data-regform="reg"]', '0x10');
  await click(tabB, '[data-reg-add]');
  await wait(tabB, 'document.querySelector("#seqState").textContent.includes("Added register")');
  await change(tabA, '#dmDevice', '0x40');
  await wait(tabA, 'document.querySelector("#dmRegister").textContent.includes("unfinished register label")');
  await route(tabB, 'communication', '#debugRegInput');
  await change(tabB, '#debugAddrInput', '0x6B', 'input');
  await wait(tabB, 'document.querySelector("#operatorRegisterSuggestions").textContent.includes("Shared <bench>")');
  await change(tabB, '#debugRegInput', '0x2A');
  assert.equal(await evaluate(tabB, 'document.querySelector("#debugLenInput").value'), '2');
  assert.equal(await evaluate(tabB, 'document.body.textContent.includes("0x2F · ADC Function Disable 0") && document.body.textContent.includes("not sampled in periodic telemetry")'), true);
  await change(tabB, '#debugCommandType', 'i2c_write');
  assert.equal(await evaluate(tabB, '[...document.querySelector("#operatorRegisterSuggestions").options].some(o => o.value === "0x2A" || o.value === "0x2F")'), false);
  await route(tabB, 'sequences', '#seqName');
  assert.equal(await evaluate(tabB, 'document.querySelector("#seqName").value'), 'Unsaved bench sequence');
  assert.equal(await evaluate(tabB, 'document.querySelectorAll(".seq-block").length'), 2);
  await evaluate(tabB, 'document.querySelectorAll(".seq-block [data-select]")[1].click()');
  assert.equal(await evaluate(tabB, 'document.querySelector("[data-field=register]").value'), 'user-40-10-1');
  await click(tabB, '[data-add="registerWrite"]');
  await evaluate(tabB, 'document.querySelectorAll(".seq-block [data-select]")[2].click()');
  await change(tabB, '[data-field="addr"]', '0x6B');
  assert.equal(await evaluate(tabB, '[...document.querySelector("[data-field=reg]").options].filter(o => o.value === "0x30").length'), 1);
  assert.equal(await evaluate(tabB, '[...document.querySelector("[data-field=reg]").options].some(o => o.value === "0x2A" || o.value === "0x2F")'), false);
  await evaluate(tabA, 'window.__beforeReload = true');
  await send('Page.reload', {}, tabA);
  await wait(tabA, '!window.__beforeReload && document.querySelector("#dmDevice")?.options.length > 0');
  await change(tabA, '#dmDevice', '0x6B');
  await wait(tabA, 'document.querySelector("#dmRegister").textContent.includes("Other operator")');
  assert.equal(await evaluate(tabA, '[...document.querySelector("#dmRegister").options].filter(o => o.textContent.includes("0x30 ")).length'), 1);
  assert.equal(await evaluate(tabA, 'document.querySelector("#dmRegister").textContent.includes("Shared <bench>")'), true);
  assert.deepEqual(errors, []);
});
