# Digital twin rendering study — 9 November 2026

The main opportunity is to remove repeated rendering work while retaining the detailed CAD, lighting and environment reflections. The present Studio preset increases several independent costs together. Its slowdown is reproducible in the available browser.

This study adds local profiling fixtures and evidence only. The shipped viewer, model, telemetry integration and production configuration were not modified. No deployment or hardware connection was performed.

## Measured behavior

Browser: Chromium 155 in the Codex in-app browser on macOS; WebGL reports Intel Iris Plus Graphics 655 through ANGLE Metal. The scene viewport is 947 × 720 CSS pixels, native device pixel ratio 2. The scene has 333 mesh instances including the shadow floor, 260 distinct geometries, 333 material objects and 95 selectable component roots.

Each case uses 45 warmup frames and 120 measured frames. Camera-motion cases use OrbitControls auto-rotation from a common camera pose. Frame intervals are requestAnimationFrame intervals; CPU frame time covers the application's animation callback and renderer submission, including any driver stalls. GPU queries measure rendering with EXT_disjoint_timer_query_webgl2, sampled every fourth frame; unavailable/disjoint results are discarded. Counters reset **before** renderer.render so they include shadow work. No gl.finish or synchronous GPU completion was introduced.

| Configuration while orbiting | Buffer DPR | Median interval | p95 interval | Draw calls/frame | Triangles submitted/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Performance | 1 | 17.6 ms | 50.2 ms | 347 | 877,691 |
| Studio, current preset | 2 | 83.0 ms | 99.8 ms | 985 | 2,622,665 |
| Studio, main buffer DPR 1 | 1 | 66.4 ms | 67.4 ms | 985 | 2,622,665 |
| Studio, DPR 1, cached shadows | 1 | 49.8 ms | 51.0 ms | 667 | 1,751,896 |
| Studio, DPR 1, cached shadows, half-size refraction buffer | 1 | 33.4 ms | 49.2 ms | 667 | 1,751,896 |
| Studio, DPR 1, shadows disabled — diagnostic | 1 | 33.6 ms | 50.4 ms | 667 | 1,751,896 |
| Studio, DPR 1, transmission disabled — diagnostic | 1 | 33.4 ms | 34.3 ms | 665 | 1,748,460 |
| Performance, part updates skipped — diagnostic | 1 | 17.6 ms | 34.3 ms | 347 | 877,691 |
| Performance, repeated at end | 1 | 17.7 ms | 49.9 ms | 347 | 877,691 |

The improved Studio experiment retains every model triangle, environment reflections, lights, acrylic transmission and shadow appearance for a stationary assembly. Its main image and refraction sampling are lower than the current DPR-2 Studio preset. This is a demonstrated sampling tradeoff, **not** proof of identical image quality or 60 fps. A 60 Hz frame budget is 16.7 ms; even the improved Studio case exceeds it.

Results are short sequential diagnostic runs, not randomized benchmarks or guarantees for another device. GPU query medians varied substantially even between repeated Performance cases (7.1 versus 19.4 ms), and frame p95 remains poor. Power state, thermal state, browser scheduling, driver behavior and camera-dependent overdraw were not controlled. Prefer the invariant pass counts and broad frame-time differences to precise speedup ratios. CPU/GPU times overlap and must not be added to estimate a frame interval. The profiler itself adds instrumentation overhead.

## Findings in priority order

### P1 — Studio rerenders almost the entire assembly three times

Locations: `site/knight-eps-phase12/viewer/main.mjs:35–36,133,170`; vendored Three.js `three.module.js:16221–16227,16464–16580`.

The original model contains 874,229 triangles across its instances. The full Studio frame submits 2.62 million triangles: shadow rendering, an offscreen opaque-scene render for transmission, and the visible image, with additional handling for double-sided transparency. The 985 draw calls are about 2.84 times Performance's 347. Lights and environment-map reflections already work in Performance; the environment texture is generated once during initialization, rather than rerendering six reflection views every frame.

**Recommendation:** retain the existing lighting and reflections. Cache the directional-light shadow map while only the camera moves. Invalidate it when geometry, visibility, relevant material shadow properties, or lights change, including throughout lid/explode animation. Expose transmission-buffer sampling separately from output resolution. Half-size transmission means one quarter of that target's pixels; it does not remove the duplicated geometry submission. Treat removing transmission as a diagnostic, not the intended final appearance. Three.js documents these [shadow controls and transmission-resolution controls](https://threejs.org/docs/pages/WebGLRenderer).

