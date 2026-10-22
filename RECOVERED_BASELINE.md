# Recovered live baseline

Recovered October 22, 2026 from the authenticated droplet at 45.55.77.215.

Base history: PR #2, `ed08f12e9e14c9ce2591d9b355ace05f4ec30649`. The droplet checkout remained clean at that revision, but the deployed website and bridge had October 19 changes outside the checkout. This branch preserves those live files, including the updated satellite image.

Live bridge SHA-256: `61a8409dbd0b2873883c1f0f95b53b0bc05524c1747b3c4ac3c6b45e2ad9eb33`.

Only `site/` and `telemetry-bridge/server.js` were recovered from deployment; package metadata was unchanged. Firmware, deployment scripts and original tests come from PR #2. **Do not treat this branch's firmware as the latest flashed v6 firmware.** Jaden's current Windows tool and firmware provenance remain pending.

Server runtime: Node 20.19.4. The deployed bridge supports v6 streaming and authenticated `/live-mode`. This baseline has no telemetry database integration. MariaDB is installed separately on the droplet, with project ownership not established.

The initial inherited test suite produced 35 passes and four stale-expectation failures: three peripheral payload assertions omit `lightLevel`, and one asserts an old asset version. Follow-up test changes should explicitly check the new contract, not remove coverage.

Original recovery archives and file hashes are retained outside this worktree in `deployment-audit/2026-10-22/`. No live deployment or firmware change is part of this recovery.
