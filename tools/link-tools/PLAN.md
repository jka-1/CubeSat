# Wireless telemetry link: architecture and characterization plan
Source: jka-1/CubeSat @ telemetry-fixes-addons, commit 2a82d13. All line numbers refer to that commit.

## 1. Architecture
**Uplink (MCU → droplet → browser)**
- `main/wifi_station.c` `wifi_station_init` sets up an STA with WPA2 threshold and PMF capable. `wifi_event_handler` (l.30–49) reconnects on disconnect **at most 10 times** (l.34) and then stops for good ("reconnect limit reached", l.39). The counter only resets on GOT_IP (l.44–48).
- `main/main.c` `telemetry_task` (l.167) blocks on `WIFI_CONNECTED_BIT` (l.184), then reads the I2C sensors (l.225). If that succeeds it calls `udp_transport_send_power_telemetry` (l.240), then `poll_commands_until_deadline` (l.288) until cycle_start + `DEMO_STREAM_PERIOD_MS` (1000 ms, app_config.h). After 5 consecutive errors it closes the socket (l.284). The next send opens a new socket, so the **source port changes**.
- `main/udp_transport.c` `udp_transport_send_power_telemetry` (l.1155) runs `getaddrinfo` on every send, takes a 16-bit seq from `next_sequence_word` (l.275; skips 0, restarts at 1 on boot), builds the 80-char ASCII-hex v4 packet (l.294–350), and sends it to 45.55.77.215:3333. It then does **stop-and-wait**: it blocks up to `DEMO_ACK_TIMEOUT_MS` = 250 ms for `{"type":"ack","seq":N}` (`validate_ack` l.353) and handles any commands that arrive meanwhile (l.1271). The MCU-side ACK RTT is computed (l.1302–1310) but **only logged to serial**.
- `telemetry-bridge/server.js` `udpSocket.on('message')` (l.1893) decodes the packet (`decodeUdpPacket` l.1281, v4 at l.893). It sets `lastTelemetryEndpoint = {address, port, last_seen}` (l.1983), creates an envelope with `received_at` (l.1313), sends the JSON ACK with `seq`, `server_rx_ms` (l.2011–2031), and broadcasts SSE.
- SSE: `GET /events` (l.1741) replays status plus the latest telemetry/debug/command envelope on connect, with a `: heartbeat` every 15 s (l.2039) and a status rebroadcast when connectivity flips (500 ms poll, l.2047). Apache proxies this as `/telemetry/events`, `/telemetry/health`, `/telemetry/command` (README l.53–54, dashboard.js l.290 `EventSource`). **The Apache vhost config is not in the repo**, so proxy buffering and timeouts for SSE can't be checked from the code.

**Downlink (command path)**
- Browser/script → `POST /command` (l.1834) → `assertCommandAuthorized` (`X-Command-Token`, timing-safe sha256 compare, l.299) → `resolveCommandTarget` (l.1480). That uses the fixed `COMMAND_TARGET_HOST/PORT` if configured, otherwise the last telemetry endpoint **only if fresh** (age ≤ `TELEMETRY_STALE_MS` = 5000). The bridge registers a pending command with a timer (`COMMAND_TIMEOUT_MS` = 4000, l.1410), sends a JSON command over UDP from the bridge's 3333 socket, and returns HTTP 202 `pending`.
- MCU: the command arrives on the same socket. It is handled either during the ACK wait or in `udp_transport_poll_command` (l.1317, 100 ms recv slices). `handle_command_payload` (l.1017) runs the I2C action and `send_debug_response` (l.185) returns a `debug_result` with `request_id`, `issued_at`, `device_time_ms`.
- The bridge matches by `request_id`, the source endpoint (`endpointsMatch` l.1928), and content (`debugResultMatchesPending` l.389). It computes `round_trip_ms` = now − issued_at (l.1945) and publishes `command_status` completed/failed over SSE. Otherwise `timed_out`.
- **Retries:** JSON (v1–v4) commands get **0 retries** (`maxRetries` defaults to 0, l.1450). Only `ina226-load-v1` binary commands retry once (`INA226_LOAD_COMMAND_RETRIES`, l.1707). README's "retries" note applies to the ina226-load-test path only.

**ina226-load-test:** a separate firmware with 10-byte binary telemetry (no sequence number, period `INA226_TEST_TELEMETRY_PERIOD_MS` = 1000) and an 8/12-byte command/result protocol. The bridge **does not ACK** these (l.2010). For that firmware, loss can only be inferred from inter-arrival gaps. The tools still work in timing-only mode.

