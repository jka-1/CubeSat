# Shared operator register registry — local verification, 2026-11-12

Implemented locally. No deployment, production configuration change, production/physical-device target, or physical hardware command was used. Tests use local fixtures only.

## Inventory before implementation

| Surface | Previous source/store | Result |
| --- | --- | --- |
| Debug Mode device/register dropdown | `register-map.json`; additions mutated the mounted map only | Verified map plus persisted custom registry; mounted menus refresh |
| Branch Definition Register read and I²C read command blocks | Frontend static sequence catalog, separately validated backend catalog | Built-in catalog plus shared additions and immutable per-definition metadata snapshots |
| Branch Definition Register write and I²C write command blocks | Separate frontend hard-coded allowlists and backend command allowlist | Shared frontend policy; backend allowlist, width and reserved-bit validation retained independently |
| Conditions, including nested AND/OR/NOT | Static catalog and telemetry IDs, embedded definition registers, disconnected localStorage reusable list | Registry-backed choices; legacy IDs and embedded metadata retained |
| Communication manual I²C command panel | Free-text device/register inputs, no catalog suggestions | Shared read suggestions with width selection; approved-write suggestions only; free text preserved |
| MPPT communication detail and streaming overview | Measurements from existing telemetry fields; no 0x2F/0x30 metadata | Both register names, widths and project permissions shown; values explicitly unsampled |
| Debug text sequence commands and probe/scan | Free-text commands, no register selector | Existing command parsing and backend restrictions preserved |
| Python hardware reference and exported web map | `cubesat-i2c-tool/cubesat_i2c/registers.py`, seeded from Register Map.xlsx and TI references | Added matching 0x2F metadata; retained 0x30 and existing write policy |

## Behavior and compatibility

- `/registers` uses the existing private recording database and worker. GET and POST require an operator session; POST requires CSRF/origin verification. Editing-only operator sessions may add metadata without taking the control lease. Recording storage must be configured; otherwise the API returns 503.
- One canonical shared entry per device/register target. Distinct concurrent additions merge transactionally; identical retries reuse entries. Conflicting width, byte order, or nonempty custom label returns 409. Built-in targets reuse their canonical entries instead of creating duplicate rows. Custom metadata cannot supply an access permission.
- Mounted clients poll every two seconds, refresh on focus, and use a browser channel to accelerate cross-tab updates. Only selector options change; unfinished inputs and unsaved definition objects remain intact. Unsaved definitions remain in memory during navigation and clear on sign-out. Definitions must still be saved before a page reload; registry metadata itself survives navigation, reload and bridge restart.
- Existing schemaVersion 1 definitions and operand IDs remain valid. Custom reads embed the selected metadata in `definition.registers`; execution decodes using that snapshot's byte order. Registry changes never replace existing embedded metadata. The old localStorage library migrates on mount, retaining failed/conflicting entries for recovery. Loaded definition additions are offered to the shared registry without rewriting the definition.
- Catalog membership never grants writes. Backend supported-device checks, command token, active control lease, CSRF, exact write widths and BQ25798 REG14 reserved-bit checks remain active. Unsupported device metadata can be cataloged, but firmware commands remain restricted to configured devices.

## Hardware verification

Project references inspected: the Python hardware catalog, exported web register map, frontend/backend sequence catalogs, backend command allowlist, README hardware mapping, and firmware `main/debug_mode.c`/`main/udp_transport.c`. The referenced original Register Map.xlsx is not present in the workspace.

