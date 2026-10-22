# Recovered live baseline

Recovered October 22, 2026 from the authenticated droplet at 45.55.77.215.

Base history: PR #2, `ed08f12e9e14c9ce2591d9b355ace05f4ec30649`. The droplet checkout remained clean at that revision, but the deployed website and bridge had October 19 changes outside the checkout. This branch preserves those live files, including the updated satellite image.

Live bridge SHA-256: `61a8409dbd0b2873883c1f0f95b53b0bc05524c1747b3c4ac3c6b45e2ad9eb33`.

Only `site/` and `telemetry-bridge/server.js` were recovered from deployment; package metadata was unchanged. Firmware, deployment scripts and original tests come from PR #2. **Do not treat this branch's firmware as the latest flashed v6 firmware.** Jaden's current Windows tool and firmware provenance remain pending.

Server runtime: Node 20.19.4. The deployed bridge supports v6 streaming and authenticated `/live-mode`. This baseline has no telemetry database integration. MariaDB is installed separately on the droplet, with project ownership not established.

The initial inherited test suite produced 35 passes and four stale-expectation failures: three peripheral payload assertions omit `lightLevel`, and one asserts an old asset version. Follow-up test changes should explicitly check the new contract, not remove coverage.

Original recovery archives and file hashes are retained outside this worktree in `deployment-audit/2026-10-22/`. No live deployment or firmware change is part of this recovery.

## Validated development baseline

Branch: `codex/telemetry-baseline`. Recovery commit: `8a68a6b`.

The follow-up test changes preserve strict peripheral assertions while adding the current `lightLevel` field and updating the asset-version expectations. New integration tests exercise:

- ASCII and binary v6 packets, signed current/temperature conversion, BMS/MPPT engineering units, ADC GPIOs and raw values;
- invalid extension flags and absent devices, retaining nulls;
- malformed v6 lengths leaving the previous valid packet untouched, and v4 decoding after v6;
- live-mode missing/wrong tokens, invalid boolean input, health and SSE updates, the API alias, and the distinction between a mode flag and a fresh device/command target.

Validation: **43 tests passed, zero failed**, using `node --test` under local Node v25.9.0. `git diff --check` passed. All 29 recovered production files were verified against the original audit hashes; application behavior was not changed during test alignment.

Runtime limitation: downloading a temporary Node v20.19.4 runtime from nodejs.org timed out, so matching-version execution remains unverified. No packages or global runtime changes were installed. V6 fixtures are synthetic tests of the recovered decoder contract, not independent confirmation of Jaden's firmware or hardware.

## Jaden update integration

Integrated `github/debug-mode-link-health` at `9563ef3b3dbd432fc32f17b7ba53473059cfc392` (four commits beyond PR #2's original head). This supplies v6 firmware, the Windows tool, streaming fixtures/tests and link diagnostics while preserving our independent v6/live-mode tests. The earlier firmware-source limitation above describes the original recovery, not this merged state. Which firmware binary is flashed is still not independently confirmed.

The user supplied `app_config.h` and `app_config_defaults.h` privately. Both are local-only, ignored through the repository's local exclude file, absent from the Git index, and must not be staged or pushed. Their contents are not documented here. Upstream removed the older tracked `app_config.h`; that deletion is preserved. No private configuration is included in this merge.

Combined bridge/frontend validation: **70 tests passed** under Node v25.9.0. Host C sensor conversion tests also passed. URL-to-path conversion now handles spaces in both the link test and the development server. The server smoke test successfully served the dashboard from this workspace path. Link-tool suite: **14 passed, 2 skipped, zero failed** initially. One skip was another URL-encoded path in the fixture parity test; after fixing it, that targeted test passed too, for **15 verified passes**. The optional patched-bridge case remains unconfigured and skipped. Upstream Windows CRLF files and embedded patch context whitespace were preserved.

Remaining validation limitations: full ESP-IDF build is unavailable (`idf.py` not installed); Windows GUI/Python tests were not run (PySide6, pyserial and pytest absent); exact Node 20 validation remains pending. No hardware command, flash, push or live deployment was performed. Next work can proceed with database design using the aligned source and packet fixtures.
