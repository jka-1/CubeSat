# Delivery pilot and 60 fps feasibility decision — 9 November 2026

**Recommendation: stop treating delivery compression or further general batching as the route to sustained full-resolution Studio 60 fps.** The pilot produces useful delivery and memory savings, but does not demonstrate a feasible continuation to 16.7 ms on the tested Intel Iris Plus 655. This is a decision about the evidence and next investment, not proof that the hardware can never render an equivalent image at 60 fps. A renderer change also needs a measured proof before committing to a rewrite.

All work is local and isolated in this evidence directory. The shipped viewer, compiler, source GLB, manifests, website layout and production configuration were not edited by this pilot. The original GLB SHA-256 remains `dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47`. Prior working-tree changes remain. No deployment, hardware connection, external model upload or derivative adoption occurred.

## What was built

| Candidate | Actual GLB bytes | Result |
| --- | ---: | --- |
| Original | 37,548,864 | Independent original retained |
| Lossless Meshopt | 15,863,472 | 57.75% fewer model bytes; decoded geometry remains identical |
| Regulator UASTC | 37,670,240 | Three KTX2 images plus original PNG fallbacks; larger container by 121,376 bytes |

`build-delivery-pilots.mjs` processes the existing GLB into `delivery-assets/`; it never invokes the CAD compiler. Meshopt 0.18 encodes raw attributes and exact index sequences, with no quantization, reordering or lossy filters. The decoder is the one supplied with Three.js r176. Geometry, normals, UVs, indices, materials, all node metadata and transforms are preserved. A virtual fallback-buffer alignment defect was corrected after the loading observations: compressed bytes, decoded data and container byte count are unchanged. `build-report.json` records both hashes. Subsequent browser integrity/rendering checks use the corrected revision. Startup timings were not repeated for this metadata-only correction.

The three regulator images remain 3000 × 2272. Basis Universal 1.16.4 used UASTC level 4, no RDO, Zstandard level 18, straight alpha, sRGB-aware box-filtered full mip chains, and one runtime transcoder worker. These images exercise blended top/bottom copper and alpha-masked silkscreen, and remain shared across both regulator instances. Materials keep their original alpha modes and 0.1 silkscreen alpha cutoff. The LCD remains a dynamic canvas.

The local fixture supplies matching r176 KTX2Loader, WorkerPool, KTX parser, Zstandard decoder, color-space module and Basis JS/WASM transcoder. The complete KTX runtime dependency set is 681,105 uncompressed bytes; Basis JS/WASM alone is 584,862 bytes. Meshopt's decoder is 24,850 bytes. There is no runtime dependency upgrade. Downloads came from official repositories; licenses, URLs and SHA-256 hashes are in `delivery-vendor/provenance.json`.

## Texture creation, storage and transient memory

Actual runtime observations distinguish 17 embedded original PNGs, 16 requested/decoded original images, 15 active PCB image textures, the replaced static screen, and the live canvas. The unreferenced 1024 × 768 image is not decoded. The original static 512 × 388 screen image is decoded during parse but replaced before drawing. Both regulator instances share three texture sources; their residency is not doubled. Active materials reference 16 texture objects/sources: 15 PCB artworks and one live LCD. There is no evidence of a duplicate texture upload per regulator instance.

On this device the pilot transcoded all three KTX2 images to **BC7**, r176 `RGBA_BPTC_Format` (36492), with 12 mip levels and 9,090,272 bytes per texture. The sRGB color space is retained. The observed WebGL internal format is sRGB BC7. No RGBA fallback was used. Other devices can select another supported format or RGBA; their memory/quality benefit is not established by this run.

| Accounting category | Original / Meshopt | KTX2 subset |
| --- | ---: | ---: |
| Active material texture storage estimate, all mip levels | 660.69 MiB | 582.70 MiB |
| Three regulator textures, included above | 104.00 MiB | 26.01 MiB |
| Requested PNG decoded RGBA8 pixel estimate, before mipmaps | 494.63 MiB | 416.62 MiB |

