#!/usr/bin/env bash
# Run as root in an isolated checkout of the reviewed release on the existing droplet.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Release checkout has modified tracked files; nothing changed.' >&2
  exit 1
fi
command -v npm >/dev/null || { echo 'npm is required; nothing changed.' >&2; exit 1; }
export KNIGHT_LIVE_PID
KNIGHT_LIVE_PID="$(systemctl show cubesat-telemetry.service -p MainPID --value)"
[[ "$KNIGHT_LIVE_PID" =~ ^[1-9][0-9]*$ ]] || { echo 'Bridge is not running; nothing changed.' >&2; exit 1; }
node --input-type=module <<'JS'
import { readFileSync, readlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const pid = process.env.KNIGHT_LIVE_PID;
const env = Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((entry) => {
  const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)];
}));
if (!env.AUTH_CONFIG_PATH) throw new Error('Website operator authentication is not configured; nothing changed.');
if (env.RECORDING_DB_PATH) {
  const require = createRequire('/opt/cubesat-telemetry/package.json');
  const Database = require('better-sqlite3');
  const db = new Database(resolve(readlinkSync(`/proc/${pid}/cwd`), env.RECORDING_DB_PATH), { readonly: true, fileMustExist: true });
  try {
    if (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='recording'").get().n) throw new Error('A recording is active. Finish it before deploying; nothing changed.');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='sequence_executions'").get() &&
        db.prepare("SELECT COUNT(*) AS n FROM sequence_executions WHERE state IN ('running','paused')").get().n) throw new Error('A sequence is active; nothing changed.');
    const backup = `/root/cubesat-live-backups/recordings-${Date.now()}`;
    mkdirSync(backup, { mode: 0o700, recursive: false });
    await db.backup(`${backup}/runs.sqlite`);
    chmodSync(`${backup}/runs.sqlite`, 0o600);
    const copy = new Database(`${backup}/runs.sqlite`);
    try { copy.prepare('DELETE FROM recorder_owner').run(); } finally { copy.close(); }
    console.log(`Recording database backup: ${backup}/runs.sqlite`);
  } finally { db.close(); }
}
console.log('Recording and authentication preflight passed.');
JS
SERVICE_NAME=cubesat-telemetry.service bash scripts/deploy-live.sh
curl --fail --silent --show-error http://127.0.0.1:8080/public/health
