# Connected sequence features — local verification, November 12, 2026

Implemented locally in `CubeSat-telemetry-baseline`. No deployment or production configuration changes. Existing uncommitted register, telemetry, UI and firmware-tool work was retained.

## Inspection

Read `AGENTS.md`, inspected the current sequence editor/model/engine/API/store/history and their pre-existing diffs, reviewed available sequence history and local branch refs (including `github/sequence-runner`), and checked the other available worktree. No saved Branch Definition deletion handler was present in those sources. Existing block-removal controls were preserved. The current web revision-conflict Cancel handler did discard edits; it now leaves the draft and its base revision intact.

## Behavior

- Overwrite and deletion require explicit identification of the definition ID and revision, with consequences explained. Cancel sends no destructive request and preserves draft contents. New/Load and browser navigation guard unsaved edits; clean definitions and same-page navigation avoid extra prompts. In-app navigation retains the existing in-memory draft behavior.
- PUT requires the current `revision` and matching `confirmed_revision`. DELETE requires the same pair, operator authentication and CSRF protection. Worker transactions reject competing saves/deletes and stale revisions. Definition maintenance retains editor-only operator access; hardware actions still require the existing control lease and command token.
- A new immutable `sequence_revisions` table backfills existing saved definitions. Deletion removes the library entry, retaining archived revisions and run snapshots. Current saved definitions referencing the target directly or through older pinned dependencies block deletion. Revision numbers remain monotonic after deletion/recreation.
- `runSaved` selects a definition and pins a revision on any sequence path. Each execution snapshots its complete dependency graph. Validation visits every conditional path, rejecting direct/indirect recursion, missing revisions, combined call/IF depth beyond 8, more than 1000 expanded blocks, or snapshots over 1 MiB. Individual definitions retain existing size/block limits.
- Nested calls share the parent run's authorization, target, cancellation, pause, timeout, command pacing, recording and hardware-safety lifecycle. Register metadata and read-result scopes remain separate per invocation. Preflight lists pinned dependencies. Ordered events identify the definition, revision, block and conditional/call path; nested start/completion/failure and messages appear in execution history and live recording timelines.
- `message` is a logging action, limited to 1000 UTF-16 code units of nonblank plain text, rejecting unwanted control characters. It executes no code, formatting directives or shell commands. Only a selected/executing block logs its timestamped message; text is safely rendered. Simulation sends no hardware commands or hardware-recording annotations.
- The bundled desktop client's save confirmations/payloads and block editor/model were updated for the shared API. Its separate explicit discard action remains available; conflict Cancel preserves edits, and conflict overwrite does not ask a second time.

## Changed files for this task

Pre-existing changes within shared files were retained. Other dirty files are outside this task.

| Area | Files |
| --- | --- |
| Web editor and actions | `site/assets/js/sequences.js`, `site/assets/js/sequence-editor-model.mjs`, new `site/assets/js/sequence-actions.mjs` |
| Navigation and cache entrypoints | `site/assets/js/router.js`, `site/assets/js/app.js`, `site/index.html` |
| History and recording event display | `site/assets/js/sequence-history.mjs`, `site/assets/js/runs.js`, `site/modules/runs.html` |
| Editor markup and styles | `telemetry-bridge/auth/views/sequences.html`, `site/assets/css/sequences.css`, `site/assets/css/sequence-history.css` |
| Backend model and execution | `telemetry-bridge/sequence/model.mjs`, `telemetry-bridge/sequence/engine.mjs`, new `telemetry-bridge/sequence/dependencies.mjs` |
| Persistence and API | `telemetry-bridge/recording/store.mjs`, `telemetry-bridge/recording/worker.mjs`, `telemetry-bridge/server.js` |
| Desktop compatibility | `cubesat-i2c-tool/cubesat_i2c/branch_page.py`, `cubesat-i2c-tool/cubesat_i2c/sequence_model.py`, `cubesat-i2c-tool/cubesat_i2c/wireless_session.py` |
| Tests | new `telemetry-bridge/test/sequence-actions.test.js`, new `telemetry-bridge/test/sequence-composition.test.js`, `telemetry-bridge/test/auth.test.js`, `cubesat-i2c-tool/tests/test_branch_definition.py` |
| Documentation and evidence | `telemetry-bridge/SEQUENCES.md`, this report, `verification/sequence-editor-20261112.jpg` |

## Results

**61 focused tests passed; no failing tests remain.**

- 43 passed: Node sequence actions/composition/editor/engine and runs model/UI tests.
- 7 passed: HTTP authentication/authorization and live recording integration tests using loopback HTTP/UDP fixtures. Covers unauthenticated/viewer/CSRF rejection, unconfirmed overwrite/delete rejection, simultaneous overwrites, save/delete races, dependency deletion protection, historical results after deletion, stale preflight rejection, and live execution of an older pinned child after a newer revision is saved.
- 11 passed: Python Branch Definition and wireless-session tests, including Qt offscreen cancellation/confirmation, conflict behavior, new block editing and payload compatibility. An additional selector interaction test caught a Qt sender-lifetime crash; the selector now updates its revision control without deleting the active widget, and the suite passes.
- JavaScript syntax checks and `git diff --check` passed. The UI mechanical detector returned no findings; its HTML route resolver could not resolve the dynamically embedded operator-page stylesheets.

Commands:

```sh
node --test telemetry-bridge/test/sequence-actions.test.js telemetry-bridge/test/sequence-composition.test.js telemetry-bridge/test/sequence-editor.test.js telemetry-bridge/test/sequence.test.js telemetry-bridge/test/runs-model.test.js telemetry-bridge/test/runs-ui.test.js
node --test telemetry-bridge/test/auth.test.js
QT_QPA_PLATFORM=offscreen PYTHONPATH=cubesat-i2c-tool /private/tmp/cubesat-sequence-python-qa/bin/python -m pytest -q cubesat-i2c-tool/tests/test_branch_definition.py cubesat-i2c-tool/tests/test_wireless_session.py
git diff --check
```

HTTP/UDP tests needed permission to bind loopback ports outside the sandbox. Python dependencies were installed only in a temporary virtual environment; system packages were unchanged. The isolated UI bridge/proxy used disposable temporary credentials/storage and has been stopped.

## Verification limits and compatibility notes

The browser successfully authenticated, loaded a saved definition and displayed the new palette/configuration. Its automation connection stalled on the native JavaScript confirmation dialog, preventing a completed interactive Cancel check and further pointer interactions. Cancellation behavior is verified by the JavaScript action tests and Qt tests; responsive/mobile browser verification was not completed. No physical spacecraft hardware was used; live safety/recording checks used the existing UDP device fixture.

Existing schemaVersion 1 definitions and historical run JSON remain readable. External clients that overwrite saved definitions must now provide `confirmed_revision`; both bundled editors have been updated. Immutable revision archives deliberately remain after library deletion.

Desktop palette rendering evidence (not an end-to-end interaction result):

![Local Branch Definition palette](</Users/itzjaclechtman/Documents/Senior Design/CubeSat-telemetry-baseline/verification/sequence-editor-20261112.jpg>)
