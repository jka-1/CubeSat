# CubeSat PMDS telemetry product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The CubeSat senior design team uses this browser-based lab interface. Operators control hardware and record bench tests; reviewers inspect telemetry evidence with read-only access.

## Product Purpose

The product receives ESP32 telemetry over UDP, shows current measurements through a Node.js bridge, and preserves named runs for later review. It helps the team inspect battery, photovoltaic, MPPT, and peripheral measurements; study startup transients; and explain debug-mode, live-mode, and power-source transitions.

## Positioning

The bridge ties live telemetry to a private recording store with packet-level evidence and linked run segments at confirmed mode, source, and device-restart boundaries. Operators can also build saved visual sequences whose live execution is controlled by the backend, while simulation does not transmit hardware commands.

## Operating Context

Operators use the dashboard and Windows I²C tool during local bench tests. The ESP32 sends UDP packets to the bridge; Apache serves the dashboard, and the browser receives telemetry through SSE. The bridge is the only browser-to-SQL boundary. A private SQLite worker stores recordings, sequence definitions, execution snapshots, and ordered events. Development remains local until the team explicitly approves deployment.

## Capabilities and Constraints

- A JWT session establishes the signed-in user and role. Viewer accounts can inspect telemetry and saved runs. The authorized active operator can start and stop recordings and use controls. Hardware commands also require the existing command token.
- Firmware-reported debug state is authoritative. A run is classified as `debug` or `live_telemetry` from real packets.
- Confirmed ACDRV1 means photovoltaic power. Confirmed ACDRV2 or off is shown as BAT/secondary; it does not distinguish battery from another secondary source or prove measured power flow. Missing or contradictory source evidence remains unknown.
- A debug-mode transition records an event. Returning to live telemetry ends the current run and starts a linked successor. A confirmed photovoltaic-to-BAT/secondary or reverse transition outside debug mode also ends the run, records source-switch and end markers, and starts a linked successor.
- Recordings contain real UDP telemetry only. Cached, simulated, or unrelated device data cannot enter a run. Missing measurements remain missing; the interface does not interpolate or relabel unavailable values.
- The visual sequence editor saves definitions through the bridge's approved persistence API. The backend sequence engine schedules live and simulated execution; the browser does not run a separate hardware execution engine. Live execution requires active operator ownership and backend preflight. Simulation sends no commands to hardware.
- The frontend uses static HTML, CSS, and browser ES modules. Existing dashboard features and run recording remain part of the product.

## Brand Commitments

Keep the established CubeSat PMDS name, black-and-gold lab interface, current navigation, and existing telemetry vocabulary.

## Evidence on Hand

The recovered live implementation, existing dashboard, Jaden's debug-application concept, the user-supplied telemetry screenshot, and the local SQLite recorder and query API inform the product. The bridge's authentication, recording, and sequence documentation describe the implemented local behavior. The dashboard's “Frequency response” view presents startup or transient analysis: its value-over-time data does not establish a frequency sweep.

## Product Principles

- Preserve raw packet evidence and make summaries traceable to their time windows and sample IDs.
- Make run boundaries and their causes visible in graphs and event tables.
- Keep identity, read access, recording authority, and hardware-command authority explicit.
- Keep unavailable measurements and uncertain hardware outcomes visible rather than inferring values or success.
- Support dense, readable lab controls with keyboard access and clear loading, empty, error, and narrow-screen states.

## Accessibility & Inclusion

Maintain readable contrast, 44-pixel touch targets where practical, semantic tables and forms, visible focus, and live status announcements. No formal accessibility conformance level has been specified.
