#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
site_source="${SITE_SOURCE:-$repo_root/site}"
bridge_source="${BRIDGE_SOURCE:-$repo_root/telemetry-bridge/server.js}"
site_root="${SITE_ROOT:-/var/www/html}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
service_name="${SERVICE_NAME:-}"

if [ ! -d "$site_source" ]; then
  echo "Site source not found: $site_source" >&2
  exit 1
fi

if [ ! -f "$bridge_source" ]; then
  echo "Bridge source not found: $bridge_source" >&2
  exit 1
fi

backup_dir="$("$script_dir/backup-live.sh")"
echo "Backup created at: $backup_dir"

cp -a "$site_source/." "$site_root/"
cp "$bridge_source" "$bridge_file"

if [ -n "$service_name" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$service_name"
  systemctl status "$service_name" --no-pager > "$backup_dir/service-status-after-deploy.txt" 2>&1 || true
fi

if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --fail http://127.0.0.1:8080/health > "$backup_dir/health-after-deploy.json" || true
fi

echo "Deploy complete."
echo "If needed, rollback with: $script_dir/rollback-live.sh $backup_dir"
