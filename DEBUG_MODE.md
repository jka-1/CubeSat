# Debug mode (firmware, bridge, web, Windows tool)

## Firmware
* `DEMO_DEBUG_MODE_DEFAULT 0` (app_config.h): debug mode is off at boot. You turn it on with the
  `debug_control` command.
* **Presence detection** (`DEMO_PRESENCE_DETECTION 1`). `i2c_master_probe` (20 ms timeout) checks
  INA226 0x40, BQ76942 0x08 and BQ25798 0x6B:
  * at startup
  * every `DEMO_PRESENCE_PROBE_PERIOD_MS` (5000 ms)
  * on demand with `i2c_scan`
  A device counts as present only if the probe returns ESP_OK. A device that is absent, NACKs or times
  out is skipped by `i2c_bus_monitor_read_all`, so it costs no 100 ms transaction timeouts.
* **Validity instead of zeros:**
  * v5: presence/probed masks plus per-device status codes. The bridge turns absent groups into `null`
    with `available:false`.
  * v3/v4: word 15 (polled-sensor mask) now reports `enabled & present`.
* **Debug packet v5** is sent only while debug mode is on: 36 words, which is the 20 v4 words
  (version 0x0005) plus the 16 below.

  | word | content |
  |---|---|
  | 20 | RSSI dBm (int16, 0x8000 = n/a) |
  | 21-22 | uptime ms (hi, lo) |
  | 23 | UDP tx errors |
  | 24 | ACK timeouts |
  | 25 | Wi-Fi reconnects |
  | 26 | flags: bit0 debug enabled, bit1 presence detection |
  | 27 | present mask (low byte), probed mask (high byte); bit0 PV, bit1 BMS, bit2 MPPT |
  | 28 | scan period ms |
  | 29 | probe period ms |
  | 30-32 | error counts PV, BMS, MPPT |
  | 33 | status nibbles PV/BMS/MPPT: 0 ok, 1 absent, 2 nack, 3 timeout, 4 paused, 5 error, F unknown |
  | 34 | I2C bus phase of the last cycle, 0.1 ms units |
  | 35 | last ACK round trip ms (0xFFFF = timeout) |

* **Commands.** All are JSON over UDP, and each returns `debug_result`.
  * `debug_control {enabled}`
  * `set_scan_period {period_ms}`: clamped to 200..5000; the bridge rejects values outside that range.
  * `i2c_scan`: 0x08..0x77; returns `addresses`, `count`, `scan_us` and also re-probes presence.
  * `i2c_probe {addr}`: a NACK is still `ok:true` with `present:false`.
  * `i2c_read` / `i2c_write`: unchanged.
* **Wi-Fi power save.** Debug on sets `esp_wifi_set_ps(WIFI_PS_NONE)`; debug off sets
  `WIFI_PS_MIN_MODEM`, which is the IDF default.
* **Reconnects** use exponential backoff from 1 s to 30 s and retry forever. The old code gave up after
  10 immediate retries.
* **ACK wait** is `min(250 ms, period/4)`.

## Behavior changes
1. Absent or erroring devices are no longer read every cycle; they are re-probed every 5 s.
   * v3/v4 word 15 shows them as not polled, and their words stay 0 (v4 has no other validity field).
   * Paused and absent therefore look the same in v4. In v5 they are told apart by status 4 vs 1.
2. If `i2c_bus_monitor_read_all` fails, the packet is now still sent in debug mode, or when
   `DEMO_SEND_ON_I2C_FAILURE` is 1 (default 0). Before, that cycle sent nothing.
3. Wi-Fi reconnect waits 1 s before the first retry instead of retrying immediately, and it never stops
   retrying.
4. With a period under 1000 ms, the ACK wait shrinks to period/4 (for example 50 ms at 200 ms). At the
   default 1000 ms it stays 250 ms.
5. Modem sleep is off while debug mode is on, which raises current draw.