### P1 — Studio automatically quadruples main-image pixel count on this display

Locations: `main.mjs:30,170,173–182`.

Performance caps DPR at 1. Studio raises it to 2, changing 947 × 720 pixels into 1894 × 1440 pixels. The transmission pass also uses the active viewport at full scale by default. This increases pixel work at the same moment shadows and refraction are enabled, making one quality selector conceal several causes.

**Recommendation:** separate main-image resolution, transmission resolution and shadow refresh policy internally. Establish a measured frame-time budget before selecting defaults. A sharp final image after interaction is compatible with an on-demand renderer. Dynamic sampling during motion is an optional tradeoff to validate visually; it should not silently remove CAD detail or materials.

### P1 — A stationary viewer keeps submitting complete frames

Locations: `main.mjs:186–193`; `display.mjs:26,63`.

The recursive requestAnimationFrame loop never sleeps while the iframe exists. Every frame updates controls, lid pivots and component positions, forces scene matrix updates and renders the assembly, including when the camera, geometry and telemetry are unchanged. The idle case submitted 347 draw calls and 877,691 triangles every rendered frame. This consumes GPU time and power before the user starts dragging and can contribute to sustained thermal pressure; thermal impact was not measured here.

**Recommendation:** schedule frames on camera input, damping, active animations, resize, model/texture loading, visibility/material changes and LCD updates. Continue only until damping and animation settle. Keep the display's age/staleness clock correct and let an actual display change invalidate the scene. Suspend visual work when the document is hidden. Three.js provides an [on-demand rendering guide](https://threejs.org/manual/pages/rendering-on-demand.html).

The part-update code itself measured approximately 0.2–0.3 ms median. Skipping it did not materially change median orbit frame interval. It is useful cleanup, but the evidence does not support blaming it as the primary interaction bottleneck. Telemetry was disconnected in these runs, so it cannot explain the reproduced Studio slowdown; loaded live-stream performance remains unmeasured.

### P2 — Material and draw submission remain fragmented

Locations: `scripts/build-detailed-twin.mjs:66–75`; `main.mjs:95–100,133`.

The asset has 155 material definitions but only 97 distinct definitions after excluding names/extras. It contains 332 mesh instances using 259 unique meshes; the viewer then clones a separate material for every render mesh. 139 of the 155 material definitions are double-sided. Some of this is necessary for CAD sheets, selection and translucency; it should not be removed indiscriminately.

The compiler already batches each PCB by source material ID and shares regulator geometry. It does not combine equivalent source material definitions or instance all repeated fixtures. Selecting a component traverses all meshes, restores their material settings and marks every material needsUpdate, including unchanged opaque parts. That creates unnecessary shader-program validation; a shader recompilation or click-time stall was not directly measured.

**Recommendation:** canonicalize equivalent material definitions, merge compatible opaque geometry within each independently selectable/animated component, instance repeated fixtures where IDs and selection can be preserved, and change only the previous/new selection materials. Share immutable materials where possible and clone only for an actual override. Reserve needsUpdate for shader-affecting changes. Retain UVs, artwork, transforms, selection ownership, visibility and explosion behavior. Simple deduplication alone does not guarantee fewer draw calls; compatible geometry must also be batched or instanced.

### P2 — Existing diagnostics hide the extra shadow pass and frame-time distribution

Locations: `main.mjs:144`; `tests/twin/verify.mjs`, final frame-timing check; Three.js `three.module.js:16221–16227`.

The public performance API returns renderer.info.render after Three.js has automatically reset its counters **following** the shadow pass. The old 347-draw Performance observation is valid for that preset, but the same mechanism understates total Studio work. The regression harness records 60 animation intervals in the default preset without a sustained orbit, Studio comparison, GPU queries or a performance assertion. Passing functional tests therefore does not establish smooth rendering.

**Recommendation:** reset counters at a controlled frame boundary and track all passes, main/refraction pixel counts, CPU submission, GPU timing when available, median/p95 frame intervals, idle render count and load/first-interaction latency. Benchmark assembled, open, exploded and focused states separately, on target hardware.

### P2, investigate — Global logarithmic depth has a documented cost; this run is inconclusive

