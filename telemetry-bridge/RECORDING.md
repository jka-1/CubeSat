# Recording and run analysis

This is a local, opt-in implementation. It has not been deployed. The browser Run Explorer and Windows sequence-run integration are implemented locally; CSV export remains a future milestone. JWT login is also implemented locally: viewers can read history, operators can start/stop runs, and hardware actions still require the existing command token. See `AUTHENTICATION.md`.

## Database decision

Use a private SQLite file with WAL and a dedicated worker for this single-device baseline. This keeps local development independent of the droplet's unrelated `COP4331` MariaDB database, adds no database service and prevents synchronous database work from blocking UDP acknowledgements. The driver is pinned to better-sqlite3 12.8.0, compatible with Node 20 through 25 (excluding Node 21). No MariaDB schema or account has been changed. Concurrent recorders are rejected using a transaction-protected owner PID; the database must be local to a single host, not shared over network storage. A reused PID after a crash can conservatively require operator recovery.

The protocol remains unchanged. Storage records the decoded envelope plus raw packet bytes (base64), receive time, sequence, mode, source category and packet-order classification. For JSON transport only, `auth_token` is removed before archiving and `raw_auth_redacted` is true; binary and hex bytes remain exact. A single `run_id` identifies each run; `run_type` is `debug` or `live_telemetry` at creation. Since entering Debug does not split a run, every sample also records its mode and `contains_debug` identifies mixed runs. `session_id` links automatically split runs from the same recording session.

## Agreed run boundaries

- Start explicitly with fresh, real UDP telemetry. Capture continues without any browser open.
- Confirmed ACDRV1 (`REG13` selector bits `01`) → `pv`.
- Confirmed ACDRV2 or off (`10` or `00`) → `bat_secondary`, displayed as **BAT/secondary**. This is the user's hardware mapping; it does not distinguish battery from another secondary source or prove measured power flow.
- Missing, paused, absent, bus-error, or contradictory (`11`) MPPT evidence → unknown; never infer a BAT transition from missing data.
- Outside Debug: a confirmed PV ↔ BAT/secondary change ends the current run and creates the next one.
- Entering Debug: retain the run, mark the mode change, tag subsequent samples as Debug.
- Within Debug: source changes create events without ending the run, preserving the before/after transient.
- Leaving Debug: end the run and start Live Telemetry. A simultaneous source change still produces only one successor.
- The first packet reporting a boundary belongs only to the successor. Old-run end and new-run start share its receive timestamp. Both run records and the end marker contain the linkage.

Mode currently means the **ESP32-reported debug flag**. It is not the Windows app's `live_mode` flag or a successful button click. Legacy v4 packets indicate normal mode. A separate app-selected experiment mode has not been introduced.

Source and mode changes are detected from telemetry, not from an issued command. The observation timestamp is therefore limited by the telemetry sampling period. These records support startup/transient analysis, not a claim of frequency-response measurement or high-speed logic capture.

An end marker contains `reason`, `from_source`, `to_source`, source register evidence, timestamp and `next_run_id`. `source_switch` and `mode_changed` events provide additional context. Existing command status updates are recorded with request IDs and timestamps. The Windows tool records each executable sequence line with its profile name, original line index, command text, phase and result; sequence execution remains client-side.

## Local setup

From `telemetry-bridge`, install using `npm ci`. Set `RECORDING_DB_PATH` to a private path outside `site/` or `/var/www/`, for example an absolute path under `telemetry-bridge/data/`, which is ignored by Git. Configure JWT login as described in `AUTHENTICATION.md` and keep the existing `COMMAND_TOKEN` in the private service environment, then run `node server.js`. Never put real tokens, account files or passwords in shared examples or commits.

Without `RECORDING_DB_PATH`, recording is disabled and no database worker opens. Health/SSE status adds a `recording` object with enabled/ready status, active run ID, queue count and error/drop counters. With JWT disabled, history retains its command-token compatibility behavior and fails closed if no token is configured or the legacy unauthenticated-command bypass is enabled. With JWT enabled, history reads require a viewer or operator session and recording actions require an operator session. Do not enable JWT remotely before HTTPS is established.

Both user-supplied firmware headers remain local and excluded from Git. This backend does not read them.

## API contract

All routes are under the existing Apache prefix in deployment (`/telemetry/runs/...`). In JWT mode, reads require a viewer or operator session and writes require an operator session plus CSRF verification. The command token remains reserved for hardware-control routes. Examples below use bridge-relative paths:

