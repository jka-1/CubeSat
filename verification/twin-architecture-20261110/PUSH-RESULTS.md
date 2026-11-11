# Further rendering optimization

**Later integration:** [The 11 November site integration](../twin-integration-20261111/README.md) fixes receiving-shadow shader invalidation discovered during production checks and supersedes these pilot timings with a fully shadowed sustained test. The report below preserves the pilot findings.

10 November 2026. Authorized follow-up to `LEAN-RESULTS.md`. The target remains rapid, detailed rendering on this 2018 Iris Plus 655 MacBook Pro and other site clients. All implementation remains isolated in the prototype. Production source and canonical model assets are unchanged.

**Result:** the full-resolution FXAA alternative passes the sustained GPU headroom test on this Mac. Four-sample MSAA fails that test. This supports continuing with the prepared-model/WebGL design, subject to visual acceptance of FXAA and the existing acrylic approximation. Actual 60 Hz presentation and other clients remain unqualified.

## Candidate for visual review

<http://127.0.0.1:8770/verification/twin-architecture-20261110/prototype/?renderer=legacy&asset=compact&appearance=lean-acrylic&depth=bounded&cull=certified&capture=region&prepass=cheap&shadow=ortho&aa=fxaa>

The website layout, full drawing resolution, source artwork and every CAD triangle remain. This candidate combines the optimizations below with **FXAA instead of four-sample MSAA**. It also retains the earlier screen-space acrylic alternative. Both are explicit appearance choices for review; unchanged Studio equivalence is not claimed. Full MSAA remains the default when `aa=fxaa` is omitted. No production setting has changed.

The candidate combines the following optimizations without simplifying the model:

1. **Cull hidden faces of certified closed solids.** Offline auditing uses exact coordinate equality, two opposed edge incidents and positive signed volume for every connected component. Certificates bind to the actual GLB SHA-256. At runtime, retain both sides whenever the conservative solid bounds intersect the camera/clip range, or an override is transparent. Shadow culling requires the complete bounds to lie within an orthographic light's clipping volume. The selected whole-primitive policy covers 230,404 logical triangles across 85 meshes; every triangle remains in the model.
2. **Deduplicate identical vertex attributes.** Stored vertices decrease from 1,115,514 to 918,771 (17.6%). The prepared GLB decreases from 39,454,508 to 34,590,388 bytes. Every expanded indexed position, normal and UV byte, triangle order, component transform, material and image payload matches the prior prepared asset. No quantization, smoothing or decimation occurs. Independent Node tests verify the Python compiler's output.
3. **Copy only the acrylic's visible screen region.** Original pixel resolution and blur taps are retained, with three pixels of padding and conservative full-size fallback for uncertain projections. Reuse allocations in 64-pixel buckets. Fully offscreen panes skip the copy. In the complete 60-render trial, captures use 81,920 pixels typically and at most 102,400, versus a 2,750,400-pixel full buffer. This is a smaller region, not downsampling.
4. **Use inexpensive original opaque surfaces as depth occluders.** A depth-only prepass includes eligible meshes with at most 512 triangles, then renders the complete original scene. It uses actual source geometry, matching sidedness and invariant vertex positions. It excludes transparent, alpha-tested/hashed, displaced, clipped, biased or nonstandard-depth materials. Logarithmic fallback bypasses the prepass. This adds roughly 26,000 cheap triangles during animation while avoiding hidden PBR fragment shading. Shadows refresh through the original path once per outer frame.

5. **Avoid redundant orthographic shadow depth writes.** The original logarithmic-depth fragment writes ordinary depth unchanged for an orthographic light. The selected shadow variant omits that write while preserving packed shadow depth. R8 artwork now also reconstructs its alpha correctly in shadow shaders, independently of this optimization. A comparison against original RGBA artwork confirms assembled/acrylic close-ups within 1/255; the prior R8 path incorrectly cast fully opaque artwork rectangles.

## Controlled 60-render workload

Same 1910 × 1440 drawing buffer, four samples, full-resolution R8 artwork and cached/dynamic shadows. Five-second warmup, 30-second orbit, 15-second lid and 15-second explosion, with 1 Hz synthetic SSE through the display API. Sparse asynchronous whole-frame GPU queries include the prepass, shadows, main drawing and acrylic capture.

