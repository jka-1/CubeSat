# Dashboard/twin version mismatch — 2026-11-11

The screenshots show only battery, ambient temperature and relative light in
the new six-value LCD. Those are exactly the original adapter's three fields.
The public server's adapter and router matched release `c5113f5c` at 20:37 UTC;
the public SSE sanitizer also preserves the entire telemetry envelope. Public
static-file hashes are recorded in `public-static-check.json`.

An already-open dashboard can retain its imported adapter/router after a
deployment, then fetch the updated twin fragment and LCD. Loading the actual
old adapter (`6cde17de`) with the six-value viewer reproduces the exact three
populated fields. This demonstrates the mismatch without access to the user's
tab or private hardware stream; it does not establish what was cached there.

## Local fix

- The embedded viewer recognizes the legacy dashboard update contract (live
  updates without complete-snapshot metadata). It refreshes that same dashboard
  once with a revision query, preserving its path, existing query and twin route.
- It rejects the partial update while recovering. If the adapter is still old
  after recovery, the LCD requests a dashboard update instead of showing false
  fresh/live readings or entering a reload loop. Multiple packets cannot keep
  restarting a pending navigation.
- The dashboard-to-viewer entry chain uses `20261111-sync`. The shared streaming
  module retains its existing singleton URL and one SSE connection.
- Standalone and third-party public API integrations, explicit mock mode,
  timestamps, stale thresholds, out-of-order protection and geometry are
  preserved. The static deployment manifest includes the new helper module.

No production files, backend, authentication configuration or hardware changed.
No deployment was performed.

## Verification

65 focused Node tests passed across the dashboard guard, twin integration,
display, inspection, models, render pipeline, shared streaming and navigation
authorization. JavaScript/shell syntax and `git diff --check` passed.

Browser checks use the real local dashboard, decoder and viewer in the dedicated
temporary Chrome profile at port 9227 and local preview at port 8770. Auth and
telemetry are explicitly synthetic; no credentials or production SSE are used.

- `legacy-results.json`: old adapter plus the pre-recovery six-value viewer
  reproduces exactly the three screenshot fields.
- `browser-results.json`: one dashboard refresh recovers all six overview
  values, full device readings and RSSI, with one parent stream and no child
  stream or repeated refresh. `lcd-recovered.png` is synthetic test output.
- `blocked-results.json`: an intentionally persistent old adapter shows an
  update message with no false live readings and no refresh loop.
- `current-browser-results.json`: the current adapter needs no recovery;
  correct MPPT values, all six LCD fields, missing-device clearing, sample age,
  expiry, ordering, reconnect behavior and mobile width pass (11 checks).
- `normal-preview.json`: the standalone public live API and six-value mock pass;
  preview restored to the normal uninstrumented viewer, telemetry source none.

Reproduction commands (local preview and dedicated Chrome must be running):

```sh
node verification/twin-sync-20261111/test-browser.mjs --expect-legacy
node verification/twin-sync-20261111/test-browser.mjs
node verification/twin-sync-20261111/test-browser.mjs --expect-blocked
node verification/twin-sync-20261111/test-current-browser.mjs
node verification/twin-sync-20261111/finish-preview.mjs
```
