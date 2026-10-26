# Telemetry recording deployment and acceptance plan

This plan validates the `codex/telemetry-recording` release on the live droplet without weakening the existing `COMMAND_TOKEN` control. Record the deployed commit, timestamps, operator and evidence links in the execution record at the end of this file.

## Release gates

Do not start the live deployment unless all of these gates pass:

- The working tree is clean and `main/app_config.h` plus `main/app_config_defaults.h` are ignored and absent from the commit.
- `npm test` passes in `telemetry-bridge`.
- The droplet has a supported Node version and `npm` is installed.
- The current service is healthy, the checkout has no tracked local changes and a rollback backup can be created.
- `COMMAND_TOKEN` remains configured privately. No token, password, JWT signing key or telemetry HMAC key appears in Git or command output.
- The recording database is stored outside `/var/www` and the application checkout.

The first rollout uses unsigned-telemetry compatibility mode. Leave `REQUIRE_SIGNED_TELEMETRY` false until HMAC-enabled firmware has compiled, flashed and passed the provenance checks below. JWT is activated only after the private account file exists and the public HTTPS origin is confirmed.

## Automated release checks

From the candidate checkout:

```bash
git status --short --branch
git diff --check
git ls-files --error-unmatch main/app_config.h main/app_config_defaults.h
```

The final command must fail because neither private header may be tracked.

Run the bridge suite:

```bash
cd telemetry-bridge
npm ci
npm test
```

Pass criteria: every test passes, including recording transactions, JWT roles and CSRF, source and reboot boundaries, CSV safety, signed packet validation, replay rejection, backup and deployment packaging.

## Droplet preflight and deployment

On the droplet, capture the current revision and service state without printing environment values:

```bash
cd /opt/cubesat-demo/repo
git status --short --branch
git rev-parse --short HEAD
node --version
npm --version
systemctl is-active cubesat-telemetry.service
curl --fail http://127.0.0.1:8080/healthz
df -h / /opt /var
```

Stop if the checkout has tracked changes, the service is unhealthy, `npm` is unavailable, or disk space is insufficient for dependencies, the database and a backup.

Fetch and deploy the release branch:

```bash
cd /opt/cubesat-demo/repo
git fetch origin
git checkout codex/telemetry-recording
git pull --ff-only origin codex/telemetry-recording
SERVICE_NAME=cubesat-telemetry.service \
EXPECTED_BRANCH=codex/telemetry-recording \
./scripts/deploy-live.sh
```

The deploy script prints the backup directory. Save it in the execution record. If health fails, use the printed rollback command immediately.

## Recording activation

Create a private data directory owned by the bridge service account and add this service setting through the existing private systemd configuration:

```ini
Environment="RECORDING_DB_PATH=/var/lib/cubesat-telemetry/runs.sqlite"
Environment="DEPLOYED_REVISION=replace-with-the-full-deployed-commit-sha"
StateDirectory=cubesat-telemetry
StateDirectoryMode=0750
UMask=0077
```

`StateDirectory` makes the private database path writable when the service uses systemd filesystem
hardening such as `ProtectSystem=strict`; directory ownership alone does not override that sandbox.

Do not change or remove `COMMAND_TOKEN`. Restart the service and verify:

- `/healthz` returns HTTP 200.
- Detailed health reports recording enabled and ready with no storage error or dropped samples.
- The database and WAL files are not readable by the web-server account or served by Apache.
- Restarting the bridge preserves completed runs and marks any previously open run interrupted.

## Live smoke test

1. Open the dashboard and confirm live telemetry updates from the expected device.
2. Confirm PV, BMS, MPPT, peripheral and link values still render.
3. Send one safe I2C read using the existing command token. The request ID must move from pending to `ok` and return matching bytes.
4. Observe service logs and health for five minutes. There must be no restart loop, recording error, queue overflow or sustained packet decode error.
5. Confirm `/telemetry/runs/` loads the Run Explorer.

## Run lifecycle and boundary tests

Use a unique run name and record the run IDs produced by each step.

