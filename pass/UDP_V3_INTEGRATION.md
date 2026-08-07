# Pass firmware to dashboard: immediate integration

This folder contains the validated I2C monitor. To stream that data into the droplet and dashboard
without adding more device-side decoding, use the `0x0003` packet format defined below.

Files added for this:

- `telemetry_packet_v3.h`
- `telemetry_packet_v3.c`

## Packet summary

The formatter builds this 16-word ASCII hex packet:

1. `0x4353`
2. `0x0003`
3. sequence
4. MCU temp in centi-C, or `0x8000` if not supplied
5. INA226 calibration raw
6. INA226 shunt raw
7. INA226 bus raw
8. INA226 power raw
9. INA226 current raw
10. BQ76942 cell 1 raw
11. BQ76942 cell 2 raw
12. BQ76942 cell 3 raw
13. BQ76942 cell 10 raw
14. BQ25798 register `0x13` raw
15. BQ25798 register `0x20` raw
16. tagged sensor polling mask (`0xA500 | active_mask`)

## Example from the validated sample

Using the sample output that was already confirmed in the lab, the formatted packet is:

`4353000303B380000A0000280FA3000A00320EE50EDF0E5C0E5D00610000A507`

## Example usage

After grabbing the latest telemetry snapshot:

```c
power_telemetry_t telemetry = {0};
telemetry_packet_v3_meta_t meta = {
    .sequence = 1,
    .has_mcu_temperature = false,
    .mcu_temperature_centi_c = 0
};
char packet_hex[TELEMETRY_PACKET_V3_HEX_CHARS + 1] = {0};

ESP_ERROR_CHECK(i2c_bus_monitor_get_latest(&telemetry));
ESP_ERROR_CHECK(telemetry_packet_v3_format_hex(
    &telemetry,
    &meta,
    packet_hex,
    sizeof(packet_hex)));

printf("UDP packet: %s\n", packet_hex);
```

Then send `packet_hex` over UDP to the droplet on port `3333`.

## Notes

- INA226 raw registers are packed high-byte then low-byte.
- BQ76942 cell registers are packed little-endian into 16-bit words.
- The dashboard currently treats:
  - INA226 `0x40` as PV
  - BQ76942 cells `1`, `2`, `3`, and `10` as the four displayed battery cells
  - BQ25798 register `0x13` as the ACDRV1 / ACDRV2 selector
  - BQ25798 register `0x20` as the MPPT fault bitmask
- There is currently no second INA226, so load telemetry is intentionally unavailable.
- Sensor polling mask bits are PV=`0x01`, BMS=`0x02`, and MPPT=`0x04`.
