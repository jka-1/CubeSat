# CubeSat telemetry link characterization tools

Zero-dependency Node ≥18 scripts (the bridge already needs Node ≥18). Built against
`jka-1/CubeSat@telemetry-fixes-addons` commit `2a82d13`.

| file | purpose |
|---|---|
| `link_monitor.mjs` | per-packet CSV + summary (loss from seq gaps, dup, out-of-order, reboots, inter-arrival p50/p95/p99, RFC3550-style jitter, outages, throughput, RSSI/counters if v5) |
| `command_rtt.mjs` | POST /command loop with `X-Command-Token` from `$COMMAND_TOKEN`; watches `/events` for `command_status` (completed/failed/timed_out/retrying); CSV + summary |
| `synth_sender.mjs` | fake ESP32: v4 (or v5) packets with injectable drop/dup/reorder/jitter/reboot; answers commands with `debug_result` |
| `patches/bridge-udp-tap-and-v5.patch` | optional bridge patch: `UDP_TAP_LOG=/path.csv` passive per-datagram log + accept proposed v5 link-stats packet. Stock bridge tests still pass (11/11) with it applied |
| `firmware/FIRMWARE_ADDITIONS.md` | proposed firmware snippets (RSSI, uptime tx timestamp, tx/ACK error counters, reconnect counter), gated by `DEMO_LINK_STATS_V5` |
| `PLAN.md` | architecture summary + characterization plan + test matrix |
| `test/` | `node --test test/` (unit + e2e against the real bridge) |

## Port 3333 conflict: pick one, never bind 3333 next to the bridge
1. **SSE (passive, zero changes, recommended first):** on the droplet
   `node link_monitor.mjs --mode sse --url http://127.0.0.1:8080/events --csv run1.csv --duration-s 1800`
   Uses the bridge's own `received_at`. It can't see datagrams the bridge rejects (bad hex), and it skips the replayed
   latest envelope that `/events` sends on connect.
2. **Bridge tap (patch):** apply the patch, add `Environment="UDP_TAP_LOG=/var/log/cubesat-udp-tap.csv"`, restart, then
   `node link_monitor.mjs --mode taplog --file /var/log/cubesat-udp-tap.csv --follow`. Logs every datagram, rejected ones included.
3. **Tee (no bridge change, bench):** `node link_monitor.mjs --mode tee --port 3334 --forward 127.0.0.1:3333`
   and set `DEMO_SERVER_UDP_PORT 3334u` in the firmware (open 3334/udp on the firewall). It relays ACKs and commands back, so
   freshness and command correlation keep working; the bridge sees the tee's address as the source.
4. **Listen (no bridge, LAN bench):** point the firmware at a laptop: `--mode listen --port 3333 --ack`. With `--ack` it mimics the bridge ACK
   (without it the firmware logs ACK timeouts and closes the socket every 5 cycles).

Ctrl-C (or `--duration-s`) writes `<csv>_summary.json` and prints the summary.

## Command RTT
```
read -rsp 'Command token: ' COMMAND_TOKEN; echo; export COMMAND_TOKEN
node command_rtt.mjs --base http://127.0.0.1:8080 --count 100 --interval-ms 2000 --csv rtt.csv
# via Apache: --base https://<site>/telemetry
unset COMMAND_TOKEN
```
The default is a read-only `i2c_read 0x40 reg 0x05 len 2`. Writes and ACDRV need `--allow-write`.
`bridge_rtt_ms` = bridge `issued_at` → matching `debug_result` (server.js ~1945). That covers bridge→MCU→bridge over UDP,
plus the MCU's poll latency (up to 100 ms slices) and the I2C time. `client_rtt_ms` adds HTTP and SSE.
Commands go to the fresh telemetry source only (`resolveCommandTarget`), so stream telemetry while testing. Keep the interval ≥ the
bridge timeout if you also want to measure timeouts cleanly. Default `--wait-ms 12000`.

## Known limitations
- v4 has no TX timestamp, so jitter is measured against the nominal period (`--period`), not true one-way delay.
- seq is 16-bit, skips 0, and restarts at 1 on reboot. A reboot is detected as a backward jump >64 or a forward jump ≥1000.
  A reboot right after boot (seq <64) or near the 65535 wrap can be mis-classified as dup/loss.
- `gap_events` counts provisional gaps. Reordered packets that arrive later decrement `lost` (`late_recovered`) but not `gap_events`.
- An I2C read failure skips the send without consuming a seq (main.c 253–263). That shows up as an inter-arrival outage, not as loss.

## Debug firmware emulation (synth_sender.mjs)
`--debug` sends 36-word v5 packets, matching main/debug_mode.c. `--present` takes all, none or a comma list of
pv,bms,mppt. `--count 0` runs until Ctrl-C. The emulation answers debug_control (switches between v4 and v5),
set_scan_period (changes the send period, 200..5000 ms), i2c_scan and i2c_probe (only present addresses respond),
and i2c_read/i2c_write against a register memory seeded with INA226 0x00/0x02/0x05/0xFE/0xFF and BQ25798 0x48.
Reads and writes to absent devices fail with ESP_FAIL; that error name is emulated.
Without `--debug`, `--present` still applies: v4 packets carry the presence in word 15 (`active_sensor_mask`), the way
the firmware does. `--wiggle` adds a deterministic drift to PV, cells, temperatures and light. It also blips CONV_OCP
briefly every 40 packets, which helps when checking the Streaming Telemetry sparklines and fault badges.
`site_dev_server.mjs` now aborts the upstream SSE request when the browser closes its EventSource.
