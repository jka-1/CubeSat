# Architecture prototype: stop before a rebuild

**Latest follow-up:** see [PUSH-RESULTS.md](PUSH-RESULTS.md) for further prepared-model/WebGL improvements. Four-sample MSAA passed a short workload but failed sustained GPU headroom; the full-resolution FXAA alternative is evaluated separately. Actual 60 Hz presentation remains unqualified. [LEAN-RESULTS.md](LEAN-RESULTS.md) preserves the preceding pilot. The report below preserves the earlier engine-migration findings and display observations.

10 November 2026. **No-go for integrating this rendering architecture as the 60 fps solution.** The isolated prototype is implemented and tested. It substantially reduces texture storage, but neither the maintained renderer change nor the board-surface experiment establishes the required performance. The surface experiment also fails visual fidelity.

There is a separate, newly verified constraint: **the active main display is 3840 × 2160, scaled to 1920 × 1080, at 30.00 Hz.** macOS reports that mode, and a visible, focused empty Chrome page produced a median 33.3 ms interval across 120 RAF samples. This setup cannot qualify 60 fps presentation. No display settings were changed; the cause of the 30 Hz connection and availability of a 60 Hz mode remain unknown.

A 60 Hz display path would remove that presentation cap. The full-quality WebGL candidates still need their measured GPU work reduced from over 40 ms to below the 16.7 ms frame budget. Changing the monitor alone does not establish that improvement.

## What was implemented

All new work is in `prototype/`. Production implementation, model assets, manifests, website CSS/layout, deployment configuration and telemetry security are unchanged by this task. Existing working-tree changes were preserved, with their starting hashes checked again afterward. No project asset was uploaded.

- **Renderer adapter:** matching Three.js r176 legacy WebGL, node WebGL and actual Intel hardware WebGPU. Per-light shadow invalidation, consistent module imports, outer-frame diagnostics and explicit resource ownership. A shadow-floor compatibility adapter restricts its node lighting to the shadow-casting lamp; the floor is omitted when shadows are disabled. Upstream renderer files were not patched.
- **Prepared display model:** move the previously validated consolidation offline, preserve all indexed attributes, keep independent components and share regulator geometry. `display.glb` is a separate derivative: 39,454,508 bytes versus 37,548,864 source bytes. This prototype does not demonstrate a delivery-size or startup improvement.
- **Full-size coverage artwork:** all fifteen PCB images have exactly two RGBA values: transparent black plus a constant foreground color. Store an R8 coverage image and the foreground constant instead of an RGBA image. The build reconstructs every source texel byte-exactly. No texture downsampling, geometry reduction or lossy block encoding is involved.
- **Surface-artwork experiment:** separately evaluate those maps on physical board faces while suppressing the auxiliary planes' draws. Keep the canonical carrier geometry and ownership. This candidate is rejected below.
- **Lifecycle and integration:** release owned geometry, textures, images, viewport-copy textures and controller references before backend teardown; verify disposal/reload. Use the actual display update path with clearly marked synthetic SSE packets. Readiness includes a submitted model image followed by a RAF, rather than parsing alone; it is not a GPU-completion timestamp.

The established controller and layout were reused as a compatibility harness. A complete controller/UI rewrite was deliberately deferred until the rendering proof passed. That gate did not pass.

## Measurements

Native Chrome **157.0.8103.50**, this MacBookPro15,2 / Intel Iris Plus 655. WebGL reports ANGLE Metal; WebGPU reports Intel gen-9 and Chrome identifies the integrated Intel adapter on Metal. No software adapter or forced GPU flags were used.

Every Studio-settings candidate used a 955 × 720 CSS scene viewport, **1910 × 1440 drawing buffer, four samples, logarithmic depth, the original lighting/environment parameters and 1024² soft-shadow settings**. Node-renderer refraction copies remain full size. Renderer migration has not received visual-equivalence approval; matching settings do not guarantee identical shading.

Five-second warm-up, then 30 seconds orbit, 15 seconds alternating lid motion and 15 seconds alternating explosion. The camera continues orbiting during the animation phases. Rotation uses elapsed time. Synthetic SSE updates arrive once per second. One test page/context at a time in a separate temporary Chrome profile.

