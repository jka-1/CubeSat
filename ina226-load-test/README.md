# INA226 Load UDP test firmware

This is a standalone ESP-IDF test application for repurposing the dashboard's
lower-right **Load** peripheral as one INA226. It intentionally excludes the
ADC, temperature, battery-monitor, charger, LED, and cJSON dependencies used
by the full firmware.

## Hardware and registers

Default wiring follows the existing ESP32-S3 firmware:

- SDA: GPIO 5
- SCL: GPIO 4
- I2C: 400 kHz, with external pull-ups
- INA226 address: `0x41` for the Load position

Change `INA226_TEST_I2C_ADDRESS` in `main/app_config.h` to `0x40` if the test
board is strapped to the original INA226 address.

The five transmitted 16-bit raw registers are:

| Order | Address | INA226 register | Access |
|---:|---:|---|---|
| 1 | `0x05` | Calibration | Read/write |
| 2 | `0x01` | Shunt voltage | Read-only |
| 3 | `0x02` | Bus voltage | Read-only |
| 4 | `0x03` | Power | Read-only |
| 5 | `0x04` | Current | Read-only |

All register values are sent raw. Scaling remains a server-side concern.

## UDP protocol

Packets are fixed-width uppercase ASCII hexadecimal with no delimiter and no
newline. Each field is one 16-bit word. UDP's own checksum is used; malformed
lengths, non-hex input, the wrong magic, and unsupported versions/opcodes are
rejected.

### Telemetry: MCU to bridge, 32 bytes

```text
494E 0001 SSSS CCCC HHHH BBBB PPPP IIII
```

- `494E`: telemetry magic (`IN`)
- `0001`: protocol version
- `SSSS`: sequence number, wrapping at 16 bits
- `CCCC`: calibration (`0x05`)
- `HHHH`: shunt voltage (`0x01`)
- `BBBB`: bus voltage (`0x02`)
- `PPPP`: power (`0x03`)
- `IIII`: current (`0x04`)

Example: `494E000112340A00FF9C2EE00012FFF0`

The MCU sends a telemetry packet only when all five reads succeed, so the
server never receives a mixture of current and stale register values.

### Calibration write: bridge to MCU, 24 bytes

```text
4943 0001 0001 RRRR RRRR CCCC
```

- `4943`: command magic (`IC`)
- `0001`: protocol version
- `0001`: write-calibration opcode
- `RRRR RRRR`: 32-bit request ID, high word first
- `CCCC`: requested nonzero calibration value

Example: `494300010001123456780A00`

The firmware accepts commands only from the configured bridge IPv4 address;
by default the source port must also match the configured bridge port. It does
not provide an arbitrary register-write command. Calibration value `0x0000`
is rejected because it disables INA226 current and power calculation.

### Write result: MCU to bridge, 28 bytes

```text
4952 0001 TTTT RRRR RRRR CCCC VVVV
```

- `4952`: result magic (`IR`)
- `0001`: protocol version
- `TTTT`: status
- `RRRR RRRR`: echoed 32-bit request ID
- `CCCC`: requested calibration value
- `VVVV`: hardware readback value

Statuses are `0000` success, `0001` invalid value, `0002` I2C write failure,
`0003` readback failure, and `0004` verification mismatch. A successful write
is always read back before `0000` is returned. The next telemetry sample is
also sent immediately.

## Configure and build

1. Edit Wi-Fi, bridge, address, and pin values in `main/app_config.h`.
2. Build and flash with ESP-IDF 5.2 or newer:

```sh
cd ina226-load-test
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

The device binds local UDP port `3334`, sends to bridge port `3333`, samples
once per second, and checks for commands at least every 100 ms. The same socket
is used in both directions so a bridge can reply to the telemetry source.

## Host-side protocol test

The packet codec has no ESP-IDF dependencies and can be tested with a desktop
C compiler:

```sh
cc -std=c11 -Wall -Wextra -Werror \
  -I main main/ina226_protocol.c test/protocol_test.c \
  -o /tmp/ina226_protocol_test
/tmp/ina226_protocol_test
```

The telemetry bridge and dashboard are deliberately unchanged in this step.
