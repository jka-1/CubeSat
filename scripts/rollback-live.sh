#!/usr/bin/env bash

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 1
fi

backup_dir="$1"
site_root="${SITE_ROOT:-/var/www/html}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
bridge_package_file="${BRIDGE_PACKAGE_FILE:-$(dirname "$bridge_file")/package.json}"
service_name="${SERVICE_NAME:-}"

if [ ! -f "$backup_dir/site.tar.gz" ]; then
  echo "Missing site archive in backup: $backup_dir/site.tar.gz" >&2
  exit 1
fi

if [ ! -f "$backup_dir/server.js" ]; then
  echo "Missing bridge file in backup: $backup_dir/server.js" >&2
  exit 1
fi

tar -xzf "$backup_dir/site.tar.gz" -C "$site_root"
cp "$backup_dir/server.js" "$bridge_file"

if [ -f "$backup_dir/package.json" ]; then
  cp "$backup_dir/package.json" "$bridge_package_file"
fi

if [ -n "$service_name" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$service_name"
fi

echo "Rollback complete from: $backup_dir"