## Scan-window analysis (is a 1 s scan feasible?)
| item | number | source / derivation |
|---|---|---|
| I2C bit time | 2.5 us | 400 kHz (`I2C_MASTER_FREQ_HZ`, GPIO4/5) |
| 2-byte register read | ~47 bits = ~118 us | S + addr/W(9) + reg(9) + Sr + addr/R(9) + 2x9 data + P |
| 1-byte register read | ~38 bits = ~95 us | same without one data byte |
| normal cycle bus time | ~2.0 ms | 15 two-byte + 2 one-byte reads (INA226 x5, BQ76942 cells/temp, BQ25798 REG13/fault) |
| with driver overhead | ~3.7 ms | estimate of ~100 us per transaction for the IDF i2c_master driver plus the mutex; **measure it with word 34** |
| BQ76942 clock stretching | unknown | can add up to ms per direct command; word 34 shows it |
| stuck device (old code) | up to 1.7 s per cycle | 17 transactions x `I2C_TRANSACTION_TIMEOUT_MS` (100 ms); presence skipping removes this |
| ADC peripheral sample | 16 samples | `PERIPHERAL_ADC_SAMPLE_COUNT` |
| ACK wait | <= 250 ms | `DEMO_ACK_TIMEOUT_MS`, stop-and-wait; now min(250, period/4) |
| Wi-Fi RX latency | up to 1 DTIM (~100-300 ms) | ESP-IDF Wi-Fi guide, "Wi-Fi Power-saving Mode": with modem sleep "the delay in receiving Wi-Fi data may be the same as the DTIM cycle"; default is WIFI_PS_MIN_MODEM |
| bus scan 0x08-0x77 | ~10-15 ms healthy; worst 112 x 10 ms = 1.12 s | 112 probes of ~11 bits plus driver overhead; 10 ms probe timeout |

* **Typical cycle:** I2C ~4 ms, then UDP send, then ACK in a few ms on a quiet LAN. That totals about
  30-70 ms with modem sleep on, because the ACK may wait for a beacon.
* **Worst case with the new code:** about 4 ms I2C plus the 250 ms ACK timeout, roughly 260 ms.
* **Verdict:** a 1 s scan is feasible with margin, about 4x.
* **200 ms (the minimum)** works only with the bounded ACK wait (50 ms) and modem sleep off, both of
  which debug mode applies. Expect occasional overruns if the AP is slow.
* **Alternatives if a faster or steadier scan is needed:**
  1. Read sensors in their own task (`i2c_bus_monitor_start` already exists in pass/) and send the
     latest snapshot on a separate timer.
  2. Make the ACK non-blocking: track outstanding sequence numbers and count timeouts asynchronously.
  3. Read only the registers you are watching in debug mode.
  4. Batch several samples into one UDP packet.

## Bridge
* Decodes v5 as `packet_format: hex-v5-debug`, with `packet.link` and `packet.debug`.
* `debug_mode` is included in the SSE status and in `/health`.
* Routes the four new commands with validation.
* `POST /command?wait=1` (or `"wait": true` in the body) answers synchronously with the final status and
  the device `result`. The Windows tool and the web sequence runner use this.
* v1-v4 and ina226-load packets are unchanged.

## Web: `#debug-mode`
* Debug toggle, scan-period control, and bus scan with probe.
* Presence tiles.
* Register read/write with raw and converted values. It uses `assets/data/register-map.json`, exported
  from the Windows tool by `tools/export_register_map.py`. `register-conversions.mjs` is
  parity-tested against `conversions.py`.
* Sequence runner, which accepts the page syntax and i2cget/i2cset.
* Downloadable `.txt` session log and an embedded link-health panel.
* Commands use the existing `X-Command-Token`.

## Windows tool
* The Connection tab has a "Debug (Wireless)" source next to Serial. `WirelessSession` translates
  i2cget/i2cset/i2cdetect into bridge commands, so the Registers, Sequences and Test Log pages work
  unchanged.
* Presence tiles and scan-period control are on the same tab.
* Serial mode is unchanged.
