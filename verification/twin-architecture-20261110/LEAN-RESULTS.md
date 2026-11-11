# Lean renderer pilot: result and decision

**Latest follow-up:** [PUSH-RESULTS.md](PUSH-RESULTS.md) records subsequent culling, vertex compaction, regional capture and depth-prepass work. Four-sample MSAA passed a short workload but failed sustained GPU headroom; a full-resolution FXAA alternative is evaluated separately. Actual 60 Hz presentation remains unqualified. The findings below preserve the earlier pilot.

10 November 2026. Follow-up to `RESULTS.md`, authorized by “go ahead.” All new implementation remains under `prototype/`; production controller, display, rendering helpers and source GLB hashes still match `prototype/provenance.json`. Website layout, telemetry boundary and all 95 component identities / 874,229 logical triangles remain.

**A substantially cheaper rendering path is feasible on this Mac, but the complete 60 fps goal has not passed. Keep the hybrid prototype for review; do not authorize an entire engine rewrite or production adoption from these results.**

The target remains 60 fps on older hardware, including this 2018 MacBook Pro, and for other site users. The external monitor’s 30 Hz mode is strictly a measurement constraint. It is never the product’s design reference or an acceptable substitute for the target.

## The selected candidate

Open locally:

<http://127.0.0.1:8770/verification/twin-architecture-20261110/prototype/?renderer=legacy&asset=packed&appearance=lean-acrylic&depth=bounded>

The red diagnostic label identifies an **appearance alternative**, not approved Studio equivalence. The prototype reuses pinned Three.js r176 WebGL and the existing interface/controller rather than replacing the framework.

- **Full-resolution R8 artwork on the legacy renderer.** All fifteen source artwork images remain at their original dimensions. A small PBR shader adapter reconstructs their two-color pixels and preserves material cloning for selection/X-ray overrides. Seven matched legacy-renderer crops differ from the original RGBA encoding by at most 2/255 per channel. Estimated active material storage remains 166.88 MiB versus 660.69 MiB; these are calculated texture allocations, not measured total GPU residency.
- **Guarded depth ranges.** Fit clipping to visible CAD, accounting for transformed meshes and fixture instances. Ordinary fixed-point depth is used only when the conservative quantization bound resolves the source’s approximately 65 micrometre artwork separation with more than eight depth steps. Otherwise retain logarithmic depth. Main-view shader variants switch together; the existing orthographic shadow path remains unchanged. This does not require `EXT_clip_control`.
- **One resolved-color capture for acrylic.** Opaque geometry is shaded once into the existing four-sample canvas. A full-size RGBA8 copy feeds a small screen-space blur, tinted transmission and the original acrylic surface’s PBR reflections. This replaces the extra HDR transmission target, mip chain and opaque replay. The copy is 1910 × 1440, roughly 10.49 MiB, with no mipmaps. There is no geometry LOD, downsampling, AA reduction or disabled shadowing.

The acrylic is a deliberate approximation: display-space composition/blur, highlight response and overlapping panes can differ from physical HDR transmission. It must be judged visually. The geometry, LCD and artwork remain independent of that decision.

## Measurements

Same Iris Plus 655, native Chrome 157 / ANGLE Metal, 955 × 720 CSS CAD viewport, **1910 × 1440 drawing buffer and four samples**. Five-second warmup; 30-second orbit, 15-second lid and 15-second explosion phases, with a 1 Hz synthetic SSE source through the actual display path. Sparse asynchronous whole-frame GPU queries; no per-pass nested queries or forced GPU synchronization.

| Phase | Median GPU | p95 GPU | Sparse samples |
| --- | ---: | ---: | ---: |
| Orbit | 12.08 ms | 13.14 ms | 225 |
| Lid | 14.14 ms | 16.79 ms | 113 |
| Explosion | 12.72 ms | 19.81 ms | 113 |

The earlier full Studio WebGL control needed roughly 46.8 ms median for orbit. The candidate is a major improvement, but its acrylic and depth strategy differ. Animation tails exceed the 16.67 ms total frame budget and the plan’s 14 ms GPU headroom target. **Do not call this a sustained 60 fps result.** Recorded frame starts remain about 33.3 ms on the 30 Hz display; GPU times remain independently useful. Running the GPU at 60 renders/s, sustained thermal behavior and actual 60 Hz presentation remain unqualified. CPU submission fields in the complete run exclude depth-guard preparation; instrumentation now includes it for future runs. They are not used to establish a CPU acceptance claim.

No five-minute acceptance test was run because the complete animation gate failed. Avoid spending more on a broad test matrix before resolving the failed requirement.

## Why the other branches were rejected