**Already observable**
- Packet seq (16-bit) in every v1–v4 packet. The bridge logs `seq=` per packet to the journal (l.2034). The MCU logs `sequence`, `rtt=` and "ACK timeout for sequence N" to serial.
- `received_at` per envelope (SSE / `/latest`). `transmission_age_ms` only when a JSON packet carries `transmitted_at` (never for hex).
- `/health`: `telemetry_connected`, `telemetry_age_ms`, `telemetry_stale_after_ms`, `telemetry_endpoint{address,port,last_seen}` (port changes reveal socket reopens/reboots), `pending_commands`, `command_ready`, `web_clients`.
- `command_status` SSE events with `round_trip_ms`, `retrying`, `timed_out`. `debug_result.device_time_ms` (MCU uptime).
- **Not observable today:** RSSI, MCU tx errors / ACK timeouts on the wire, true one-way delay (no TX timestamp in hex), reconnect count/reason.

## 2. Metrics
| metric | how | tool |
|---|---|---|
| Packet loss | seq gaps (16-bit ring, skip 0, reboot detection) | link_monitor |
| Duplicates / out-of-order | seq already seen / behind highest within 64 | link_monitor |
| Inter-arrival + jitter | bridge-side arrival deltas, p50/p95/p99/max, RFC3550-style vs nominal period | link_monitor |
| One-way delay variation | needs v5 uptime_ms: (rx − tx_uptime) minus its minimum = relative OWD | link_monitor CSV (fw_uptime_ms column) |
| Uplink RTT | MCU serial `rtt=` today, on the wire if v5 is extended (FIRMWARE_ADDITIONS §5) | serial / v5 |
| Command RTT and success | bridge `round_trip_ms`, completed/failed/timed_out | command_rtt |
| Throughput | bytes/s and pkt/s | link_monitor |
| RSSI vs distance/orientation | v5 word 21 | link_monitor (rssi columns) |
| Reconnect time | outage length in link_monitor + `/health` `telemetry_connected` flip + v5 reconnect counter; serial timestamps for disconnect→GOT_IP | link_monitor + serial |
| Effect of packet rate | rerun at `DEMO_STREAM_PERIOD_MS` 1000/500/200/100 | all |

## 3. Test matrix (each cell ≥ 30 min at 1 Hz ≈ 1800 packets; ≥ 50 commands at 2 s spacing)
| ID | variable | levels | measure |
|---|---|---|---|
| T1 baseline | bench, 1 m line of sight | — | all metrics, 2 h soak (exceeds the handoff's 5-min criterion) |
| T2 distance | 1, 5, 10, 20 m, through 1 wall | 5 | loss, RSSI, cmd RTT |
| T3 orientation | antenna 0/90/180/270°, board flat/upright | 4–8 | RSSI, loss |
| T4 rate | period 1000/500/200/100 ms | 4 | achieved rate vs target, loss, ACK timeouts, cmd RTT (stop-and-wait limits rate) |
| T5 AP drop | AP power-off for 5 s, 30 s, 120 s | 3 × 5 reps | outage duration, time to first packet after AP is back, whether the board recovers without reset (see 10-retry cap) |
| T6 bridge restart | `systemctl restart cubesat-telemetry` | 5 reps | MCU ACK timeouts, recovery time, pending commands |
| T7 command stress | 1 cmd/s, 0.5 cmd/s, burst of 5 | 3 | success %, timeouts, effect on telemetry jitter (commands are handled inside the ACK wait) |
| T8 interference | busy 2.4 GHz channel vs quiet | 2 | loss, jitter p99 |
| T9 internet path | lab Wi-Fi → droplet (real WAN) vs LAN listener | 2 | splits RF vs WAN contribution |
| T10 ina226-load-test | its own firmware | 1 | inter-arrival only, cmd RTT and retry rate |

## 4. Suggested pass criteria (starting points, tune after T1)
- Loss ≤ 1 % per 30-min run at ≤ 10 m line of sight. No gap > 3 consecutive packets outside induced faults.
- Inter-arrival p99 ≤ 1.5 × period. No outage > 5 s (= `TELEMETRY_STALE_MS`, after which commands get rejected) outside induced faults.
- Duplicates = 0 (the firmware never retransmits telemetry; a duplicate means a network or test artifact).
- Command success ≥ 99 % at ≤ 10 m. Bridge RTT p95 ≤ 500 ms, max < 4000 ms (no timeouts; LAB_HANDOFF already requires no timeouts during acceptance).
- Reconnect: telemetry resumes ≤ 10 s after the AP returns, for outages of 5 s and 30 s. A 120 s outage must recover without a reset. **That is expected to fail with the current 10-retry cap** and is a good regression test for the fix.
- RSSI: record the dBm at which loss first exceeds 1 % and use it as the link-margin figure.
- At least 5 min of ACKs (LAB_HANDOFF), extended to 2 h for the soak.
