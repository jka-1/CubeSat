# CubeSat Demo Telemetry Dashboard

This branch contains the working demo telemetry stack for Tuesday, August 4, 2026:

- the static dashboard site
- the UDP-to-SSE telemetry bridge
- deploy / backup / rollback scripts
- the ESP-side packet format used by the droplet

For the current validated `pass/` firmware, the recommended immediate test format is the `0x0003`
combined raw packet. The bridge decodes those raw register values into the dashboard view.

## What this version covers

The dashboard is set up to display these five groups:

- MCU temperature
- PV telemetry
- MPPT input select state and faults
- BMS cell voltages
- optional load telemetry when a second INA226 is available

The bridge also supports high-level commands for:

- ACDRV1 / ACDRV2 input selection
- LED on / off

## Repository layout

- `main/` - ESP firmware scaffold and packet generation
- `site/` - static web dashboard deployed to Apache
- `telemetry-bridge/server.js` - Node UDP bridge deployed on the droplet
- `scripts/` - backup, deploy, and rollback helpers
- `TELEMETRY_PACKET_V1.md` - packet reference

## Live deployment values

- branch: `demo-telemetry-dashboard`
- repo checkout on droplet: `/opt/cubesat-demo/repo`
- live site root: `/var/www/html`
- live bridge file: `/opt/cubesat-telemetry/server.js`
- service name: `cubesat-telemetry.service`
- UDP telemetry port: `3333`
- bridge HTTP bind: `127.0.0.1:8080`
- SSE endpoint through Apache: `/telemetry/events`
- health endpoint through Apache: `/telemetry/health`
- command endpoint through Apache: `/telemetry/command`

## Recommended immediate test packet format

Use one combined UDP packet once per second.

- magic: `0x4353`
- version: `0x0003`
- transport: ASCII hex preferred
- word count: `16`
- word order: big-endian

Field order:

1. `0x4353`
2. `0x0003`
3. sequence
4. MCU temp in centi-C, or `0x8000` when not supplied
5. PV INA226 calibration raw (`0x05`)
6. PV INA226 shunt raw (`0x01`)
7. PV INA226 bus raw (`0x02`)
8. PV INA226 power raw (`0x03`)
9. PV INA226 current raw (`0x04`)
10. BMS cell 1 raw
11. BMS cell 2 raw
12. BMS cell 3 raw
13. BMS cell 10 raw
14. BQ25798 register `0x13` raw
15. BQ25798 fault register `0x20` raw
16. reserved

Known-good example packet:

`4353000303B380000A0000280FA3000A00320EE50EDF0E5C0E5D006100000000`

Expected decoded values from that example:

- MCU temp: not supplied yet
- PV calibration raw: `0x0A00`
- PV shunt raw: `0x0028`
- PV bus raw: `0x0FA3`
- PV power raw: `0x000A`
- PV current raw: `0x0032`
- BMS cells: `0x0EE5`, `0x0EDF`, `0x0E5C`, `0x0E5D`
- MPPT register `0x13`: `0x61` -> `ACDRV1`
- MPPT faults: none
- load: unavailable in the current validated hardware

## Droplet deploy flow

Initial checkout:

```bash
mkdir -p /opt/cubesat-demo
cd /opt/cubesat-demo
git clone https://github.com/jka-1/CubeSat.git repo
cd repo
git checkout demo-telemetry-dashboard
```

Deploy with backup:

```bash
cd /opt/cubesat-demo/repo
SERVICE_NAME=cubesat-telemetry.service ./scripts/deploy-live.sh
```

The deploy script automatically:

- creates a backup under `/root/cubesat-live-backups/<timestamp>`
- copies `site/` into `/var/www/html`
- copies `telemetry-bridge/server.js` into `/opt/cubesat-telemetry/server.js`
- restarts `cubesat-telemetry.service`

## Verification

Bridge health:

```bash
curl http://127.0.0.1:8080/health
```

Live stream:

```bash
curl -N --max-time 5 http://localhost/telemetry/events
```

Inject a known-good test packet locally:

