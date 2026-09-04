#!/usr/bin/env bash
set -Eeuo pipefail

readonly root=/srv/seedexchange-production
readonly releases="$root/releases"
readonly target=/etc/caddy/sites-enabled/seedexchange-production.caddy
readonly main_config=/etc/caddy/Caddyfile

expected_commit=${1:-}
expected_migration=${2:-}
organization_path=${3:-}
product_path=${4:-}

if [[ "${SEEDX_PRODUCTION_CADDY_APPROVED:-}" != "YES" ]]; then
  echo "Production Caddy activation requires SEEDX_PRODUCTION_CADDY_APPROVED=YES after explicit owner approval." >&2
  exit 2
fi
if [[ $# -ne 4 || ! "$expected_commit" =~ ^[a-f0-9]{40}$ || ! "$expected_migration" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ || ! "$organization_path" =~ ^/directory/[a-z0-9-]+$ || ! "$product_path" =~ ^/product/[a-z0-9-]+$ ]]; then
  echo "Usage: SEEDX_PRODUCTION_CADDY_APPROVED=YES activate-production-caddy.sh <40-char-commit> <migration.sql> /directory/<slug> /product/<slug>" >&2
  exit 2
fi

release="$releases/$expected_commit"
source_fragment="$release/ops/caddy/seedexchange-production.caddy"
if [[ ! -d "$release" || -L "$release" || ! -f "$source_fragment" || -L "$source_fragment" ]]; then
  echo "The approved release or production Caddy fragment is unavailable." >&2
  exit 2
fi
if [[ ! -L "$root/current" || "$(readlink -f "$root/current")" != "$release" ]]; then
  echo "The approved release must be the active production application before Caddy activation." >&2
  exit 2
fi
if [[ ! -f "$main_config" || -L "$main_config" ]] || ! grep -Fqx 'import /etc/caddy/sites-enabled/*.caddy' "$main_config"; then
  echo "The root-owned Caddyfile must import the dedicated sites-enabled directory." >&2
  exit 2
fi

cd "$release"
sudo -u seedexchange -- node dist/scripts/verify-release-manifest.js --root="$release" --manifest="$release/RELEASE.json" --commit="$expected_commit" --runtime-prepared
sudo systemctl is-active --quiet seedexchange-production.service caddy.service
node dist/scripts/verify-ready.js http://127.0.0.1:4200/ready discovery "$expected_migration"
sudo -u seedexchange -- node dist/scripts/verify-production-observation.js --migration="$expected_migration" --organization="$organization_path" --product="$product_path"
sudo caddy validate --config "$source_fragment" --adapter caddyfile

installed_new=0
temporary=''
cleanup_temporary() {
  if [[ -n "$temporary" ]]; then sudo rm -f -- "$temporary" || true; fi
}
trap cleanup_temporary EXIT
if [[ -L "$target" ]]; then
  echo "Refusing to replace a symlinked production Caddy fragment." >&2
  exit 2
elif [[ -e "$target" ]]; then
  if [[ ! -f "$target" || "$(stat -c '%U:%G:%a' "$target")" != "root:root:644" ]] || ! cmp -s "$source_fragment" "$target"; then
    echo "Refusing to replace a different or unsafe production Caddy fragment." >&2
    exit 2
  fi
else
  temporary=$(sudo mktemp /etc/caddy/sites-enabled/.seedexchange-production.XXXXXX)
  sudo install -o root -g root -m 0644 "$source_fragment" "$temporary"
  sudo mv -T "$temporary" "$target"
  temporary=''
  installed_new=1
fi

rollback_fragment() {
  if [[ "$installed_new" -eq 1 ]]; then
    sudo rm -f -- "$target"
    sudo caddy validate --config "$main_config" --adapter caddyfile || true
    sudo systemctl reload caddy.service || true
  fi
}

if ! sudo caddy validate --config "$main_config" --adapter caddyfile || ! sudo systemctl reload caddy.service || ! curl -fsSI --resolve seedexchange.online:80:127.0.0.1 http://seedexchange.online/ | grep -Fiq 'location: https://seedexchange.online/'; then
  rollback_fragment
  echo "Production Caddy activation failed; a newly installed fragment was removed." >&2
  exit 1
fi

trap - EXIT
echo "Activated the production Caddy fragment for release $expected_commit. DNS was not changed."
