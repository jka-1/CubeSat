import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = path.resolve(testDirectory, '..');
const bridgePath = path.join(bridgeDirectory, 'server.js');
const repositoryRoot = path.resolve(bridgeDirectory, '..');
const commandToken = 'integration-test-token';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reserveTcpPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function reserveUdpPort() {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  socket.close();
  await once(socket, 'close');
  return port;
}

function sendUdp(socket, payload, port) {
  const buffer = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(String(payload));

  return new Promise((resolve, reject) => {
    socket.send(buffer, port, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createJsonReceiver(socket) {
  const queuedMessages = [];
  const waiters = [];

  socket.on('message', (message) => {
    const parsed = JSON.parse(message.toString('utf8'));
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else queuedMessages.push(parsed);
  });

  return function receiveJson(timeoutMs = 1_000) {
    if (queuedMessages.length > 0) {
      return Promise.resolve(queuedMessages.shift());
    }

    return new Promise((resolve, reject) => {
      const onMessage = (message) => {
        clearTimeout(timeoutHandle);
        resolve(message);
      };
      const timeoutHandle = setTimeout(() => {
        const waiterIndex = waiters.indexOf(onMessage);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for UDP message after ${timeoutMs} ms`));
      }, timeoutMs);

      waiters.push(onMessage);
    });
  };
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }

  throw lastError || new Error(`Condition not met within ${timeoutMs} ms`);
}

async function postCommand(baseUrl, payload, token = commandToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers['X-Command-Token'] = token;

  return fetch(`${baseUrl}/command`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
}

test('bridge completes the hardened telemetry and debug command lifecycle', async (context) => {
  const httpPort = await reserveTcpPort();
  const udpPort = await reserveUdpPort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const bridge = spawn(process.execPath, [bridgePath], {
    cwd: bridgeDirectory,
    env: {
      ...process.env,
      HTTP_PORT: String(httpPort),
      UDP_PORT: String(udpPort),
      HTTP_BIND_ADDRESS: '127.0.0.1',
      UDP_BIND_ADDRESS: '127.0.0.1',
      COMMAND_TOKEN: commandToken,
      COMMAND_TIMEOUT_MS: '150',
      TELEMETRY_STALE_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let bridgeOutput = '';
  bridge.stdout.on('data', (chunk) => { bridgeOutput += chunk; });
  bridge.stderr.on('data', (chunk) => { bridgeOutput += chunk; });

  context.after(async () => {
    if (bridge.exitCode === null) bridge.kill('SIGTERM');
    if (bridge.exitCode === null) await once(bridge, 'exit');
  });

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  }).catch((error) => {
    throw new Error(`${error.message}\nBridge output:\n${bridgeOutput}`);
  });

  const device = dgram.createSocket('udp4');
  device.bind(0, '127.0.0.1');
  await once(device, 'listening');
  context.after(() => device.close());
  const receiveDeviceJson = createJsonReceiver(device);

  const packetWithPollingMask =
    '4353000303B380000A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507';
  await sendUdp(device, packetWithPollingMask, udpPort);

  const acknowledgement = await receiveDeviceJson();
  assert.equal(acknowledgement.type, 'ack');
  assert.equal(acknowledgement.seq, 0x03b3);

  const liveHealth = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    return body.telemetry_connected ? body : null;
  });
  assert.equal(liveHealth.command_ready, true);
  assert.equal(liveHealth.sensor_polling.active_sensor_mask, 0x07);
  assert.equal(liveHealth.sensor_polling.source, 'telemetry-packet');

  const unauthorized = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x08', reg: '0x20', len: 1
  }, null);
  assert.equal(unauthorized.status, 401);

  const invalidAddress = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x55', reg: '0x20', len: 1
  });
  assert.equal(invalidAddress.status, 400);

  const legacyLedCommand = await postCommand(baseUrl, {
    target: 'led', state: 'on'
  });
  assert.equal(legacyLedCommand.status, 400);

  const invalidAcdrvState = await postCommand(baseUrl, {
    type: 'mppt_acdrv_control', state: 'both'
  });
  assert.equal(invalidAcdrvState.status, 400);

  const readResponse = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x08', reg: '0x20', len: 2
  });
  assert.equal(readResponse.status, 202);
  const readAccepted = await readResponse.json();
  assert.equal(readAccepted.status, 'pending');

  const readCommand = await receiveDeviceJson();
  assert.equal(readCommand.type, 'i2c_read');
  assert.equal(readCommand.addr, '0x08');
  assert.equal(readCommand.reg, '0x20');
  assert.equal(readCommand.len, 2);

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'i2c_write',
    request_id: readCommand.request_id,
    status: 'ok',
    ok: true,
    addr: readCommand.addr,
    reg: readCommand.reg,
    len: 1,
    write_data: ['0xAB']
  }), udpPort);

  await waitFor(() => bridgeOutput.includes(
    `ignored mismatched debug_result request=${readCommand.request_id}`
  ));
  const stillPending = await fetch(`${baseUrl}/latest`).then((response) => response.json());
  assert.equal(stillPending.latest_command.request_id, readCommand.request_id);
  assert.equal(stillPending.latest_command.status, 'pending');

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'i2c_read',
    request_id: readCommand.request_id,
    status: 'ok',
    ok: true,
    addr: readCommand.addr,
    reg: readCommand.reg,
    len: readCommand.len,
    data: ['0xAB', '0xCD']
  }), udpPort);

  const completedRead = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_debug?.packet?.request_id === readCommand.request_id
      ? body
      : null;
  });
  assert.deepEqual(completedRead.latest_debug.packet.data, ['0xAB', '0xCD']);
  assert.equal(completedRead.latest_command.status, 'completed');

  const writeResponse = await postCommand(baseUrl, {
    type: 'i2c_write',
    addr: '0x40',
    reg: '0x05',
    data: ['0x0A', '0x00']
  });
  assert.equal(writeResponse.status, 202);
  const writeCommand = await receiveDeviceJson();
  assert.equal(writeCommand.type, 'i2c_write');
  assert.deepEqual(writeCommand.data, ['0x0A', '0x00']);

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'i2c_write',
    request_id: writeCommand.request_id,
    status: 'ok',
    ok: true,
    addr: writeCommand.addr,
    reg: writeCommand.reg,
    len: writeCommand.data.length,
    write_data: writeCommand.data
  }), udpPort);

  const completedWrite = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_debug?.packet?.request_id === writeCommand.request_id
      ? body.latest_debug.packet
      : null;
  });
  assert.deepEqual(completedWrite.write_data, ['0x0A', '0x00']);

  const pauseResponse = await postCommand(baseUrl, {
    type: 'sensor_control', sensor: 'bms', enabled: false
  });
  assert.equal(pauseResponse.status, 202);
  const pauseCommand = await receiveDeviceJson();
  assert.equal(pauseCommand.type, 'sensor_control');

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'sensor_control',
    request_id: pauseCommand.request_id,
    status: 'ok',
    ok: true,
    sensor: 'bms',
    enabled: false,
    sensor_mask: 0x02,
    active_sensor_mask: 0x05
  }), udpPort);

  const pausedHealth = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    return body.sensor_polling?.active_sensor_mask === 0x05 ? body : null;
  });
  assert.deepEqual(
    pausedHealth.sensor_polling.paused_sensors.map((sensor) => sensor.key),
    ['bms']
  );

  const ledResponse = await postCommand(baseUrl, {
    type: 'led_control', enabled: true
  });
  assert.equal(ledResponse.status, 202);
  const ledCommand = await receiveDeviceJson();
  assert.equal(ledCommand.type, 'led_control');
  assert.equal(ledCommand.enabled, true);

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'led_control',
    request_id: ledCommand.request_id,
    status: 'ok',
    ok: true,
    enabled: true,
    gpio: 38
  }), udpPort);

  const completedLed = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_debug?.packet?.request_id === ledCommand.request_id
      ? body.latest_debug.packet
      : null;
  });
  assert.equal(completedLed.enabled, true);
  assert.equal(completedLed.gpio, 38);

  const acdrvResponse = await postCommand(baseUrl, {
    type: 'mppt_acdrv_control', state: 'acdrv2'
  });
  assert.equal(acdrvResponse.status, 202);
  const acdrvCommand = await receiveDeviceJson();
  assert.equal(acdrvCommand.type, 'mppt_acdrv_control');
  assert.equal(acdrvCommand.state, 'acdrv2');

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    device_id: 'lab-simulator',
    command_type: 'mppt_acdrv_control',
    request_id: acdrvCommand.request_id,
    status: 'ok',
    ok: true,
    state: 'acdrv2',
    register_12_before: '0x00',
    register_12_after: '0x00',
    register_13_before: '0x61',
    register_13_after: '0xA1',
    acrb_status: '0xC0',
    acrb1_present: true,
    acrb2_present: true,
    verified: true
  }), udpPort);

  const completedAcdrv = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_debug?.packet?.request_id === acdrvCommand.request_id
      ? body.latest_debug.packet
      : null;
  });
  assert.equal(completedAcdrv.state, 'acdrv2');
  assert.equal(completedAcdrv.verified, true);
  assert.equal(completedAcdrv.register_13_after, '0xA1');

  await sendUdp(device, packetWithPollingMask, udpPort);
  await receiveDeviceJson();

  const timeoutResponse = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x40', reg: '0x05', len: 2
  });
  assert.equal(timeoutResponse.status, 202);
  const unansweredCommand = await receiveDeviceJson();

  const timedOut = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_command?.request_id === unansweredCommand.request_id &&
      body.latest_command?.status === 'timed_out'
      ? body.latest_command
      : null;
  });
  assert.match(timedOut.error, /No ESP32 response/);

  await delay(1_050);
  const staleHealthResponse = await fetch(`${baseUrl}/health`);
  const staleHealth = await staleHealthResponse.json();
  assert.equal(staleHealth.telemetry_connected, false);
  assert.equal(staleHealth.command_ready, false);

  const staleCommand = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x08', reg: '0x20', len: 1
  });
  assert.equal(staleCommand.status, 400);
});

test('dashboard command controls match the hardened interface', async () => {
  const html = await readFile(
    path.join(repositoryRoot, 'site/modules/communication.html'),
    'utf8'
  );
  const script = await readFile(
    path.join(repositoryRoot, 'site/assets/js/i2c.js'),
    'utf8'
  );

  const requiredIds = [
    'commandUrl',
    'commandTokenInput',
    'debugCommandType',
    'debugAddrInput',
    'debugRegInput',
    'debugLenInput',
    'debugDataInput',
    'sendDebugCommandButton',
    'sensorControlSelect',
    'pauseSensorButton',
    'resumeSensorButton',
    'acdrvControlSelect',
    'applyAcdrvButton',
    'ledOnButton',
    'ledOffButton',
    'commandResultLog'
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(script, new RegExp(id));
  }

  assert.doesNotMatch(html, /mpptOnButton|mpptOffButton|sendCustomCommandButton/);
  assert.doesNotMatch(script, /onMpptOnClick|onMpptOffClick|onSendCustomCommandClick/);
});

test('configured hostname targets accept correlated replies from their resolved IP', async (context) => {
  const httpPort = await reserveTcpPort();
  const udpPort = await reserveUdpPort();
  const devicePort = await reserveUdpPort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const bridge = spawn(process.execPath, [bridgePath], {
    cwd: bridgeDirectory,
    env: {
      ...process.env,
      HTTP_PORT: String(httpPort),
      UDP_PORT: String(udpPort),
      HTTP_BIND_ADDRESS: '127.0.0.1',
      UDP_BIND_ADDRESS: '127.0.0.1',
      COMMAND_TOKEN: commandToken,
      COMMAND_TARGET_HOST: 'localhost',
      COMMAND_TARGET_PORT: String(devicePort),
      COMMAND_TIMEOUT_MS: '500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let bridgeOutput = '';
  bridge.stdout.on('data', (chunk) => { bridgeOutput += chunk; });
  bridge.stderr.on('data', (chunk) => { bridgeOutput += chunk; });
  context.after(async () => {
    if (bridge.exitCode === null) bridge.kill('SIGTERM');
    if (bridge.exitCode === null) await once(bridge, 'exit');
  });

  const device = dgram.createSocket('udp4');
  device.bind(devicePort, '127.0.0.1');
  await once(device, 'listening');
  context.after(() => device.close());
  const receiveDeviceJson = createJsonReceiver(device);

  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  }).catch((error) => {
    throw new Error(`${error.message}\nBridge output:\n${bridgeOutput}`);
  });

  const readResponse = await postCommand(baseUrl, {
    type: 'i2c_read', addr: '0x6B', reg: '0x13', len: 1
  });
  assert.equal(readResponse.status, 202);
  const readCommand = await receiveDeviceJson();

  await sendUdp(device, JSON.stringify({
    version: 1,
    type: 'debug_result',
    command_type: 'i2c_read',
    request_id: readCommand.request_id,
    status: 'ok',
    ok: true,
    addr: readCommand.addr,
    reg: readCommand.reg,
    len: readCommand.len,
    data: ['0x61']
  }), udpPort);

  const completed = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/latest`);
    const body = await response.json();
    return body.latest_command?.request_id === readCommand.request_id &&
      body.latest_command?.status === 'completed'
      ? body.latest_command
      : null;
  });
  assert.equal(completed.status, 'completed');
});

test('bridge health is degraded when command authorization is not configured', async (context) => {
  const httpPort = await reserveTcpPort();
  const udpPort = await reserveUdpPort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const bridge = spawn(process.execPath, [bridgePath], {
    cwd: bridgeDirectory,
    env: {
      ...process.env,
      HTTP_PORT: String(httpPort),
      UDP_PORT: String(udpPort),
      HTTP_BIND_ADDRESS: '127.0.0.1',
      UDP_BIND_ADDRESS: '127.0.0.1',
      COMMAND_TOKEN: '',
      ALLOW_UNAUTHENTICATED_COMMANDS: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let bridgeOutput = '';
  bridge.stdout.on('data', (chunk) => { bridgeOutput += chunk; });
  bridge.stderr.on('data', (chunk) => { bridgeOutput += chunk; });

  context.after(async () => {
    if (bridge.exitCode === null) bridge.kill('SIGTERM');
    if (bridge.exitCode === null) await once(bridge, 'exit');
  });

  const response = await waitFor(async () => {
    try {
      return await fetch(`${baseUrl}/health`);
    } catch {
      return null;
    }
  }).catch((error) => {
    throw new Error(`${error.message}\nBridge output:\n${bridgeOutput}`);
  });

  assert.equal(response.status, 503);
  const health = await response.json();
  assert.equal(health.status, 'degraded');
  assert.equal(health.command_auth_configured, false);
  assert.equal(health.command_ready, false);
});
