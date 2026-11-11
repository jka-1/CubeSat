# Integrated detailed twin renderer

Current ground/selection/focus behavior and evidence are in
[inspection-report.md](inspection-report.md).

The subsequent floor/loading/concurrency changes and current evidence are in
[loading-floor-report.md](loading-floor-report.md). The original five-minute
thermal results and `provenance.json` below describe the preceding floor.

11 November 2026. The approved pilot is integrated into the local site. No
deployment, server configuration, backend or hardware-command changes were
made. The existing layout and telemetry interfaces remain. The canonical CAD
GLB is unchanged; the approved derivative retains all 95 components and
874,229 logical triangles, original artwork dimensions and source texels.

Open the normal viewer, with no experimental parameters:

<http://127.0.0.1:8770/site/knight-eps-phase12/viewer/>

## Implementation

`viewer/main.mjs` uses the selected WebGL pipeline and prepared display package.
Studio is the first exposed quality, with device DPR capped at 2, FXAA, cached
shadows and the approved display-space acrylic approximation. Performance
retains its DPR 1, simplified acrylic and disabled-shadow behavior. The test
clock, renderer alternatives, diagnostic badges, rejected shader experiments
and test instrumentation do not ship in the site.

The selected helpers live in `viewer/rendering/`; the only new upstream shader
is the unmodified [Three.js r176 FXAA shader](https://github.com/mrdoob/three.js/blob/r176/examples/jsm/shaders/FXAAShader.js), covered by the existing vendor MIT license. No library version was changed.

The standalone `scripts/build-display-twin.py` rebuild succeeded and reproduced
the tested compact GLB hash exactly:
`302cd6162e57fb90b720c2111a0af715fbbe9dfa58f7843c16519af28cdc686b`.
It generates the prepared geometry, certificates and lossless coverage package
using the site's pinned dependencies. There is no runtime or build dependency
on `verification/`. The deployment helper's local file list includes the full
dependency set; it was syntax checked, not executed.

Maintainer details and rebuild instructions: `site/knight-eps-phase12/docs/rendering.md`.

## Sustained performance

2018 MacBook Pro, Intel Iris Plus 655, Chrome 157 / ANGLE Metal. CSS scene
955 × 720, drawing buffer 1910 × 1440, no MSAA, full-resolution FXAA. Synthetic
1 Hz SSE uses the actual display API and a local test endpoint only.

Five minutes of continuous orbit and repeated explosion/reassembly yielded
4,490 valid whole-frame GPU samples. GPU median/p95 was **8.27/13.12 ms**.
The subsequent hot phases were:

| Phase | GPU median | GPU p95 | Callback CPU p95 |
| --- | ---: | ---: | ---: |
| Orbit | 7.95 ms | 8.66 ms | 6.40 ms |
| Lid | 8.66 ms | 10.35 ms | 7.00 ms |
| Explosion | 7.95 ms | 9.89 ms | 7.20 ms |

All pass the 14 ms GPU headroom target; zero disjoint events occurred. The
workload submitted approximately 60 renders/s. GPU timing includes the depth
prepass, shadows, main drawing, regional acrylic capture and final FXAA.
CPU and GPU overlap; their times must not simply be added.

**Native 60 Hz presentation remains unqualified.** Read-only macOS display
enumeration still reports 3840 × 2160, scaled 1920 × 1080 at 30 Hz. No settings
were changed. The test clock is injected only by the local CDP harness; shipped
code uses requestAnimationFrame. Timer render-start p95 was 18.6–18.9 ms,
which does not pass the original 17.667 ms pacing gate. The 60 fps product
target is unchanged. Larger viewports, other browsers and other hardware are
not performance-qualified by these data. Mobile was checked for layout and
functionality on this GPU, not as a measurement of phone hardware.

An integration check exposed a pre-existing shader-cache invalidation bug:
changing `shadowMap.enabled` did not refresh every material program. Some
surfaces therefore retained the Performance program after selecting Studio.
The pipeline now tracks shadow mode per material, including cached overrides
when they become active. Receiving-shadow shaders are correct from the first
Studio frame and across quality and depth transitions. The earlier partial-
shadow timing results are retained under `production-before-shadow-cache-fix-*`
and are superseded by the final fully shadowed result.


## Startup and behavior

Compile/link prewarming alone left a first forced interior callback at
31.7–41.2 ms despite zero new shader programs. Drawing both guarded depth/side
variants during loading initializes lazy driver bindings. The final first
selection callback measured **7.6 ms CPU** and the first forced interior
callback **12.9 ms**, with zero new programs in either transition. This is a
bounded check, not a guarantee for every possible camera/material transition.

This shifts work into loading: the final qualification recorded about 448 ms
CPU across initial buffer preparation/draws, before exposing the assembly.
Earlier first-observed precompilation took 6.7 s; the final repeat recorded 1.10 s
with the existing driver cache. Network caching was disabled;
the driver shader cache was not controlled. No cold-network loading guarantee
is claimed. `ready` waits for initialization; `readyForImage` is submission
plus the next tick, not a GPU completion timestamp.

Twenty-six focused tests pass, including unchanged model, rendering and
telemetry regressions; independent expanded attribute hashes; every audited
coverage byte and source image dimension; and conservative depth, culling,
shadow, capture and occluder checks. See `results/focused-tests.txt`.

Browser checks cover selection/picking, visibility, synthetic LCD updates and
presentation, X-ray and quality switching; unsafe-depth and actual solid
interior fallbacks/restoration; full-resolution FXAA resizing; idempotent
disposal with stopped rendering and zero tracked resources; and reload with
95 parts/874,229 triangles. Leaving during asset loading also ends with zero
parts, no loaded model and disconnected transport. The mobile panel opens and
closes without horizontal overflow at 390 × 844 CSS pixels / DPR 2.

The final R8 encoding is compared against the browser's original RGBA fallback
with the corrected, fully shadowed pipeline. Across seven matched captures,
54 pixels exceed 8/255; the largest difference is 24/255, and mean per-channel
differences range from 0.00016 to 0.025/255. These isolated filtered-edge
changes are recorded in `results/visual-comparison.json`; exact pixel
identity to RGBA filtering is not claimed. Every source texel and artwork
dimension is still verified independently. The fallback itself passed the
browser checks with zero coverage overrides, while normal loading used all
15 coverage images. Linear coverage metadata is restored after GLTF parsing;
there are no sRGB-format warnings in the final run. Coverage delivery accepts
either the gzip file or HTTP-decoded bytes and rejects truncation.

The former pilot's initially unshadowed chassis is not a fidelity reference
for the fixed receiving-shadow behavior. Camera/depth restoration is checked
against the same corrected Studio view and actual GPU uniform/program state.
The CAD region restores within 1/255 per channel after a forced interior/depth
transition.
The final binding warmup uses temporary materials and restores original
material identities; cached receiving-shadow state remains consistent.

## Review and reproduction

`results/performance-summary.json`, `results/production-qualify.json`,
`results/production-early-dispose.json`, `results/production-mobile.json` and
the matched PNGs retain the evidence. `provenance.json` records the final
production file hashes. Baseline controller/HTML snapshots preserve the
pre-integration working tree for review. Earlier production changes were
preserved; no canonical CAD, manifest, website CSS or telemetry source was
changed in this integration.

Run focused checks after a relevant change:

```sh
node --test tests/twin/render-optimizations.test.mjs tests/twin/models.test.mjs tests/twin/telemetry-integration.test.mjs tests/twin/render-pipeline.test.mjs tests/twin/display-assets.test.mjs
```

The local browser driver uses the dedicated temporary Chrome profile on CDP
port 9227 and the local server on 8770. It injects timing only into the normal
site module, without changing its draw path. Repeat the sustained assay only
after a material rendering change or a specific unresolved failure.