| Studio-settings candidate | Orbit frame-start rate | Orbit median / p95 interval | Orbit median GPU | Material texture estimate |
| --- | ---: | ---: | ---: | ---: |
| Legacy WebGL, original model | 19.2/s | 52.0 / 60.3 ms | 46.8 ms | 660.69 MiB |
| Node renderer, hardware WebGPU, original model | 19.1/s | 51.3 / 62.2 ms | Not collected | 660.69 MiB |
| Node WebGL, prepared geometry + coverage | 19.0/s | 54.8 / 69.0 ms | 41.5 ms | 166.88 MiB |
| Node WebGL, prepared geometry + surface artwork | 17.9/s | 56.0 / 73.2 ms | 43.5 ms | 166.88 MiB |

Lid/explosion phases likewise fail the intended 60 fps budget. Complete phase statistics and raw samples are in `prototype/results/summary.json` and the corresponding `*-measure.json` files.

These rates measure **outer-frame render-start/submission cadence**, not actual presented frames. The discovered 30 Hz environment prevents a valid 60 Hz presentation qualification. The independently measured WebGL GPU times nevertheless remain far above budget. CPU render submission and GPU execution overlap and are not added.

During orbit, opaque replay is removed: **395 → 212 draws**, and **1,751,896 → 877,692 submitted triangles**. The surface candidate reaches 182 draws / 877,632 triangles. Those reductions do not translate into the required speed. The node path still uses a full-size half-float, multisampled main target and full-size viewport copies with mip preparation. Fewer geometry submissions do not ensure a cheap complete frame.

The results support rejecting these candidates as the basis for a full rebuild. They do not establish a universal ranking between engines or a hard limit for every possible rendering design on this GPU. Runs were bounded sequential observations; GPU clocks, temperature, background workload and physical peak memory were not instrumented. AC power and Low Power Mode off were observed at the end.

## The useful result: artwork storage

Active material storage falls **660.69 → 166.88 MiB**, approximately **74.7%**, calculated from requested dimensions/formats and mip chains. Hardware WebGPU exposes `r8unorm` for the coverage textures. This is an allocation estimate, not measured physical VRAM; render targets, environment, default framebuffer and transient allocations are separate.

The coverage package is 129,465,000 decoded bytes and **366,169 gzip bytes**, plus its small manifest. The loader substitutes coverage textures before decoding the fifteen original PNGs. All dimensions remain unchanged; the live LCD remains dynamic.

Source texels round-trip exactly, but generated mipmaps can differ because an R8 channel and separate sRGB RGBA8 channels round differently. Seven matched scene crops compare original artwork with coverage on the **same node WebGL renderer**: assembled, regulator front/back/oblique, MCU front/back and acrylic. Maximum channel difference is **2/255**; no sampled pixel differs by more than 8/255. This is strong evidence for the encoding in those views, not proof across every zoom/device or approval of the renderer migration itself.

This representation is worth retaining for a future viewer. Its memory benefit must not be reported as a 60 fps fix or an established cold-load improvement.

## Rejected surface candidate

The surface shader is a prototype approximation to layered material responses, ordering and parallax. It changes the artwork visibly: regulator-front differences exceed 8/255 across about **23.5%** of scene pixels, and MCU-front differences across about **34.5%**. It also provides no meaningful speed gain. Reject it; do not adopt the suppression of auxiliary artwork planes.

This is a failed design hypothesis, not an invitation to keep adjusting its colors indefinitely.

## Short cost diagnostics

Two ten-second orbit diagnostics retain full drawing-buffer size, all source geometry, original artwork, logarithmic depth and four-sample antialiasing, while replacing model materials with unlit shading and acrylic refraction with tinted alpha. They are explicitly labeled **not Studio quality**.

| Diagnostic | Median GPU / p95 GPU | Frame-start cadence |
| --- | ---: | ---: |
| Legacy WebGL, original RGBA artwork | 7.0 / 7.6 ms | 30.0/s |
| Node WebGL, coverage artwork | 18.8 / 21.0 ms | 30.0/s |

