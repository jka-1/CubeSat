import assert from 'node:assert/strict';
import test from 'node:test';
import { SignedTelemetryVerifier, signTelemetry, signedTelemetryCanonical } from '../telemetry-auth.mjs';

const key = 'test-only-telemetry-hmac-key-32-bytes-minimum';
const packet = {
  version: 1,
  type: 'signed_telemetry',
  device_id: 'esp32-s3-pmds',
  boot_id: '0123456789abcdef',
  seq: 42,
  uptime_ms: 12_345,
  hex: '43530004002A'
};

test('signed telemetry canonical form verifies and exposes non-secret provenance', () => {
  assert.equal(signedTelemetryCanonical(packet), 'cubesat-telemetry-v1\nesp32-s3-pmds\n0123456789abcdef\n42\n12345\n43530004002A');
  const verifier = new SignedTelemetryVerifier({ key, required: true });
  const verified = verifier.verify({ ...packet, signature: signTelemetry(packet, key) });
  assert.deepEqual(verified, {
    hex: packet.hex,
    uptime_ms: packet.uptime_ms,
    provenance: { authenticated: true, scheme: 'hmac-sha256-v1', device_id: packet.device_id,
      boot_id: packet.boot_id, seq: packet.seq }
  });
});

test('signed telemetry rejects tampering, replays and unsafe strict-mode configuration', () => {
  const signed = { ...packet, signature: signTelemetry(packet, key) };
  const verifier = new SignedTelemetryVerifier({ key, required: true, replayLimit: 2 });
  assert.throws(() => verifier.verify({ ...signed, uptime_ms: 12_346 }), /signature/);
  verifier.verify(signed);
  assert.throws(() => verifier.verify(signed), /replayed/);
  assert.throws(() => new SignedTelemetryVerifier({ key: 'short', required: true }), /32 bytes/);
  assert.throws(() => new SignedTelemetryVerifier({ required: true }), /requires TELEMETRY_HMAC_KEY/);
  assert.throws(() => verifier.verify({ type: 'telemetry' }), /required/);
});

test('compatibility mode accepts unsigned callers without claiming authentication', () => {
  const verifier = new SignedTelemetryVerifier();
  assert.equal(verifier.verify({ type: 'telemetry' }), null);
  assert.throws(() => verifier.verify({ ...packet, signature: '0'.repeat(64) }), /not configured/);
});
