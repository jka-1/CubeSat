import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import dgram from 'node:dgram';
import { SignJWT } from 'jose';
import { Sessions, passwordRecord } from '../auth/session.mjs';
const password = 'test-only-password-1234';
async function config(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cubesat-auth-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'auth.json'), key = randomBytes(32).toString('hex');
  const record = await passwordRecord(password);
  writeFileSync(file, JSON.stringify({ key, users: ['viewer', 'operator'].map((role) => ({ username: role, role, ...record })) }), { mode: 0o600 });
  return { file, key, dir };
}
const req = (headers = {}, method = 'POST') => ({ method, headers: { origin: 'http://127.0.0.1:8090', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
const settings = (file) => ({ AUTH_CONFIG_PATH: file, AUTH_ORIGIN: 'http://127.0.0.1:8090', AUTH_ALLOW_LOCAL_HTTP: 'true' });

test('JWT verification pins algorithm, claims, expiry and revocable session; config fails closed', async (t) => {
  const { file, key } = await config(t);
  assert.throws(() => new Sessions({ AUTH_ENABLED: 'true' }), /required/);
  assert.throws(() => new Sessions({ ...settings(file), AUTH_ALLOW_LOCAL_HTTP: 'false' }), /HTTPS/);
  assert.throws(() => new Sessions({ ...settings(file), HTTP_BIND_ADDRESS: '0.0.0.0' }), /HTTPS/);
  const secure = new Sessions({ AUTH_CONFIG_PATH: file, AUTH_ORIGIN: 'https://example.test' });
  assert.match(secure.cookie('token'), /; Secure$/);
  const auth = new Sessions(settings(file));
  const { jwt, session } = await auth.login(req(), { username: 'operator', password });
  const cookie = 'cubesat_session=' + jwt;
  assert.equal((await auth.authenticate(req({ cookie }))).role, 'operator');
  const forged = (claims, algorithm = 'HS256', signingKey = Buffer.from(key, 'hex')) => new SignJWT({ role: 'operator', sub: 'operator', jti: session.id, iss: auth.origin, aud: 'cubesat-bridge', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+900, ...claims }).setProtectedHeader({ alg: algorithm, typ: 'JWT' }).sign(signingKey);
  for (const token of [await forged({ exp: 1 }), await forged({ aud: 'other' }), await forged({ iss: 'other' }), await forged({ role: 'viewer' }), await forged({}, 'HS384'), await forged({}, 'HS256', randomBytes(32)), jwt + 'x']) {
    await assert.rejects(auth.authenticate(req({ cookie: 'cubesat_session=' + token })), { statusCode: 401 });
  }
  await assert.rejects(auth.authorize(req({ cookie, 'x-csrf-token': 'invalid' })), { statusCode: 403 });
  await assert.rejects(auth.authorize(req({ cookie, origin: 'https://evil.example', 'x-csrf-token': session.csrf })), { statusCode: 403 });
  assert.equal((await auth.authorize(req({ cookie, 'x-csrf-token': session.csrf }))).username, 'operator');
  auth.revoke(session.id);
  await assert.rejects(auth.authenticate(req({ cookie })), { statusCode: 401 });
  const replacement = await auth.login(req(), { username: 'operator', password });
  await assert.rejects(new Sessions(settings(file)).authenticate(req({ cookie: 'cubesat_session=' + replacement.jwt })), { statusCode: 401 });
});

test('login rejects wrong passwords, rate limits attempts and ignores forwarded peer headers', async (t) => {
  const { file } = await config(t); const auth = new Sessions(settings(file));
  await assert.rejects(auth.login(req({ origin: 'https://evil.example' }), { username: 'operator', password }), { statusCode: 403 });
  await assert.rejects(auth.login(req(), { username: 'operator', password: 'wrong' }), { statusCode: 401 });
  await assert.rejects(auth.login(req(), { username: 'unknown', password }), { statusCode: 401 });
  for (let i = 0; i < 8; i++) await assert.rejects(auth.login(req({ 'x-forwarded-for': String(i) }), {}), { statusCode: 401 });
  await assert.rejects(auth.login(req(), { username: 'operator', password }), { statusCode: 429 });
});
test('viewer sessions are concurrent, expire after inactivity, and support long passwords', async (t) => {
  const { file } = await config(t);
  const auth = new Sessions({ ...settings(file), AUTH_SESSION_SECONDS: '60' });
  assert.ok((await passwordRecord('a password much longer than twelve characters')).hash);
  const first = await auth.login(req(), { username: 'viewer', password });
  const second = await auth.login(req(), { username: 'viewer', password });
  const cookie = (login) => 'cubesat_session=' + login.jwt;
  assert.notEqual(first.session.id, second.session.id);
  assert.equal((await auth.authenticate(req({ cookie: cookie(first) }))).role, 'viewer');
  assert.equal((await auth.authenticate(req({ cookie: cookie(second) }))).role, 'viewer');
  // No session-count ceiling: existing viewers do not prevent another login.
  auth.sessions.set('many-viewers', { role: 'viewer', expires: Date.now() + 60000, streams: new Set() });
  for (let i = 0; i < 255; i++) auth.sessions.set(`viewer-${i}`, { role: 'viewer', expires: Date.now() + 60000, streams: new Set() });
  assert.ok(auth.sessions.size > 256);
  await auth.login(req(), { username: 'viewer', password });
  first.session.expires = Date.now() - 1;
  auth.prune();
  await assert.rejects(auth.authenticate(req({ cookie: cookie(first) })), { statusCode: 401 });
  assert.equal((await auth.authenticate(req({ cookie: cookie(second) }))).role, 'viewer');
});

test('account creation and login accept short passwords but reject blank passwords', async (t) => {
  const { file, key } = await config(t);
  const shortPassword = 'a1';
  await assert.rejects(passwordRecord(''), /non-empty/);
  await assert.rejects(passwordRecord('   '), /non-empty/);
  await assert.rejects(passwordRecord('x'.repeat(257)), /256/);
  const shortRecord = await passwordRecord(shortPassword);
  writeFileSync(file, JSON.stringify({ key, users: [{ username: 'short', role: 'viewer', ...shortRecord }] }), { mode: 0o600 });
  const auth = new Sessions(settings(file));
  const login = await auth.login(req(), { username: 'short', password: shortPassword });
  assert.equal((await auth.authenticate(req({ cookie: 'cubesat_session=' + login.jwt }))).username, 'short');
});

test('operator control is exclusive, survives refresh, and can be reclaimed after a missed lease', async (t) => {
  const { file } = await config(t);
  const auth = new Sessions(settings(file));
  const first = await auth.login(req(), { username: 'operator', password });
  const cookie = 'cubesat_session=' + first.jwt;
  assert.equal(auth.publicSession(await auth.authenticate(req({ cookie }))).control_active, true);
  await assert.rejects(auth.login(req(), { username: 'operator', password }), { statusCode: 409 });
  auth.operatorLeaseUntil = Date.now() - 1;
  auth.prune();
  assert.equal(auth.publicSession(await auth.authenticate(req({ cookie }))).control_active, false);
  auth.renewOperator(first.session);
  assert.equal(auth.publicSession(first.session).control_active, true);
  auth.operatorLeaseUntil = Date.now() - 1;
  const second = await auth.login(req(), { username: 'operator', password });
  await assert.rejects(auth.authorize(req({ cookie, 'x-csrf-token': first.session.csrf })), { statusCode: 409 });
  auth.revoke(second.session.id);
  auth.renewOperator(first.session);
  assert.equal(auth.publicSession(first.session).control_active, true);
});
async function freePort(udp = false) {
  const socket = udp ? dgram.createSocket('udp4') : net.createServer();
  if (udp) socket.bind(0, '127.0.0.1'); else socket.listen(0, '127.0.0.1');
  await once(socket, 'listening'); const port = socket.address().port;
  const closed = once(socket, 'close'); socket.close(); await closed; return port;
}

test('HTTP JWT login enforces roles, CSRF and command token; logout closes SSE', async (t) => {
  const { file, dir } = await config(t);
  const http = await freePort(), udp = await freePort(true), origin = `http://127.0.0.1:${http}`;
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { env: {
    ...process.env, ...settings(file), AUTH_ORIGIN: origin, HTTP_PORT: String(http), UDP_PORT: String(udp),
    HTTP_BIND_ADDRESS: '127.0.0.1', UDP_BIND_ADDRESS: '127.0.0.1', COMMAND_TOKEN: 'test-command',
    ALLOW_UNAUTHENTICATED_COMMANDS: 'true', RECORDING_DB_PATH: join(dir, 'runs.sqlite')
  }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', (d) => { logs += d; });
  t.after(async () => { if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin + '/auth/status')).ok) break; } catch {}
    if (i === 149) throw new Error('Bridge startup failed: ' + logs);
    await new Promise((r) => setTimeout(r, 20));
  }
  const request = (path, session, body, headers = {}) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('/healthz')).status, 200);
  for (const path of ['/latest', '/api/demo/latest', '/health', '/events', '/runs']) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/live-mode', null, { on: true }, { 'X-Command-Token': 'test-command' })).status, 401);
  const login = async (username) => {
    const response = await request('/auth/login', null, { username, password });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const body = await response.json(); assert.equal(body.jwt, undefined);
    return { ...body, cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const viewer = await login('viewer');
  const anotherViewer = await login('viewer');
  assert.equal((await request('/latest', anotherViewer)).status, 200);
  for (const path of ['/latest', '/health', '/runs']) assert.equal((await request(path, viewer)).status, 200);
  const health = await (await request('/health', viewer)).json();
  assert.equal(health.command_auth_required, true, 'JWT mode keeps command-token authentication required');
  for (const path of ['/runs/start', '/runs/stop', '/live-mode', '/command', '/api/demo/command', '/input', '/api/demo/input']) assert.equal((await request(path, viewer, {}, { 'X-Command-Token': 'test-command' })).status, 403);
  assert.equal((await request('/command', viewer,
    { type: 'i2c_write', addr: '0x6B', reg: '0x14', data: ['0x16'] },
    { 'X-Command-Token': 'test-command' })).status, 403);
  assert.equal((await request('/runs/events', viewer, { sequence_name: 'x', step_index: 0, step_text: 'x', phase: 'started' })).status, 403);
  const operator = await login('operator');
  const sequence = { schemaVersion: 1, name: 'Mock history', steps: [
    { id: 'choice', type: 'if', condition: { op: '>', left: { metric: 'pv.busVoltageV' }, right: { constant: 5, unit: 'V' } },
      then: [{ id: 'yes', type: 'delay', durationMs: 1 }], else: [{ id: 'no', type: 'delay', durationMs: 1 }] }
  ] };
  assert.equal((await request('/sequences', viewer)).status, 200);
  assert.equal((await request('/sequences', viewer, sequence)).status, 403);
  assert.equal((await request('/sequences/missing/execute', viewer, { mode: 'live' }, { 'X-Command-Token': 'test-command' })).status, 403);
  const invalid = await request('/sequences', operator, { ...sequence, steps: [{ id: 'bad', type: 'unknown' }] });
  assert.equal(invalid.status, 400);
  const saved = await (await request('/sequences', operator, sequence)).json();
  const executionId = '12345678-1234-4123-8123-123456789abc';
  const runRequest = { mode: 'simulation', execution_id: executionId, telemetry: { pv: { available: true, busVoltageV: 2 } } };
  const started = await request(`/sequences/${saved.sequence.id}/execute`, operator, runRequest);
  assert.equal(started.status, 202);
  assert.equal((await started.json()).execution.id, executionId);
  let recorded;
  for (let i = 0; i < 30; i++) {
    recorded = await (await request(`/sequence-executions/${executionId}`, viewer)).json();
    if (recorded.execution?.state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(recorded.execution.state, 'completed');
  assert.equal(recorded.execution.mode, 'simulation');
  assert.equal(recorded.execution.completed_steps, 2);
  const savedEvents = await (await request(`/sequence-executions/${executionId}/events`, viewer)).json();
  assert.equal(savedEvents.events.find((event) => event.type === 'branch').details.selected, 'else');
  assert.equal((await request(`/sequences/${saved.sequence.id}/execute`, operator, runRequest)).status, 200, 'retry returns the same run');
  assert.equal((await (await request('/sequence-executions', viewer)).json()).executions.filter((item) => item.id === executionId).length, 1);
  assert.equal((await (await request('/runs', viewer)).json()).runs.length, 0, 'simulation never creates a hardware recording');
  assert.equal((await request('/auth/me', operator)).status, 200);
  const duplicateOperator = await request('/auth/login', null, { username: 'operator', password });
  assert.equal(duplicateOperator.status, 409);
  assert.match((await duplicateOperator.json()).error, /Another operator/);
  assert.equal((await request('/auth/heartbeat', operator, {})).status, 200);
  assert.equal((await request('/auth/heartbeat', viewer, {})).status, 403);
  assert.equal((await request('/live-mode', operator, { on: true })).status, 401);
  assert.equal((await request('/live-mode', operator, { on: true }, { 'X-Command-Token': 'test-command', 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request('/live-mode', operator, { on: true }, { 'X-Command-Token': 'test-command', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/live-mode', operator, { on: true }, { 'X-Command-Token': 'test-command' })).status, 200);
  assert.equal((await request('/runs/start', operator, { name: 'local' })).status, 409);
  assert.equal((await request('/runs/events', operator, { sequence_name: 'x', step_index: 0, step_text: 'x', phase: 'started' })).status, 409);
  const stream = await request('/events', viewer), reader = stream.body.getReader();
  await reader.read();
  assert.equal((await request('/auth/logout', viewer, {})).status, 200);
  const ended = (async () => { while (!(await reader.read()).done) {} })();
  let timer; await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE did not close')), 2000); })]).finally(() => clearTimeout(timer));
  assert.equal((await request('/latest', viewer)).status, 401);
  assert.equal((await request('/latest', operator)).status, 200);
  assert.equal((await request('/auth/logout', operator, {})).status, 200);
  assert.equal((await request('/command', operator, {}, { 'X-Command-Token': 'test-command' })).status, 401);
  const replacement = await login('operator');
  assert.equal((await request('/latest', replacement)).status, 200);
});
