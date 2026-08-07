#!/usr/bin/env bash

set -euo pipefail

backup_root="${BACKUP_ROOT:-${1:-/root/cubesat-live-backups}}"
site_root="${SITE_ROOT:-/var/www/html}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
bridge_package_file="${BRIDGE_PACKAGE_FILE:-$(dirname "$bridge_file")/package.json}"
service_name="${SERVICE_NAME:-}"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${backup_root%/}/${timestamp}"

mkdir -p "$backup_dir"

if [ ! -d "$site_root" ]; then
  echo "Site root not found: $site_root" >&2
  exit 1
fi

if [ ! -f "$bridge_file" ]; then
  echo "Bridge file not found: $bridge_file" >&2
  exit 1
fi

tar -czf "$backup_dir/site.tar.gz" -C "$site_root" .
cp "$bridge_file" "$backup_dir/server.js"

if [ -f "$bridge_package_file" ]; then
  cp "$bridge_package_file" "$backup_dir/package.json"
fi

if [ -n "$service_name" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl status "$service_name" --no-pager > "$backup_dir/service-status.txt" 2>&1 || true
fi

printf '%s\n' "$backup_dir"
