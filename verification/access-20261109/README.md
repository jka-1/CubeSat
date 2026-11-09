# Recording, navigation, and permissions — local verification

Implemented in the existing checkout; no deployment or production configuration changes.

The old branch preflight and execution checks required an idle recorder. Each live sequence then unconditionally started and stopped a recording. Live sequence persistence now transactionally joins an active run for the same device/source, distinguishes shared and sequence-owned recording sessions, and writes existing sequence_step events into that session's active timeline. Only a session created by the sequence can be stopped by its terminal callback. Recording, sample timestamps, and the existing mode/source/reboot segmentation policy are preserved. Manual hardware commands remain excluded during live sequence execution, and authorization is rechecked before dispatch.

Primary navigation is **Home / Dashboard / Sign in (or username)** on one row, including mobile. There is no Logging Block link. Public and authenticated viewers receive exactly four dashboard sections. Operators retain all seven existing sections. Saved telemetry retains its existing authentication requirement. Protected templates are served only by operator-authorized backend routes; static legacy URLs contain only redirects. Public observation endpoints are explicitly allowlisted and filter privileged SSE events. Backend JWT roles, CSRF, operator leases, and separate command-token checks remain authoritative; legacy unauthenticated command bypass is removed. Existing command-token clients still work when JWT is disabled.

## Results

- Complete bridge suite: **140 passed / 141 tests**. The one failure, `I²C page never starts simulated data when the bridge reports live`, is an existing source-pattern assertion in `test/streaming-dial-in.test.js`. It fails identically on an untouched HEAD extracted into a temporary directory; the baseline I²C implementation already lacks its expected health-check code. Its source and behavior were left unchanged.
- Focused recording/auth/sequence/Twin regression: **42 passed / 42 tests** (includes all ten Digital Twin model/telemetry tests).
- Final access suite: **7 passed / 7 tests**, including all public/private endpoint statuses, viewer role spoofing, CSRF, operator HTML authorization, logout stream closure, a command body completed after logout, repeated branches within one recording, failed branch preservation of shared recording, independent branch recording, editing while recording, duplicate-start exclusion, sample sequences, exact receive timestamps, and branch timeline markers.
- Final navigation/UI tests after the user's account-button clarification: **10 passed / 10 tests**.
- Browser: public and authenticated viewer tabs; operator's seven tabs; protected editor loading; logout to viewer telemetry; browser Back; direct legacy protected URL; public Digital Twin with all 27 components. Desktop 1440×900 and mobile 390×844 checks confirm no page overflow, no primary navigation overflow, and all three primary controls share a row. Dashboard tabs scroll horizontally on mobile.
- `git diff --check`: clean.

## Scope and limits

Hardware command replies and UDP packets in tests came from a loopback ESP simulator. Physical ESP32/I²C bench validation and production Apache deployment were not performed. Existing telemetry-observed mode/source/reboot boundaries may still segment recordings without losing the session link. Account roles continue to come from the private existing auth file; no users, credentials, production configuration, or schema fields were added.

Design review fixed the primary navigation's mobile fit. Existing gradient heading, glow accents, and decorative background treatments were preserved outside the requested navigation scope; no detector suppressions were added.

For another disposable browser check from the checkout, run `node tests/access/preview.mjs`. Its loopback URL is `http://127.0.0.1:8096/`; fixture usernames are `viewer` and `operator`, with password `local-test-only`. Credentials and recording data are generated in a private temporary directory and removed when the preview stops.
