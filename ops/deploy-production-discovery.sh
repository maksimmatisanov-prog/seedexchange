#!/usr/bin/env bash
set -Eeuo pipefail

readonly root=/srv/seedexchange-production
readonly releases="$root/releases"
readonly shared="$root/shared"
readonly env_file="$shared/production.env"

artifact=${1:-}
expected_sha256=${2:-}
expected_commit=${3:-}

if [[ "${SEEDX_PRODUCTION_DISCOVERY_PREPARE_APPROVED:-}" != "YES" ]]; then
  echo "Production preparation requires SEEDX_PRODUCTION_DISCOVERY_PREPARE_APPROVED=YES after explicit owner approval." >&2
  exit 2
fi
if [[ $# -ne 3 || ! "$expected_sha256" =~ ^[a-f0-9]{64}$ || ! "$expected_commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Usage: SEEDX_PRODUCTION_DISCOVERY_PREPARE_APPROVED=YES ops/deploy-production-discovery.sh /absolute/release.tar.gz <sha256> <40-char-commit>" >&2
  exit 2
fi
if [[ "$artifact" != /* || ! -f "$artifact" || -L "$artifact" ]]; then
  echo "Artifact must be an absolute path to a regular non-symlink file." >&2
  exit 2
fi
artifact=$(readlink -f -- "$artifact")
release="$releases/$expected_commit"
if [[ ! -d "$releases" || ! -d "$shared/storage/media" || ! -f "$env_file" || -L "$env_file" || -e "$release" ]]; then
  echo "Production root is incomplete, environment is unsafe, or release already exists." >&2
  exit 2
fi
if [[ "$(stat -c '%G' "$env_file")" != "seedexchange" ]] || find "$env_file" -perm /007 -print -quit | grep -q .; then
  echo "production.env must belong to group seedexchange and grant no permissions to other users." >&2
  exit 2
fi
if ! sudo -u seedexchange -- test -r "$env_file"; then
  echo "production.env is not readable by the seedexchange service account." >&2
  exit 2
fi
actual_sha256=$(sha256sum "$artifact" | awk '{print $1}')
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Artifact SHA-256 does not match the approved value." >&2
  exit 2
fi

listing=$(mktemp)
types=$(mktemp)
prepared=0
cleanup() {
  rm -f -- "$listing" "$types"
  if [[ "$prepared" -eq 0 && -d "$release" && "$release" == "$releases"/[a-f0-9]* ]]; then rm -rf -- "$release"; fi
}
trap cleanup EXIT
tar -tzf "$artifact" > "$listing"
tar -tvzf "$artifact" > "$types"
if grep -Eq '(^|/)\.\.(/|$)|^/|\\' "$listing"; then
  echo "Artifact contains an unsafe path." >&2
  exit 2
fi
if awk '{ type=substr($1,1,1); if (type != "-" && type != "d") exit 1 }' "$types"; then :; else
  echo "Artifact may contain only regular files and directories." >&2
  exit 2
fi

install -d -m 0750 -o seedexchange -g seedexchange "$release"
tar --no-same-owner --no-same-permissions -xzf "$artifact" -C "$release"
chown -R seedexchange:seedexchange "$release"
sudo -u seedexchange -- node "$release/dist/scripts/verify-release-manifest.js" --root="$release" --manifest="$release/RELEASE.json" --commit="$expected_commit"

cd "$release"
sudo -u seedexchange -- npm ci --omit=dev
ln -s "$env_file" .env
sudo -u seedexchange -- node dist/scripts/verify-production-environment.js --file="$env_file"
sudo -u seedexchange -- node dist/scripts/verify-production-mail.js
sudo -u seedexchange -- node dist/src/db/migrate.js
chmod -R a-w "$release"
prepared=1
echo "Prepared production discovery release $expected_commit. No service, Caddy or DNS state was changed."
