#!/usr/bin/env bash
# Site-only update. Run from the pushed release checkout, as root on the droplet.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
site_root="${SITE_ROOT:-/var/www/html}"
backup_root="${BACKUP_ROOT:-/root/cubesat-live-backups}"
bridge_file="${BRIDGE_FILE:-/opt/cubesat-telemetry/server.js}"
health_url="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"
site_check_url="${SITE_CHECK_URL:-http://127.0.0.1/knight-eps-phase12/viewer/?v=20261109a}"
base_revision=80c6fa3b6d706fa93dc1a58ff545757918b763ea
revision="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "${EXPECTED_REVISION:-}" && "$revision" != "$EXPECTED_REVISION" ]]; then
  echo "Release revision differs from EXPECTED_REVISION; nothing changed." >&2
  exit 1
fi

# New geometry first, entry-point HTML last. No backend, auth, data or config files.
files=(
  knight-eps-phase12/models/KnightEPS_Detailed.glb
  knight-eps-phase12/docs/model-upgrades.json
  knight-eps-phase12/docs/component_manifest.json
  knight-eps-phase12/viewer/display.mjs
  knight-eps-phase12/viewer/styles.css
  knight-eps-phase12/viewer/main.mjs
  knight-eps-phase12/viewer/index.html
  assets/js/twin.js
  modules/twin.html
  assets/css/styles.css
  assets/js/router.js
  assets/js/app.js
  index.html
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
backup_dir="$(mktemp -d "$backup_root/detailed-twin-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
tar -czf "$backup_dir/site-files.tar.gz" -C "$site_root" "${existing[@]}"
printf '%s\n' "${absent[@]}" > "$backup_dir/new-files.txt"
printf '%s\n' "$revision" > "$backup_dir/deployed-revision.txt"
echo "Pre-deploy backup: $backup_dir"

rollback() {
  trap - ERR
  tar -xzf "$backup_dir/site-files.tar.gz" -C "$site_root"
  for rel in "${absent[@]}"; do rm -f -- "$site_root/$rel"; done
  echo "Deployment failed; restored site files from $backup_dir." >&2
}
trap 'rollback' ERR
for rel in "${files[@]}"; do
  # Install beside the destination and rename atomically on the same filesystem.
  temporary="$(mktemp "$(dirname "$site_root/$rel")/.knight-eps-XXXXXX")"
  install -m 644 "$repo_root/site/$rel" "$temporary"
  mv -f -- "$temporary" "$site_root/$rel"
done
for rel in "${files[@]}"; do cmp "$repo_root/site/$rel" "$site_root/$rel"; done
curl --silent --show-error --fail --max-time 15 -H 'Host: orbitaladdress.com' "$site_check_url" > "$backup_dir/viewer-after.html"
curl --silent --show-error --fail --max-time 15 "$health_url" > "$backup_dir/health-after.json"
[[ "$(sha256sum "$bridge_file")" == "$bridge_before" ]]
trap - ERR
echo "Detailed Twin deployed: $revision"
echo "Backup retained: $backup_dir"