| Phase | GPU median | GPU p95 | Average submitted renders/s |
| --- | ---: | ---: | ---: |
| Orbit | 10.03 ms | 12.59 ms | 60.00 |
| Lid | 10.31 ms | 12.46 ms | 60.00 |
| Explosion | 10.86 ms | 13.50 ms | 60.00 |

All three phases meet the 14 ms GPU headroom target in this short trial; the later sustained result below fails it. Recorded callback CPU p95 is 5.7–7.2 ms, including controller work and render preparation. GPU and CPU times overlap; they must not simply be added.

**This is rendering-capacity evidence, not a measured 60 Hz presentation result.** The external monitor is still at 30 Hz. An isolated timer-driven test clock submits the same controller workload at 60 Hz; normal review still uses requestAnimationFrame. Timer-driven render-start p95 is 18.2–18.6 ms, so the original presentation/pacing gate is not passed by this assay. The 60 fps product target has not been lowered. Real 60 Hz RAF presentation and representative other clients remain unqualified.

## Sustained full-AA result and quality alternative

The fully recorded five-minute sweep with corrected shadows contains 17,943 frames and 4,484 valid GPU samples, with zero disjoint events. GPU median/p95 is 13.53/18.96 ms; the final 900 GPU samples have p95 18.18 ms. Subsequent hot orbit/lid/explosion p95 is 18.24/21.04/19.04 ms, although the submission rate remains approximately 60/s. **Sustained full-AA acceptance fails.** The hardware clock/temperature cause was not measured; these data must not be described as proof of throttling or as a successful 60 fps presentation result.

An `aa=off` diagnostic keeps the full 1910 × 1440 drawing buffer, all triangles, artwork dimensions, PBR lighting, shadows and the existing acrylic alternative. Removing four-sample MSAA gives interaction GPU p95 of 5.54 ms orbit, 6.58 ms lid and 8.08 ms explosion in the complete short workload. This isolates multisample rendering/resolve as a strong cost lead on this GPU; it does not prove every machine has the same bottleneck.

The review candidate uses `aa=fxaa` to add edge smoothing at full drawing resolution. It uses the official, unmodified Three.js r176 FXAA shader after the final encoded image, without another tone mapping or color conversion. Its initial ten-second orbit probe gives GPU median/p95 6.03/6.47 ms. This is a **quality alternative**, not fulfillment of the original unchanged-AA contract.

