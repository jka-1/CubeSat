# Local power-board replacements and interaction fixes

11 November 2026. Implemented locally. Nothing deployed; production
configuration, backend, SSE protocol, hardware commands and security untouched.
Existing unrelated dirty/untracked work is preserved. No subagents used.

Reset View and Reset assembly now share the existing full reset path. The
reset restores all 95 physical parts and groups, closed/assembled geometry,
isometric framing and the stable chassis anchor; it clears selection,
search, isolation, temporary ghosts, x-ray, extraction and visibility overrides.
Controls and checkboxes agree. Quality, the active telemetry subscription,
source, readings and LCD presentation remain intact. A pending named fit still
waits for animation settlement.

Deselecting a focused component outside isolation smoothly returns the orbit
target to the chassis, retaining camera angle and distance. Inside isolation,
the local pivot/visibility remain and Show previous stays enabled after
deselection. Canvas/list single-click selection and double-click focus remain.

The battery issue was reproduced before modification using the actual list
selection and isolation buttons: selecting BatteryCell_01 left only that
cell. All five battery physical IDs now resolve to the logical
BatteryPack_4x18650 selection. Holder and four cells share highlighting,
visibility, bounds, outside focus and isolation, with exact previous visibility
restored afterward. Physical mesh IDs, parents and geometry remain unchanged.
Individual cell inspection is not a separate explorer entry; legacy cell IDs
remain accepted as complete-pack aliases. Payload grouping is retained.

## Models and lossless preparation

Both supplied exports are retained in `model-sources/power-boards/`.
`source-provenance.json` records their original absolute paths and hashes.
The source README documents identity evidence, units, coordinate datums and
support faces. Both sources omit NORMAL attributes; their original indexed
topology generates those absent normals. Provided normals are preserved if
present; scene transforms are traversed correctly. Every supplied position,
UV, index, triangle, material and embedded image is checked independently.

| Model | Source triangles | Source meshes/draws | Batched material draws |
| --- | ---: | ---: | ---: |
| MPPT / Charger_BMS034A_EVM | 117,816 | 475 | 34 |
| BMS / BMS_BQ76942 | 32,036 | 178 | 23 |

Independent staged comparison proves all 95 component anchor transforms are
unchanged and the other 93 components retain byte-identical geometry and
materials. New substrates reproduce the prior support datums/connector
orientation at uniform millimeter-to-meter scale. No fixtures move for this
pair; earlier regulator corrections remain. Physical fit remains illustrative.

Triangle accounting: 874,229 − 121,190 − 31,760 + 117,816 + 32,036 =
**871,131** logical triangles, with the same **95** physical components.
The difference comes from the supplied exports; no geometry was decimated.

Canonical SHA-256:
`f1ed146e43c7dd3291beed9599d9a4f42f3e54b726dde8600ad978be8ad649c4`.
The compiler/loader source pins, counts, certificates, artwork metadata,
vertex-equivalence proof and provenance were rebuilt together. Exact
attribute deduplication reduces prepared vertices 1,097,485 → 900,713.
Four new multicolor images retain original PNG bytes/full-size RGBA on both
browser paths. The 15 existing two-color images still roundtrip exactly
through their R8 coverage representation. No downsampling or quantization.

Recoverable baseline: `baseline-assets.tgz`; staged candidate and audit are
retained alongside it. `main-before.mjs` records the previously dirty viewer
before this session's changes. Rebuild instructions are in the source README.

## Bounded checks

- 33 focused tests covered inspection, render consolidation/fixtures, models,
  telemetry integration, rendering and display assets. The initial run passed
  32/33; the old compression percentage was obsolete for the added RGBA PNGs.
  Its replacement pins the exact 10,222,122-byte gzip and limits size to the
  prior package plus the independently measured new PNG payloads. All nine
  affected asset/model tests subsequently passed; the other 24 tests passed
  unchanged. Logs: `focused-tests.txt`, `asset-tests.txt`.