The subset saves **77.99 MiB (11.8%)** of estimated active material texture storage. PNG decode counts fall 16 → 13. The decoded PNG estimate includes the static screen at parse time and is not a peak process-memory measurement. KTX2 also needs compressed level buffers and a worker/WASM heap. Geometry decoding retains 36,337,910 bytes of attribute/index output, plus encoded input, temporary buffers and existing runtime consolidation copies. We did not measure an exact browser/driver peak. These categories can overlap on unified-memory hardware and must not be summed into an alleged exact VRAM reading.

Separate full-resolution Studio allocations are unchanged by either derivative:

- Refraction: 1910 × 1440, half-float RGBA color with mipmaps, requested 4× MSAA. Resolved color/mips are approximately 27.98 MiB. Observed renderbuffer allocations imply approximately 83.94 MiB multisample color, 41.97 MiB multisample depth and 10.49 MiB resolved depth when depth storage is accounted at four bytes per sample.
- Shadow: 1024 × 1024 color and depth, approximately 4 MiB each with the same depth-storage assumption.
- Environment atlas: 768 × 1024 RGBA half-float, approximately 6 MiB, generated before the upload hook and accounted separately.
- Default framebuffer: observed four samples. RGBA8 plus 24-bit depth implies a 73.44 MiB color/depth bit-count lower estimate at 1910 × 1440; driver padding, compositor and resolve copies are unknown.

Tracked GL texture storage is approximately 692.66 → 614.67 MiB, including material, shadow-color and resolved-refraction textures. Tracked renderbuffers add approximately 140.40 MiB under the assumptions above. Environment and the browser's default framebuffer are separate. These are allocation estimates from dimensions, formats and storage calls, **not measured physical VRAM**. r176 allocates/generates LCD mipmaps despite its LinearFilter; the raw loading records' material-only estimate omitted that 0.57 MiB, while their GL-storage observations and the final full/visual records include it. No display implementation change was made.

## Loading observations

Three sequential model-cache reloads and three warm requests per candidate, on localhost. The viewer boots in its established Performance preset, 955 × 720 drawing buffer. “First usable” means the first complete model render was submitted and the next RAF occurred; it does not mean an independently measured GPU completion/presentation timestamp.

| Candidate | Reload model fetch median | Parse including decode median | First usable reload median [range] | First usable warm median [range] |
| --- | ---: | ---: | ---: | ---: |
| Original | 369 ms | 569 ms | 4.22 s [4.17–5.24] | 4.39 s [4.01–10.18] |
| KTX2 subset | 362 ms | 1,012 ms | 4.21 s [4.15–23.96] | 3.83 s [3.66–6.00] |
| Meshopt | 168 ms | 559 ms | 4.17 s [4.05–5.79] | 4.19 s [3.76–9.66] |

Meshopt reload decode/allocation CPU time was 42–69 ms (median 44 ms), with a 211 ms warm outlier. KTX parse/transcoding is slower than PNG parsing for this subset, while initial upload submission is lower in the typical observations. Original reload first-model render CPU median is 3.04 s, including 2.64 s inside texture allocation/upload submission calls. Corresponding medians are 2.55 / 2.20 s for KTX2 and 3.09 / 2.71 s for Meshopt. The raw records separate image decode intervals, transcode intervals, mesh decode calls, GL upload submission and shader compile/link calls. Decode/transcode intervals overlap; summing them is not elapsed loading time. Shader compile/link calls alone do not measure all deferred driver compilation.

**No robust first-usable speedup is established.** Later observations contain large first-render stalls. These are retained, not trimmed. Browser shader/WASM caches, thermal state, GC and driver/system memory pressure were not controlled. “Reload” forces the model fetch to revalidate/reload; it is not a fresh-browser/process/OS-cache experiment, and decoder code may be cached. `transferSize: 0` appears for some cached resource entries. These localhost timings do not predict WAN download time or a production server's HTTP-compressed transfer ratios. The fixture currently imports both pilot loader modules for a common comparison harness, including in the original case; it is not a production minimal-module-load benchmark.

## Rendering and feasibility

Chromium 155, ANGLE Metal / Intel Iris Plus Graphics 655, identical 955 × 720 CSS scene, **1910 × 1440 Studio buffer**, full-scale refraction, logarithmic depth, lighting and shadows retained. The fixture explicitly fixes output DPR at 2 in Studio because the desktop browser's native DPR changed during validation. Performance stays at 1. All compared full-resolution records use the same buffer dimensions.

