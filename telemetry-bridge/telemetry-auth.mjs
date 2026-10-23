import crypto from 'node:crypto';

const DEVICE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const BOOT_ID = /^[0-9a-f]{16}$/i;
const SIGNATURE = /^[0-9a-f]{64}$/i;
const HEX_PAYLOAD = /^(?:[0-9a-f]{2})+$/i;

export function signedTelemetryCanonical({ device_id, boot_id, seq, uptime_ms, hex }) {
  return `cubesat-telemetry-v1\n${device_id}\n${boot_id.toLowerCase()}\n${seq}\n${uptime_ms}\n${hex.toUpperCase()}`;
}

export function signTelemetry(value, key) {
  return crypto.createHmac('sha256', key).update(signedTelemetryCanonical(value)).digest('hex');
}

export class SignedTelemetryVerifier {
  constructor({ key = '', required = false, replayLimit = 20_000 } = {}) {
    this.key = String(key);
    this.required = Boolean(required);
    this.replayLimit = replayLimit;
    this.seen = new Map();
    if (this.key && Buffer.byteLength(this.key) < 32) {
      throw new Error('TELEMETRY_HMAC_KEY must contain at least 32 bytes');
    }
    if (this.required && !this.key) {
      throw new Error('REQUIRE_SIGNED_TELEMETRY requires TELEMETRY_HMAC_KEY');
    }
  }

  verify(value) {
    if (value?.type !== 'signed_telemetry') {
      if (this.required) throw new Error('signed telemetry is required');
      return null;
    }
    if (!this.key) throw new Error('signed telemetry is not configured');
    if (value.version !== 1) throw new Error('unsupported signed telemetry version');
    if (typeof value.device_id !== 'string' || !DEVICE_ID.test(value.device_id)) throw new Error('invalid signed telemetry device_id');
    if (typeof value.boot_id !== 'string' || !BOOT_ID.test(value.boot_id)) throw new Error('invalid signed telemetry boot_id');
    if (!Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > 65_535) throw new Error('invalid signed telemetry sequence');
    if (!Number.isSafeInteger(value.uptime_ms) || value.uptime_ms < 0) throw new Error('invalid signed telemetry uptime');
    if (typeof value.hex !== 'string' || value.hex.length > 4_096 || !HEX_PAYLOAD.test(value.hex)) throw new Error('invalid signed telemetry hex payload');
    if (typeof value.signature !== 'string' || !SIGNATURE.test(value.signature)) throw new Error('invalid signed telemetry signature');

    const expected = Buffer.from(signTelemetry(value, this.key), 'hex');
    const supplied = Buffer.from(value.signature, 'hex');
    if (!crypto.timingSafeEqual(expected, supplied)) throw new Error('invalid signed telemetry signature');

    const replayKey = value.signature.toLowerCase();
    if (this.seen.has(replayKey)) throw new Error('replayed signed telemetry packet');
    this.seen.set(replayKey, true);
    while (this.seen.size > this.replayLimit) this.seen.delete(this.seen.keys().next().value);

    return {
      hex: value.hex.toUpperCase(),
      uptime_ms: value.uptime_ms,
      provenance: {
        authenticated: true,
        scheme: 'hmac-sha256-v1',
        device_id: value.device_id,
        boot_id: value.boot_id.toLowerCase(),
        seq: value.seq
      }
    };
  }
}