```bash
printf '%s\n' '4353000200010E3800DC130604D8000100000FB40FAA0F960FA000B4085203D4' | nc -u -w1 127.0.0.1 3333
printf '%s\n' '4353000303B380000A0000280FA3000A00320EE50EDF0E5C0E5D006100000000' | nc -u -w1 127.0.0.1 3333
```

When telemetry is working, health should show:

- `"telemetry_connected": true`
- `"command_ready": true`

## Command path

The bridge accepts:

- `POST /command`
- `POST /api/demo/command`

Legacy high-level command payloads still supported by the bridge:

```json
{"target":"mppt","state":"on"}
{"target":"mppt","state":"off"}
{"target":"led","state":"on"}
{"target":"led","state":"off"}
```

For the current validated hardware, the dashboard uses direct I2C write commands for MPPT input
selection instead:

```json
{"type":"i2c_write","addr":"0x6B","reg":"0x13","data":["0x1D"]}
{"type":"i2c_write","addr":"0x6B","reg":"0x13","data":["0x2D"]}
```

The bridge also accepts direct JSON I2C command payloads for firmware that exposes generic
register access over UDP:

```json
{"type":"i2c_read","addr":"0x08","reg":"0x20","len":1}
{"type":"i2c_write","addr":"0x08","reg":"0x20","data":["0x1D"]}
```

Example local command test:

```bash
curl -X POST http://127.0.0.1:8080/command \
  -H 'Content-Type: application/json' \
  -d '{"target":"led","state":"on"}'
```

Important behavior:

- the bridge sends commands to the last telemetry source by default
- firmware should keep the UDP socket open so the same source can receive commands
- a fixed command target can also be configured with:
  - `COMMAND_TARGET_HOST`
  - `COMMAND_TARGET_PORT`

## Rollback

If a deploy breaks, use the backup printed by the deploy script:

```bash
/opt/cubesat-demo/repo/scripts/rollback-live.sh /root/cubesat-live-backups/<timestamp>
```

## Exact values already known

- service: `cubesat-telemetry.service`
- bridge UDP port: `3333`
- bridge HTTP port: `8080`
- magic word: `0x4353`
- recommended packet version: `0x0003`
- packet length: `16` words
- update rate target: `1 Hz`
- shunt value : `100 ohms`

Important note on the shunt value:

For the new `0x0003` raw packet, the droplet resolves INA226 current and power using the packet's
calibration register and the server setting `PV_INA226_SHUNT_OHMS`. The default bridge decode
assumes `0.1` ohms (`100 mΩ`). If telemetry values look physically wrong, confirm whether
"100 ohms" actually means `100 ohms` or `100 milliohms`.

## Current firmware status from `main/pass`

The `pass/` code on `origin/main` validates the current hardware-side I2C reads for:

- INA226 at `0x40`
- BQ76942 at `0x08`
- BQ25798 at `0x6B`

It also confirms the BMS cell register map starting at `0x14`, and the BQ25798 status reads at
registers `0x13` and `0x20`.

Current confirmed hardware mapping:

- INA226 `0x40` is the PV sensor
- dashboard BMS cells should show raw BQ76942 cells `1`, `2`, `3`, and `10`
- BQ25798 control is a switch between `ACDRV1` and `ACDRV2`
- BQ25798 register `0x20` bit names are:
  - bit 0: `VAC1_OVP_STAT`
  - bit 1: `VAC2_OVP_STAT`
  - bit 2: `CONV_OCP_STAT`
  - bit 3: `BAT_OCP_STAT`
  - bit 4: `IBUS_OCP_STAT`
  - bit 5: `VBAT_OVP_STAT`
  - bit 6: `VBUS_OVP_STAT`
  - bit 7: `BAT_REG_STAT`

That firmware is a validated bus monitor. This repo now defines a matching `0x0003` packet format
for it, so firmware can start streaming to the dashboard without waiting for an externally defined
packet.

## Legacy packet support

The bridge still supports the older `0x0001` raw INA226 packet, but that format is not the recommended default. Use `0x0002` unless there is a strong reason to keep raw register words.