One focused sequence per candidate: 750 ms orbit warmup + 3 s sampling, then 1.8 s lid and explosion observations. Whole-render asynchronous GPU queries sample every fourth rendered frame and include shadow/refraction/main work. CPU and GPU overlap and are not added.

| Candidate | Orbit median / p95 | Lid median / p95 | Explosion median / p95 | Orbit GPU median |
| --- | ---: | ---: | ---: | ---: |
| Original | 62.1 / 74.4 ms | 58.5 / 64.6 ms | 63.8 / 73.2 ms | 50.9 ms |
| KTX2 subset | 53.2 / 57.7 ms | 53.2 / 58.0 ms | 53.3 / 57.5 ms | 46.0 ms |
| Meshopt | 57.7 / 61.5 ms | 60.6 / 72.2 ms | 56.4 / 59.5 ms | 49.9 ms |

Orbit remains 395 draws and 1,751,896 submitted triangles; geometry animations use 577 draws and 2,622,665 triangles including shadows. All 874,229 logical triangles and 95 component identities remain. Meshopt has no inherent steady-state draw/triangle benefit; its small timing difference is not proof of a rendering improvement. The KTX2 observation suggests texture effects can help, but the short sequential samples do not isolate a reliable speedup or justify extrapolating to all artwork.

Even the best observed orbit median is **36.5 ms over budget**. Its 46 ms GPU median alone would need approximately 64% reduction to fit 16.7 ms before reserving headroom. This result and the earlier approximately 51 ms GPU baseline do not support continuing small CPU/delivery optimizations as a credible route to the goal. Sustained full-resolution 60 fps has not been achieved or demonstrated feasible.

The early separate-pass GPU-query experiment roughly doubled apparent GPU/frame cost. It is rejected as perturbing the workload; the established whole-frame query method returned approximately 51 ms. Do not use its transmission/main/shadow numbers as lower bounds or sum them. A later fixture picking error occurred after the original whole-frame timings completed; those timings are retained, and the corrected visual-only rerun passed. Failed fixture records remain explicit in the JSON.

## Visual and functional checks

Existing 13 focused tests passed; three new delivery tests pass. They verify the unchanged source hash, metadata/transforms/materials, exact Meshopt decoded bytes, virtual buffer alignment, KTX dimensions, sRGB descriptor, straight alpha, mip chain and PNG fallbacks. Browser checks pass for all three candidates: 874,229 triangles, seven detailed-board identities, 95 components, full-resolution settings, regulator picking/isolation/visibility, LCD telemetry/presentation, X-ray and Performance mode. Existing fixture coverage for all other controls is reused.

There are 14 matching image comparisons: assembled, lid, exploded, both regulator faces, oblique regulator view and acrylic, each against both candidates. Meshopt assembled/exploded/acrylic and the unpopulated face/oblique views are pixel-identical; populated-face maximum difference is 1/255. Lid has small animation/shadow sampling differences (0.039% of pixels exceed 8/255), so that capture is not evidence of lossy geometry. KTX2 acrylic is pixel-identical. Its populated-face comparison changes 0.0068% of pixels above 8/255; other face/oblique maximum differences are 5/255 and 3/255. Fine artwork remains legible in inspected captures, but KTX2 is not claimed visually lossless at every scale. CPU-generated mips can differ from driver-generated PNG mips.

An independent native BC7 mip-zero check found no source pixels crossing the silkscreen's 0.1 alpha threshold. Top-copper and silkscreen alpha are exact in that check; bottom-copper alpha changes by at most 1/255. Copper uses BLEND, so continuous alpha matters; a threshold check alone does not validate blended edges. Other devices/transcode formats and all zoom/filter combinations remain untested. The derivative remains a candidate for user review, not an adopted asset.

The first captures named `regulator-top/bottom/side` accidentally repeated the focus API's isometric pose. They are excluded from directional evidence and replaced by `artwork-front/back/oblique`, which use three explicit matching camera directions. “Front/back” denote the chosen local-normal directions, not component-side nomenclature. `delivery-artwork-close-comparison.png` shows original left, KTX2 right at identical pixel scale.

## Atlasing assessment

