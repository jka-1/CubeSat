# Knight EPS — reset, orbit, battery isolation and model replacements

## Task and working directory

Work in `/Users/itzjaclechtman/Documents/Senior Design/CubeSat-telemetry-baseline`.

Read this handoff and the repository `AGENTS.md`, inspect the current working
tree, briefly explain the implementation plan, then implement these changes
locally. Do not deploy or change production configuration. Preserve unrelated
dirty/untracked work. Do not use subagents. Keep investigation and tests bounded;
reuse the existing studies instead of restarting the rendering investigation.

The handoff-writing chat changed documentation only. These new requests are
not implemented yet.

## User's requested changes

1. **Reset View resets the whole view and makes everything visible.**
   The current button only resets the camera. Make it restore the assembled,
   default isometric view and default physical orbit anchor, clear selection,
   isolation, temporary focus ghosts, x-ray, extraction and visibility overrides,
   and show every component/group again. Restore corresponding UI controls and
   checkboxes. Clear the component search if needed for a complete explorer
   reset. Reset View must also recover from a hidden payload/battery pack,
   open lid and exploded assembly. Preserve the selected rendering quality,
   live telemetry subscription/source and LCD content/presentation state.

2. **Deselecting a focused item outside isolation restores the default orbit.**
   Empty-canvas deselection currently removes the highlight/temporary reveal,
   but the camera continues orbiting the previously focused component. When
   focus is active and isolation is not active, return the orbit target to
   the same stable chassis anchor used by the default assembly view. Avoid
   an abrupt camera jump; preserve the viewing angle/distance where practical.
   This is not a full visibility/assembly reset. When isolated, deselection
   must preserve isolation and its local inspection framing/pivot.
   Preserve normal single-click selection and double-click focus semantics.

3. **Fix battery-pack isolation.**
   User report: “When isolating the battery pack, one battery remains visible.”
   Reproduce through the actual UI first. Pack-level isolation must retain
   the holder and all four cells together, with no unrelated geometry left
   visible. Restore the previous visibility when leaving isolation. Keep
   physical cell identities and geometry; use logical grouping, as with the
   payload, rather than merging away CAD identities. If individual-cell
   inspection remains available, distinguish it from selecting the complete
   pack. Verify pack highlighting, visibility, focus and isolation agree.

4. **Replace the MPPT and BMS models with the supplied high-fidelity models.**
   Preserve all functionality, placement/orientation, real scale, mounting
   relationships, selection, visibility, isolation, head-on PCB focus,
   animations, telemetry fields and existing public integration IDs.
   Identify the actual new source files before modifying assets; do not
   substitute the old exports or guess which file corresponds to which board.

## Read first — current truth, not the old optimization handoff

- `site/knight-eps-phase12/docs/rendering.md`
- `verification/twin-integration-20261111/inspection-report.md`
- `verification/twin-integration-20261111/inspection-provenance.json`
- `verification/twin-integration-20261111/loading-floor-report.md` for loading
  and concurrency findings only; its finite Lambert floor is superseded.

`verification/twin-optimization-20261109/NEXT-SESSION.md` is historical. Its
old renderer/performance findings and approval workflow are not the current
implementation plan. Do not reintroduce rejected renderer experiments.

## Current implementation and likely edit points

### Viewer interaction

- `site/knight-eps-phase12/viewer/main.mjs`
  - `#reset-camera` currently calls only `fitModel('iso')`.
  - `reset()` already restores assembly, visibility and isolation, then calls
    `requestFrame('iso')`. Reuse/refactor it rather than adding a second reset
    state machine. Check search, detail UI and all visibility controls too.
  - `clearFocus()` clears temporary ghosts and sets `orbitMode='satellite'`,
    but does not restore `controls.target` — relevant to deselection.
  - `select()`, `focusSelected()`, the `isolation` snapshot, `syncVisibility()`,
    `listParts()`, `fit()` and `animate()` own the relevant behavior.
  - Preserve the pending named fit after assembly settles; an earlier bug
    cancelled the reset camera transition with a later `requestFrame()`.
