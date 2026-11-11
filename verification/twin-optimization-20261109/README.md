# Knight EPS full-resolution rendering optimization — 9 November 2026

Implemented locally after approval. No deployment, production configuration change, dependency upgrade, hardware connection, model decimation or asset rewrite. Studio keeps output DPR up to 2, full-size refraction sampling (scale 1), logarithmic depth, the original lighting/environment, refractive acrylic and soft shadows. Performance remains available. No adaptive sampling was implemented.

## Changes

- `viewer/main.mjs`: schedule frames on demand; continue camera damping, camera transitions, lid and explosion animation; invalidate on loading, resizing, visibility/material changes and LCD updates. Cancel scheduled frames while the document is hidden and resume with current display state. Cache shadows while geometry is stationary; refresh for geometry/visibility/shadow-relevant material changes and directional-light/shadow-camera changes. Reset render counters before the complete render so shadows are included.
- `viewer/display.mjs`: retain telemetry/status clocks, but upload/redraw the LCD only when its visible content changes. Notify the viewer when display contents or binding change. A received packet's visible age legitimately causes approximately one update per second; disconnected/no-packet idle needs no frames.
- `viewer/render-optimizations.mjs`: share equivalent materials using appearance plus texture identity; consolidate compatible opaque geometry within independent components; instance repeated PCB fixtures. Preserve original bounds points for unchanged framing. Original fixture meshes remain on a camera-excluded picking layer, retaining precise owners, bounds, IDs and transforms; selected fixtures render separately for their highlight.
- Material overrides are cached and assigned only when their state changes. Selection visits the previous/new components. Reset and quality/X-ray changes reconcile affected appearances without blanket material cloning or material `needsUpdate` writes.
- Payload **body**: 91 meshes become **one mesh with five material groups**. Its acrylic case, fixtures and dedicated live LCD retain their established independent identities within the payload assembly. Material groups still require separate draws; one mesh does not mean one draw.
- The 52 repeated PCB fixtures become two instance batches. All 95 logical component roots remain. Visible scene material objects at initial Studio inspection decrease from 333 to 98; equivalent base appearances number 97.

## Focused measurement

Fresh matching baseline and optimized runs in Chromium 155, macOS, ANGLE Metal / Intel Iris Plus Graphics 655. Scene viewport **955 × 720 CSS pixels**, Studio buffer **1910 × 1440**, DPR **2**, refraction scale **1** throughout. Performance uses DPR 1. Same fixture, starting pose, OrbitControls auto-rotation speed 2, animation controls and sampling settings. The viewport differs slightly from the previous study but matches between these two runs.

Orbit uses 750 ms warmup then a 3 s measurement; lid/explosion each use a 1.8 s observation starting at the control action. Performance orbit uses 500 ms warmup then 2 s. Timing samples are rendered RAF intervals, not idle browser callbacks. Baseline/optimized measured Studio orbit samples number 42/46 intervals; animation cases have 26–30 optimized intervals. These short sequential samples establish work reduction and the remaining gap; they do not establish sustained 60 fps or controlled thermal/power-state equivalence.

| Case | Before median / p95 | After median / p95 | Before → after total draws/frame |
| --- | ---: | ---: | ---: |
| Studio orbit, full resolution | 66.8 / 83.6 ms | 65.9 / 82.3 ms | 985 → 395 |
| Studio lid open, full resolution | 66.3 / 67.6 ms | 57.7 / 85.6 ms | 985 → 577 median |
| Studio explosion, full resolution | 66.6 / 67.7 ms | 53.3 / 69.1 ms | 985 → 577 median |
| Performance orbit | 16.7 / 17.4 ms | 16.7 / 17.5 ms | 347 → 211 |

Orbit draw submissions decrease **59.9%** and median CPU callback/submission time decreases **22.5 → 9.0 ms (60%)**. The frame interval improvement in orbit is small and should not be treated as a reliable speedup. Animation medians improve, while lid p95 worsens. Median GPU query time for Studio orbit remains approximately **51 ms**; queries sample every fourth frame and have relatively few samples. CPU and GPU times overlap and must not be added.

