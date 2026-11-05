#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
site_root="${SITE_ROOT:-/var/www/html}"
site_source="$repo_root/site"
site_check_url="${SITE_CHECK_URL:-http://127.0.0.1/knight-eps-phase12/viewer/}"
health_url="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"
base_revision=e64b98e87f33da266b5398933f379edf6669f546
expected_branch=feat/knight-eps-phase12-digital-twin
changed=(index.html assets/css/styles.css assets/js/app.js assets/js/router.js assets/js/streaming-telemetry.mjs assets/js/twin.js modules/twin.html)

if [ "$(git -C "$repo_root" branch --show-current)" != "$expected_branch" ]; then
  echo "Refusing to deploy from another branch." >&2
  exit 1
fi
git -C "$repo_root" cat-file -e "$base_revision^{commit}"
if [ -e "$site_root/knight-eps-phase12" ]; then
  echo "The live Phase12 asset directory already exists; inspect it before overwriting." >&2
  exit 1
fi
for rel in "${changed[@]}"; do
  if ! cmp -s <(git -C "$repo_root" show "$base_revision:site/$rel") "$site_root/$rel"; then
    echo "Live $rel differs from the inspected base; inspect production-only changes." >&2
    exit 1
  fi
done

# Reuse the repository's full live backup, including bridge files. This release only copies site assets.
backup_dir="$("$repo_root/scripts/backup-live.sh")"
echo "Pre-deploy backup: $backup_dir"
rollback_site() {
  trap - ERR
  rm -rf -- "$site_root/knight-eps-phase12"
  tar -xzf "$backup_dir/site.tar.gz" -C "$site_root"
  echo "Site restored from $backup_dir" >&2
}
trap rollback_site ERR

cp -a "$site_source/knight-eps-phase12" "$site_root/"
for rel in "${changed[@]}"; do
  cp -p "$site_source/$rel" "$site_root/$rel"
  cmp "$site_source/$rel" "$site_root/$rel"
done
for rel in viewer/index.html viewer/main.mjs viewer/styles.css models/KnightEPS_Phase10.glb docs/component_manifest.json; do
  cmp "$site_source/knight-eps-phase12/$rel" "$site_root/knight-eps-phase12/$rel"
done
curl --silent --show-error --fail -H 'Host: orbitaladdress.com' "$site_check_url" >/dev/null
curl --silent --show-error --fail "$health_url" >/dev/null
trap - ERR
echo "Phase12 site assets deployed. Rollback: rm -rf -- '$site_root/knight-eps-phase12' && tar -xzf '$backup_dir/site.tar.gz' -C '$site_root'"