- `site/knight-eps-phase12/viewer/inspection.mjs`
  - Logical payload grouping, selection members, PCB focus frames and curved
    camera transitions. A suitable place to extend battery-pack ownership.
  - Payload logical ID: `NerdMiner_Heltec_V2`; its 20 original members resolve
    to this selection. Member IDs remain accepted by `select`/`setVisible`.
  - Battery holder/cells are currently separate logical selections, which is
    a likely source of the reported pack-isolation behavior. Verify the cause.
- `site/knight-eps-phase12/viewer/render-optimizations.mjs`
  - `instanceFixtures().sync(selected, overrides)` renders selected/ghosted
    fixtures independently and removes them from opaque instance batches.
    Preserve this; otherwise a faded clip still draws opaque in its batch.
- `site/knight-eps-phase12/viewer/index.html`: entry-point cache version and
  existing UI. Keep the website layout.

Battery physical IDs: `BatteryHolder_4x18650_CAD`, `BatteryCell_01`,
`BatteryCell_02`, `BatteryCell_03`, `BatteryCell_04` (`battery_assembly` group).

### Model identities and source availability

- MPPT/solar power-path controller integration ID: `Charger_BMS034A_EVM`.
  Current metadata describes the BQ25798 board; existing upgrade source is
  `BMS034A_PCB_1_high_detail.glb`. The name containing “BMS” does not establish
  that it is the BQ76942 board.
- Battery-management board integration ID: `BMS_BQ76942`.
- Metadata: `site/knight-eps-phase12/docs/component_manifest.json` and
  `site/knight-eps-phase12/docs/model-upgrades.json`.
- Existing archive: `model-sources/Final_Models_V1.zip`. It contains the
  previously used `Final Models_V1/BMS034A_PCB_1_high_detail.glb`; its existing
  report explicitly says the archive has no BQ76942 replacement.
- **The paths of the newly supplied replacement pair were not established
  in the handoff-writing chat.** Inspect the next chat's attachments and
  relevant workspace files. Record paths/hashes and verify board identity.
  If either source is unavailable, ask for that file/path while completing
  independent UI fixes. Do not claim the asset replacement is complete.

### Asset pipeline and safeguards

- `scripts/build-detailed-twin.mjs` rebuilds the canonical assembly from
  `models/KnightEPS_Phase10.glb` plus CAD exports. It currently assumes the
  old ZIP naming/layout, flat CAD nodes and particular axis mappings/offsets.
  Inspect new assets before reusing those assumptions. Preserve supplied
  normals, transforms, materials and artwork where applicable; do not flatten
  transformed nodes incorrectly or recompute normals blindly for new inputs.
- `scripts/build-display-twin.py` and `scripts/twin-display/` generate the
  compact derivative, closed-solid certificate, full-resolution artwork
  coverage, gzip transport and provenance.
- `site/knight-eps-phase12/viewer/rendering/model-loader.mjs` loads the display
  package and validates hashes before certified culling.
- Current canonical SHA:
  `dee1eeb8d43504350bf0c34fc8eff95210aa505eec6ff0da168c6f740c803f47`.
  Current baseline: **95 physical components, 874,229 logical triangles**.
  These are pre-replacement values, not requirements to retain obsolete board
  triangles. Keep logical identities stable and independently account for
  the new triangle totals and the unchanged geometry of unaffected parts.
- The compiler, loader and tests deliberately pin source hashes/counts.
  Update pins only after auditing the intentional replacement. Rebuild the
  derivative/certificates/masks/provenance together. Do not just bypass hash
  checks or keep a certificate from the old model. Inspect artwork extraction
  assumptions: new PCB textures may not fit the current constant-color R8
  coverage reconstruction. Use it only when exact texel recovery is proven;
  preserve original RGBA materials where it does not apply.
- Stage new assets and compare before adopting them. Keep source exports and
  a recoverable baseline. Do not externally upload model assets or silently
  simplify, quantize, downsample or nonuniformly scale the supplied models.
- Verify substrate/support anchors, connector direction, units and board
  bounds. Do not move fixtures or claim physical fit without evidence.
