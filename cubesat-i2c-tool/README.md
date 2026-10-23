# CubeSat I2C Tool (Windows)

Desktop app for the ESP32-S3 running Espressif's **i2c-tools** example console
(`i2cconfig`, `i2cdetect`, `i2cget`, `i2cset`, `i2cdump`) over the USB/serial port.

## Run / build on Windows
1. Install Python 3.10+ (tick "Add to PATH").
2. Dev run: double-click `run_dev.bat` (makes `.venv`, installs PySide6 + pyserial, starts the app).
   `run_dev.bat --mock` adds a simulated ESP32 port (no hardware needed).
3. Build the exe: `build_exe.bat` → runs the tests, then PyInstaller → `dist\CubeSatI2CTool.exe`.
4. Tests only: `pip install -r requirements.txt -r requirements-dev.txt` then `python -m pytest -q tests`.

Close `idf.py monitor` / other serial terminals first. Default baud 115200.
Opening the port sets DTR/RTS low to avoid resetting the board.

## Pages
- **Connection**: COM port + baud, I2C config line (default `i2cconfig --scl=2 --sda=1 --freq=400000`,
  editable, saved, optionally sent on connect), raw command box, i2cdetect, console output.
- **Registers**: device dropdown (address editable + saved), register dropdown, Read / Read all /
  Write / i2cdump. Reads show bytes, raw integer and converted engineering value.
  Write accepts one number (split into bytes by register width/endianness) or explicit bytes (`0x22 0x00`).
- **Add / Delete**: per-device register list; add/update (register, value, name, access, width,
  endian, signed, scale/offset/unit) or delete. Add/delete devices; reset to defaults.
- **Sequences**: named profiles (Startup/Shutdown examples included, *edit before use*), one command per
  line, `delay 500` / `delay 2 s`, `#` comments, stop-on-error, Stop button, import/export .txt.
- **Test Log**: every TX/RX/converted value/sequence event timestamped into
  `%APPDATA%\CubeSatI2CTool\logs\test_log_YYYY-MM-DD.txt`; viewable live, notes can be added.

Settings, devices and profiles: `%APPDATA%\CubeSatI2CTool\{settings,devices,profiles}.json`
(override folder with env `CUBESAT_I2C_HOME`).

- **Link Health**: wireless telemetry link monitor fed by the droplet bridge's SSE stream
  (default `http://45.55.77.215/telemetry/events`, from `DEMO_SERVER_HOST`; optional health URL
  `.../telemetry/health`, polled every 5 s). Tiles: link state (Connected / Stale / Offline / Bridge unreachable),
  last-packet age, ESP32 endpoint with port-change and reboot counts, RSSI (v5 link-stats packets only, otherwise n/a),
  pending commands, and command auth/ready. Six live charts (inter-arrival, jitter, loss %, gaps/dups/out-of-order,
  command RTT, RSSI) plus a stats table over a 1/5/15/60 min window. The stats code (`link_stats.py`) is a line-for-line
  port of the web dashboard's `link-stats.mjs` and `link_monitor.mjs`, checked against shared fixtures.
  `run_dev.bat --mock-link` starts a simulated link; choose "Mock link" in the Source box at any time.
  `--link-tab` opens the app on this page.

- **Streaming Telemetry** (Debug (Wireless)): live device cards with sparklines for the devices that are present
  (1/5/15/60 min window, last-update age, LIVE/STALE/OFF indicator; stale cards are greyed). Data comes from
  `<bridge>/events` via the same `SseLinkSource` reader, plus `<bridge>/health`.
  - Cards:
    - INA226 PV: bus V, current, power and shunt.
    - BQ76942: cells 1/2/3/10 with gauges and min/max/Δ.
    - BQ25798: ACDRV path, REG20 fault badges and REG13.
    - MCU temperature, and peripheral temperature/light.
  - Absent, bus-error and not-polled devices are hidden and listed as small chips.
  - The tab starts by itself when Debug (Wireless) connects, or use Start streaming.
  - `streaming_model.py` is a port of the web page's `streaming-telemetry.mjs` and is tested on the same fixtures.
  - `--stream-tab` opens the app on this tab.

## Addresses (note)
Defaults follow the CubeSat repo: **BMS BQ76942 = 0x08**, **MPPT BQ25798 = 0x6B**, INA226 = 0x40.
(An earlier note said BMS=0x6B / MPPT=0x08.) Change on the Registers page → *Save address*.

## Conversions (value = raw × scale + offset)
BQ76942 (16-bit, little-endian, `i2cget -l 2`): cells 0x14/16/18/1A mV; PACK 0x36 10 mV;
CC2 0x3A signed mA; temp 0x68 0.1 K − 273.15; 0x3E = subcommand address (write `0x22 0x00` → FET_ENABLE).
BQ25798 (16-bit ADC big-endian): IBUS 0x31 / IBAT 0x33 signed 1 mA; VBUS 0x35, VAC1 0x37, VAC2 0x39,
VBAT 0x3B, VSYS 0x3D 1 mV; TDIE 0x41 signed 0.5 °C; 8-bit control/status regs shown hex + bitfields.
INA226 (big-endian): shunt 2.5 µV, bus 1.25 mV; current/power assume current_LSB = 1 mA (edit scale to
match your CALIBRATION).

## Debug (Wireless) source
On the Connection tab, choose **Source → Debug (Wireless)**. Enter the bridge base URL, for example
`http://<droplet>:8080` or `https://<site>/telemetry`. Enter the command token; it is pre-filled from the
`COMMAND_TOKEN` environment variable if that is set, and it is never saved to disk. Then click
**Connect**. After that, the Registers, Sequences and Test Log pages run over the bridge's
`POST /command?wait=1` API.

If the bridge has JWT login enabled, also enter an operator username and password. The password,
JWT and CSRF value remain in memory and are not written to settings. The command token is still
sent for every hardware command. Streaming Telemetry and Link Health reuse the same in-memory
authenticated connection.

* Presence tiles (PV/INA226 0x40, BMS/BQ76942 0x08, MPPT/BQ25798 0x6B) refresh every 2 s from
  `/health`. They need the firmware's debug mode (v5 packets).
* Buttons: Enable/Disable debug, scan period (200-5000 ms), and bus scan + probe.
* Extra sequence lines: `debug on|off`, `scan_period N`, `probe 0x6B`.
* The Sequences page can start and stop a named telemetry recording. While a recording is active,
  every executable sequence line writes server-timestamped `started` and `completed`/`failed`
  markers to the run. These markers appear in the browser Run Explorer graph and event table.
* `i2cconfig` is ignored (the bus is fixed in firmware). `i2cdump` is not available over the bridge.
* Serial mode is unchanged.
* `run.py --wireless http://host:8080` opens the app with this source selected.
* `tools/export_register_map.py <repo>` re-exports the register map and the JS parity fixtures for the
  web Debug Mode page.