Disabling physical transmission alone gave 22.54 / 25.50 ms median/p95 GPU with opaque PBR and logarithmic depth. Reversed depth reduced that diagnostic to 10.48 / 11.57 ms, identifying the depth/shading path as a useful lead. Full original physical transmission with reversed depth still needed 34.87 / 39.75 ms. The first reversed-depth acrylic candidate reached 12.26 / 12.60 ms in a short orbit but **failed visual comparison because shadow lighting changed**. Its speed is not an acceptance result; the selected candidate uses normal depth with guarded logarithmic fallback.

An orthographic-shadow shader experiment also removes the otherwise unchanged `gl_FragDepth` write during directional shadow rendering. It is optional (`shadow=ortho`) and **not selected for review/adoption**. The first run had a GLSL integer/float error and is explicitly saved as `INVALID-ortho-shadow-shader-animation.json`. After correction, another animation run completed its interactions but the harness rejected a replayed console error from the previous page: that error’s timestamp precedes the second run by 65 seconds. The replay handling is now fixed; raw statuses are preserved. Its exploratory GPU tails still provide no clear case for the added shader complexity. No performance or fidelity acceptance rests on it.

## Visual and functional checks

Seventeen focused automated tests pass: the twelve prior geometry/material/telemetry checks plus five checks covering depth precision and unsafe ranges, material cloning, acrylic surface parameters, conditional depth hooks and orthographic-shadow state. Source/derivative geometry tests compare every indexed position, normal and UV against approved consolidation; source assets remain unchanged.

The selected candidate passes six browser checks for component integrity, picking ownership, visibility, LCD synthetic telemetry/presentation and quality/X-ray switching. All seven matched view ranges are certified by its conservative depth guard. A separate browser check forces an inside-assembly view, confirms **logarithmic fallback with zero bounded-depth materials**, restores the original view and confirms bounded depth returns. It also verifies idempotent disposal, no subsequent rendering, zero owned-resource entries and a successful reload with 95 components / 874,229 triangles. No renderer exception or console error occurs in that qualification run.

Seven matched image pairs preserve detailed artwork. Relative to the original, the selected candidate changes more than 8/255 in approximately 0.04–0.55% of isolated board-view pixels, 1.79% of assembled-view pixels and 5.27% of the acrylic close-up. These include depth/rasterization edge changes and the explicitly changed acrylic effect; **they are not image equivalence**. The diagnostic overlay’s exact rectangle is excluded transparently in numerical comparison. Full screenshots retain the label. See `prototype/results/lean-bounded-visual-comparison.json` and `lean-summary.json`.

Limitations: seven views do not establish every angle, zoom or browser. First visits to another depth/material variant may compile shaders; transitions need prewarming before production. The fallback preserves depth but its worst-case frame time is not qualified. The guard certifies CAD layer spacing, not all possible near-coplanar geometry or arbitrary future assets. Review ground-shadow clipping and pane overlaps when extending this prototype.

## Display observation

CoreGraphics reports an available 60 Hz mode with the same 1920 × 1080 logical / 3840 × 2160 pixel dimensions. A temporary switch was attempted and returned `CGError 1000`; the display remained at 30 Hz. No successful settings change occurred. The error does not identify the cable, monitor or macOS permission cause. Evidence: `prototype/results/display-mode-check.json`.

## Next investment

Review whether the acrylic appearance is acceptable before developing it further. If it is, keep the prepared geometry, R8 encoding and guarded WebGL core; focus on moving-geometry/shadow cost and shader prewarming. Qualify the fallback and then test on a real 60 Hz display at a sustained 60 renders/s, followed by representative other clients. If equivalent physical transmission is mandatory, this candidate does not satisfy that contract; the measured full-physical path still fails and needs a different render-target design.

This is evidence against another general-purpose engine migration as the next step. It is evidence for a focused rendering-core redesign, not proof that every remaining problem is solved or that a complete website rebuild is required.

## Reproduce narrowly

From repository root, while the local server and dedicated CDP browser are running:

```sh
node verification/twin-architecture-20261110/prototype/test-browser.mjs measure legacy packed lean-acrylic bounded
node verification/twin-architecture-20261110/prototype/test-browser.mjs qualify legacy packed lean-acrylic bounded
python3 verification/twin-architecture-20261110/prototype/analyze-lean.py
node --test tests/twin/render-optimizations.test.mjs tests/twin/telemetry-integration.test.mjs verification/twin-architecture-20261110/prototype/architecture.test.mjs verification/twin-architecture-20261110/prototype/lean-renderer.test.mjs
```

Do not repeat these without a changed implementation or unresolved verification question. New implementation: `legacy-coverage.mjs`, `lean-acrylic.mjs`, `depth-guard.mjs`; optional experiment: `orthographic-shadow.mjs`. Source mechanisms are pinned r176 `ShaderLib`, `WebGLRenderer.renderTransmissionPass`, `WebGLShadowMap` and depth chunks in `prototype/vendor/three-r176/`; no upstream renderer files or dependency versions were edited. Research references remain in `PLAN.md`.
