const bridgeUrl = String(
  process.env.BRIDGE_HTTP_URL || 'http://127.0.0.1:8080'
).replace(/\/$/, '');
const timeoutMs = readPositiveInteger('INA226_LIVE_TIMEOUT_MS', 60_000);
const pollMs = readPositiveInteger('INA226_LIVE_POLL_MS', 500);
const commandToken = String(process.env.COMMAND_TOKEN || '');
const checkStartedAt = Date.now();

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(pathname, options = undefined) {
  const response = await fetch(`${bridgeUrl}${pathname}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${pathname} returned HTTP ${response.status}: ${body?.error || 'unknown error'}`
    );
  }
  return body;
}

async function waitFor(check, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(pollMs);
  }

  const detail = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs} ms.${detail}`);
}

function validateTelemetry(body) {
  const envelope = body?.latest;
  const packet = envelope?.packet;
  if (packet?.packet_format !== 'ina226-load-v1') return null;
  const receivedAt = Date.parse(envelope?.received_at || '');
  if (!Number.isFinite(receivedAt) || receivedAt < checkStartedAt) return null;
  if (envelope?.network?.bytes !== 10) {
    throw new Error(`INA226 packet was ${envelope?.network?.bytes ?? 'unknown'} bytes, expected 10`);
  }

  const raw = packet?.raw?.load;
  const decoded = packet?.telemetry?.load;
  const rawFields = ['calibration', 'shunt', 'bus', 'power', 'current'];
  if (!rawFields.every((field) => Number.isInteger(raw?.[field]))) {
    throw new Error('INA226 packet is missing one or more raw 16-bit registers');
  }
  if (!decoded || !Number.isFinite(decoded.shuntVoltageMv) ||
      !Number.isFinite(decoded.busVoltageV)) {
    throw new Error('INA226 packet did not produce valid voltage measurements');
  }

  return envelope;
}

async function verifyReadCommand() {
  const accepted = await readJson('/command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Command-Token': commandToken
    },
    body: JSON.stringify({
      type: 'i2c_read',
      addr: '0x40',
      reg: '0x05',
      len: 2
    })
  });

  const result = await waitFor(async () => {
    const body = await readJson('/latest');
    const packet = body?.latest_debug?.packet;
    return packet?.request_id === accepted.request_id ? packet : null;
  }, `INA226 calibration response ${accepted.request_id}`);

  if (!result.ok || result.command_type !== 'i2c_read' ||
      result.readback_valid !== true || result.data?.length !== 2) {
    throw new Error(
      `Calibration read failed: ${result.error || JSON.stringify(result)}`
    );
  }
  return result;
}

console.log(`[CHECK] Waiting for a real INA226 packet at ${bridgeUrl} ...`);
await readJson('/health');

const telemetry = await waitFor(async () => {
  const body = await readJson('/latest');
  return validateTelemetry(body);
}, 'a fresh 10-byte INA226 telemetry packet');

console.log('[PASS] Real INA226 telemetry received and decoded.');
console.log(JSON.stringify({
  received_at: telemetry.received_at,
  remote: telemetry.network
    ? `${telemetry.network.remote_address}:${telemetry.network.remote_port}`
    : null,
  raw: telemetry.packet.raw.load,
  decoded: telemetry.packet.telemetry.load
}, null, 2));

if (commandToken) {
  const readResult = await verifyReadCommand();
  console.log('[PASS] Bidirectional UDP calibration read completed.');
  console.log(JSON.stringify({
    request_id: readResult.request_id,
    calibration: readResult.readback_calibration,
    driver_error: readResult.driver_error
  }, null, 2));
} else {
  console.log('[SKIP] Set COMMAND_TOKEN to verify the server-to-MCU calibration read.');
}