The 30/s cadence prompted the empty-page and OS refresh investigation. It must not be interpreted as the geometry's intrinsic limit. The legacy diagnostic shows that this GPU can process the full-resolution CAD through a substantially cheaper path. The node-renderer diagnostic also shows that its remaining pipeline is expensive before polished model lighting is restored. These assays change several effects together and use different artwork encodings; they do not isolate one shader, depth operation or resolve cost.

## Validation and exclusions

- **12 focused automated tests pass:** approved consolidation/fixture/material tests, telemetry integration and three new architecture checks. The strengthened geometry check compares every expanded indexed position, normal and UV against the validated live consolidation, plus all component transforms, bounds, triangle counts and regulator sharing. Original materials and PNG payloads remain intact.
- **95 components and 874,229 logical triangles** remain. The surface experiment's 36 auxiliary triangles remain in canonical/derivative geometry but are omitted from its separate draws; that experiment is rejected.
- Three bounded browser visual/interaction runs each pass six checks: component integrity, picking ownership, visibility, synthetic LCD telemetry, presentation text and X-ray/Performance switching. Each also passes a disposal check: no subsequent rendering, no owned-resource entries, no retained model children/components and disconnected transport. Final cleanup/reload is checked again after disposal-order improvements.
- Fourteen image comparisons are saved in `prototype/results/visual-comparison.json`. Engine-wide visual equivalence and exhaustive zoom/device coverage are not claimed.
- The early node-WebGL instrumentation included nested shadow renders in frame timing. **`INVALID-node-webgl-nested-render-measure.json` is excluded.** The final recorder gates measurements to the outer scene/camera and uses sparse, asynchronous whole-frame GL queries.
- The prepared WebGPU test lost its CDP target/session during the explosion phase. Its complete orbit/lid phases remain raw partial evidence; **it is excluded from complete-run comparisons**. The cause was not established, so this is not labeled a GPU crash.
- WebGPU GPU timestamps were not collected. No CPU duration is substituted for them. No candidate qualified for a five-minute thermal acceptance run. Device-loss recovery and broader browser qualification were deferred after the performance gate failed.

## Decision and next investment

**Keep the production viewer and source assets in place. Do not commission the full rewrite on the strength of this prototype.** Retain the coverage encoding, prepared-geometry compiler and evidence as reusable work.

Before further 60 fps acceptance testing, establish a display connection/mode that actually refreshes at 60 Hz. Then focus rendering research on a leaner GPU path: the cost of opaque material shading, depth/rasterization, antialiasing and full-size HDR/refraction operations. The inexpensive legacy diagnostic provides a useful control. Another framework migration or more general batching has no demonstrated case.

Reversed/tighter depth, different AA, simplified materials or a custom refraction pipeline remain separate hypotheses requiring depth/visual evidence and explicit treatment of any changed quality contract. Nothing here silently approves those changes, a dependency upgrade, external Autodesk upload or production integration.

## Review and reproduce

The local server remains available on `127.0.0.1:8770`. Review the coverage candidate at:

`http://127.0.0.1:8770/verification/twin-architecture-20261110/prototype/?renderer=node-webgl&asset=packed`

Use `renderer=legacy&asset=original` for the existing-renderer control. `asset=surface` is the rejected experiment. The separate diagnostic appearance parameter must not be used for Studio acceptance.

Source/provenance: `prototype/provenance.json`, `prototype/final-code-provenance.json`, `prototype/assets/build-report.json`, `prototype/assets/artwork-masks.json`. Display evidence: `prototype/results/display-observation.json` and `refresh-calibration.json`.

Rebuild only when changing the prototype:

```sh
python3 verification/twin-architecture-20261110/prototype/build-prototype.py
node verification/twin-architecture-20261110/prototype/compile-display.mjs
python3 verification/twin-architecture-20261110/prototype/build-artwork.py
python3 verification/twin-architecture-20261110/prototype/server.py
```

The browser driver uses an isolated Chrome profile with local CDP on port 9227; it does not use personal browsing data. Final code provenance records the delivered prototype snapshot. Raw runs include the explicitly documented earlier instrumentation and interrupted attempt. Reuse the evidence; do not rerun the whole matrix without a material change or a specific unresolved question.

