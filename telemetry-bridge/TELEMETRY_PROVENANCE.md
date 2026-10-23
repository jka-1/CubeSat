# Authenticated UDP telemetry

This local, opt-in protocol authenticates firmware telemetry without changing the existing command-token architecture. It has not been deployed or hardware-compiled in this workspace.

## Protocol

When `DEMO_TELEMETRY_HMAC_KEY` is defined in the ignored private `main/app_config.h`, the ESP32 wraps each existing hex packet in JSON:

```json
{
  "version": 1,
  "type": "signed_telemetry",
  "device_id": "configured-device-id",
  "boot_id": "16-random-hex-characters",
  "seq": 1,
  "uptime_ms": 1234,
  "hex": "4353...",
  "signature": "64-lowercase-hex-characters"
}
```

The signature is HMAC-SHA256 over this exact UTF-8 canonical form, with uppercase packet hex and lowercase boot ID:

```text
cubesat-telemetry-v1\n<device_id>\n<boot_id>\n<seq>\n<uptime_ms>\n<hex>
```

The bridge validates the signature with constant-time comparison, verifies the wrapper sequence against the decoded packet, requires the wrapper device ID to equal `HEX_DEVICE_ID`, and rejects an identical signed datagram replay during the current bridge process. The random boot ID separates sequence epochs. Authenticated uptime is applied to live v4 packets too, allowing the recorder to detect firmware restarts outside Debug mode.

Replay memory is bounded to the latest 20,000 signatures and is reset with the bridge process. This prevents immediate duplicate/replay acceptance; it is not a durable anti-replay ledger. UDP can still be dropped, delayed or reordered, and encryption is not provided.

## Private configuration

Generate one random secret of at least 32 bytes and deliver it separately to the firmware builder and bridge operator. Never reuse `COMMAND_TOKEN`, put the value in Git, or include it in screenshots/logs.

In the ignored private `main/app_config.h`:

```c
#define DEMO_TELEMETRY_HMAC_KEY "replace-with-the-private-random-secret"
```

In the bridge's private service environment, use the exact same value:

```ini
Environment="TELEMETRY_HMAC_KEY=replace-with-the-private-random-secret"
Environment="REQUIRE_SIGNED_TELEMETRY=true"
Environment="HEX_DEVICE_ID=configured-device-id"
```

`TELEMETRY_HMAC_KEY` alone lets the bridge validate signed packets while retaining unsigned compatibility. `REQUIRE_SIGNED_TELEMETRY=true` rejects unsigned raw hex, binary telemetry and legacy token-only JSON telemetry. Signed mode applies to telemetry ingestion; debug command responses remain correlated to pending commands by endpoint, request ID and command type. `COMMAND_TOKEN` remains mandatory for browser/Windows hardware commands.

Roll out in this order: build and bench-test signed firmware, configure the bridge key with strict mode off, confirm `/health` reports `telemetry_provenance.authenticated: true`, then enable strict mode. A missing key in strict mode or a key shorter than 32 bytes stops bridge startup. An empty firmware key preserves the current raw-hex transport.

## Operational signals

`/health` and status events expose:

- `telemetry_auth_configured`
- `telemetry_auth_required`
- `telemetry_provenance` with scheme, device ID, boot ID and sequence

No key or signature secret is returned. Recorded envelopes keep the non-secret provenance metadata so saved runs can distinguish authenticated packets from compatibility-mode captures.
