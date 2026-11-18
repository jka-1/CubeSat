# KnightEPS demo rehearsal · November 18, 2026

The local working tree passed an operator rehearsal with Chrome, the Node bridge, a temporary SQLite database, and the ESP32 emulator. UDP packets crossed the bridge and reached the dashboard over SSE. The physical ESP32, I²C boards, venue Wi-Fi and deployed Apache service still need a bench check together.

## Demo paths exercised

| Path | Observed result |
| --- | --- |
| I²C Telemetry | The emulator sent v6 packets every 100 ms. Pausing held the displayed packet. Interrupting UDP marked the feed stale. Restoring UDP brought back the live battery reading automatically. In a separate run a loopback proxy severed the browser’s SSE connection while UDP continued. Chrome opened a replacement stream, showed fresh packets and retained the operator session. After a page reload, Advanced view and the operator session survived. Packet sequence advanced in every 15-second interval of a further three-minute run, including two theme changes. |
| Branch Definition | Saved and reloaded a conditional in the browser, then simulated both TRUE and FALSE and saw each reach completion. A separate live-mode run identified the saved revision and loopback target in preflight, then completed a read-only register command. Bridge tests also exercised nested calls, acknowledgment failures, timeouts, operator disconnect, revision conflicts and restart recovery. |
| Recordings | A recording stayed active across navigation, display pause, UDP interruption, reload and theme changes. The full CSV download contained 1,794 rows across four API pages. Every exported row matched SQLite for its sequence, timestamp, packet order, mode, power source, raw payload and decoded envelope. Every exported PV power value matched the decoded packet. |
| Editor and account menu | Tested an expanded nested branch and the anchored theme menu at 320, 390, 768, 1024 and 1440 pixels. Theme changes preserved the draft. Sign-out cancellation preserved edits. Confirmed sign-out released the session. The branch library fixture exercised touch dragging, keyboard selection, retry after a storage error and reconciliation of concurrent edits. |
| Public site | The film decoded during forward and reverse scroll. The mobile hero fit its viewport. Reduced motion switched to stills. The browser suite also opened the public routes and the digital twin. |

## Regression runs

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| Node telemetry bridge | 188 | 0 |
| Python / Qt desktop app, including loopback integration | 111 | 0 |
| Digital twin | 52 | 0 |
| UDP link tools | 15 | 1 |
| Chrome website and dashboard | 64 | 0 |
| Chrome nested editor and account menu | 15 | 0 |
| Chrome branch library fixture | 23 | 0 |
| Host C programs for peripheral conversion, v4 packet encoding and INA226 protocol | 3 | 0 |

The link-tools skip requires a separately patched bridge with a UDP tap logger. The normal bridge ran the packet loss, duplication, reordering and command retry tests. The main browser run and the timed rehearsal both recorded zero uncaught browser exceptions.

## Fix found during rehearsal

Opening the desktop Recordings page on macOS with PySide6 6.10.3 reproducibly crashed Qt while it painted the widget. The graph metric selector had replaced the inherited paint-device method named `metric`. The metric and window selectors now have distinct attribute names. The desktop test opened the page, started and stopped a recording, selected the completed run and loaded its chart and events.

The streaming tests also expected an MCU-temperature card from a sender that explicitly marks that reading unavailable. The assertions now match the wire data. A separate widget test feeds 26 °C, an unavailable reading and 0 °C in succession and checks the card and value at each transition.

[Browser checks, emulator counters and CSV comparison](browser-and-recording.json)
