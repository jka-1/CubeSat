# Knight EPS digital twin — delivery and texture-memory optimization

Work in:
`/Users/itzjaclechtman/Documents/Senior Design/CubeSat-telemetry-baseline`

Plan the next optimization pass, then stop for approval before editing implementation files or model assets. After approval, complete the agreed work locally. Do not deploy.

## Read first

1. Project `AGENTS.md`.
2. `verification/twin-performance-20261109/README.md` — original rendering study.
3. `verification/twin-optimization-20261109/README.md` — implemented optimizations, measurements and validation.
4. Relevant implementation:
   - `site/knight-eps-phase12/viewer/main.mjs`
   - `site/knight-eps-phase12/viewer/display.mjs`
   - `site/knight-eps-phase12/viewer/render-optimizations.mjs`
   - `scripts/build-detailed-twin.mjs`

Reuse the existing evidence. Do not repeat the broad investigation or rendering benchmark without a failure, material change or specific unresolved uncertainty. Inspect working-tree changes before editing and preserve unrelated/untracked work. Do not use subagents.

## Current state

Implemented locally:

- Demand rendering, including controls damping and camera/lid/explosion animation continuation; hidden-document suspension.
- Cached shadows during camera-only movement; refreshes for geometry, visibility, relevant material/light changes.
- Equivalent-material sharing and cached state overrides; no blanket per-mesh material cloning or material `needsUpdate` writes.
- Compatible opaque geometry consolidation within independent components.
- Payload body: 91 meshes → one mesh with five material groups. Acrylic, fixtures and the dedicated live LCD retain their established identities within the payload assembly.
- 52 PCB fixtures → two instance batches, with original logical picking/bounds ownership retained.
- Correct all-pass rendering counters, including shadows.

The GLB and compiler were not modified. All 874,229 logical model triangles and 95 component identities remain. Studio uses output DPR up to 2 and full-resolution refraction, with logarithmic depth retained. Performance mode remains available.

Matched measurements on Chromium 155 / ANGLE Metal / Intel Iris Plus Graphics 655, 955 × 720 CSS scene viewport, Studio buffer 1910 × 1440:

| Interaction | Before median / p95 | After median / p95 |
| --- | ---: | ---: |
| Studio orbit | 66.8 / 83.6 ms | 65.9 / 82.3 ms |
| Studio lid | 66.3 / 67.6 ms | 57.7 / 85.6 ms |
| Studio explosion | 66.6 / 67.7 ms | 53.3 / 69.1 ms |

Orbit draws decreased 985 → 395; median CPU callback/submission decreased 22.5 → 9.0 ms. GPU query median remained around 51 ms. Idle rendering dropped from 33 frames to zero over a 2.2 s no-packet observation. These are short sequential samples, not sustained-performance guarantees. Studio 60 fps was NOT achieved. Do not represent idle rendering avoidance as achieving 60 fps.

Validation: 13 focused automated tests, 14 bounded browser checks and seven before/after image pairs passed. Actual OS background-tab behavior and live SSE load were not benchmarked; hidden/resume was simulated through the actual handler. Details and caveats are in the optimization README.

## New finding: texture dimensions matter more than encoded bytes

The 37,548,864-byte GLB contains 17 PNG images totaling 904,066 encoded bytes. Read-only inspection found dimensions:

- 1024 × 768
- 512 × 388
- Three each of: 3000 × 3862, 3000 × 2272, 3000 × 2347, 3000 × 3487, 3000 × 2417

All 17 encoded image payloads have different SHA-256 hashes. The fifteen large images are PCB top copper, bottom copper and silkscreen artwork across five source board models. The regulator geometry/artwork is reused between its two instances.

Summing dimensions at RGBA8 gives approximately **497.63 MiB before mipmaps**, or **663.50 MiB with a full mip chain**, IF all images were resident. This is a calculated upper-level estimate, NOT measured GPU allocation. The 1024 × 768 image has no remaining material references; the original screen image/material is replaced by the live canvas. Distinguish embedded images, referenced textures, decoded images, uploaded textures and actual/estimated GPU storage. Include framebuffer, refraction and shadow allocations separately.

The previous study's 0.9 MB encoded-image observation did not establish low texture-memory use. Do not dismiss KTX2 based on download size.

## Goal and non-negotiable constraints

Improve cold loading, first usable frame, decoded/uploaded texture footprint and, where demonstrated, runtime GPU cost. Continue targeting sustained 60 fps (16.7 ms), but distinguish loading improvements from interaction improvements and report remaining gaps honestly.

Preserve:

