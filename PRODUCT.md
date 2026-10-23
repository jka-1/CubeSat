# CubeSat PMDS telemetry product

## Platform and users

This is a browser-based lab interface backed by a Node.js telemetry bridge and SQLite recording store. It serves the CubeSat senior design team, lab operators who can control the hardware, and reviewers who need read-only access to telemetry evidence.

## Purpose and operating context

The product receives real ESP32 telemetry over UDP, exposes current data to the browser through the bridge, and preserves named telemetry runs for later review. Operators use it during bench tests to inspect battery, photovoltaic, MPPT, and peripheral measurements; understand initialization transients; and explain debug, live-mode, and power-source transitions.

## Product constraints

- A JWT session establishes the signed-in user and role. The existing command token remains required for hardware commands.
- Viewer accounts can inspect telemetry and saved runs. Operator accounts can start and stop recordings and use authorized controls.
- Firmware-reported debug state is authoritative. A run is classified as `debug` or `live_telemetry` from real packets.
- ACDRV1 enabled means photovoltaic power. ACDRV1 disabled means the confirmed battery or secondary source.
- A debug-mode transition records an event. When the transition returns to live telemetry, it ends the current run and starts a linked successor.
- A photovoltaic-to-battery or battery-to-photovoltaic transition outside debug mode ends the current run, records `source_switch` and `run_ended` markers, and starts a linked successor.
- Recordings contain real UDP telemetry only. Cached, simulated, or unrelated device data cannot enter a run.
- Missing measurements remain missing. The interface must not interpolate, invent, or relabel unavailable values.
- The current frontend is static HTML, CSS, and browser ES modules. The bridge is the only browser-to-SQL boundary.
- Development remains local until the team explicitly approves a deployment.

## Evidence and source material

Product behavior is grounded in the recovered live implementation, the existing black-and-gold dashboard, Jaden's debug-application concept, the user's supplied telemetry screenshot, and the implemented SQLite recorder and query API. “Frequency response” is presented as startup or transient analysis because the current data describes value-over-time behavior rather than a frequency sweep.

## Design principles

- Preserve every raw packet and make derived summaries traceable to their time window and sample IDs.
- Make run boundaries and their causes visible in the graph and event table.
- Keep identity, read access, recording authority, and hardware-command authority explicit.
- Prefer dense, readable lab controls over decorative dashboard elements.
- Support keyboard operation, visible focus, loading, empty, error, and narrow-screen states.

## Brand and accessibility commitments

Use the established CubeSat PMDS name, black-and-gold lab interface, current navigation, and existing telemetry vocabulary. Maintain readable contrast, 44-pixel touch targets where practical, semantic tables and forms, visible focus, and live status announcements. No formal accessibility conformance level has been specified.
