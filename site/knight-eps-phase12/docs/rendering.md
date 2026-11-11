# Detailed twin rendering

The viewer uses the existing pinned Three.js r176 WebGL renderer. Studio now
uses full device resolution up to DPR 2, FXAA, cached shadows and display-space
acrylic transmission. Performance caps DPR at 1, removes transmission and
disables shadows. Both retain every CAD triangle and the original artwork
dimensions. FXAA and the acrylic composition are the approved pilot's visual
tradeoffs; this is not equivalence to the former physical HDR/MSAA pipeline.

The controller, website layout, component identities, selection/picking,
artwork layers, dedicated LCD and telemetry interfaces remain in place.
No renderer experiments or timer-based frame scheduling ship with the site.
Demand rendering uses requestAnimationFrame and suspends while hidden.

## Assets and build

`models/KnightEPS_Detailed.glb` is canonical. The supplied MPPT and BMS were
replaced locally on 11 November 2026; see
`model-sources/power-boards/README.md` and the replacement audit. The separate
`models/display/` package contains a prepared derivative, its geometry
certificate and full-resolution R8 artwork. The prepared model retains all
871,131 logical triangles and 95 component identities. Exact vertex-attribute
deduplication reduces stored vertices from 1,097,485 to 900,713. Every expanded
indexed position, normal and UV matches the prepared source byte for byte.

Rebuild after the canonical CAD build:

```sh
python3 scripts/build-display-twin.py
```

This needs Python 3 with Pillow and Node with `module.registerHooks` (tested
with Node 25.9). It uses the site's pinned dependencies, stages output in a
temporary directory, and writes derivatives only after all audits succeed.
No build or runtime dependency points into `verification/`. The compiler pins
the canonical source hash; a CAD revision requires deliberate revalidation.
`provenance.json`, `compact-report.json` and `build-report.json` retain hashes
and the attribute equivalence proof. All original embedded image bytes remain
in the derivative as the compatibility fallback or original multicolor artwork.

The builder also emits `display-compact.glb.gz`: 10,222,122 bytes versus
35,884,332 decoded bytes (71.5% smaller). This is ordinary lossless gzip, not
geometry quantization. Modern browsers download that static file, decode it
and verify the same geometry certificate. No web-server compression setting
is required; already HTTP-decoded responses also work. Browsers without
DecompressionStream request the original uncompressed derivative instead.
Artwork download/decompression starts alongside the model transfer. Both
paths keep the original source and display GLBs unchanged.

The coverage package reconstructs every eligible two-color source texel exactly.
The four new multicolor PCB images retain their original embedded RGBA PNGs
and full dimensions; their image hashes/dimensions are recorded separately.
No constant-color approximation is applied to them. R8
versus RGBA mip generation can differ by channel rounding. A browser without
DecompressionStream uses the original embedded RGBA maps. Coverage delivery
accepts gzip or transparently HTTP-decoded bytes; maps remain linear data
after GLTF parsing. A browser without
secure-context hashing keeps both faces instead of trusting the certificate.

## Rendering and lifecycle

The ground appearance is a constant environment backdrop, with a separate
transparent, front-sided ShadowMaterial receiver. There is no visible finite
floor mesh, edge or underside. Orbiting below loses the shadows and retains
the same backdrop. Performance retains the backdrop with shadows disabled.
The receiver stays outside the CAD depth precision calculation and is
disposed with the viewer; no reflection pass or larger shadow map was added.

- Invalidate material programs when shadow mode changes, including cached
  overrides when they next become active. Studio receiving shadows must not
  depend on a later selection or camera transition.
- Cull only certified, outward, completely closed opaque solids, with both
  sides restored for clipping/interior views and transparent overrides.
- Use ordinary depth only when the fitted range resolves the original
  artwork separation conservatively. Retain logarithmic depth otherwise.
- Use cheap original opaque surfaces for a depth prepass. Do not occlude
  refractive objects, disable original geometry or simplify the mesh.
- Copy only the visible acrylic region, at original pixel resolution, with
  blur/filter padding and conservative full-buffer fallback.
- Restore R8 alpha in artwork shadow shaders. Orthographic shadow shaders
  omit a redundant logarithmic depth write; perspective shadows retain it.
- Apply the pinned upstream FXAA shader to encoded output once. Avoid a
  second tone mapping/color conversion.

Startup precompiles main, near-camera, sidedness, transparent and quality
variants against the real scene lighting. It also draws the guarded depth/side
variants to initialize lazy uniform and vertex bindings before interaction.
Buffer initialization finishes
before hiding the loading message and resolving `ready`; the first exposed
quality is Studio. Precompilation shifts work into loading, not free work.
`readyForImage` means a submitted image followed by the next animation tick;
it is not a GPU completion timestamp.

Dispose stops callbacks, controls, mock/SSE display transport and observers;
releases geometry, maps, image bitmaps, capture textures, warm shader
references, shadows and environment resources; and removes component DOM
references. Disposal during model loading or precompilation is safe and
idempotent. `performance().rendering` exposes the selected path and resource
counts without adding diagnostics to the product interface.
`performance().loading` records model response size, download, unpacking,
verification, parsing and readiness times. These are browser elapsed times,
not server throughput or GPU completion measurements.

## Pre-replacement loading and concurrent viewers

At simulated 20 Mbps / 40 ms latency with the HTTP cache disabled on the test
MacBook, navigation-to-ready measured 18.42 s before compression, 8.30 s on
the first new floor shader run and 6.77 s on the final run. Model transfer
dropped from approximately 14.48 s to 3.92 s. GPU driver shader caches were
not cleared; this is a bounded comparison, not a guarantee for every device.

