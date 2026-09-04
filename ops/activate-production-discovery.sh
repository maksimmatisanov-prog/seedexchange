#!/usr/bin/env bash
set -Eeuo pipefail

readonly root=/srv/seedexchange-production
readonly releases="$root/releases"
readonly env_file="$root/shared/production.env"
readonly service=seedexchange-production.service
readonly unit_target=/etc/systemd/system
readonly production_units=(
  seedexchange-production.service
  seedexchange-production-outbox.service
  seedexchange-production-outbox.timer
  seedexchange-production-sitemap.service
  seedexchange-production-sitemap.timer
)

expected_commit=${1:-}
expected_migration=${2:-}
source_media_manifest=${3:-}
organization_path=${4:-}
product_path=${5:-}
media_path=${6:-}

if [[ "${SEEDX_PRODUCTION_DISCOVERY_ACTIVATE_APPROVED:-}" != "YES" ]]; then
  echo "Production activation requires SEEDX_PRODUCTION_DISCOVERY_ACTIVATE_APPROVED=YES after explicit owner approval." >&2
  exit 2
fi
if [[ $# -ne 6 || ! "$expected_commit" =~ ^[a-f0-9]{40}$ || ! "$expected_migration" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ || ! "$organization_path" =~ ^/directory/[a-z0-9-]+$ || ! "$product_path" =~ ^/product/[a-z0-9-]+$ || ! "$media_path" =~ ^/media/[a-f0-9]{40}\.webp$ ]]; then
  echo "Usage: SEEDX_PRODUCTION_DISCOVERY_ACTIVATE_APPROVED=YES ops/activate-production-discovery.sh <40-char-commit> <migration.sql> /absolute/source-media-manifest.json /directory/<slug> /product/<slug> /media/<key>.webp" >&2
  exit 2
fi
release="$releases/$expected_commit"
readonly unit_source="$release/ops/systemd/production"
if [[ ! -d "$release" || -L "$release" || ! -f "$source_media_manifest" || -L "$source_media_manifest" || "$source_media_manifest" != /* ]]; then
  echo "Prepared release and source media manifest must be real paths with the expected types." >&2
  exit 2
fi
if [[ ! -L "$release/.env" || "$(readlink -f "$release/.env")" != "$(readlink -f "$env_file")" ]]; then
  echo "Prepared release does not use the production environment file." >&2
  exit 2
fi
if [[ -e "$root/current.next" && ! -L "$root/current.next" ]]; then
  echo "Refusing to replace a non-symlink current.next path." >&2
  exit 2
fi
if [[ -e "$root/current" && ! -L "$root/current" ]]; then
  echo "Refusing to replace a non-symlink current path." >&2
  exit 2
fi
for unit in "${production_units[@]}"; do
  if [[ ! -f "$unit_target/$unit" || -L "$unit_target/$unit" ]] || ! cmp -s "$unit_source/$unit" "$unit_target/$unit"; then
    echo "Installed systemd unit does not match the prepared release: $unit." >&2
    exit 2
  fi
  if [[ "$(stat -c '%U:%G:%a' "$unit_target/$unit")" != "root:root:644" ]]; then
    echo "Installed systemd unit must be root:root mode 0644: $unit." >&2
    exit 2
  fi
  if [[ -n "$(systemctl show "$unit" --property=DropInPaths --value)" ]]; then
    echo "Systemd drop-ins are not allowed for the production discovery units: $unit." >&2
    exit 2
  fi
done

cd "$release"
sudo -u seedexchange -- node dist/scripts/verify-release-manifest.js --root="$release" --manifest="$release/RELEASE.json" --commit="$expected_commit" --runtime-prepared
manifest_migration=$(node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("RELEASE.json","utf8")); process.stdout.write(manifest.expectedMigration)')
if [[ "$manifest_migration" != "$expected_migration" ]]; then
  echo "Approved migration does not match RELEASE.json." >&2
  exit 2
fi
sudo -u seedexchange -- node dist/scripts/verify-production-environment.js --file="$env_file"
sudo -u seedexchange -- node dist/scripts/verify-media.js --expected="$source_media_manifest"
sudo -u seedexchange -- node dist/scripts/verify-discovery-data.js "$expected_migration"

previous=''
if [[ -L "$root/current" ]]; then
  previous=$(readlink -f "$root/current")
  if [[ "$previous" != "$releases"/* || ! -d "$previous" ]]; then
    echo "Current production release points outside the guarded release root." >&2
    exit 2
  fi
fi
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
if ! sudo systemctl restart "$service" || ! node dist/scripts/verify-ready.js http://127.0.0.1:4200/ready discovery "$expected_migration" || ! node dist/scripts/verify-discovery-runtime.js --origin=http://127.0.0.1:4200 --migration="$expected_migration" --organization="$organization_path" --product="$product_path" --media="$media_path" || ! sudo systemctl start seedexchange-production-sitemap.service || ! sudo systemctl start seedexchange-production-outbox.service || ! sudo systemctl enable "$service" || ! sudo systemctl enable --now seedexchange-production-sitemap.timer seedexchange-production-outbox.timer || ! sudo systemctl is-active --quiet "$service" seedexchange-production-sitemap.timer seedexchange-production-outbox.timer; then
  if [[ -n "$previous" && "$previous" == "$releases"/* && -d "$previous" ]]; then
    ln -sfn "$previous" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    sudo systemctl enable --now "$service" seedexchange-production-sitemap.timer seedexchange-production-outbox.timer
    sudo systemctl is-active --quiet "$service" seedexchange-production-sitemap.timer seedexchange-production-outbox.timer
  else
    sudo systemctl disable --now "$service" seedexchange-production-sitemap.timer seedexchange-production-outbox.timer || true
    rm -f -- "$root/current"
  fi
  exit 1
fi
echo "Activated production discovery release $expected_commit. Caddy and DNS were not changed."
