#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
site_source="${SITE_SOURCE:-$repo_root/site}"
bridge_source="${BRIDGE_SOURCE:-$repo_root/telemetry-bridge/server.js}"
bridge_package_source="${BRIDGE_PACKAGE_SOURCE:-$repo_root/telemetry-bridge/package.json}"
site_root="${SITE_ROOT:-/var/www/html}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
bridge_package_file="${BRIDGE_PACKAGE_FILE:-$(dirname "$bridge_file")/package.json}"
service_name="${SERVICE_NAME:-}"
expected_branch="${EXPECTED_BRANCH:-}"
health_url="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"
bridge_source_dir="$(dirname "$bridge_source")"
bridge_dir="$(dirname "$bridge_file")"

if [ ! -d "$site_source" ]; then
  echo "Site source not found: $site_source" >&2
  exit 1
fi

if [ ! -f "$bridge_source" ]; then
  echo "Bridge source not found: $bridge_source" >&2
  exit 1
fi

if [ ! -f "$bridge_package_source" ]; then
  echo "Bridge package metadata not found: $bridge_package_source" >&2
  exit 1
fi

if [ -n "$expected_branch" ] && command -v git >/dev/null 2>&1; then
  current_branch="$(git -C "$repo_root" branch --show-current)"
  if [ "$current_branch" != "$expected_branch" ]; then
    echo "Refusing deploy from branch '$current_branch'; expected '$expected_branch'." >&2
    exit 1
  fi
fi

if [ ! -d "$bridge_source_dir/auth" ] || [ ! -d "$bridge_source_dir/recording" ] || [ ! -f "$bridge_source_dir/tools/auth-user.mjs" ] || [ ! -f "$bridge_source_dir/telemetry-auth.mjs" ] || [ ! -f "$bridge_source_dir/package-lock.json" ]; then
  echo "Missing bridge auth/recording modules or package lock." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to prepare the bridge dependencies; live files were not changed." >&2
  exit 1
fi
# Prepare native dependencies for this server before replacing any live application files.
npm ci --prefix "$bridge_source_dir" --omit=dev
(cd "$bridge_source_dir" && node --input-type=module -e "import { jwtVerify } from 'jose'; import Database from 'better-sqlite3'; await import('./telemetry-auth.mjs'); const db = new Database(':memory:'); db.close();")

backup_dir="$("$script_dir/backup-live.sh")"
echo "Backup created at: $backup_dir"

cp -a "$site_source/." "$site_root/"
cp "$bridge_source" "$bridge_file"
cp "$bridge_package_source" "$bridge_package_file"
cp "$bridge_source_dir/package-lock.json" "$bridge_dir/package-lock.json"
cp "$bridge_source_dir/telemetry-auth.mjs" "$bridge_dir/telemetry-auth.mjs"
cp -a "$bridge_source_dir/recording" "$bridge_dir/"
cp -a "$bridge_source_dir/auth" "$bridge_dir/"
cp -a "$bridge_source_dir/tools" "$bridge_dir/"
cp -a "$bridge_source_dir/node_modules" "$bridge_dir/"

if command -v git >/dev/null 2>&1; then
  git -C "$repo_root" rev-parse HEAD > "$backup_dir/deployed-revision.txt" 2>/dev/null || true
  git -C "$repo_root" branch --show-current > "$backup_dir/deployed-branch.txt" 2>/dev/null || true
fi

if [ -n "$service_name" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$service_name"
  systemctl status "$service_name" --no-pager > "$backup_dir/service-status-after-deploy.txt" 2>&1 || true
fi

if command -v curl >/dev/null 2>&1; then
  health_ok=false
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl --silent --show-error --fail "$health_url" > "$backup_dir/health-after-deploy.json"; then
      health_ok=true
      break
    fi
    sleep 1
  done

  if [ "$health_ok" != true ]; then
    echo "Deploy failed: bridge health check did not pass." >&2
    echo "Restoring the pre-deploy backup: $backup_dir" >&2
    if SERVICE_NAME="$service_name" "$script_dir/rollback-live.sh" "$backup_dir"; then
      echo "Automatic rollback completed." >&2
    else
      echo "Automatic rollback failed. Retry with: $script_dir/rollback-live.sh $backup_dir" >&2
    fi
    exit 1
  fi
fi

echo "Deploy complete."
echo "If needed, rollback with: $script_dir/rollback-live.sh $backup_dir"