Rendering runs on each visitor's GPU. The dashboard's shared stream manager
uses one EventSource per page and forwards readings to the embedded viewer;
the normal viewer does not open another stream. An isolated loopback check
with the real bridge accepted nine independent authenticated viewer sessions,
delivered status broadcasts to all nine, and cleaned up to zero connections.
No hardware or production server was contacted. There is no nine-viewer
rendering bottleneck shared by the server in this architecture.

Simultaneous first visits still share available server/Wi-Fi bandwidth. Nine
model transfers now total 72.7 MB instead of 311.3 MB, plus scripts/artwork.
As a transfer-only example, those nine models take at least 5.8 s through a
shared 100 Mbps link, or 29.1 s through a shared 20 Mbps link. Device decode
and rendering preparation add time. Production Apache/proxy limits and
uplink capacity have not been load-tested. No production configuration was
changed; see `verification/twin-integration-20261111/loading-floor-report.md`
for evidence and the short rendering regression check.

## Selection and inspection

Single-click selects; double-click focuses, on the canvas or in the component
list. Empty clicks and drags do not trigger focus. Focus selected and the
existing Payload view button use the same inspection path.

The complete payload is one logical selection, `NerdMiner_Heltec_V2`, with
20 original CAD members. Picking a case, screw, board or LCD selects the
whole assembly; highlighting, isolation and visibility operate on all 20.
The component list has one Payload entry. Legacy member IDs remain accepted
by `select` and `setVisible`, resolving to the whole payload. All 95 physical
CAD identities, source geometry, artwork and the dedicated live LCD remain
intact. `state().selectionMembers` exposes the selected CAD member IDs.

PCB focus looks along the component-side mounting normal, stored in the
part's local frame and transformed with its current parents. This includes
the sensor on the moving lid. Battery and payload focus approach from their
outside faces, orbit around the selected bounds and use an arc transition
rather than passing straight through the assembly. Reset assembly restores
the isometric view after geometry settles.

Focus temporarily ghosts components intersecting nine sightlines to the
selected bounds at the destination. Those components remain visible, with
the user's visibility and explicit x-ray settings preserved. Ghosted clips
leave their opaque instance batch and use their own transparent material;
normal batching returns afterward. Focused picking ignores those ghosted
obstructions. Fit model, Reset View, Reset assembly or selecting another
component clears this temporary reveal. `state().focusReveal` lists it.
Occlusion is computed when focusing, not raycast every animation frame.

## Qualification

The subsequent inspection changes and current continuous-ground evidence are
in `verification/twin-integration-20261111/inspection-report.md`.

See `verification/twin-integration-20261111/README.md` for the integrated
site's measured results and limitations. A timer-driven 60-render workload
measures capacity, not native 60 Hz presentation. The design target remains
60 fps; larger viewports, other browsers and other GPUs require their own
qualification. Do not infer universal 60 fps from one machine/viewport.

The deployment helper includes the complete new dependency/asset list. It
has not been executed as part of this integration.

## Full reset and battery pack (11 November 2026)

Reset View and Reset assembly share one reset path: all physical components
and groups become visible, the lid closes, the assembly/extraction/x-ray and
isolation states clear, selection/search clear, and isometric framing runs
after the assembly settles. Quality, the telemetry subscription/source and
LCD readings/presentation remain intact. Deselecting a focused component
outside isolation smoothly translates the camera and target to the chassis
anchor and restores Y-up orbit, preserving distance and ordinary viewing
angles. A nearly vertical inspection exits five degrees away from the pole
so the next drag has a stable azimuth. In isolation the local pivot and
visibility remain; Show previous stays enabled even without selection.

The battery pack is one logical selection, `BatteryPack_4x18650`, with the
holder and all four cells. Their original physical IDs resolve to the pack
for selection and visibility. Highlight, bounds, outside focus and isolation
use the same five members; original CAD ownership and individual geometry
remain unchanged. Leaving isolation restores the exact visibility snapshot.

The previous loading/concurrency numbers above describe the pre-replacement
package. Current replacement measurements and limitations are recorded in
`verification/twin-replacements-20261111/report.md`. The design target remains
60 fps, including external monitors and the 2018 Intel MacBook Pro.

## Telemetry snapshots and payload LCD

The dashboard keeps its single shared SSE connection and forwards complete
current snapshots to the embedded viewer. The adapter now includes all six
BQ25798 power-path ADC values, MCU temperature, INA226 engineering values,
BMS pack/cell/internal temperatures, peripheral inputs and device-reported
Wi-Fi RSSI. Presence/paused/error flags still gate device readings. Missing
channels clear on the next snapshot; zero is a valid value. MPPT VBAT and
BMS PACK voltage remain separate channels, and INA226 current is labelled PV
current rather than being inferred as independent solar-panel current.

The adapter uses the shared model's stale threshold and bridge-clock-adjusted
sample time. It rejects older arrivals and does not restart the freshness
clock on forwarding, reconnects or periodic age updates. The viewer API
accepts `receivedAt` in client-clock milliseconds, `staleMs`, and
`snapshot: true` for a complete snapshot, including an empty one. Existing
flat numeric fields remain accepted. The legacy
`mppt_switch_temperature_c` field carries the decoded MPPT die temperature;
the UI labels this as die temperature, not a separate switch sensor.

The full-resolution 768 × 582 live canvas shows three readings per column:
battery/PV current/ambient temperature and light/MCU temperature/MPPT die
temperature. Relative light retains the decoded 0–1 scale. A drawn Wi-Fi
indicator uses device RSSI only while telemetry is fresh and connected;
transport alone does not establish signal strength. Stale/disconnected data
and mock mode do not illuminate its bars. Custom presentation screens and
reset behavior remain intact. All tests used explicit local synthetic data;
no hardware or production endpoint was contacted for this change.
