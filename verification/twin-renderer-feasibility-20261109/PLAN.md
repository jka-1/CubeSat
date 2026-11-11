# Knight EPS: hardware diagnosis and deliberate renderer plan

Research date: 9 November 2026. Planning and read-only inspection only. No implementation/model changes or new rendering benchmarks were performed for this study. Existing local work is preserved.

Target clarified on 10 November 2026: the user ideally wants full Studio 60 fps on this 2018 Intel MacBook Pro. Treat the Iris Plus 655 / 8 GiB machine as the primary performance target. This is a desired acceptance goal, not an established feasibility claim. Passing only on newer hardware does not fulfill that goal; any hardware or quality compromise requires a separate decision.

## Recommendation

**The measured workload is GPU-bound, and this 2018 MacBook Pro is the primary target. Use the existing measurements as its baseline, resolve any material native-browser uncertainty, then test the existing r176 Three.js node renderer with its WebGL2 and hardware WebGPU backends in isolation before authorizing a rewrite. A newer machine is an optional diagnostic control, not the acceptance machine.**

This revises the order of the earlier delivery-pilot recommendation. “The pilot did not demonstrate a route to 60 fps on Iris 655” remains true; it does not establish that the current viewer fails on a modern demonstration computer. There is also now source-level evidence for a maintained alternative to a custom refraction fork, already in the same Three.js release.

The best proven implementation is still an open empirical question. The best next investment is a short, gated renderer comparison on this Mac. A native-browser result may remove an embedded-browser-specific problem, but the existing Studio measurements already fail the desired target. No engine has yet been benchmarked with this model on a second GPU, and that comparison is not a prerequisite for the local proof.

## 1. What the hardware evidence establishes

Read-only host inspection found:

| Item | Observed |
| --- | --- |
| Computer model | MacBookPro15,2 |
| CPU | Intel Core i5-8259U, 2.30 GHz |
| Installed RAM | 8 GiB |
| Graphics | Intel Iris Plus Graphics 655, Metal supported |
| OS graphics-memory description | 1536 MB shared; not a measured allocation or hard portable VRAM limit |
| Low Power Mode at inspection | Off |
| Memory-pressure snapshot | 53% free, at inspection only |

The browser's previous ANGLE Metal / Iris Plus 655 identification agrees with the host GPU. This is hardware rendering, rather than evidence of a SwiftShader/software renderer. These facts describe the test host; they do not identify another computer the user might choose for the demonstration.