| Method / path | Operation |
|---|---|
| `POST /runs/start` with `{"name":"Startup test"}` | Start recording the currently fresh UDP device/address; returns 201 and a run |
| `POST /runs/stop` | Finish the active recording |
| `POST /runs/events` | Add a server-timestamped sequence-step marker to the active run |
| `GET /runs?limit=50&offset=0` | List runs, newest first; at most 100 per page |
| `GET /runs/:id` | Run metadata, counts, status, end reason and previous/next IDs |
| `GET /runs/:id/samples?start=...&end=...&after=...&limit=100` | Packet table with raw payload and decoded envelope; at most 500 per page |
| `GET /runs/:id/events?after=...&limit=100` | Start/end, source/mode and command events; at most 500 per page |
| `GET /runs/:id/series?metric=pv.currentA&start=...&end=...&points=500` | Bounded graph buckets with min/max/mean, sample/valid counts and packet IDs |

`start` and `end` are UTC epoch milliseconds; intervals are `[start,end)`. Samples and events use stable ingestion-ID cursors (`next_after`). Series ranges are limited to 24 hours and 2,000 buckets. Use the returned bucket range to drill into its raw rows. Empty buckets are omitted; the future UI must render gaps rather than invent measurements. Stored nulls contribute no numeric value to aggregates. All SQL values are bound parameters, and metrics are allowlisted in `recording/store.mjs`.

`bms.cellSlot4V` deliberately refers to the fourth transmitted slot: v6 uses physical cell 4, older formats used cell 10. Keep packet format visible when comparing historical data. Calibration/decoder metadata is saved at start; set `DEPLOYED_REVISION` during deployment to avoid an `unversioned` decoder label.

## Failure and provenance behavior

Raw UDP capture is **not authenticated hardware provenance**: the existing sender identity/IP controls and network trust still apply. HTTP `/input`, browser mock data, unrelated device IDs and other source IPs cannot enter a recording. The acquisition is pinned to the starting device ID and address, while a UDP source-port change does not itself split runs.

Duplicate and out-of-order sequence values remain in the raw archive but do not change mode/source state or cause boundaries. A 16-bit sequence wrap is supported. Reboot identification/sequence-epoch recovery is not yet implemented: after a device reboot, stop/start the recording explicitly to establish a fresh sequence baseline. Do not claim zero loss over UDP.

Start/stop and each ingestion boundary use SQLite transactions. A failed write cannot leave a half-created successor. On restart, open runs become interrupted and do not automatically resume. Graceful shutdown also ends the active run as interrupted. Storage failures and queue overflow are visible in health; capture stops, keeping UDP/SSE responsive. Queue overflow persists an incomplete-run marker when the database can still write. A full/broken disk can prevent the failure marker itself; health remains the immediate source of truth. Recovery requires fixing storage and restarting recording.

## Backup and deployment

Use `node tools/backup-recordings.mjs <source.sqlite> <new-backup.sqlite>` from an environment with the bridge dependencies installed. The backup uses SQLite's backup API for committed WAL data and strips process ownership from the copy. Restore only with the recorder stopped; retain the damaged/original file first. Restored active runs become interrupted. Application rollback must not overwrite the database.

Deployment helpers now prepare locked dependencies and verify the SQLite native module **before** copying live application files. They include recording modules, dependencies and the lockfile in application backup/restore. The droplet currently lacks npm; deployment preflight will refuse until it is available. Application backups do not substitute for the database backup above. Only schema v1 exists; automatic downgrade is not supported, and a newer schema version is rejected.

The browser Run Explorer lists and searches saved runs, shows linked recording segments and end reasons, graphs any allowlisted metric over preset or custom time windows, and binds graph selection to the exact packet-table interval. It also exposes event markers and an event table, inline decoded packet inspection, and operator-only start/stop controls. Graph gaps remain gaps; unavailable measurements are never interpolated.

The Windows I²C tool uses `POST /runs/start`, `POST /runs/stop` and `POST /runs/events` for operator recording control and sequence correlation. Sequence events contain a bounded profile name, original line number and command text, phase, outcome and truncated result. The bridge supplies the event timestamp and always attaches the marker to the active run; clients cannot select another run or backdate a marker. With JWT enabled, these writes require an operator session and CSRF validation. Hardware commands additionally continue to require `X-Command-Token`.

Next milestones: calibrated transient acquisition, CSV export and retention/load testing before sustained capture.

## Validation

The local suite covers real loopback UDP/HTTP recording, mode/source boundaries, credential redaction, restart recovery, duplicate/reordered packets, bounded queries, transaction rollback, queue overflow, concurrent-writer rejection, consistent backup/restore, JWT signature/claim/expiry validation, role and CSRF enforcement, logout revocation, and deploy/rollback packaging in temporary directories. Exact Node 20 execution, sustained production-rate testing, hardware confirmation and all live deployment checks remain pending.
