# Knight EPS Digital Twin refinement — 9 November 2026

Implemented locally in `CubeSat-telemetry-baseline`. Nothing was deployed and no hardware commands were sent.

## Changes

| Files | Result |
| --- | --- |
| `site/modules/twin.html`, `site/assets/js/twin.js`, `site/assets/css/styles.css` | The viewer fills the viewport below the measured site navigation. Removed the outer card, redundant page heading, margins, frame rounding and forced minimum height. Navigation size changes update the available height. Route cleanup releases the viewer and restores normal page scrolling. |
| `site/knight-eps-phase12/viewer/index.html`, `styles.css`, `main.mjs`, `display.mjs` | Payload naming, no phase/subtitle labels, black/gold integration, overlay camera controls, collapsible right sidebar, phone drawer, component isolation and consistent accessible controls. Resize preserves camera position and physical orbit target while adjusting projection, aspect and pixel density. |
| `site/index.html`, `site/assets/js/app.js`, `site/assets/js/router.js` | Cache versions for the changed UI dependency chain. Authentication, telemetry and unrelated routes are preserved. |
| `site/knight-eps-phase12/models/KnightEPS_Detailed.glb` | Actual detailed CAD for all seven mapped PCB instances. All obsolete PCB meshes, accessors and binary ranges are removed from this output. The original assembly GLB remains as the build foundation, and is no longer the viewer's active model. |
| `site/knight-eps-phase12/docs/component_manifest.json`, `model-upgrades.json` | Stable component IDs and telemetry links; new geometry provenance, hashes, triangle counts, bounds and measured fixture corrections. |
| `model-sources/Final_Models_V1.zip`, `scripts/build-detailed-twin.mjs` | Untouched supplied archive and reproducible asset compiler. Materials are batched per board without decimating triangles or discarding artwork. The two regulators share immutable browser geometry. |
| `tests/twin/` | Model-integrity tests and a local-only browser verification harness. |

## Model mapping

| Existing component ID | Supplied geometry | Triangles | Material batches |
| --- | --- | ---: | ---: |
| `INA226` | `INA226_v12_high_detail.glb` | 37,486 | 18 |
| `Regulator_01` | `Regulator_PCB_high_detail.glb` | 56,630 | 23 |
| `Regulator_02` | `Regulator_PCB_high_detail.glb` | 56,630 | 23 |
| `MCU_Final` | `Final_MCU_v12_high_detail.glb` | 337,084 | 26 |
| `LightSensor` | `lightsens_high_detail.glb` | 14,986 | 16 |
| `TemperatureSensor` | `tempsens_high_detail.glb` | 13,510 | 13 |
| `Charger_BMS034A_EVM` | `BMS034A_PCB_1_high_detail.glb` | 121,190 | 35 |

The BQ76942 board has no replacement in the archive and remains unchanged. All 110 payload mesh position buffers were compared with the nested payload GLB and already match byte for byte; its detailed geometry was preserved and its visible names changed to Payload.

The CAD exports use millimeters, while the assembly uses meters. Imports use a uniform 0.001 conversion and rigid rotations determined from substrate planes, component orientation and existing material-region bounds. No surrounding chassis, cover, payload or other electronics were scaled or moved.

The regulator substrate changed from 33.96 × 40.62 mm to 32.69 × 43.16 mm. Both PCB anchors, orientation and support depth are preserved. Each bottom clip/base pair follows the lower edge by 1.27 mm; each side pair follows its edge inward by 0.635 mm. Other fixtures are unchanged. Substrate support planes match the originals within 0.0001 mm.

## Verification and evidence