Official source: [Texas Instruments BQ25798 datasheet, SLUSDV2C, sections 7.5.1.43–44, pages 114–115](https://www.ti.com/lit/ds/symlink/bq25798.pdf).

- Device address remains 0x6B.
- 0x2F: **ADC Function Disable 0**, one byte. Hardware fields 7:1 are R/W; bit 0 is reserved/read-only. Project write approval remains disabled, so operator access is read-only.
- 0x30: **ADC Function Disable 1**, one byte. Hardware fields 7:4 are R/W; bits 3:0 are reserved/read-only. Existing project R/W approval is preserved.
- Existing big-endian metadata is retained (byte order has no effect for one-byte reads). The current telemetry protocol does not sample either value. No values or channel states are inferred from reset defaults or other registers.

## Tests and results

`npm test --prefix telemetry-bridge`: **165 tests; 164 passed; 1 failed; 0 skipped**.

The remaining failure is `streaming-dial-in.test.js` → “I²C page never starts simulated data when the bridge reports live”. It checks source strings for the older `health.live_mode`/`health.telemetry_connected` implementation. That live/mock path was already modified in the existing unrelated `i2c.js` work and was not changed by this implementation. Its behavior and the assertion were left untouched.

Passing coverage includes:

- Real headless Chrome + temporary bridge/database: debug → mounted sequence read menu, sequence condition addition → mounted debug menu, same-browser tabs, independent editing-only operator session, selected operands, unchanged unfinished input, navigation with unsaved blocks, saved definition metadata, reload, manual suggestions/widths, write-menu filtering, no duplicate 0x30, and no browser runtime exceptions.
- New registry/store tests: persistence after database reopen; duplicates and conflicts; concurrent additions across mounted clients; migration and failed-migration retention; immutable saved-definition snapshots; custom read decoding and subsequent block-result comparisons.
- Expanded HTTP auth tests: anonymous/viewer denial, CSRF and origin denial, concurrent controlling/editing-only sessions, saved custom-read definitions, rejection of forged access metadata, writes to unapproved custom/0x2F registers, wrong widths, reserved REG14 bit and unsupported devices.
- Existing recorder/store/worker integration, sequence execution/recovery, telemetry, command, conversion, browser mock/streaming and navigation regressions.
- Python/web catalog parity check: names, widths, endian, access and uniqueness match for 0x2F/0x30. The optional Python pytest suite could not run because pytest is absent; no dependencies were installed.
- `git diff --check`: clean.

## Files changed for this task

Frontend registry and shared policy:

- `site/assets/js/register-definition.mjs` (new)
- `site/assets/js/register-registry.mjs` (new)
- `site/assets/js/operator-registers.mjs` (new)
- `site/assets/js/register-controls.mjs` (new)
- `site/assets/js/register-policy.mjs`

Frontend consumers/catalogs and asset versions:

- `site/assets/js/debug-mode.js`
- `site/assets/js/i2c.js` (only registry mounting/import/version changes; existing unrelated changes preserved)
- `site/assets/js/sequences.js`
- `site/assets/js/sequence-editor-model.mjs`
- `site/assets/js/sequence-condition-fields.mjs`
- `site/assets/js/sequence-register-catalog.mjs`
- `site/assets/js/streaming-view.mjs` (only MPPT metadata rows; existing unrelated changes preserved)
- `site/assets/js/app.js`
- `site/assets/js/router.js`
- `site/index.html`
- `site/modules/communication.html`
- `site/assets/data/register-map.json`
- `cubesat-i2c-tool/cubesat_i2c/registers.py`

Backend persistence and validation:

- `telemetry-bridge/register-registry.mjs` (new)
- `telemetry-bridge/server.js`
- `telemetry-bridge/recording/store.mjs`
- `telemetry-bridge/recording/worker.mjs`
- `telemetry-bridge/sequence/register-catalog.mjs`
- `telemetry-bridge/sequence/model.mjs`
- `telemetry-bridge/sequence/engine.mjs`

Operator help and tests:

- `telemetry-bridge/auth/views/debug-mode.html`
- `telemetry-bridge/auth/views/manual-document.html`
- `telemetry-bridge/SEQUENCES.md`
- `telemetry-bridge/test/register-registry.test.js` (new)
- `telemetry-bridge/test/register-registry-ui.test.js` (new)
- `telemetry-bridge/test/auth.test.js`
- `telemetry-bridge/test/dashboard.mock-mode.test.js` (mock for the new mounted control dependency)
- `verification/register-registry-20261112.md` (this report)

Pre-existing changes to `telemetry-bridge/test/streaming-telemetry.test.js` and the untracked `telemetry-bridge/test/i2c-streaming-ui.test.js` were preserved without edits. AGENTS.md did not require changes.
