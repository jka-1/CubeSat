#!/usr/bin/env bash
# Clean prototype appearance only. Run from the pushed checkout, as root on the droplet.
set -euo pipefail
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --check ) ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
site_root="${SITE_ROOT:-/var/www/html}"
backup_root="${BACKUP_ROOT:-/root/cubesat-live-backups}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
health_url="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"
site_check_url="${SITE_CHECK_URL:-http://127.0.0.1/knight-eps-phase12/viewer/?v=20261116-clean-prototype}"
base_revision="${BASE_REVISION:-cd561f3427561689784c0da119940f4d3435782f}"
revision="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "${EXPECTED_REVISION:-}" && "$revision" != "$EXPECTED_REVISION" ]]; then
  echo "Release revision differs from EXPECTED_REVISION; nothing changed." >&2
  exit 1
fi

# Install assets and helper before the loader activates them. No backend or config changes.
files=(
  knight-eps-phase12/models/clean-prototype/appearance.glb
  knight-eps-phase12/models/clean-prototype/appearance.json
  knight-eps-phase12/viewer/rendering/clean-prototype.mjs
  knight-eps-phase12/viewer/rendering/model-loader.mjs
)
[[ -d "$site_root" ]] || { echo "Site root is missing." >&2; exit 1; }
git -C "$repo_root" cat-file -e "$base_revision^{commit}"
existing=()
absent=()
for rel in "${files[@]}"; do
  source="$repo_root/site/$rel"
  target="$site_root/$rel"
  [[ -f "$source" && ! -L "$target" ]] || { echo "Invalid source or symlink target: $rel" >&2; exit 1; }
  cmp -s <(git -C "$repo_root" show "$revision:site/$rel") "$source" || { echo "Uncommitted release file: $rel" >&2; exit 1; }
  # Already-installed release files are safe to redeploy. Otherwise require the
  # inspected base so production-only edits are never overwritten silently.
  if [[ -f "$target" ]]; then
    existing+=("$rel")
    if ! cmp -s "$source" "$target"; then
      if ! git -C "$repo_root" cat-file -e "$base_revision:site/$rel" 2>/dev/null ||
         ! cmp -s <(git -C "$repo_root" show "$base_revision:site/$rel") "$target"; then
        echo "Live file differs from the inspected base: $rel; nothing changed." >&2
        exit 1
      fi
    fi
  else
    absent+=("$rel")
    if git -C "$repo_root" cat-file -e "$base_revision:site/$rel" 2>/dev/null; then
      echo "Expected live file is missing: $rel; nothing changed." >&2
      exit 1
    fi
  fi
done
if [[ "${1:-}" == --check ]]; then
  echo "Preflight passed for $revision (${#files[@]} static files)."
  exit 0
fi
curl --silent --show-error --fail --max-time 15 "$health_url" >/dev/null
bridge_before="$(sha256sum "$bridge_file")"
mkdir -p "$backup_root"
backup_dir="$(mktemp -d "$backup_root/clean-prototype-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
tar -czf "$backup_dir/site-files.tar.gz" -C "$site_root" "${existing[@]}"
printf '%s\n' "${absent[@]-}" > "$backup_dir/new-files.txt"
printf '%s\n' "$revision" > "$backup_dir/deployed-revision.txt"
echo "Pre-deploy backup: $backup_dir"

rollback() {
  trap - ERR
  tar -xzf "$backup_dir/site-files.tar.gz" -C "$site_root"
  for rel in "${absent[@]-}"; do
    if [[ -n "$rel" ]]; then rm -f -- "$site_root/$rel"; fi
  done
  echo "Deployment failed; restored site files from $backup_dir." >&2
}
trap 'rollback' ERR
for rel in "${files[@]}"; do
  # Install beside the destination and rename atomically on the same filesystem.
  mkdir -p -- "$(dirname "$site_root/$rel")"
  temporary="$(mktemp "$(dirname "$site_root/$rel")/.knight-eps-XXXXXX")"
  install -m 644 "$repo_root/site/$rel" "$temporary"
  mv -f -- "$temporary" "$site_root/$rel"
done
for rel in "${files[@]}"; do cmp "$repo_root/site/$rel" "$site_root/$rel"; done
curl --silent --show-error --fail --max-time 15 -H 'Host: orbitaladdress.com' "$site_check_url" > "$backup_dir/viewer-after.html"
curl --silent --show-error --fail --max-time 15 "$health_url" > "$backup_dir/health-after.json"
[[ "$(sha256sum "$bridge_file")" == "$bridge_before" ]]
trap - ERR
echo "Clean prototype deployed: $revision"
echo "Backup retained: $backup_dir"