The [pinned upstream shader](https://github.com/mrdoob/three.js/blob/r176/examples/jsm/shaders/FXAAShader.js) is vendored locally with the existing Three.js MIT license; its hash is recorded in `prototype/final-code-provenance.json`.

Seven matched captures retain fine PCB markings, components and LCD text. Differences are expected along edges: 0.37–4.49% of compared CSS pixels differ by more than 8/255, with mean channel differences 0.03–0.76/255. This is not an equivalence threshold or proof that FXAA is preferable; screenshots and `prototype/results/push-fxaa-visual-comparison.json` make the tradeoff reviewable. The review page labels FXAA explicitly.

## Final FXAA sustained test

Same Intel Iris Plus 655, Chrome 157 / ANGLE Metal, full 1910 × 1440 drawing buffer. Five minutes of orbit and repeated explosion/reassembly produced 17,998 submitted frames and 4,500 GPU samples, with zero disjoint events. GPU median/p95 was **6.41/8.57 ms**; the last 900 GPU samples had p95 **10.67 ms**. Subsequent hot phases were:

| Phase | GPU median | GPU p95 | Callback CPU p95 |
| --- | ---: | ---: | ---: |
| Orbit | 6.00 ms | 10.36 ms | 5.40 ms |
| Lid | 6.98 ms | 7.95 ms | 6.40 ms |
| Explosion | 6.69 ms | 11.74 ms | 6.20 ms |

All hot phases pass the 14 ms GPU headroom target; zero GPU disjoint events occurred. Submission averaged approximately 60/s, with no recorded render-start intervals above 25 ms. Render-start p95 was 18.3–18.4 ms, so the original 17.667 ms presentation/pacing gate is **not passed**. The timer assay and the 30 Hz display cannot qualify native 60 Hz presentation. These results establish GPU capacity for this explicit quality alternative, not completion of the entire product acceptance gate.

Raw observations are in the `-fxaa-timer60-clock-thermal60.json` result; `prototype/results/push-summary-fxaa.json` contains the compact summary. No additional broad benchmark was run after this final candidate.

## Fidelity and focused validation

Twenty-nine focused automated checks pass across the existing model/rendering/telemetry checks and updated prototype checks. These include exhaustive independent attribute-byte comparison for the compact model, conservative culling/interior behavior, regional-copy padding/resize/offscreen handling and safe occluder classification.

The combined candidate passes six browser checks for counts, selection/picking ownership, visibility, synthetic LCD telemetry, presentation content and X-ray/quality switching, followed by resource disposal. All 95 component identities and 874,229 logical triangles remain.

The final FXAA qualification also passes unsafe-depth fallback/restoration, actual closed-solid interior double-sided fallback/restoration, quality-driven resize from 955 × 720 to 1910 × 1440 with correctly sized filter textures and only two retained capture textures, idempotent disposal, stopped rendering and reload integrity. Owned resource sets, component references and model children are empty after disposal; no browser exceptions/errors were logged. The interior callback observed 6.8 ms CPU. A reload's last recorded callback was approximately 100 ms; cold startup/shader compilation is not qualified by the sustained timings and remains an integration task.

Seven matched detailed views differ from the preceding culling control by **at most 1/255 per channel** outside recorded interface overlays: assembled, regulator front/back/oblique, MCU front/back and acrylic close-up. Against the original lean pilot, only six MCU-front edge pixels exceed 8/255 (maximum 17/255); other views differ by at most 1/255. Full screenshots, overlay rectangles and raw comparisons remain in `prototype/results/push-visual-comparison.json`. This is bounded visual evidence, not an exhaustive proof for every camera/browser or future model.

The initial five-minute run retained near-60 submission throughput, but explosion GPU p95 rose to 17.97 ms. This is a failure, not a sustained acceptance result. A follow-up with the corrected orthographic shadow path is recorded separately in `prototype/results/push-summary-ortho.json`; its five-minute warmup itself is sampled across all camera angles and repeated explosion/reassembly, as well as the final hot interaction phases.

## Deliberate stop rules

The following optional research branches are **not selected**: front-to-back opaque sorting, splitting mixed primitives into more draws, fixed-value material shaders, matte environment approximation. They failed to provide consistent tail improvements or enough gain to justify the tradeoff/complexity. No further lighting approximation was adopted.

The FXAA alternative supports continuing with this prepared-model/WebGL design. A general engine migration or entire website rebuild still has no demonstrated advantage. Multisample rendering/resolve is a much stronger cost lead; the AA quality change and existing acrylic approximation require visual acceptance before production adoption. Production integration should keep only the selected path, prewarm relevant shader variants and qualify actual 60 Hz presentation, cold transitions and representative clients before calling the overall goal complete.

## Reproduce only after a material change

```sh
python3 verification/twin-architecture-20261110/prototype/audit-closed.py
python3 verification/twin-architecture-20261110/prototype/compact-vertices.py
node verification/twin-architecture-20261110/prototype/test-browser.mjs thermal60 legacy compact lean-acrylic bounded ortho certified baseline baseline region cheap fxaa
node verification/twin-architecture-20261110/prototype/test-browser.mjs qualify legacy compact lean-acrylic bounded ortho certified baseline baseline region cheap fxaa
python3 verification/twin-architecture-20261110/prototype/compare-fxaa.py
python3 verification/twin-architecture-20261110/prototype/analyze-push.py fxaa
```

Base results use the `legacy-compact-lean-acrylic-bounded-certified-cull-region-capture-cheap-prepass` prefix. The corrected shadow candidate inserts `ortho-shadow-` before `certified-cull`; the AA alternative appends `-fxaa`. The thermal test uses a five-minute 60-render warmup with repeated explosion cycles, then repeats all three measured phases. It reconnects the synthetic stream before measuring to avoid the local fixture's six-minute SSE lifetime. No hardware connection, external upload or deployment occurs.
