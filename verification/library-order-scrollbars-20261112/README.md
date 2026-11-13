# Saved library ordering and scroll surfaces — 2026-11-12

Implemented locally. No deployment, push, production configuration changes, or hardware commands were performed. All browser data came from a disposable loopback bridge and SQLite fixture. `documentation/tooltips/` and the pre-existing untracked `documentation/prompts/` were left unchanged.

## Behavior and persistence

The bridge’s existing recording SQLite database now has a separate `sequence_library_order` singleton containing stable definition IDs and an optimistic version. Existing libraries seed their former newest-first order once (with an ID tie-break); subsequent creates and duplicates append, revisions/renames stay in place, and deletions remove only their IDs. The former 100-definition list truncation is removed. Definition JSON, revision rows, pinned references, execution snapshots and events are independent of this metadata.

`GET /sequences` returns the ordered library plus `{ order: { version, ids } }`. `PUT /sequences/order` accepts `{ id, before_id, expected_version }` (`before_id: null` means the end). The existing operator authentication, CSRF and post-body session check apply. Hardware ownership and command tokens are unnecessary. A stale version returns 409 without changing order. The panel refreshes confirmed state and offers an explicit retry of the intended ID move; it never sends a replacement list that could drop concurrent additions. Failed writes retain confirmed order. Deleted drag sources/targets produce feedback rather than resurrecting entries.

The Arrange library disclosure provides pointer handles, insertion marks, edge scrolling, named revision choices, selected state, keyboard move buttons, focus restoration and live announcements. Selecting a name still requires Load. List updates change only selector options, preserving the editor DOM and pinned input values. The same order feeds Run Saved Sequence reference choices.

Shared native scrollbar tracks, thumbs, corners and applicable resize grips use dark surfaces and muted gold/neutral colors. Controls have native dark styling. Flex/grid sizing, wrapping, deep mobile branches and the saved-run list were corrected; page-wide overflow is no longer hidden. Long histories, tables, logs and Twin lists retain useful bounded scrolling. The manual and Twin documents theme their own scroll surfaces. A mobile telemetry-dialog stacking defect was corrected so navigation cannot cover its header or Close control. Only asset cache keys changed in the app entry points and module links.

## Verification performed

- **111 focused Node tests passed**, zero failed/skipped: sequence model/editor/actions/composition/order, authentication, recording store, run model/UI, navigation/auth, debug/streaming UI, and Twin integration/inspection/render optimization. See `focused-tests.txt`. Includes SQLite reopen, stable rename/revision/create/duplicate/delete behavior, legacy migration with 125 entries, stale moves, concurrent membership changes, transactional storage failure and retry, two operator sessions, viewer/unauthenticated denial, missing/incorrect CSRF, bad Origin, sign-out/sign-in, and byte-identical revision/execution evidence after reorder.
- **16 browser interaction checks passed** against the real ordering module in `tests/sequence-library-order.html`. See `browser-regressions.txt`. Covers confirmed state, failed save/retry, stale conflict/retry, unchanged-poll focus retention, synthetic touch-pointer dragging with edge scrolling and insertion feedback, addition/deletion during dragging, Escape, empty state and editor-data preservation. Synthetic touch capture is stubbed in the harness; it is not a physical-device test.
- Actual mouse dragging and keyboard Enter moves were exercised in the authenticated editor. Escape restored the trigger. An unsaved draft name, selected definition, reference selection and manually pinned revision 7 survived ordering (`unsaved-reference-check.json`). The confirmed order was seen again after a real local bridge restart and subsequent sign-in.
- Browser measurements at **320, 390, 768 and 1440 CSS pixels** covered Home, Dashboard, I²C Telemetry, Network Statistics, Programming, Logged Telemetry, Branch Definition and Manual. No document horizontal overflow: `layout-audit-final.json`. The fixture included 35 saved definitions, a long saved name, four nested branches, 45 histories with 120 long events each, and an archived 200-packet table. Final deep-editor inspection at 320 found no overflowing descendants. The run-library width matched its scroll width; packet-table horizontal scrolling stayed inside its wrapper. Viewer controls were hidden correctly at 390.
- Embedded and standalone Twin documents were checked at all four widths (`twin-layouts.json`, `twin-standalone-layouts.json`). Mobile panels at 320/390 had no horizontal overflow (`twin-mobile-panels.json`). Selection, panel toggling, zoom, actual orbit dragging and the rendering-quality selector worked. Component lists retain their own bounded scroll. Camera, telemetry and model code were unchanged.
- Representative final screenshots cover ordering, focus, the deep editor, histories, tables, viewer mode, telemetry dialog and both Twin presentations. Computed scrollbar colors were dark in the dashboard, manual iframe and Twin. Visual inspections showed no bright tracks or corners in this Chromium-based browser. A temporary browser stall after loading multiple Twin documents was resolved by closing those test tabs; subsequent checks completed in one tab.
- JavaScript syntax checks and `git diff --check` passed. Impeccable’s detector ran once; its only advisory was the existing topology grid background. It cannot resolve dashboard-relative stylesheet links from the backend HTML fragment, so those warnings were evaluated against the actual browser rendering.

