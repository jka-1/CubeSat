# CubeSat Demo Telemetry Packet

This branch now supports two fixed 16-word telemetry packet layouts over UDP.

Recommended for the Tuesday demo:

- packet version `0x0002`
- one combined packet per sample
- ASCII hex string preferred
- each field is already scaled into engineering units

Legacy compatibility still supported by the bridge:

- packet version `0x0001`
- INA226 current and power words decoded from raw register values
- requires known INA226 calibration / `Current_LSB`

## Recommended packet: v2 engineering-units packet

Each field is one 16-bit word rendered as 4 hex characters.

Example:

`4353000200010E3800DC130604D8000100000FB40FAA0F960FA000B4085203D4`

That is 16 words total, in this exact order:

1. `magic` = `0x4353`
2. `version` = `0x0002`
3. `sequence`
4. `mcu_temperature_centi_c` (signed, `word / 100`)
5. `pv_shunt_centi_mv` (signed, `word / 100`)
6. `pv_power_centi_w` (`word / 100`)
7. `pv_current_ma` (signed, `word / 1000`)
8. `mppt_switch_raw` (`0x0000` = off, nonzero = on)
9. `mppt_fault_raw` (16-bit fault bitmask)
10. `bms_cell1_mv`
11. `bms_cell2_mv`
12. `bms_cell3_mv`
13. `bms_cell4_mv`
14. `load_shunt_centi_mv` (signed, `word / 100`)
15. `load_power_centi_w` (`word / 100`)
16. `load_current_ma` (signed, `word / 1000`)

Why v2 is the recommended format:

- it keeps the packet 16-bit and hex-based
- it avoids hidden INA226 calibration assumptions on the droplet
- it lets the ESP firmware own device-specific register handling
- the dashboard still receives one normalized telemetry shape from the bridge

## Legacy packet: v1 raw INA226 packet

The bridge still accepts the older `0x0001` layout that uses:

- INA226 shunt raw register words
- INA226 power raw register words
- INA226 current raw register words

That format remains available for backward compatibility, but it is not the recommended default because INA226 current and power decoding depends on the calibration register and `Current_LSB`.

## Transport notes

- ASCII hex is preferred for now.
- Raw 32-byte UDP packets are also supported by the bridge.
- Word order is big-endian on the receive side.
  - ASCII example: `0FB4` means `0x0FB4`
  - Raw bytes example: `0F B4` means the same 16-bit word

## Command path

The bridge now also exposes a command endpoint:

- `POST /command`
- `POST /api/demo/command`

Recommended high-level commands:

- `{ "target": "mppt", "state": "on" }`
- `{ "target": "mppt", "state": "off" }`
- `{ "target": "led", "state": "on" }`
- `{ "target": "led", "state": "off" }`

The bridge forwards those commands over UDP to the last telemetry source, or to a fixed command target if configured on the server.