Locations: `main.mjs:12–14`; `framing.mjs:14`; vendored `three.module.js:404`.

The renderer enables logarithmicDepthBuffer to preserve very thin PCB layer ordering. Its shader writes gl_FragDepth. Three.js documents that this disables early fragment testing and can hurt performance in overlapping geometry. However, the isolated standard-depth run was inconsistent: Performance intervals ranged from 33.0 to 17.3 ms between repeats, and the improved Studio case was essentially unchanged at 33.3 ms. This study does **not** establish a reliable speedup from disabling logarithmic depth.

**Recommendation:** keep it until correctness and repeatable benefit are demonstrated. Investigate tighter camera near/far planes or supported reverse depth using the **vendored r176 API**, with PCB artwork, microscopic layer separation, extreme zoom, transparency and camera presets visually verified. Do not simply disable it based on generic advice. See the [renderer depth-buffer documentation](https://threejs.org/docs/pages/WebGLRenderer).

### P2 — Model transfer is a separate startup cost

The detailed GLB is 37,548,864 bytes; only 904,066 bytes are encoded image payload. The rest is predominantly geometry and metadata. No Draco or meshopt geometry-compression extension is used. The model's MCU board alone has 337,084 triangles. These facts matter for download, parse/upload latency and memory, but a 37.5 MB download does not itself explain slow steady-state orbiting.

**Recommendation:** measure cold model download, parse, shader compilation and GPU upload separately; then evaluate lossless geometry transport/compression and staged first-frame preparation. Preserve the source model and integrity checks. Do not begin by decimating detailed boards. Compression or loading changes were not benchmarked here.

## Comparison with Fusion and other CAD viewers

The expectation of smooth, detailed rendering is reasonable. This assembly is under one million source triangles, but the current rendering policy turns that into repeated geometry and pixel work. Autodesk explicitly documents mesh consolidation and hardware instancing in its web viewer as ways to improve CAD rendering while retaining model content: [Autodesk model consolidation](https://aps.autodesk.com/blog/forge-viewer-consolidated-geometry). That is evidence for the optimization approach, not a claim that Fusion's internal renderer is identical or that Fusion was benchmarked here.

A good sequence is: correct performance instrumentation; cache stationary shadows and stop idle drawing; batch equivalent material/geometry work; tune refraction sampling independently; then evaluate depth and startup optimization with visual regression checks. Full model detail and environment reflections should be acceptance criteria throughout. The experiments show substantial headroom, but do not yet establish full-Studio 60 fps on this GPU.

## Evidence, reproduction and validation

- `logarithmic.json`: the full ten-case baseline, with CPU/frame intervals rounded to 0.1 ms when transcribed from visible browser output; GPU values retain reported precision.
- `standard.json`: the shorter standard-depth diagnostic, saved directly by the fixture.
- `asset-analysis.json`: GLB counts, material equivalence groups, alpha modes, transmission and image payload.
- `profile_server.py`, `profile.mjs`: local-only instrumentation. The server injects probes into served responses; it does not rewrite viewer source. Hardware/telemetry routes return 503. The Save local measurements button writes only a named JSON result in this evidence directory.

```sh
python3 verification/twin-performance-20261109/profile_server.py
```

Open `http://127.0.0.1:8767/site/knight-eps-phase12/viewer/` and wait for “Twin performance complete”. For the depth diagnostic, append `?depth=standard&suite=depth`. Choose “Save local measurements” to record a completed run. Compare matching cases, and repeat under controlled power/thermal conditions before treating small differences as meaningful.

Validation: instrumented JavaScript passed `node --check`; the four model-integrity and six Twin telemetry integration tests passed. The application has no tracked source diff. Source SHA-256 at inspection:

```text
5be3b99ef6196588c4235c6a1762555e6fd86a471ffa90f839c987b05c089c18  viewer/main.mjs
42dc5f52b5aee32c7cfb13c306e4b68d6bb9b94a34c668f1125b82b830e30ffb  viewer/framing.mjs
dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47  models/KnightEPS_Detailed.glb
```

Remaining measurements: controlled hardware/power-state repetitions, live-stream load, cold-start and first-interaction latency, click picking/selection, lid/explode/focus p95 behavior, and visual correctness of proposed optimizations. No AGENTS.md rule update is needed for this study. The existing optional Impeccable build-path preference remains unset; it is unrelated to this performance investigation.