Intel identifies this CPU as a Q2 2018 mobile processor with Iris Plus 655, a 28 W nominal package TDP, 128 MB eDRAM and up to 37.5 GB/s system memory bandwidth. Those are specifications, not measurements of available bandwidth or clock speed during our workload. A “4K 60 Hz supported” display-output specification is not a promise to render this 3D scene at that speed. [Intel processor specification](https://www.intel.com/content/www/us/en/products/sku/135935/intel-core-i58259u-processor-6m-cache-up-to-3-80-ghz/specifications.html).

The viewer's actual evidence is more useful than generic GPU rankings:

- Original Studio orbit GPU time is approximately 51 ms while CPU submission was previously reduced to approximately 9 ms. The texture pilot reaches approximately 46 ms GPU time. Both exceed the entire 16.67 ms frame budget before allowing headroom.
- A 1910 × 1440 output contains 2.75 million pixels. Output, full-size refraction, multisample attachments, mip generation, transparent artwork and shadows all consume GPU resources. “Under one million CAD triangles” alone does not describe this workload.
- Active material texture storage is estimated at 660.69 MiB before separately accounting for refraction, shadows, environment and the browser's framebuffer. The 8 GiB system must also accommodate decoded images, geometry, the browser and the operating system. Texture bandwidth and memory pressure are plausible contributors; we have not measured the GPU's limiting subsystem or a peak process footprint.
- Performance mode's earlier approximately 16.7 ms orbit observation shows that the same CAD can be submitted at a much lower-cost preset. Because that preset also changes output sampling, transmission and shadows, it does not prove that Studio can achieve 60 fps on this GPU.

The hardware snapshots do not retrospectively establish thermal throttling, power limits or memory pressure during earlier runs. The very slow startup outliers remain unexplained. WebGL exposes no portable exact VRAM query; shared-memory labels must not be treated as a VRAM budget. [WebGL memory guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#budget_vram_conservatively).

**What cannot be concluded:** that the model is intrinsically too detailed, that a new engine will provide a particular speedup, that a GPU rated “3× faster” elsewhere will meet this frame budget, or that upgrading RAM alone fixes steady-state rendering. The current approximate GPU-time ratio is a workload requirement, not a product-shopping benchmark.

## 2. What the rendering research changes

### Current r176 WebGLRenderer

The checked-in source explicitly renders opaque objects into the transmission render target, resolves/generates its mips, handles double-sided transmissive backfaces, and later renders the main scene. Camera movement changes the refracted view, so caching that image while orbiting would make the image wrong. The existing shadow cache already removes stationary shadow updates from orbiting. Further delivery compression does not remove this opaque geometry replay.

Relevant local source: `site/knight-eps-phase12/viewer/vendor/three/build/three.module.js`, especially `renderTransmissionPass` and the subsequent main-scene render. The earlier per-pass timer experiment perturbed the workload; its individual GPU durations are rejected. The duplicated work is a source observation, not a claim that removing one pass automatically halves frame time.

### Better first alternative: matched r176 WebGPURenderer

This alternative already exists in the same upstream release:

- r176 `PhysicalLightingModel` samples mipmapped viewport textures for refraction. [Pinned physical-lighting source](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/nodes/functions/PhysicalLightingModel.js).
- `ViewportTextureNode` extracts the current framebuffer with a copy rather than requiring another scene render to produce that texture. Copies, resolves and mipmaps still have a cost. [Pinned viewport-texture source](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/nodes/display/ViewportTextureNode.js).
- The common renderer renders its opaque list then transparent lists, including the required double-sided transparency handling. This is a different route from the legacy transmission replay. [Pinned common renderer](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/renderers/common/Renderer.js).

**Inference:** this is a credible, more maintainable way to investigate the expensive rendering architecture before writing a private fork. It is not yet proof of equivalent acrylic or sufficient speed on this model.

It does not remove all extra work: front/back refraction copies, resolves, mip generation and output conversion can remain. The common renderer can also allocate a full-size half-float intermediate color target. Fewer scene draws can therefore coexist with substantial bandwidth/memory cost. Audit the resulting resources and image before interpreting a speed difference; this candidate could still be slower.

`WebGPURenderer` is a renderer name, not proof of the API used. In r176, `forceWebGL: true` selects its WebGL2 backend; the normal path selects WebGPU with a WebGL2 fallback. It also exposes logarithmic depth and defaults to half-float color buffers. This makes a useful experiment possible: change the rendering architecture while keeping WebGL2, then compare WebGPU separately. [Pinned constructor/options](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/renderers/webgpu/WebGPURenderer.js).

Existing standard, physical, basic and shadow materials have mappings in its node library. That includes the materials used for CAD, acrylic, the LCD and shadow floor, but mappings do not guarantee identical shading. Shadow invalidation is a specific migration risk: the node shadow path checks **each light's** `shadow.autoUpdate`/`shadow.needsUpdate`. Copying only the current global renderer shadow flags would be insufficient. [Material mappings](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/renderers/webgpu/nodes/StandardNodeLibrary.js), [shadow update path](https://raw.githubusercontent.com/mrdoob/three.js/r176/src/nodes/lighting/ShadowNode.js).

The prototype must initialize the renderer once before rendering, adapt environment preparation, and check capture/disposal and counters. It must preserve demand rendering and the display invalidation contract. All prototype imports must resolve to a consistent r176 module set; do not mix material/scene classes from unrelated copies or releases.

The current upstream release was verified as r187, published 30 October 2026. Newer source includes further viewport-transmission handling, but an r176 → r187 change would introduce an additional variable and require a separately justified compatibility review. Start with r176. Escalate to a pinned newer release only for a demonstrated relevant bug or missing capability. [Official release record](https://github.com/mrdoob/three.js/releases/tag/r187).

### Why WebGPU alone is not the answer

WebGPU offers more flexible GPU programming and can reduce JavaScript overhead, but this application already reduced CPU submission substantially. We need evidence of less GPU work or better execution of that work. Verify adapter acquisition, actual backend, optional timing support and device loss. A WebGL fallback result must be labeled WebGL. Do not use browser flags to force unsupported hardware through a disabled path. Three.js explicitly warns that some scenes remain faster in WebGLRenderer. [Three.js migration guidance](https://threejs.org/manual/pages/webgpurenderer), [Chrome WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview), [Chrome troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips).

### Other alternatives

| Alternative | What it could solve | Main weakness | Decision |
| --- | --- | --- | --- |
| Keep current renderer on verified demonstration hardware | May satisfy the actual target with minimal work | Does not establish older-laptop support | Test first |
| Matched r176 node renderer, WebGL2 and WebGPU | Changes the relevant transmission pipeline while retaining Three.js | Different shaders, shadow behavior and backend support need proof | Preferred first renderer prototype |
| Custom shared-color/depth refraction pipeline | Direct control of duplicate scene work and resource lifetime | High correctness and maintenance cost; double-sided acrylic, alpha ordering, tone mapping and depth are subtle | Reserve for a measured failure of the maintained route |
| Babylon.js replacement | A mature alternative renderer and different optimization tools | Its glTF transmission helper also prepares an opaque-scene render target with MSAA/mips; migration alone does not establish less work | Do not choose without a model-specific advantage |
| Full KTX2 artwork conversion | Lower decoded/uploaded texture footprint and potentially bandwidth | Pilot does not show enough speedup; quality/device format and non-multiple-of-four image dimensions need further work | Separate delivery/memory decision |
| Meshopt, more atlasing or small draw-call changes | Delivery or CPU submission improvements | Does not directly solve the measured GPU gap | Do not lead the 60 fps effort |
| Remote rendering or a native CAD viewer | Could use a different GPU/runtime | Changes deployment, latency or website interaction requirements | Poor fit for the current local browser requirement |

Babylon's transmission helper uses a separate opaque render list/target; its defaults include four samples and generated mipmaps. This is why an engine-name change is not a demonstrated fix. Its low-level performance guidance remains useful, but we already apply several CPU-side measures. [Transmission helper source](https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/loaders/src/glTF/2.0/Extensions/transmissionHelper.ts), [scene optimization guidance](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene).

No proposal silently converts blended copper to a binary mask, disables logarithmic depth, lowers refraction/output resolution, removes shadow quality, decimates geometry or uses reduced-geometry LOD. Those would change the approved problem rather than establish a solution to it.

## 3. The alternative plan and stopping rules

### Phase A — use this Mac's baseline and resolve browser uncertainty

Use the existing viewer and original GLB. Do not change renderer, material policy or assets. The user's preferred target is now this 2018 Intel MacBook Pro at full Studio quality; keep it as the acceptance machine throughout the proof.

Reuse the existing Iris 655 measurements. A single controlled native-browser comparison addresses the remaining browser-specific uncertainty; do not repeat the broad study. Proceed to Phase B if this Mac still fails. A stronger computer may be used as an optional diagnostic control, but do not delay the local proof for access to another machine or count that other machine passing as success. Do not buy hardware based on synthetic benchmark ratios.

On the Iris host, use one native hardware-accelerated browser comparison to determine whether an embedded-browser/driver/compositor effect materially changes the result. Record exact renderer strings; this is not a comparison of hardware if both browsers select the same GPU. On dual-GPU computers, record the selected adapter. A `powerPreference` hint cannot create a discrete GPU that the computer does not have.

**Gate:** if the current viewer passes the sustained/visual protocol on this Mac in the intended browser, retain it. A rewrite has no demonstrated need. Preserve the existing Performance option, but its lower-cost rendering does not count as meeting the full Studio goal.

**If the target fails:** distinguish browser-specific failure, hardware limits and renderer architecture cost. Carry the actual numbers into Phase B. A stronger machine passing demonstrates a hardware dependency, not fulfillment of the user's preferred target.

### Phase B — one isolated, same-version renderer proof

Build a local-only branch of the viewer inside the verification fixture. Use the original GLB/manifest and the same demand scheduler, geometry consolidation, fixture instances, camera trajectories, quality settings and component actions. Candidate adoption and production changes remain gated.

The comparison has three labeled paths:

1. Current r176 `WebGLRenderer` control.
2. r176 `WebGPURenderer({forceWebGL:true})`: different renderer pipeline, same WebGL2 API.
3. r176 `WebGPURenderer` using an acquired hardware WebGPU adapter; otherwise record unavailable/fallback rather than claiming WebGPU performance.

Boot and visual correctness come before timing. Confirm all 874,229 logical triangles, 95 component identities, source metadata, attributes/UVs and transforms. Verify the copied refraction textures' actual dimensions, format and mips and the actual antialiasing sample counts. Keep the 1910 × 1440 main image and full-size refraction; initially keep logarithmic depth, lights, environment, color management and shadow settings. New defaults must not masquerade as equal quality.

Explicit adapter duties include per-light shadow invalidation; scene/environment initialization; render statistics; frame capture; cleanup; resize/projection offsets; instances and picking; and LCD CanvasTexture uploads. Do not silently change public API return types or telemetry behavior. No continuous loop may replace the existing demand scheduler.

**Gate:** a maintained candidate must pass correctness and show enough sustained GPU/frame headroom on this 2018 MacBook Pro to meet the protocol. A 20% improvement from a 50 ms baseline remains a failure of the 60 fps goal. If the candidate is slower, renders differently, or silently falls back, keep that finding and stop. Repeat only a failed check or a materially changed candidate.

A specific r176 defect may justify one tightly scoped newer-version control after documenting the defect, relevant upstream fix and migration risks. Do not start an unbounded sequence of engines or Three.js upgrades.

### Phase C — integrate only a proven winner

Preserve the current HTML/CSS, sidebar layout, labels, control placement, camera framing, source model, manifests and dashboard integration. Confine the change to a renderer adapter and its small bootstrap/metrics glue. Keep the old renderer available for rollback until acceptance. Keep Performance mode available with its established meaning.

Only after the renderer decision, separately decide whether to adopt lossless Meshopt or expand KTX2. This prevents a visual/asset change from obscuring the rendering comparison. KTX2 remains visibly lossy in principle and needs explicit adoption approval.

### Phase D — deliberate fallback decision

If all maintained candidates fail this Mac at identical quality, issue a stop report with the measured gap. The user described this target as ideal; do not silently turn a failed ideal into approval for a compromise. Present a higher minimum hardware requirement, a changed quality policy or a custom rendering research project as separate choices for the user. If the current quality/hardware goal stays fixed and no candidate passes, report it as unproven; do not promise that starting from scratch will solve it.

## 4. Bounded validation protocol

This is a proposed future protocol, not new measured performance in this research task:

- One active viewer/context at a time; close competing GPU workloads. Record browser build/backend, adapter, RAM, CSS viewport, drawing buffer, refraction dimensions, samples, output color/format, power mode and display refresh. Use a consistent power/thermal setup. Avoid repeating the many rapid context reloads that complicated the earlier startup samples.
- For each viable path/device, warm for five seconds, then use a fixed 60-second script: 30 seconds orbit, 15 seconds repeated lid cycles, 15 seconds repeated explosion cycles, at the same camera trajectory and animation rate. Keep the page foreground. This is focused sustained validation of the specific unresolved uncertainty, not another broad preset sweep.
- Record rendered frame intervals and requested cadence, median/p95/p99, delayed-frame count, CPU submission, GPU time when supported, all-pass draw/triangle counts and shadow updates. Use asynchronous whole-frame GPU queries at a sparse rate. Do not reintroduce the rejected per-pass-query method or synchronously wait for the GPU. If WebGPU timestamps are unavailable, say so; do not infer GPU timing from JavaScript duration.
- Include the actual display-update path using a same-origin synthetic SSE fixture with clearly identified test data, initially at the observed/intended packet cadence. Measure idle display age updates too. Never issue hardware commands for a rendering test.
- Acceptance on a stable 60 Hz display: approximately 60 delivered frames/s under continuous interaction; median near the measured refresh interval; p95 no more than one refresh interval plus **1 ms measurement/scheduling tolerance**; fewer than 1% intervals above 1.5 refresh periods; no recurring long stalls. Target GPU p95 at or below 14 ms and CPU submission headroom when measurable. CPU/GPU run concurrently and are not added. The 1 ms reporting tolerance avoids treating normal RAF jitter as a rendering failure; it is not permission to reduce quality or call 30–50 ms frames 60 fps. This clarifies the previous report's overly literal p95 ≤16.7 ms threshold.
- Validate first usable load separately from warm sustained interaction; neither improvement substitutes for the other. Record memory estimates separately from physical allocation claims and check a bounded load/dispose/reload for leaks.
- Visual/functional coverage: both PCB faces at fine zoom, oblique/minified artwork and alpha edges, microscopic layer ordering, acrylic over front/back/interior geometry, environment/shadows during movement, selection/highlight/isolation/visibility, lid/explosion, camera presets/pan/zoom, resize/sidebar framing, Performance switching, LCD text/telemetry, and context/device-loss behavior. Pixel comparisons help locate differences but cannot replace review of a different shading implementation. Any meaningful shading/AA difference needs user review.

## 5. Concrete file scope for a later approved proof

Proposed verification-only files under `verification/twin-renderer-feasibility-20261109/`:

- `index.html`, `compare.mjs`, `server.py`: common local comparison interface, served-copy injection and bounded measurement/capture controls.
- `renderer-adapter.mjs`: same-version prototype initialization, backend selection, material/environment handling, per-light shadow flags, render/capture/disposal and normalized diagnostics.
- `protocol.json`: immutable camera/animation/quality/sampling settings and acceptance parameters.
- `vendor/three-r176/`: upstream matching WebGPU/TSL builds and required dependency closure, with licenses and SHA-256 provenance. Add only what imports require. Use a consistent core/module graph.
- `renderer-compatibility.test.mjs`: focused API, geometry/identity and scheduler/invalidation checks specific to the adapter.
- `results/`, `RESULTS.md`: raw hardware/browser/quality evidence, captures, outcomes and decision. Reuse current fixtures/tests instead of creating a second general model test suite.

Phase A uses the existing comparison on this Mac. If an optional comparison on another machine needs a test bundle, prepare it for local transfer; no third-party model upload is authorized.

No edits to `site/knight-eps-phase12/viewer/main.mjs`, `display.mjs`, `render-optimizations.mjs`, model assets or deployment configuration are part of this planning task. Phase C would need a concrete integration diff for approval after the proof passes. The existing no-deploy and no-subagent rules remain in force.

## 6. Evidence, uncertainty and decision ownership

Existing measurements are in `verification/twin-performance-20261109/`, `verification/twin-optimization-20261109/README.md`, and `verification/twin-optimization-20261109/delivery-README.md` with their raw JSON. They remain the baseline; this study did not rerun them.

`hardware-observation.json` records the read-only host findings. `research-sources.json` records primary documentation/source links and what each supports. No generic benchmark score or unrelated example scene is used to claim a model-specific speedup. The user's 10 November clarification resolves the primary hardware target: this 2018 Intel MacBook Pro. A second GPU remains an optional comparison.

**Recommended approval scope:** one native-browser control on this Mac, followed by the single r176 node-renderer proof if the full Studio target still fails. This clarification establishes the preferred target; it is not implementation approval. No full rewrite, derivative adoption, dependency upgrade, quality reduction or deployment is included in the proposed scope.
