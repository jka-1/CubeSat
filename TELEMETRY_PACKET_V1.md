# CubeSat Demo Telemetry Packet

This branch supports four versioned telemetry packet layouts over UDP:

- `0x0001` legacy raw INA226 packet
- `0x0002` engineering-units packet
- `0x0003` validated raw-pass packet for the current hardware test path
- `0x0004` validated raw-pass packet with peripheral temperature and light sensors

New firmware emits `0x0004`. The bridge continues to accept `0x0001` through `0x0003` unchanged.

## Current packet: v4 peripheral sensors

Version `0x0004` contains 20 16-bit words. Words 1-16 retain the v3 field order, with the version
word set to `0x0004`. The four appended words are:

17. `peripheral_status_flags`
    - bit 0: peripheral temperature valid
    - bit 1: light reading valid
    - bit 2: peripheral temperature ADC saturated
    - bit 3: light ADC saturated
18. `peripheral_temperature_centi_c`, signed; ignored unless bit 0 is set
19. `light_voltage_mv`; ignored unless bit 1 is set
20. `relative_light_basis_points`, `0` through `10000`; ignored unless bit 1 is set

Availability is controlled only by the validity flags. A zero data word is not interpreted as a
measurement when its validity bit is clear.

Relative light is defined as:

`clamp(calibrated_LIGHT_OUT_mV / 3100, 0, 1)`

The dashboard displays that fraction as `0%` through `100%`. This is a relative ADC level, not lux.
The calibrated LIGHT_OUT voltage remains in telemetry for debugging. If the ADC saturates, the
dashboard marks the percentage and voltage as a lower bound.

Example with peripheral temperature `25.00 °C`, light voltage `1550 mV`, relative light `50.00%`,
and both ADC saturation flags set for decoder testing:

`4353000403B30A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507000F09C4060E1388`

Example with both peripheral sensors unavailable:

`4353000403B40A280A0000280FA3000A00320EE50EDF0E5C0E5D00610000A5070000000000000000`

## Legacy v3 validated raw packet

Each field is one 16-bit word rendered as 4 hex characters.

Transport:

- ASCII hex string preferred
- 16 words total
- word text is standard big-endian hex, for example `0EE5`
- sensor values inside the packet are still raw register words

Field order for version `0x0003`:

1. `magic` = `0x4353`
2. `version` = `0x0003`
3. `sequence`
4. `mcu_temperature_centi_c`
   - signed
   - use `0x8000` when MCU temperature is not supplied yet
5. `pv_ina226_calibration_raw` = register `0x05`
6. `pv_ina226_shunt_raw` = register `0x01`
7. `pv_ina226_bus_raw` = register `0x02`
8. `pv_ina226_power_raw` = register `0x03`
9. `pv_ina226_current_raw` = register `0x04`
10. `bms_cell1_raw`
11. `bms_cell2_raw`
12. `bms_cell3_raw`
13. `bms_cell10_raw`
14. `bq25798_reg13_raw`
15. `bq25798_fault20_raw`
16. tagged sensor polling mask (`0xA500 | active_mask`)

Confirmed current hardware mapping:

- INA226 `0x40` is the PV sensor
- BMS dashboard cells should display BQ76942 cells `1`, `2`, `3`, and `10`
- BQ25798 input select is read from register `0x13`
- BQ25798 fault bits are read from register `0x20`
- second INA226 / load telemetry is currently not present

How the bridge decodes version `0x0003`:

- PV shunt voltage from INA226 shunt raw register
- PV current from INA226 current raw register using:
  - calibration word from packet
  - `PV_INA226_SHUNT_OHMS` on the server
  - current deployment default: `100` ohms
- PV power from INA226 power raw register using the same resolved current LSB
- BMS voltages from raw words divided by `1000`
- MPPT state from BQ25798 register `0x13`:
  - bit 6 set, bit 7 clear -> `ACDRV1`
  - bit 7 set, bit 6 clear -> `ACDRV2`
  - both clear -> `off`
  - both set -> `both`
- MPPT fault bits from BQ25798 register `0x20`

Default BQ25798 fault bit names used by the bridge:

- bit 0: `VAC1_OVP_STAT`
- bit 1: `VAC2_OVP_STAT`
- bit 2: `CONV_OCP_STAT`
- bit 3: `BAT_OCP_STAT`
- bit 4: `IBUS_OCP_STAT`
- bit 5: `VBAT_OVP_STAT`
- bit 6: `VBUS_OVP_STAT`
- bit 7: `BAT_REG_STAT`

Example packet built from the validated sample output:

`4353000303B380000A0000280FA3000A00320EE50EDF0E5C0E5D006100000000`

Decoded meaning of that example:

- sequence: `947`
- MCU temp: not supplied yet
- PV calibration: `0x0A00`
- PV shunt raw: `0x0028`
- PV bus raw: `0x0FA3`
- PV power raw: `0x000A`
- PV current raw: `0x0032`
- BMS cells: `0x0EE5`, `0x0EDF`, `0x0E5C`, `0x0E5D`
- MPPT register `0x13`: `0x61` -> `ACDRV1`
- MPPT fault register `0x20`: `0x00`

## Engineering packet: v2

The branch still supports the older engineering-units packet:

- packet version `0x0002`
- one combined packet per sample
- each field already scaled into engineering units

That format remains useful if firmware later wants to move the register decoding onto the ESP.

## Legacy raw INA226 packet: v1

The branch still accepts the older `0x0001` layout that uses:

- INA226 shunt raw register words
- INA226 power raw register words
- INA226 current raw register words

That format remains available for backward compatibility.

## Command path

The bridge exposes:

- `POST /command`
- `POST /api/demo/command`

Recommended direct I2C command payloads:

- `{"type":"i2c_read","addr":"0x08","reg":"0x20","len":1}`
- `{"type":"i2c_write","addr":"0x40","reg":"0x05","data":["0x0A","0x00"]}`

Do not use a full-register write to BQ25798 register `0x13` for ACDRV selection. That control needs a
masked read/modify/write command so unrelated control bits are preserved. The typed
`mppt_acdrv_control` command uses `REG13.EN_ACDRV1/2` for selection and `REG12.DIS_ACDRV` to disable
both paths, then verifies both registers by readback. Physical PACK voltage must be measured separately.

The bridge forwards those commands over UDP to the last telemetry source, or to a fixed command target if configured on the server.
