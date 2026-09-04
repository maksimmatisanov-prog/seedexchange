#!/usr/bin/env bash
set -Eeuo pipefail

readonly production_root=/srv/seedexchange-production
readonly production_database=seedexchange_production
readonly production_role=seedexchange_production
readonly production_fragment=/etc/caddy/sites-enabled/seedexchange-production.caddy
readonly units=(
  seedexchange-production.service
  seedexchange-production-outbox.service
  seedexchange-production-outbox.timer
  seedexchange-production-sitemap.service
  seedexchange-production-sitemap.timer
)

if [[ "${SEEDX_PRODUCTION_FOUNDATION_APPROVED:-}" != "YES" ]]; then
  echo "Production foundation creation requires SEEDX_PRODUCTION_FOUNDATION_APPROVED=YES after explicit owner approval." >&2
  exit 2
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: SEEDX_PRODUCTION_FOUNDATION_APPROVED=YES bash ops/prepare-production-foundation.sh /secure/root-only-db-password" >&2
  exit 2
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Production foundation creation must run as root." >&2
  exit 2
fi

password_argument=$1
if [[ -L "$password_argument" ]]; then
  echo "The database password file must be a root-owned regular non-symlink file under /secure with mode 0600." >&2
  exit 2
fi
password_file=$(readlink -f -- "$password_argument" 2>/dev/null || true)
if [[ "$password_file" != /secure/* || ! -f "$password_file" || -L "$password_file" || "$(stat -c '%U:%a' "$password_file" 2>/dev/null)" != "root:600" ]]; then
  echo "The database password file must be a root-owned regular non-symlink file under /secure with mode 0600." >&2
  exit 2
fi
password=$(<"$password_file")
password_file_size=$(stat -c '%s' "$password_file" 2>/dev/null || printf invalid)
if [[ "$password_file_size" != "${#password}" && "$password_file_size" != "$(( ${#password} + 1 ))" ]]; then
  echo "The database password file must contain exactly one line." >&2
  exit 2
fi
if [[ ${#password} -lt 32 || ${#password} -gt 128 || ! "$password" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "The database password must contain 32 to 128 URL-safe characters." >&2
  exit 2
fi

fail_clean() {
  echo "Production host is not in the required clean pre-foundation state." >&2
  exit 2
}

[[ "$(node --version 2>/dev/null)" =~ ^v24\. ]] || fail_clean
id -u seedexchange >/dev/null 2>&1 || fail_clean
systemctl is-active --quiet postgresql || fail_clean
systemctl is-active --quiet caddy || fail_clean
[[ -d /srv/seedexchange ]] || fail_clean
[[ -f /etc/caddy/Caddyfile && ! -L /etc/caddy/Caddyfile ]] || fail_clean
grep -Fqx 'import /etc/caddy/sites-enabled/*.caddy' /etc/caddy/Caddyfile || fail_clean
command -v psql >/dev/null 2>&1 || fail_clean
command -v createdb >/dev/null 2>&1 || fail_clean
command -v dropdb >/dev/null 2>&1 || fail_clean
command -v sudo >/dev/null 2>&1 || fail_clean
command -v ss >/dev/null 2>&1 || fail_clean
if ss -H -ltn 'sport = :4200' 2>/dev/null | grep -q .; then fail_clean; fi
[[ ! -e "$production_root" && ! -L "$production_root" ]] || fail_clean
[[ ! -e "$production_fragment" && ! -L "$production_fragment" ]] || fail_clean
for unit in "${units[@]}"; do
  [[ ! -e "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] || fail_clean
done
database_inventory=$(sudo -u postgres -- psql -v ON_ERROR_STOP=1 -d postgres -Atqc "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname = '$production_database') THEN 'present' ELSE 'missing' END" 2>/dev/null || printf query_failed)
role_inventory=$(sudo -u postgres -- psql -v ON_ERROR_STOP=1 -d postgres -Atqc "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$production_role') THEN 'present' ELSE 'missing' END" 2>/dev/null || printf query_failed)
[[ "$database_inventory" == "missing" && "$role_inventory" == "missing" ]] || fail_clean

created_role=0
created_database=0
created_root=0
prepared=0
cleanup() {
  unset password PGPASSWORD
  if [[ "$prepared" -eq 1 ]]; then return; fi
  set +e
  if [[ "$created_database" -eq 1 ]]; then sudo -u postgres -- dropdb --if-exists -- "$production_database" >/dev/null 2>&1; fi
  if [[ "$created_role" -eq 1 ]]; then printf 'DROP ROLE IF EXISTS %s;\n' "$production_role" | sudo -u postgres -- psql -v ON_ERROR_STOP=1 -d postgres >/dev/null 2>&1; fi
  if [[ "$created_root" -eq 1 && "$production_root" == "/srv/seedexchange-production" ]]; then rm -rf -- /srv/seedexchange-production; fi
}
trap cleanup EXIT

created_role=1
printf "CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n" "$production_role" "$password" \
  | sudo -u postgres -- psql -v ON_ERROR_STOP=1 -d postgres >/dev/null
created_database=1
sudo -u postgres -- createdb --owner="$production_role" --encoding=UTF8 --template=template0 -- "$production_database"

created_root=1
install -d -m 0750 -o seedexchange -g seedexchange \
  "$production_root" \
  "$production_root/releases" \
  "$production_root/shared" \
  "$production_root/shared/storage" \
  "$production_root/shared/storage/media"

export PGPASSWORD=$password
identity=$(psql -h 127.0.0.1 -p 5432 -U "$production_role" -d "$production_database" -Atqc \
  "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(database_row.datdba) || '|' || CASE WHEN role_row.rolcanlogin AND NOT (role_row.rolsuper OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls) THEN 'least-privilege' ELSE 'elevated' END FROM pg_roles role_row JOIN pg_database database_row ON database_row.datname=current_database() WHERE role_row.rolname=current_user")
[[ "$identity" == "seedexchange_production|seedexchange_production|seedexchange_production|least-privilege" ]] || {
  echo "Production database password login or identity verification failed." >&2
  exit 1
}

prepared=1
unset password PGPASSWORD
echo "Production foundation created. No environment, release, service, Caddy, DNS, data import or payment state was changed."