- 35 passing browser assertions across the bounded acceptance batch/remainder:
  full reset from open lid/exploded/hidden/x-ray/isolation states; same open
  loopback synthetic EventSource (one created, zero closed); preserved LCD
  content/readings/source/quality; PCB/payload/battery deselection in/out of
  isolation; all pack members/highlights/aliases and exact visibility restore;
  payload regressions; PCB head-on picking, moving-lid focus and telemetry
  fields; mobile overflow. No real hardware packet was fabricated or used.
- Top/bottom/oblique replacement screenshots and desktop/mobile views reviewed.
  Original artwork, colors, populated geometry, connectors and layout remain.
- Renderer qualification passed bounded/log-depth and interior/culling
  restoration, Studio/Performance shadow invalidation and FXAA resizing,
  disposal with zero owned resources, and reload with the new triangle count.
- Older-browser control disabled DecompressionStream: the uncompressed GLB
  retained all original RGBA images and both replacement boards remained
  selectable/focusable. No browser exceptions or console errors.
- Syntax and diff whitespace checks passed; mechanical UI detector returned
  no findings. Deployment helper already lists all required runtime assets;
  no additional dependency or deployment action was needed.

The first fixed empty-canvas probe hit the chassis; subsequent probes confirm
an empty ray before dispatching native clicks. A fixed first Performance lid
delay was insufficient; bounded waits for actual animation settlement passed.
These harness issues are retained in the acceptance summary rather than hidden.

## Performance

| Measure | Previous package | Replacement package |
| --- | ---: | ---: |
| Decoded display GLB | 34,590,388 B | 35,884,332 B |
| Lossless gzip transfer | 8,075,595 B | 10,222,122 B |
| Navigation → ready, simulated 20 Mbps / 40 ms | 6.77 s | 7.97 s |
| Model download | 3.92 s | 4.59 s |
| 10-second orbit GPU median | 8.01 ms | 7.95 ms |
| 10-second orbit GPU p95 | 8.52 ms | 8.96 ms |
| Rendered draws in that workload | 296 | 327 |

The new full-color artwork adds 2,352,196 bytes of PNG data; gzip grows
2,146,527 bytes (26.6%). Decoding took 152 ms, SHA verification 130 ms,
GLTF parsing 221 ms and shader warmup 835 ms in the throttled loading run.
Navigation includes scripts and readiness work beyond these isolated stages.
GPU tests used Iris Plus 655, a 1910 × 1440 drawing buffer, full Studio DPR 2,
FXAA, shadows and acrylic. There were 150 valid GPU queries, zero disjoint
queries and no new programs during the orbit; callback CPU p95 was 6.0 ms.

The extra material/RGBA draw workload raises GPU p95 by 0.44 ms (5.1%), still
inside the existing 14 ms headroom gate. Fidelity-preserving batching removes
596 source draws from the new pair; exact vertex deduplication and lossless
gzip remain. Both replacement geometry and imagery stay at supplied fidelity.
This short timer-driven capacity check does not prove native 60 Hz presentation,
external-monitor performance or thermal stability. **60 fps remains the target.**
No broad thermal, server-load or production benchmark was repeated.

Evidence: `../twin-integration-20261111/results/replacement-production-*.json`,
`replacement-*.png`, and `loading-power-boards.json`/`.png`.
`acceptance-summary.json` collects passing assertions. Prior evidence files are
preserved. `normal-preview.json` records the final ordinary viewer, left open
without test instrumentation, test clock or a telemetry connection.

## Files changed in this session

- `viewer/main.mjs`, `viewer/inspection.mjs`, viewer entry-point cache version.
- `scripts/build-detailed-twin.mjs`, `scripts/twin-display/compile-display.mjs`,
  `scripts/twin-display/build-artwork.py`, loader canonical hash pin.
- Canonical GLB, full display package, component manifest and upgrade report.
- Focused model/inspection/display tests and the existing browser verification
  count/driver/loading probe; new local evidence and source provenance.
- Rendering documentation and retained supplied source models/README.

No unavailable model inputs remain. No production changes or deployment.