- Four model-integrity tests pass: seven detailed sources, stable IDs/transforms and unchanged surrounding geometry, support-plane retention, and valid packed binary ranges. See `model-tests.txt`.
- Nineteen shared telemetry decoder/model tests pass. See `telemetry-tests.txt`.
- Browser checks verify the seven loaded source hashes and triangle counts, absence of old PCB meshes, naming, viewport sizing, stable orbit anchor across sidebar toggles, every board's selection/highlighting/isolation/visibility/focus/raycasting, lid opening/closing, exploded positioning, all six assembled and exploded camera presets, rendering-quality controls and telemetry/display API behavior with explicitly synthetic packets.
- Desktop (1440 × 900) and phone (390 × 844) complete browser runs pass. Responsive checks at 820 × 1180, 1280 × 800, 1440 × 900 and 390 × 844 show no document overflow, model clipping or orbit-target drift; the projection remains visually centered. Direct pointer dragging and zoom controls were also exercised. See `browser-mobile.json`, `responsive-layouts.json`, and the mobile screenshots.
- A final keyboard-control pass verified fixed viewport anchoring: both desktop and phone report zero iframe scroll after reset/lid/sidebar actions, with the scene pinned to the full frame. See `viewport-anchor.json` and `mobile-anchor.json`. The Twin route also uses a solid navigation background and dark native scrollbars to avoid compositing artifacts across the frame boundary.
- `browser-desktop.json` records the checks and measurements. `pcb-inspection.jpg` shows all seven actual detailed board renders, assembled and lid-open views, and the exploded assembly.
- Performance mode avoids the acrylic transmission render pass while preserving its translucency, caps pixel ratio at 1 and disables shadows. Studio restores source transmission and shadows. Measured desktop performance mode: 347 draw calls, 877,691 rendered triangles, median frame interval 16.5 ms and p95 20.6 ms in this browser. These figures do not establish performance on physical low-powered devices.

The two dashboard assertions found during the initial check are now fixed. `dashboard.mock-mode.test.js` checks the actual “Mock Telemetry” control label. `dashboard.peripheral.test.js` verifies the versioned application/router/dashboard asset references and reads the referenced files, rather than pinning historical cache dates. No dashboard behavior or production configuration changed.

The follow-up run passes **37 tests**: eight dashboard tests, nineteen shared telemetry tests, four model-integrity tests and six new Twin telemetry integration tests. The new tests execute the actual shared stream manager, decoder and Twin adapter using isolated EventSource and viewer substitutes. They cover connection-only events, confirmed measurement mapping, duplicate replay, absent devices, malformed/unavailable data, the Twin's 15-second freshness boundary, bridge clock skew, disconnects, teardown and navigating away while the model is loading. This is local protocol replay coverage, not an on-device or real HTTP/SSE connection test.

```sh
node --test tests/twin/telemetry-integration.test.mjs tests/twin/models.test.mjs telemetry-bridge/test/dashboard.mock-mode.test.js telemetry-bridge/test/dashboard.peripheral.test.js telemetry-bridge/test/streaming-telemetry.test.js
```

## Reproduce

```sh
node scripts/build-detailed-twin.mjs
node --test tests/twin/models.test.mjs
node --test telemetry-bridge/test/streaming-telemetry.test.js
python3 tests/twin/preview.py
```

Open `http://127.0.0.1:8766/tests/twin/verify.html`, wait for “Viewer ready”, then choose “Run viewer checks”. The preview server binds only to localhost. It supplies a test-only unauthenticated session response, returns 503 for hardware/telemetry endpoints and never connects to a live bridge. It must not be used as a production server.

## Remaining limits

The previous mounting work explicitly leaves spring flex unmodeled. Its existing clip engagement requires up to approximately 0.482 mm of spring deflection. Geometry alignment is checked; physical installation, spring compliance and manufacturing tolerances remain unverified. Live SSE/hardware behavior was not exercised against an actual device in this session. Studio is more expensive than performance mode, and the detailed combined GLB is approximately 37.5 MB before HTTP compression.

Design-tooling note: Impeccable reported that its optional build-path preference is unset. It can be recorded as code-first for future refinement work; no design-tooling configuration was changed in this task.