- Keep the lossless `.glb.gz` delivery and older-browser RGBA fallback.
  Update `scripts/deploy-detailed-twin.sh`'s local file list if dependencies
  change, but do not execute deployment.

## Preserve existing behavior and performance

- Continuous constant environment background plus transparent, front-sided
  ground-shadow receiver: no visible floor edge; underneath only shadows go.
- Single-click selects; double-click focuses on canvas and list. Empty
  double-clicks and drags must not trigger focus.
- PCB component-side head-on views track current parent transforms, including
  the opened lid. Battery/payload focus approaches their outside faces.
- Temporary obstruction ghosts restore correctly. No per-frame raycasting
  was introduced; sightlines are checked when focus is requested.
- Full source detail, live LCD, dashboard shared SSE, existing telemetry
  semantics, demand rendering, cached shadows and pinned Three.js r176.
- Preserve corrected material invalidation when shadow quality changes;
  Studio shadows must not depend on a later depth-mode transition.
- Full Studio DPR up to 2, FXAA, bounded depth with safe log-depth fallback,
  certified culling, cheap occlusion and regional acrylic capture.
- User's target remains **60 fps**, including external monitors and an older
  2018 Intel MacBook Pro. Never use 30 Hz as the design target.

Recent evidence: 31 focused tests and 19 inspection browser assertions passed.
A subsequent three-test fixture rerun and targeted browser check passed after
the ghosted-instance fix. A short orbit measured GPU p95 8.52 ms on Iris Plus
655 at a 1910×1440 drawing buffer. This is not native 60 Hz presentation proof
or a thermal qualification. Previous model compression was 34.6 → 8.1 MB,
with simulated 20 Mbps navigation-to-ready 18.4 → 6.8 s; new model sizes and
loading costs must be measured again after replacement, without broad reruns.

## Bounded acceptance checks

1. Hide several individual parts/groups and the payload; isolate; focus;
   enable x-ray; open/explode. Reset View must restore every component,
   default assembly/camera/orbit and coherent controls without changing
   quality, disconnecting SSE or resetting the live LCD.
2. Focus a PCB, battery and payload; deselect outside isolation. Confirm the
   default chassis orbit anchor returns and temporary ghosts clear. Repeat
   while isolated and confirm its local pivot/visibility remain intact.
3. Select/isolate the complete battery pack from both canvas and list. Check
   all four cells plus holder, consistent highlighting/visibility, and exact
   restoration of prior visibility. Recheck complete payload isolation.
4. Confirm each new PCB's source identity, true-scale placement, materials,
   traces/text, top/bottom and oblique appearance, picking, head-on focus,
   isolation and telemetry fields. Confirm unrelated CAD/LCD/animations remain.
5. Run focused tests appropriate to the actual changes. Relevant suite:

   ```sh
   node --test tests/twin/inspection.test.mjs tests/twin/render-optimizations.test.mjs tests/twin/models.test.mjs tests/twin/telemetry-integration.test.mjs tests/twin/render-pipeline.test.mjs tests/twin/display-assets.test.mjs
   ```

   Change count/hash expectations to independently established new truths;
   do not weaken tests to force the new models through.
6. Reuse the bounded CDP driver and evidence in
   `verification/twin-integration-20261111/test-browser.mjs`. Add checks for
   these regressions. Do not run old count assertions unchanged after an
   intentional model update. One desktop/mobile visual batch, one correction
   batch if needed; no open-ended polishing or repeated broad benchmarks.
7. For materially heavier models, measure download/decode/preparation and
   one short representative GPU workload. If performance regresses, identify
   the cost and use fidelity-preserving remedies. Do not declare success by
   dropping detail or changing the 60 fps target.

Local preview was `http://127.0.0.1:8770/site/knight-eps-phase12/viewer/`.
The dedicated temporary Chrome profile used CDP port 9227; check availability
before reuse and do not use a personal browser profile. Leave an
uninstrumented normal viewer open when finished.

Finish with files changed, checks/results, any unavailable model inputs or
remaining limitations, and the fact that nothing was deployed.