All rendering work is counted: baseline Studio refreshes shadows every frame, in addition to refraction and the main image. Optimized orbit has **two scene passes and zero shadow refreshes during the observation**; lid/explosion have three passes while geometry moves and two when only the fitting camera moves. Double-sided transparency submissions are included in draw/triangle totals. Orbit triangles decrease **2,622,665 → 1,751,896** by skipping the shadow pass, while geometry-animation frames still submit **2,622,665**. The original logical model remains **874,229 triangles**.

A 2.2 s no-packet idle observation drops from **33 rendered frames to 0**. This is power/work avoidance, not a 60 fps result. Simulated hidden-document checks also produce zero renders, retain incoming telemetry, and redraw on visibility restoration. Live SSE load was not measured; packets in interaction checks are explicit synthetic fixtures and telemetry routes on this server return 503.

**Remaining gap:** Studio orbit is about 65.9 ms median versus the 16.7 ms target, approximately 49.2 ms over budget. Full-resolution sustained Studio 60 fps was **not achieved**. Keeping all triangles, full-resolution refraction/output and logarithmic depth leaves substantial GPU work; this implementation does not conceal that by lowering quality.

## Visual and interaction validation

Seven matching before/after PNG pairs: assembled, lid/top, exploded, isolated MCU PCB, isolated payload body, isolated fixture and payload/acrylic close-up. Actual decoded artwork, reflections, acrylic and shadow appearance were retained. Pixel differences above 8/255 affect at most **0.0044%** of pixels; fixture and acrylic captures are pixel-identical. Small remaining raster-edge differences exist, so this is not a claim of universal bit-identical rendering. No intentional visual tradeoff was introduced.

Fourteen bounded browser checks passed: seven-board geometry audits; select/highlight/isolate/raycast/visibility ownership for MCU, payload, clip and base; quality switching, X-ray, LCD presentation, telemetry, age/staleness, simulated hidden/resume, damping continuation/settling, six camera presets and sidebar resizing. The hidden test drives the actual visibility handler with a simulated `document.hidden`; it is not a claim of a separate operating-system background-tab benchmark. Final viewer boot and Performance → Studio selection were also checked in the established interface.

Focused automated validation:

```sh
node --test tests/twin/render-optimizations.test.mjs
node --test tests/twin/models.test.mjs tests/twin/telemetry-integration.test.mjs
```

All **13 tests pass** (3 optimization, 4 existing model integrity, 6 existing telemetry integration). The optimization test parses the actual GLB with a parsing-only image stand-in, then compares every triangle's position/normal and textured UV stream per material, identities and anchors. Maximum absolute attribute error from local Float32 transform baking is **2.95462e-8**; no triangles or artwork coordinates are removed. Browser captures use real decoded images. Fixture tests verify transform/visibility/selection synchronization. JavaScript syntax checks and `git diff --check` pass; the bounded Impeccable mechanical detector returns no findings.

The GLB remains byte-for-byte unchanged:

`dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47`

## Evidence and reproduction

- `baseline.json`, `optimized.json`: matching focused measurements.
- `visual.json`: bounded interaction outcomes and image differences. Mutable projection-offset objects in this run's capture metadata were omitted; the fixture now snapshots camera metadata for future runs.
- `baseline-*.png`, `optimized-*.png`: original-resolution comparison views; `studio-interface.png`: final interface confirmation.
- `baseline-main.mjs`, `baseline-display.mjs`: unchanged pre-implementation sources used only by the local fixture.
- `optimized-invalid-orbit.json`: rejected first run, whose scripted auto-rotation stopped after a single frame; **not used** for the performance comparison. The scheduler now explicitly continues auto-rotation. That failure, a too-short visual animation wait, and Float32-sensitive integrity comparisons were corrected; only failed/materially affected checks were repeated.

```sh
python3 verification/twin-optimization-20261109/server.py
```

Open `http://127.0.0.1:8768/verification/twin-optimization-20261109/index.html`. Run **Measure baseline**, then **Measure optimized**, waiting for Complete between them. To run the bounded visual fixture, append `?visual` to the harness URL and choose **Check interactions and capture comparison**. Results and PNGs save only into this evidence directory. No AGENTS.md rule update is needed.
