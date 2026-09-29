# INA226-only ESP32-S3 UDP test

This standalone ESP-IDF application repurposes the dashboard's lower-right
Load box for one INA226. It uses only I2C, Wi-Fi, UDP/lwIP, NVS, ESP timer, and
the normal ESP-IDF runtime. It does not include the ADC, temperature, BMS,
charger, LED, console-command, cJSON, or third-party sensor code.

## Hardware defaults

- ESP32-S3
- SDA GPIO 5, SCL GPIO 4
- INA226 seven-bit address `0x40`
- I2C at 400 kHz with external 3.3 V pull-ups
- UDP server `45.55.77.215:3333`; local port `3334`
- one sample per second
- configuration `0x00 = 0x4127`
- initial calibration `0x05 = 0x0A00`

Edit `main/app_config.h` before flashing. The server must send commands from
the configured UDP endpoint because the MCU filters the source IP and,
normally, source port. This is a trusted-network bench control, not
cryptographic authentication.

## Five exposed registers

All values are raw 16-bit words in this wire order:

| UDP offset | Register | Meaning | Remote access |
|---:|---:|---|---|
| 0-1 | `0x05` | Calibration | Read/write |
| 2-3 | `0x01` | Shunt voltage | Read |
| 4-5 | `0x02` | Bus voltage | Read |
| 6-7 | `0x03` | Power | Read |
| 8-9 | `0x04` | Current | Read |

The startup-only configuration register `0x00` is not remotely accessible.
If any of the five reads fails, the entire telemetry sample is dropped.

## Binary UDP protocol

Telemetry is exactly 10 bytes, with no application header or acknowledgement:

```text
CAL_H CAL_L SHUNT_H SHUNT_L BUS_H BUS_L POWER_H POWER_L CURRENT_H CURRENT_L
```

The bridge decodes shunt as signed raw × 2.5 µV, bus as unsigned raw ×
1.25 mV, current as signed raw × Current_LSB, and power as unsigned raw ×
25 × Current_LSB. Current_LSB is `0.00512 / (calibration × shunt_ohms)`.

Commands are exactly 8 bytes:

```text
49 43 01 OP ID_H ID_L VALUE_H VALUE_L
```

- opcode `01`: read calibration; value must be zero
- opcode `02`: write calibration `0x0001` through `0x7FFF`

Responses are exactly 12 bytes:

```text
49 52 01 OP ID_H ID_L STATUS VALID ACTUAL_H ACTUAL_L ERROR_H ERROR_L
```

Statuses are success `0`, bad command `1`, write failure `2`, read failure
`3`, verification mismatch `4`, and stale request ID `5`. The firmware caches
the last response so an identical retry does not repeat the write. Request IDs
use 16-bit serial arithmetic and wrap from `65535` to `0`.
Reset this test firmware when restarting a bridge whose request counter is not
persisted; otherwise the firmware can correctly reject the restarted bridge's
first low request IDs as stale.

## Build and verify

From an activated ESP-IDF terminal:

```sh
cd ina226-load-test
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

Run the portable protocol test with a host C compiler:

```sh
cc -std=c11 -Wall -Wextra -Werror -I main \
  main/ina226_protocol.c test/protocol_test.c \
  -o /tmp/ina226_protocol_test
/tmp/ina226_protocol_test
```

No ESP-IDF cross-build or hardware test is performed by the host test. On the
bench, verify the 10-byte stream, calibration read/write/readback, scaling with
the real shunt resistance, and Wi-Fi/sensor disconnect behavior.
