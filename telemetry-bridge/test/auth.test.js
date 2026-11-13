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
import httpClient from 'node:http';
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
  for (const path of ['/public/health', '/public/latest', '/public/events']) assert.equal((await request(path)).status, 401);
  for (const path of ['/operator-pages/sequences', '/operator-pages/debug-mode', '/operator-pages/manual', '/operator-pages/manual-document', '/sequences', '/sequence-executions']) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/public/command', null, {}, { 'X-Command-Token': 'test-command' })).status, 404);
  for (const path of ['/latest', '/api/demo/latest', '/health', '/events', '/runs']) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/live-mode', null, { on: true }, { 'X-Command-Token': 'test-command' })).status, 401);
  const login = async (username) => {
    const response = await request('/auth/login', null, { username, password });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const body = await response.json(); assert.equal(body.jwt, undefined);
    return { ...body, cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const viewer = await login('viewer');
  for (const path of ['/public/health', '/public/latest']) assert.equal((await request(path, viewer)).status, 200);
  const publicStream = await request('/public/events', viewer), publicReader = publicStream.body.getReader();
  const publicStatus = new TextDecoder().decode((await publicReader.read()).value);
  assert.ok(publicStatus.includes('"command_ready":false'));
  assert.ok(!publicStatus.includes('active_sequence'));
  await publicReader.cancel();
  for (const path of ['/operator-pages/sequences', '/operator-pages/debug-mode', '/operator-pages/manual', '/operator-pages/manual-document', '/sequences', '/sequence-executions']) assert.equal((await request(path, viewer)).status, 403);
  assert.equal((await request('/command', viewer, { role: 'operator' }, { 'X-Command-Token': 'test-command', 'X-Role': 'operator' })).status, 403);
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
  for (const path of ['/operator-pages/sequences', '/operator-pages/debug-mode', '/operator-pages/manual', '/operator-pages/manual-document']) assert.equal((await request(path, operator)).status, 200);
  const sequence = { schemaVersion: 1, name: 'Mock history', steps: [
    { id: 'choice', type: 'if', condition: { op: '>', left: { metric: 'pv.busVoltageV' }, right: { constant: 5, unit: 'V' } },
      then: [{ id: 'yes', type: 'delay', durationMs: 1 }], else: [{ id: 'no', type: 'delay', durationMs: 1 }] }
  ] };
  assert.equal((await request('/sequences', viewer)).status, 403);
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
    recorded = await (await request(`/sequence-executions/${executionId}`, operator)).json();
    if (recorded.execution?.state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(recorded.execution.state, 'completed');
  assert.equal(recorded.execution.mode, 'simulation');
  assert.equal(recorded.execution.completed_steps, 2);
  const savedEvents = await (await request(`/sequence-executions/${executionId}/events`, operator)).json();
  assert.equal(savedEvents.events.find((event) => event.type === 'branch').details.selected, 'else');
  assert.equal((await request(`/sequences/${saved.sequence.id}/execute`, operator, runRequest)).status, 200, 'retry returns the same run');
  assert.equal((await (await request('/sequence-executions', operator)).json()).executions.filter((item) => item.id === executionId).length, 1);
  assert.equal((await (await request('/runs', viewer)).json()).runs.length, 0, 'simulation never creates a hardware recording');
  assert.equal((await request('/auth/me', operator)).status, 200);
  const duplicateOperator = await request('/auth/login', null, { username: 'operator', password });
  assert.equal(duplicateOperator.status, 409);
  assert.match((await duplicateOperator.json()).error, /Another operator/);
  // Concurrent Branch Definition editing: a second client signs in for editing only (no control lease).
  const editorLogin = await request('/auth/login', null, { username: 'operator', password, control: false });
  assert.equal(editorLogin.status, 200);
  const editorBody = await editorLogin.json();
  assert.equal(editorBody.control_active, false);
  const editor = { ...editorBody, cookie: editorLogin.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/auth/me', operator)).status, 200, 'editor login does not displace the controlling operator');
  assert.equal((await (await request('/auth/me', operator)).json()).control_active, true);
  // Registry metadata is shared by authorized operators, including editing-only sessions.
  const register = { addr: '0x6B', reg: '0x2A', len: 2, endian: 'little', label: 'Shared bench register' };
  assert.equal((await request('/registers')).status, 401);
  assert.equal((await request('/registers', viewer)).status, 403);
  assert.equal((await request('/registers', viewer, register)).status, 403);
  assert.equal((await request('/registers', operator, register, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await request('/registers', operator, register, { Origin: 'https://evil.test' })).status, 403);
  const additions = await Promise.all([
    request('/registers', operator, register), request('/registers', editor, { ...register, reg: '0x2B' }),
    request('/registers', editor, register)
  ]);
  assert.deepEqual(additions.map((response) => response.status), [200, 200, 200]);
  const catalog = (await (await request('/registers', editor)).json()).registers;
  assert.equal(catalog.length, 2);
  assert.equal((await request('/registers', operator, { ...register, endian: 'big' })).status, 409);
  assert.equal((await request('/registers', editor, { ...register, reg: '0x2F', len: 1, endian: 'big' })).status, 200);
  assert.equal((await request('/registers', editor, { ...register, access: 'RW' })).status, 400);
  const customRead = { schemaVersion: 1, name: 'Shared register read', registers: catalog, steps: [
    { id: 'read', type: 'registerRead', command: { type: 'i2c_read', addr: register.addr, reg: register.reg, len: 2 } }
  ] };
  const customSavedResponse = await request('/sequences', editor, customRead);
  assert.equal(customSavedResponse.status, 201);
  const customSaved = (await customSavedResponse.json()).sequence;
  assert.deepEqual(customSaved.registers, catalog);
  const unsafe = { ...customRead, steps: [{ id: 'write', type: 'registerWrite', command: { type: 'i2c_write', addr: '0x6B', reg: '0x2A', data: ['0x00', '0x00'] } }] };
  assert.equal((await request('/sequences', editor, unsafe)).status, 400, 'registry does not expand write approval');
  for (const [addr, reg, data] of [['0x6B', '0x2A', ['0x00', '0x00']], ['0x6B', '0x2F', ['0x00']], ['0x6B', '0x14', ['0x40']], ['0x6B', '0x30', ['0x00', '0x00']], ['0x48', '0x00', ['0x00']]]) {
    assert.equal((await request('/command', operator, { type: 'i2c_write', addr, reg, data }, { 'X-Command-Token': 'test-command' })).status, 400);
  }
  const put = (path, session, body) => fetch(origin + path, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf }, body: JSON.stringify(body) });
  // Shared library order is available to editing-only operators, with the existing CSRF boundary.
  const orderWrite = (actor, body, headers = {}) => fetch(origin + '/sequences/order', { method: 'PUT', headers: {
    Origin: origin, 'Content-Type': 'application/json', ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}), ...headers
  }, body: JSON.stringify(body) });
  const beforeOrder = await (await request('/sequences', editor)).json();
  const moveBody = { id: customSaved.id, before_id: saved.sequence.id, expected_version: beforeOrder.order.version };
  assert.equal((await orderWrite(null, moveBody)).status, 401);
  assert.equal((await orderWrite(viewer, moveBody)).status, 403);
  for (const token of ['', 'wrong']) assert.equal((await orderWrite(editor, moveBody, { 'X-CSRF-Token': token })).status, 403);
  assert.equal((await orderWrite(editor, moveBody, { Origin: 'https://evil.test' })).status, 403);
  const moved = await orderWrite(editor, moveBody);
  assert.equal(moved.status, 200, 'no hardware control lease or command token needed');
  const movedLibrary = await moved.json();
  assert.equal(movedLibrary.sequences[0].id, customSaved.id);
  assert.deepEqual(await (await request('/sequences', operator)).json(), movedLibrary, 'other operator sees shared order');
  assert.equal((await orderWrite(operator, moveBody)).status, 409, 'stale order write rejected');
  assert.equal((await (await request(`/sequences/${customSaved.id}`, editor)).json()).sequence.revision, customSaved.revision);
  const base = (await (await request(`/sequences/${saved.sequence.id}`, editor)).json()).sequence;
  const stream2 = await request('/events', editor), reader2 = stream2.body.getReader();
  const editorSave = await put(`/sequences/${base.id}`, editor, { ...base, confirmed_revision: base.revision, name: 'Edited in app' });
  assert.equal(editorSave.status, 200, 'editor-only operator may save definitions');
  assert.equal((await editorSave.json()).sequence.revision, base.revision + 1);
  let sse = '';
  for (let i = 0; i < 20 && !sse.includes('sequence_saved'); i++) sse += new TextDecoder().decode((await reader2.read()).value);
  assert.match(sse, /"type":"sequence_saved"/);
  await reader2.cancel();
  const stale = await put(`/sequences/${base.id}`, operator, { ...base, name: 'Stale web edit' });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.code, 'revision_conflict');
  assert.equal(conflict.current.revision, base.revision + 1);
  assert.equal(conflict.current.name, 'Edited in app');
  assert.equal((await put(`/sequences/${base.id}`, operator, { ...base, revision: conflict.current.revision, confirmed_revision: conflict.current.revision, name: 'Overwrite' })).status, 200);
  const destroy = (target, actor, body, headers = {}) => fetch(origin + `/sequences/${target}`, { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json', ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}), ...headers }, body: JSON.stringify(body) });
  const latestDefinition = (await (await request(`/sequences/${base.id}`, editor)).json()).sequence;
  const confirmed = { revision: latestDefinition.revision, confirmed_revision: latestDefinition.revision };
  assert.equal((await destroy(base.id, null, confirmed)).status, 401);
  assert.equal((await destroy(base.id, viewer, confirmed)).status, 403);
  assert.equal((await destroy(base.id, editor, confirmed, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await destroy(base.id, editor, { revision: latestDefinition.revision })).status, 400);
  assert.equal((await destroy(base.id, editor, { revision: base.revision, confirmed_revision: base.revision })).status, 409);
  assert.equal((await put(`/sequences/${base.id}`, editor, latestDefinition)).status, 400, 'overwrite needs explicit confirmation');
  const child = (await (await request('/sequences', editor, { schemaVersion: 1, name: 'Nested log', steps: [{ id: 'note', type: 'message', message: '<script>printf %s</script>' }] })).json()).sequence;
  const parent = (await (await request('/sequences', editor, { schemaVersion: 1, name: 'Parent log', steps: [{ id: 'call', type: 'runSaved', sequenceId: child.id, revision: child.revision }] })).json()).sequence;
  assert.equal((await destroy(child.id, editor, { revision: child.revision, confirmed_revision: child.revision })).status, 409, 'saved dependencies block deletion');
  const nestedStart = await request(`/sequences/${parent.id}/execute`, operator, { mode: 'simulation' });
  assert.equal(nestedStart.status, 202);
  const nestedId = (await nestedStart.json()).execution.id;
  let nestedResult;
  for (let i = 0; i < 100; i++) {
    nestedResult = (await (await request(`/sequence-executions/${nestedId}`, operator)).json()).execution;
    if (nestedResult.state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(nestedResult.state, 'completed');
  assert.equal(nestedResult.definition.dependencies[0].revision, child.revision);
  const nestedEvents = (await (await request(`/sequence-executions/${nestedId}/events`, operator)).json()).events;
  assert.equal(nestedEvents.find((event) => event.type === 'message').details.message, '<script>printf %s</script>');
  assert.equal((await destroy(parent.id, editor, { revision: parent.revision, confirmed_revision: parent.revision })).status, 200, 'editor deletion does not need hardware control');
  assert.equal((await destroy(child.id, editor, { revision: child.revision, confirmed_revision: child.revision })).status, 200);
  assert.equal((await request(`/sequences/${child.id}`, editor)).status, 404);
  assert.equal((await request(`/sequence-executions/${nestedId}`, editor)).status, 200, 'deletion preserves historical snapshots');
  const raceDefinition = (await (await request('/sequences', editor, { schemaVersion: 1, name: 'Revision race', steps: [{ id: 'note', type: 'message', message: 'race' }] })).json()).sequence;
  const competing = await Promise.all(['first', 'second'].map((name) => put(`/sequences/${raceDefinition.id}`, editor, { ...raceDefinition, name, confirmed_revision: raceDefinition.revision })));
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409], 'exactly one concurrent overwrite commits');
  const raceLatest = (await (await request(`/sequences/${raceDefinition.id}`, editor)).json()).sequence;
  const [racedSave, racedDelete] = await Promise.all([
    put(`/sequences/${raceLatest.id}`, editor, { ...raceLatest, name: 'last save', confirmed_revision: raceLatest.revision }),
    destroy(raceLatest.id, editor, { revision: raceLatest.revision, confirmed_revision: raceLatest.revision })
  ]);
  assert.ok(racedSave.status === 200 && racedDelete.status === 409 || racedSave.status === 404 && racedDelete.status === 200, 'save/delete race cannot both mutate the same revision');
  assert.equal((await request(`/sequences/${base.id}/execute`, editor, { mode: 'simulation' })).status, 403, 'execution still needs the control lease');
  assert.equal((await request('/auth/heartbeat', editor, {})).status, 409, 'editor cannot take control while it is held');
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
  // A body that finishes after logout must not dispatch using an earlier authorization.
  const commandBody = JSON.stringify({ type: 'led_control', enabled: true });
  let finishSlow;
  const slowResponse = new Promise((resolve, reject) => {
    const pending = httpClient.request(origin + '/command', { method: 'POST', headers: {
      Origin: origin, Cookie: operator.cookie, 'X-CSRF-Token': operator.csrf,
      'X-Command-Token': 'test-command', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(commandBody)
    } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    pending.on('error', reject); pending.write(commandBody.slice(0, 5));
    finishSlow = () => pending.end(commandBody.slice(5));
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const confirmedLibrary = await (await request('/sequences', operator)).json();
  assert.equal((await request('/auth/logout', operator, {})).status, 200);
  finishSlow();
  assert.equal(await slowResponse, 401);
  assert.equal((await request('/command', operator, {}, { 'X-Command-Token': 'test-command' })).status, 401);
  const replacement = await login('operator');
  assert.equal((await request('/latest', replacement)).status, 200);
  assert.deepEqual(await (await request('/sequences', replacement)).json(), confirmedLibrary, 'library order survives sign-out/sign-in');
});

test('live branches share a recording, preserve packets and markers, and retain independent runs', async (t) => {
  const { file, dir } = await config(t);
  const http = await freePort(), udp = await freePort(true), origin = `http://127.0.0.1:${http}`;
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { env: {
    ...process.env, ...settings(file), AUTH_ORIGIN: origin, HTTP_PORT: String(http), UDP_PORT: String(udp),
    HTTP_BIND_ADDRESS: '127.0.0.1', UDP_BIND_ADDRESS: '127.0.0.1', COMMAND_TOKEN: 'test-command',
    RECORDING_DB_PATH: join(dir, 'runs.sqlite')
  }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', (d) => { logs += d; });
  t.after(async () => { if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } });
  const waitFor = async (fn) => {
    for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('Timed out: ' + logs);
  };
  await waitFor(async () => { try { return (await fetch(origin + '/auth/status')).ok; } catch { return false; } });
  const login = await fetch(origin + '/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password }) });
  const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
  const request = (path, body, method = body === undefined ? 'GET' : 'POST') => fetch(origin + path, { method,
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': session.csrf, 'X-Command-Token': 'test-command', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (path, body, method) => {
    const response = await request(path, body, method), value = await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`); return value;
  };
  const publicStream = await request('/public/events');
  const publicReader = publicStream.body.getReader();
  let observerText = '';
  const observing = (async () => {
    while (true) { const { done, value } = await publicReader.read(); if (done) break; observerText += new TextDecoder().decode(value); }
  })();
  t.after(async () => { await publicReader.cancel(); await observing; });
  const device = dgram.createSocket('udp4'); device.bind(0, '127.0.0.1'); await once(device, 'listening');
  t.after(() => device.close());
  let commands = 0, seq = 0, failNext = false;
  const emitted = [];
  device.on('message', (bytes, peer) => {
    let command; try { command = JSON.parse(bytes); } catch { return; }
    if (command.type !== 'led_control') return;
    commands++;
    const ok = !failNext; failNext = false;
    device.send(JSON.stringify({ type: 'debug_result', device_id: 'esp32-telemetry', request_id: command.request_id,
      command_type: 'led_control', ok, enabled: true, gpio: 38 }), peer.port, peer.address);
  });
  const send = async () => {
    const current = ++seq;
    const words = [0x4353, 4, current, 2600, 0x0a00, 40, 4003, 10, 50, 3813, 3807, 3676, 3677, 0x61, 0, 0xa507, 3, 2500, 1550, 5000];
    const hex = words.map((word) => word.toString(16).padStart(4, '0')).join('');
    device.send(hex, udp, '127.0.0.1');
    const latest = await waitFor(async () => { const value = await json('/latest'); return value.latest?.packet?.seq === current && value.latest; });
    const publicLatest = await json('/public/latest');
    assert.equal(publicLatest.latest.packet.seq, current);
    assert.equal(publicLatest.latest_debug, null);
    emitted.push(latest); return latest;
  };
  await send();
  const nestedDefinition = (await json('/sequences', { schemaVersion: 1, name: 'Nested hardware check', steps: [
    { id: 'led', type: 'command', command: { type: 'led_control', enabled: true } },
    { id: 'hold', type: 'delay', durationMs: 200 },
    { id: 'note', type: 'message', message: 'Nested live message <escaped> %s' }
  ] })).sequence;
  let definition = (await json('/sequences', { schemaVersion: 1, name: 'Concurrent branch', steps: [
    { id: 'choice', type: 'if', condition: { op: '>', left: { metric: 'pv.busVoltageV' }, right: { constant: 1, unit: 'V' } },
      then: [{ id: 'call', type: 'runSaved', sequenceId: nestedDefinition.id, revision: nestedDefinition.revision }],
      else: [{ id: 'fallback', type: 'delay', durationMs: 1 }] }
  ] })).sequence;
  const stalePreflight = await json(`/sequences/${definition.id}/preflight`, {});
  assert.equal(stalePreflight.dependencies[0].revision, 1);
  definition = (await json(`/sequences/${definition.id}`, { ...definition, name: 'Preflight revision changed', confirmed_revision: definition.revision }, 'PUT')).sequence;
  assert.equal((await request(`/sequences/${definition.id}/execute`, { mode: 'live', confirmation_token: stalePreflight.confirmation_token })).status, 403, 'stale preflight cannot execute a changed revision');
  await json(`/sequences/${nestedDefinition.id}`, { ...nestedDefinition, confirmed_revision: nestedDefinition.revision, steps: [{ id: 'replacement', type: 'message', message: 'Current revision must not replace the pinned child' }] }, 'PUT');
  assert.equal(commands, 0);
  const execute = async (during) => {
    const confirmation = await json(`/sequences/${definition.id}/preflight`, {});
    const started = await json(`/sequences/${definition.id}/execute`, { mode: 'live', confirmation_token: confirmation.confirmation_token });
    await send();
    if (during) await during(started);
    const saved = await waitFor(async () => { const row = (await json(`/sequence-executions/${started.execution.id}`)).execution; return ['completed', 'failed'].includes(row.state) && row; });
    return saved;
  };
  const before = await execute();
  assert.equal((await json('/runs')).recording.active_run_id, null, 'independent branch closes only its own recording');
  assert.equal((await json(`/runs/${before.recording_run_id}`)).run.status, 'completed');
  const run = (await json('/runs/start', { name: 'Uninterrupted acquisition' })).run;
  const first = await execute(async () => {
    assert.equal((await request('/command', { type: 'led_control', enabled: true })).status, 409, 'manual command cannot overlap branch control');
    assert.equal((await request('/runs/start', { name: 'duplicate' })).status, 409);
    definition = (await json(`/sequences/${definition.id}`, { ...definition, confirmed_revision: definition.revision, name: 'Edited during recording' }, 'PUT')).sequence;
  });
  const second = await execute();
  assert.equal(first.state, 'completed'); assert.equal(second.state, 'completed');
  failNext = true;
  const failed = await execute();
  assert.equal(failed.reason, 'command_failed');
  assert.equal(failed.recording_run_id, run.id);
  assert.equal(first.recording_run_id, run.id); assert.equal(second.recording_run_id, run.id);
  assert.equal(first.recording_session_id, run.session_id); assert.equal(second.recording_session_id, run.session_id);
  await send();
  assert.equal((await json('/runs')).recording.active_run_id, run.id);
  assert.equal((await json(`/runs/${run.id}`)).run.status, 'recording');
  const stopped = (await json('/runs/stop', {})).run;
  assert.equal(stopped.id, run.id); assert.equal(stopped.status, 'completed');
  const samples = (await json(`/runs/${run.id}/samples`)).items;
  assert.deepEqual(samples.map((sample) => sample.seq), emitted.slice(2).map((envelope) => envelope.packet.seq));
  assert.deepEqual(samples.map((sample) => sample.received_ms), emitted.slice(2).map((envelope) => Date.parse(envelope.received_at)));
  const events = (await json(`/runs/${run.id}/events?limit=500`)).items;
  for (const execution of [first, second]) {
    assert.ok(events.some((event) => event.type === 'sequence_step' && event.details.execution_id === execution.id && event.details.phase === 'branch'));
    assert.ok(events.some((event) => event.type === 'sequence_step' && event.details.execution_id === execution.id && event.details.phase === 'message' && event.details.message === 'Nested live message <escaped> %s' && event.details.path.includes(`call:${nestedDefinition.id}@1`)));
    assert.equal(execution.definition.dependencies[0].revision, 1);
  }
  const after = await execute();
  assert.notEqual(after.recording_run_id, run.id);
  assert.equal((await json('/runs')).recording.active_run_id, null);
  assert.equal(commands, 5);
  await publicReader.cancel(); await observing;
  const publicEvents = observerText.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  assert.ok(publicEvents.some((event) => event.type === 'telemetry'));
  assert.ok(publicEvents.some((event) => event.type === 'command_status' && Number.isFinite(event.round_trip_ms)));
  for (const event of publicEvents) {
    assert.ok(['status', 'telemetry', 'command_status'].includes(event.type));
    assert.equal(event.active_sequence, undefined);
    assert.equal(event.definition, undefined);
    if (event.type === 'command_status') { assert.equal(event.result, undefined); assert.equal(event.target, undefined); }
  }
});
