#!/usr/bin/env bash
set -Eeuo pipefail

readonly root=/srv/seedexchange-production
readonly releases="$root/releases"
readonly target=/etc/caddy/sites-enabled/seedexchange-production.caddy
readonly main_config=/etc/caddy/Caddyfile

expected_commit=${1:-}
if [[ "${SEEDX_PRODUCTION_CADDY_ROLLBACK_APPROVED:-}" != "YES" ]]; then
  echo "Production Caddy rollback requires SEEDX_PRODUCTION_CADDY_ROLLBACK_APPROVED=YES after explicit owner approval and DNS restoration." >&2
  exit 2
fi
if [[ $# -ne 1 || ! "$expected_commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Usage: SEEDX_PRODUCTION_CADDY_ROLLBACK_APPROVED=YES rollback-production-caddy.sh <40-char-commit>" >&2
  exit 2
fi

release="$releases/$expected_commit"
source_fragment="$release/ops/caddy/seedexchange-production.caddy"
if [[ ! -d "$release" || -L "$release" || ! -f "$source_fragment" || -L "$source_fragment" || ! -f "$target" || -L "$target" ]]; then
  echo "The installed production Caddy fragment must exactly match the approved release." >&2
  exit 2
fi
if [[ "$(stat -c '%U:%G:%a' "$target")" != "root:root:644" ]] || ! cmp -s "$source_fragment" "$target"; then
  echo "The installed production Caddy fragment must exactly match the approved release." >&2
  exit 2
fi
if [[ ! -f "$main_config" || -L "$main_config" ]] || ! grep -Fqx 'import /etc/caddy/sites-enabled/*.caddy' "$main_config"; then
  echo "The root-owned Caddyfile must import the dedicated sites-enabled directory." >&2
  exit 2
fi

cd "$release"
sudo -u seedexchange -- node dist/scripts/verify-release-manifest.js --root="$release" --manifest="$release/RELEASE.json" --commit="$expected_commit" --runtime-prepared
backup=$(sudo mktemp /run/seedexchange-production-caddy.XXXXXX)
cleanup_backup() { sudo rm -f -- "$backup" || true; }
trap cleanup_backup EXIT
sudo install -o root -g root -m 0600 "$target" "$backup"
sudo rm -f -- "$target"
if ! sudo caddy validate --config "$main_config" --adapter caddyfile || ! sudo systemctl reload caddy.service; then
  sudo install -o root -g root -m 0644 "$backup" "$target"
  sudo caddy validate --config "$main_config" --adapter caddyfile || true
  sudo systemctl reload caddy.service || true
  echo "Caddy rollback failed; the production fragment was restored." >&2
  exit 1
fi
sudo rm -f -- "$backup"
trap - EXIT
echo "Removed the production Caddy fragment for release $expected_commit after DNS rollback. Other sites were not changed."
