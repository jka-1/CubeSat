# Lab handoff: telemetry requirements 1-4

Target test date: Saturday, August 8, 2026

This handoff validates only the first four requested capabilities:

1. The Node bridge receives an execution result from the ESP32.
2. The dashboard sends structured I2C reads and writes.
3. The bridge returns bytes read from a monitored ESP32 I2C device.
4. An automatic sensor loop can be paused, manually accessed, and resumed.

The core pass criteria remain requirements 1-4. Typed ACDRV and RGB LED controls are available as
separate controlled checks. BMS FET enable, saved profiles, and login behavior are not part of this handoff.

## Before the lab

On the droplet, confirm the intended branch and revision:

```bash
cd /opt/cubesat-demo/repo
git fetch origin
git checkout telemetry-fixes-addons
git pull --ff-only origin telemetry-fixes-addons
git status --short --branch
git rev-parse --short HEAD
```

Configure a temporary command token without committing it:

```bash
systemctl edit cubesat-telemetry.service
```

Add this service override, replacing the example value with the token shared with the lab operator:

```ini
[Service]
Environment="COMMAND_TOKEN=replace-with-the-shared-lab-token"
```

Then deploy:

```bash
systemctl daemon-reload
cd /opt/cubesat-demo/repo
SERVICE_NAME=cubesat-telemetry.service \
EXPECTED_BRANCH=telemetry-fixes-addons \
./scripts/deploy-live.sh
curl --fail http://127.0.0.1:8080/health
```

The health response must show:

- `status` is `ok`
- `command_auth_configured` is `true`
- `telemetry_connected` becomes `true` after the ESP32 starts streaming
- `command_ready` becomes `true` after the ESP32 starts streaming

## Firmware gate

The tracked Wi-Fi values in `main/app_config.h` are placeholders. On the flashing computer, enter the
active lab SSID and password without committing them. Load the ESP-IDF environment used for the board,
then run:

```bash
idf.py reconfigure
idf.py build
idf.py -p <serial-port> flash monitor
```

`idf.py reconfigure` resolves the official `espressif/led_strip` component used by the addressable RGB
LED. Confirm the board revision before flashing: ESP32-S3-DevKitC-1 v1.1 uses GPIO 38, while the initial
revision uses GPIO 48 and requires changing `DEMO_RGB_LED_GPIO` in `main/app_config.h`.

Do not continue until the build succeeds and the serial monitor shows:

- Wi-Fi received an IPv4 address
- I2C initialized all three configured devices
- raw-v3 telemetry is streaming
- ACK messages return from the bridge

## Dashboard setup

1. Open the website and select `I2C Telemetry`.
2. Select `Connect Live`.
3. Confirm the page says `Live ESP32 telemetry` and shows the ESP32 endpoint.
4. Enter the temporary command token. It is held only in the current page.
5. Confirm the debug controls unlock.

Every submitted command should first show `pending`, then show `ok` or `failed` with the same request
ID. A timeout means the command was not proven to execute and must not be treated as successful.

## Acceptance sequence

### 1. BMS pause and manual read

1. Select `BMS / BQ76942` and select `Pause Polling`.
2. Confirm the active polling mask becomes `0x5` and BMS is listed as paused.
3. Send an I2C read to address `0x08`, register `0x14`, size `2`.
4. Confirm a two-byte ESP32 result appears with the matching request ID.
5. Select `Resume Polling` and confirm the active mask returns to `0x7`.

### 2. MPPT pause and manual read

1. Select `MPPT / BQ25798` and select `Pause Polling`.
2. Confirm the active polling mask becomes `0x3`.
3. Send an I2C read to address `0x6B`, register `0x13`, size `1`.
4. Confirm a one-byte ESP32 result appears.
5. Resume MPPT polling and confirm the active mask returns to `0x7`.

### 3. Safe write-path proof

1. Select `PV / INA226` and pause polling. The active mask should become `0x6`.
2. Read address `0x40`, register `0x05`, size `2` and record the returned bytes.
3. Change the command to `I2C Write` and write those exact same two bytes back to register `0x05`.
4. Read register `0x05` again and confirm the bytes are unchanged.
5. Resume PV polling and confirm the active mask returns to `0x7`.

This write test proves the write path without intentionally changing the existing device configuration.

## Controlled recovered-feature checks

These checks are separate from the 1-4 pass criteria.

### RGB LED

1. Select `RGB LED On` and confirm the board's addressable LED turns dim green.
2. Confirm the result reports `GPIO38` and `ok`.
3. Select `RGB LED Off` and confirm the LED turns off.
4. If the command reports success but the LED does not light, stop and confirm whether the board is the
   initial GPIO-48 revision before changing firmware configuration.

### BQ25798 ACDRV

1. Pause MPPT polling and record PACK voltage, BQ25798 register `0x12`, register `0x13`, and register
   `0x1E` before changing the power path.
2. Choose only the input path that matches the wired hardware, then select `Apply Verified ACDRV Control`.
3. Confirm the result is `ok`, `verified` is true, and the before/after register values preserve all unrelated bits.
4. Measure PACK voltage physically. Register readback alone does not prove that the external FET path closed.
5. If the path must be turned off, choose `Disable Both ACDRV Paths`, apply it, and confirm register `0x12`
   bit 7 is set by the returned readback.
6. Resume MPPT polling when finished.

Do not use ACDRV control as a substitute for the separate BMS FET_ON procedure. If the BQ25798 reports
that the selected ACFET/RBFET pair is not present, the command fails without changing the selection.

## Recovery

If a command fails or times out, do not repeat writes blindly. First resume all sensors using `All Sensors`
and `Resume Polling`, confirm active mask `0x7`, then check telemetry and the ESP32 serial log.

If deployment fails, use the backup path printed by the deploy script:

```bash
/opt/cubesat-demo/repo/scripts/rollback-live.sh /root/cubesat-live-backups/<timestamp>
```

## Pass criteria

The 1-4 handoff passes when all of the following are true:

- The ESP32 streams telemetry and receives bridge ACKs for at least five minutes.
- Read results return to the dashboard with matching request IDs.
- Paused devices stop automatic polling while manual access continues to work.
- Polling resumes and the authoritative active mask returns to `0x7`.
- The safe same-value INA226 write and readback succeeds.
- No command remains pending or times out during the acceptance sequence.