The top/bottom copper materials share render state except texture, but silkscreen uses MASK while copper uses BLEND. Merging copper into a per-board atlas could at most remove one material group per applicable board instance: six instances, approximately 12 visible-pass draws with the current double-sided blended rendering. That is about 3% of 395 orbit draws before considering transparent sorting. It does not eliminate opaque transmission replay, reduce triangles or guarantee GPU savings. A global atlas would still need independent component ownership, compatible material state, padding/mipmap bleed protection and culling. No atlas was built; this is not a justified next investment for 60 fps.

## A different fix, with the same website

Keep the existing website/sidebar/controls and the public twin integration contract. Reuse the original model, component manifest, CAD transforms, telemetry and LCD behavior. A replacement should be confined behind the 3D viewport's renderer adapter.

1. **Best targeted hypothesis:** a new full-resolution rendering pipeline that reuses the opaque scene color/depth for refraction/composition instead of replaying the opaque geometry for both transmission and the main image. Investigate resolve/mipmap work and material/overdraw cost at the same sampling quality. This directly targets GPU work visible in the r176 source. It is a research hypothesis, not an implemented fix or a promised 60 fps result. Transparency ordering, tone mapping, double-sided acrylic, depth precision and shadows are significant correctness risks.
2. **Alternative prototype:** a pinned modern Three.js WebGPURenderer with equivalent node materials and verified depth/refraction behavior. It supports WebGPU and WebGL2 fallback, but is not a drop-in performance guarantee; official guidance explicitly acknowledges scenes that remain faster in WebGLRenderer. A fallback must be reported as such. This would require a separately approved dependency/version change and compatibility review. [Official migration guidance](https://threejs.org/manual/pages/webgpurenderer), [renderer depth/options](https://threejs.org/docs/pages/WebGPURenderer.html).
3. **Full engine replacement, such as Babylon.js:** possible, but presently weaker evidence for the additional porting cost. Its glTF loader also configures transmission handling, and GPU shader/render-target costs still need measurement. Existing CPU optimizations already address much of the generic scene-management advice. [Babylon optimization guidance](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene), [transmission implementation](https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/loaders/src/glTF/2.0/Extensions/KHR_materials_transmission.pure.ts).

**Next approval should be for one bounded renderer proof, not a full rewrite or another open-ended optimization pass.** The proof must run this model on the intended minimum hardware at the same 1910 × 1440 output/refraction sampling and preserve all geometry/artwork/depth behavior. Require a sustained matched orbit/lid/explosion run with median and p95 at or below 16.7 ms, plus correctness checks for close PCB layers, acrylic, shadows and live LCD updates, before investing in a complete integration. If it cannot pass, report the remaining gap and explicitly decide hardware/quality requirements instead of silently lowering them. No replacement implementation was started in this pilot.

## Reproduction and files

```sh
python3 verification/twin-optimization-20261109/delivery-server.py
# Open http://127.0.0.1:8769/verification/twin-optimization-20261109/delivery.html
# Loading: three reload/warm pairs per model. Rendering: one sequence per model.
# Artwork: explicit two-face/oblique capture; no repeated rendering benchmark.
node --test verification/twin-optimization-20261109/delivery-pilots.test.mjs
node --test tests/twin/render-optimizations.test.mjs
node --test tests/twin/models.test.mjs tests/twin/telemetry-integration.test.mjs
python3 verification/twin-optimization-20261109/analyze-delivery.py
```

Rebuild derivatives with `KNIGHT_BASISU=/path/to/pinned/1.16.4/basisu node verification/twin-optimization-20261109/build-delivery-pilots.mjs`. The source archive URL/hash and executable hash are recorded; the encoder was compiled locally from its upstream CMake source list with clang, C++11, `-O2`, SSE disabled and Zstandard enabled. No encoder executable is shipped. Encoder command lines and logs are in `delivery-assets/`.

New files are the local server/HTML/runner/probe, builder/test/analyzer, pinned local vendor files, separate assets/build report, raw `delivery-results.json`, derived `delivery-analysis.json`, alpha-check report and captures. `delivery-invalid-instrumentation.json` is the rejected early loading instrumentation attempt, which omitted immutable texture-storage/sub-image calls and async Meshopt decode timing; it is not used for the loading table. Python/JavaScript syntax checks and `git diff --check` pass. No AGENTS.md rule update is needed.