- All CAD geometry and accurate transforms.
- PCB traces, silkscreen, alpha edges and layer ordering, including close inspection.
- Polished lighting, environment reflections, refractive acrylic and soft shadows.
- Selection, highlighting, isolation, visibility, camera controls, lid/explosion animations, LCD presentation and telemetry.
- Performance mode and the established interface.
- Logarithmic depth protection and the vendored Three.js API.

No adaptive sampling, reduced output/refraction resolution, decimation, replacement normal-map baking or reduced-geometry LOD is approved. No dependency upgrade without demonstrated need. No external upload of project/model assets.

Compression may be visually lossy even when topology is retained. Do not silently enable a compressed derivative that degrades artwork, alpha edges or geometric precision. Keep the original GLB intact and independently available. A pilot candidate should remain separate until the user approves adoption.

## Priorities for this session

1. **Audit texture residency and loading stages.** Reuse the static dimension/reference findings; inspect actual runtime texture creation/sharing, formats, dimensions and mip policy. Measure or estimate GPU allocations with explicit assumptions; do not claim portable exact VRAM readings when the browser cannot provide them. Separate download, decode/transcode, parse, upload/shader preparation and first usable frame. Avoid synchronous GPU stalls introduced solely for timing.
2. **Prepare a high-quality KTX2/Basis pilot.** Propose a representative PCB artwork subset covering copper, silkscreen and transparency. Consider high-quality encoding settings and the actual device-supported transcode formats. Preserve dimensions initially. Verify the matching r176 loader/transcoder integration and any required local decoder assets before proposing implementation. Check artwork, alpha thresholds, mipmaps, color space and filtering at close zoom and oblique angles. The live LCD canvas remains dynamic and should not be converted into a static compressed texture.
3. **Evaluate geometry delivery compression.** Compare precision-preserving Draco and/or lossless Meshopt where supported without upgrading Three.js. Do not assume compression ratios or instant loading. Include decoder bytes, decode latency, temporary memory and upload/first-frame time. Verify decoded triangle counts, attributes, component metadata and transforms. Quantization must not disturb microscopic PCB layer separation. Compression alone does not inherently reduce draw calls or rendered triangle counts.
4. **Assess further atlasing only where justified.** Identify compatible PCB material regions and estimate actual draw savings. A single atlas does not imply one draw: geometry and material state must also be compatible. Preserve independent component ownership; keep opaque surfaces, refractive acrylic and the LCD appropriately separate. Avoid unnecessary UV resampling, giant atlases or loss of culling granularity. Do not broaden into a full asset rewrite without a concrete benefit and approval.

Frustum culling already operates in vendored Three.js, and instance bounds are refreshed. No custom object-level occlusion culling was added. Any future culling must account for refractive visibility, shadow contribution, X-ray/isolation and animated assembly states; do not simply hide everything behind the chassis.

## Approval gate

Before editing implementation or assets, present a concise, concrete plan identifying:

- Exact proposed files and derivative assets.
- Pilot scope, encoder/decoder choices and vendored-version compatibility.
- Expected delivery/memory/runtime benefits, clearly labeled as hypotheses where unmeasured.
- Potential visual/precision tradeoffs and acceptance criteria.
- A bounded measurement and validation plan.

STOP and wait for explicit user approval. Read-only inspection and measurements are allowed before this gate. Do not treat this handoff as approval to modify implementation or assets.

## Validation after approval

- Compare matching viewport, device, camera trajectory, quality and sampling settings.
- Separate cold/warm loading, full-resolution interaction and any proposed derivatives. Do not present different sampling settings as equivalent.
- Log actual texture transcode formats, dimensions and estimated storage; include mipmaps and render targets. Distinguish estimates from measurements and peak transient memory from steady residency.
- Preserve source GLB, manifests and component/source provenance. Run existing model-integrity tests if asset processing changes; add only focused checks needed for the approved processing path.
- Use one bounded visual/interaction pass covering fine PCB artwork/alpha edges, acrylic/refraction, shadows, selection/isolation/visibility, LCD/telemetry and animations.
- If runtime rendering changes materially, run one focused orbit/lid/explosion comparison, recording median/p95 intervals and all rendering passes including shadows. Otherwise reuse the existing runtime baseline and measure the delivery/memory changes actually made.
- Repeat only for failures, material changes or unresolved measurement uncertainty. No broad test suites or unrelated refactors.

Existing relevant checks:

```sh
node --test tests/twin/render-optimizations.test.mjs
node --test tests/twin/models.test.mjs tests/twin/telemetry-integration.test.mjs
```

Existing rendering evidence/fixture:
`verification/twin-optimization-20261109/`

Finish with files changed, measured loading/memory/runtime differences, visual tradeoffs, checks performed and the remaining gap to 60 fps. Do not deploy or claim success without evidence.
