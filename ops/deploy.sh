#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/seedexchange
artifact=${1:-}
release_id=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
release="$root/releases/$release_id"
expected_phase=${SEEDX_EXPECTED_LAUNCH_PHASE:-discovery}

if [[ -z "$artifact" || ! -f "$artifact" ]]; then
  echo "Usage: ops/deploy.sh /absolute/path/to/artifact.tar.gz [release-id]" >&2
  exit 2
fi
if [[ ! "$release_id" =~ ^[0-9A-Za-z._-]+$ || -e "$release" ]]; then
  echo "Release id is unsafe or already exists." >&2
  exit 2
fi
test -d "$root/releases" -a -d "$root/shared"
mkdir "$release"
tar -xzf "$artifact" -C "$release"
cd "$release"
npm ci
npm run check
npm test
npm run build
npm prune --omit=dev
expected_migration=$(find dist/src/db/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | tail -n 1)
if [[ -z "$expected_migration" ]]; then
  echo "No compiled database migration was found." >&2
  exit 2
fi
ln -s "$root/shared/staging.env" .env
ln -s "$root/shared/storage" storage
sudo -u seedexchange -- node dist/src/db/migrate.js

previous=''
if [[ -L "$root/current" ]]; then previous=$(readlink -f "$root/current"); fi
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
if ! sudo systemctl restart seedexchange-staging.service || ! node dist/scripts/verify-ready.js http://127.0.0.1:4100/ready "$expected_phase" "$expected_migration"; then
  if [[ -n "$previous" && "$previous" == "$root"/releases/* ]]; then
    ln -sfn "$previous" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    sudo systemctl restart seedexchange-staging.service
  fi
  exit 1
fi
echo "Activated $release"