1. Start a run while fresh telemetry is arriving. It must begin as `live_telemetry` and continue when the browser is closed.
2. Enter Debug. The same run must remain active, `contains_debug` must become true and a mode-change event must appear.
3. Change the confirmed source while in Debug. The run must remain active and contain a source-change event.
4. Leave Debug. The active run must end and one linked `live_telemetry` successor must start. The boundary packet must exist only in the successor.
5. Outside Debug, switch ACDRV from confirmed ACDRV1 to ACDRV2 or off, or vice versa. The old run must end with `source_switch`; the marker must show the prior and next source plus `next_run_id`; one linked successor must start.
6. Remove or pause MPPT evidence. The source must become unknown without inventing a BAT/secondary transition or splitting the run.
7. Restart the ESP32 during a non-Debug run. The old run must end with `device_reboot`; the first post-reboot packet must belong only to its linked successor.
8. Stop recording explicitly. No new samples may be added after the stop response.

Source expectations are fixed for this release: confirmed ACDRV1 means `pv`; confirmed ACDRV2 or off means `bat_secondary`. Missing or contradictory evidence means unknown.

## Run Explorer and data checks

For the run created above:

- Open its graph and select at least one PV, BMS and MPPT metric.
- Change the time window and confirm the x-axis and bucket range change without connecting gaps.
- Select a graph bucket and confirm the packet table is restricted to the exact selected interval.
- Open a packet row and compare decoded fields, raw payload, receive time, sequence, mode and source with live telemetry.
- Inspect the event table for mode changes, source changes, sequence markers, reboot and run-end reason.
- Export the current graph interval to CSV and open it locally. Confirm headers, timestamps, raw and decoded data, row count and spreadsheet-formula neutralization.
- Confirm linked previous and next run navigation follows the recorded session.

Pass criteria: graphs, tables and exports describe the same stored samples; unavailable values remain blank; no value is interpolated across a gap.

## Startup response and sequence tests

1. Choose a command, mode, source or sequence-step event as T+0.
2. Set explicit pre-trigger and post-trigger windows.
3. Confirm the graph is aligned to T+0 and reports the pre-trigger baseline, first post-trigger bucket, peak change, peak time and post-trigger range.
4. Run a short Windows sequence. Each executable line must create a server-timestamped `started` marker and a completion or failure marker with the profile name, original line number and bounded result.
5. Confirm a failed line is visible and cannot be mistaken for a successful hardware command.

This is a time-domain startup/transient measurement at the telemetry sample rate. It is not a swept-frequency or Bode measurement.

## JWT activation test

After the public HTTPS origin and private account file are ready, enable JWT with one viewer and one operator account. Keep `COMMAND_TOKEN` configured.

- A viewer can open telemetry and saved runs but cannot start/stop a run or send commands.
- An operator can start/stop runs after login.
- An operator hardware command without the command token fails.
- The same command with both the operator session and command token succeeds.
- A missing or invalid CSRF value rejects state-changing requests.
- Logout closes the session; expiry triggers one Windows-client renewal and retry while credentials remain in memory.
- Repeated bad logins are rate limited and no password, token or signing key appears in logs.

## Signed telemetry rollout test

Perform this section only after the ESP-IDF HMAC firmware build and bench test pass.

1. Configure the same private 32-byte-or-longer HMAC key in firmware and the bridge; leave strict mode off.
2. Confirm signed packets are accepted and health reports authenticated provenance with the expected device and boot ID.
3. Confirm a modified signature, mismatched device, mismatched sequence and exact replay are rejected.
4. Confirm a firmware reboot changes the boot ID and produces the expected run boundary.
5. Enable `REQUIRE_SIGNED_TELEMETRY=true`, restart and confirm unsigned telemetry is rejected while signed telemetry continues.
6. Keep `COMMAND_TOKEN` unchanged; provenance settings must not alter command authorization.

## Backup, recovery and soak

- Create a consistent SQLite backup with `tools/backup-recordings.mjs` while the service is running, open the copy separately and compare run/sample counts.
- Restart the service and confirm historical runs remain queryable.
- Exercise application rollback in a maintenance window and verify that rollback does not overwrite the recording database.
- Run a minimum one-hour capture at the intended packet rate. Pass when health reports no dropped recording samples, queue overflow or storage error and the final database size is consistent with the observed rate.

## Execution record

| Field | Result |
|---|---|
| Date / operator | |
| Git commit | |
| Previous live commit | |
| Deployment backup path | |
| Automated tests | |
| Health and five-minute smoke | |
| Run lifecycle IDs | |
| CSV evidence | |
| JWT result | Not activated / Pass / Fail |
| Signed telemetry result | Deferred / Compatibility pass / Strict pass / Fail |
| One-hour soak | |
| Issues and follow-up | |