## Limits and copy inventory

Exact **200% browser page zoom was not verified**: the in-app browser ignored the normal zoom shortcut and exposed only viewport sizing. Narrow-width reflow was verified directly. Physical touch hardware, Firefox/Safari, OS overlay-scrollbar preferences, and forced-colors/reduced-motion OS settings were not exercised. Forced-colors fallbacks and existing reduced-motion behavior remain in source. Native select popups, OS overlay scrollbars and some resize grips may retain browser/OS-controlled appearance; CSS cannot guarantee their exact rendering.

No existing tooltip wording changed and no new `title`/`data-tooltip` copy was added. New visible and accessible ordering labels/help/status text live in `sequence-library-order.mjs` and the sequences view; include them in a future help/accessibility inventory if desired. The pending Word/tooltip wording review was not edited. No AGENTS.md rule update is warranted. Impeccable reported its optional future build preference as unset; its configuration was left untouched.

## Changed source files

- Persistence/API: `telemetry-bridge/recording/store.mjs`, `recording/worker.mjs`, `server.js`.
- Ordering UI: `site/assets/js/sequence-library-order.mjs` (new), `sequences.js`; `telemetry-bridge/auth/views/sequences.html`.
- Shared/layout CSS: `site/assets/css/{styles,sequences,sequence-history,runs,debug-mode,link-health,streaming}.css`.
- Independent documents: `site/knight-eps-phase12/viewer/{styles.css,index.html}`, `telemetry-bridge/auth/views/manual-document.html`.
- Cache keys: `site/index.html`, `site/assets/js/{app,router}.js`, `site/modules/{link-health,runs,twin}.html`, `telemetry-bridge/auth/views/debug-mode.html` (plus the view/document links above).
- Regression coverage: `telemetry-bridge/test/sequence-library-order.test.js` (new), `auth.test.js`, `tests/sequence-library-order.html` (new).

To rerun the browser interaction harness, serve the repository on loopback and open `/tests/sequence-library-order.html`; it uses an isolated in-memory library and makes no bridge/hardware requests. For authenticated manual review, the existing `node tests/access/preview.mjs` creates a disposable local bridge/site fixture.

## Follow-up: quieter move controls

Replaced the visible Move up/down labels and bordered buttons with small, borderless SVG arrows. On mouse/trackpad devices they appear only for the hovered or keyboard-focused row; keyboard focus and accessible action names remain available. Touch/coarse-pointer devices retain quiet arrows with 44px targets. Rows use the freed space for definition names, including at phone widths. Updated the visible panel instructions; no tooltip text or Word inventory changed.

Verified desktop appearance, keyboard movement and 390px layout in a disposable local preview. The existing 16 browser interaction checks and four ordering-store tests passed again; JavaScript syntax and `git diff --check` passed. See `ordering-subtle-arrows-desktop.png`, `ordering-subtle-arrows-390.png`, and `browser-regressions-subtle-arrows.txt`. Earlier screenshots show the original labeled controls.
