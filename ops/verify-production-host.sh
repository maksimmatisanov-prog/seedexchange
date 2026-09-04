#!/usr/bin/env bash
set -uo pipefail

readonly production_root=/srv/seedexchange-production
readonly environment_file="$production_root/shared/production.env"
readonly production_fragment=/etc/caddy/sites-enabled/seedexchange-production.caddy
readonly units=(
  seedexchange-production.service
  seedexchange-production-outbox.service
  seedexchange-production-outbox.timer
  seedexchange-production-sitemap.service
  seedexchange-production-sitemap.timer
)

expectation=${1:-}
if [[ "$expectation" != "--expect=clean" && "$expectation" != "--expect=foundation" && "$expectation" != "--expect=units-installed" ]]; then
  echo "Usage: sudo bash ops/verify-production-host.sh --expect=clean|foundation|units-installed" >&2
  exit 2
fi
expectation=${expectation#--expect=}

errors=()
report() { printf '%s=%s\n' "$1" "$2"; }
reject() { errors+=("$1"); }
exists() { [[ -e "$1" || -L "$1" ]]; }
presence() { if exists "$1"; then printf present; else printf missing; fi; }

report expectation "$expectation"
if [[ "$EUID" -eq 0 ]]; then report effective_user root; else report effective_user non_root; reject root_required; fi

node_major=missing
if command -v node >/dev/null 2>&1; then
  node_major=$(node --version 2>/dev/null | sed -En 's/^v([0-9]+).*/\1/p')
  [[ -n "$node_major" ]] || node_major=invalid
fi
report node_major "$node_major"
[[ "$node_major" == "24" ]] || reject node_24_required

if id -u seedexchange >/dev/null 2>&1; then report service_user present; else report service_user missing; reject service_user_missing; fi
if systemctl is-active --quiet postgresql; then report postgresql active; else report postgresql inactive; reject postgresql_inactive; fi
if systemctl is-active --quiet caddy; then report caddy active; else report caddy inactive; reject caddy_inactive; fi

if [[ -d /srv/seedexchange ]]; then report staging_root present; else report staging_root missing; reject staging_root_missing; fi
if [[ -f /etc/caddy/Caddyfile && ! -L /etc/caddy/Caddyfile ]] && grep -Fqx 'import /etc/caddy/sites-enabled/*.caddy' /etc/caddy/Caddyfile; then
  report caddy_site_import valid
else
  report caddy_site_import invalid
  reject caddy_site_import_invalid
fi

if ! command -v ss >/dev/null 2>&1; then
  report port_4200 unknown
  reject socket_inventory_unavailable
elif ss -H -ltn 'sport = :4200' 2>/dev/null | grep -q .; then
    report port_4200 in_use
    reject port_4200_in_use
else
  report port_4200 free
fi

production_database=unknown
production_role=unknown
production_role_superuser=unknown
production_database_owner=unknown
if [[ "$EUID" -eq 0 ]] && command -v sudo >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
  production_database=$(sudo -u postgres -- psql -d postgres -Atqc "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname = 'seedexchange_production') THEN 'present' ELSE 'missing' END" 2>/dev/null || printf unknown)
  production_role=$(sudo -u postgres -- psql -d postgres -Atqc "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seedexchange_production') THEN 'present' ELSE 'missing' END" 2>/dev/null || printf unknown)
  if [[ "$production_role" == "present" ]]; then
    production_role_superuser=$(sudo -u postgres -- psql -d postgres -Atqc "SELECT CASE WHEN rolsuper THEN 'yes' ELSE 'no' END FROM pg_roles WHERE rolname = 'seedexchange_production'" 2>/dev/null || printf unknown)
  fi
  if [[ "$production_database" == "present" ]]; then
    production_database_owner=$(sudo -u postgres -- psql -d postgres -Atqc "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'seedexchange_production'" 2>/dev/null || printf unknown)
  fi
fi
report production_database "$production_database"
report production_role "$production_role"
report production_role_superuser "$production_role_superuser"
report production_database_owner "$production_database_owner"

report production_root "$(presence "$production_root")"
report production_environment "$(presence "$environment_file")"
report production_caddy_fragment "$(presence "$production_fragment")"
for unit in "${units[@]}"; do
  unit_file=/etc/systemd/system/$unit
  report "unit_$unit" "$(presence "$unit_file")"
done

require_foundation() {
  for directory_spec in \
    "production_root:$production_root" \
    "releases_directory:$production_root/releases" \
    "shared_directory:$production_root/shared" \
    "storage_directory:$production_root/shared/storage" \
    "media_directory:$production_root/shared/storage/media"; do
    directory_name=${directory_spec%%:*}
    directory_path=${directory_spec#*:}
    [[ -d "$directory_path" && ! -L "$directory_path" ]] || reject "${directory_name}_missing_or_unsafe"
  done
  if [[ "$production_database" == "present" ]]; then
    [[ "$production_database_owner" == "seedexchange_production" ]] || reject production_database_owner_invalid
  else
    reject production_database_missing
  fi
  if [[ "$production_role" == "present" ]]; then
    [[ "$production_role_superuser" == "no" ]] || reject production_role_must_not_be_superuser
  else
    reject production_role_missing
  fi
  if [[ ! -f "$environment_file" || -L "$environment_file" ]]; then
    reject production_environment_missing_or_unsafe
  else
    [[ "$(stat -c '%G' "$environment_file" 2>/dev/null)" == "seedexchange" ]] || reject production_environment_group_invalid
    if find "$environment_file" -perm /007 -print -quit 2>/dev/null | grep -q .; then reject production_environment_other_permissions; fi
    sudo -u seedexchange -- test -r "$environment_file" || reject production_environment_unreadable
  fi
}

if [[ "$expectation" == "clean" ]]; then
  ! exists "$production_root" || reject production_root_must_be_absent
  [[ "$production_database" == "missing" ]] || reject production_database_must_be_absent
  [[ "$production_role" == "missing" ]] || reject production_role_must_be_absent
  ! exists "$production_fragment" || reject production_caddy_fragment_must_be_absent
  for unit in "${units[@]}"; do ! exists "/etc/systemd/system/$unit" || reject production_units_must_be_absent; done
else
  require_foundation
  ! exists "$production_fragment" || reject production_caddy_fragment_must_be_absent
  for unit in "${units[@]}"; do
    unit_file=/etc/systemd/system/$unit
    if [[ "$expectation" == "foundation" ]]; then
      ! exists "$unit_file" || reject production_units_must_be_absent
    else
      [[ -f "$unit_file" && ! -L "$unit_file" ]] || reject production_unit_missing_or_unsafe
      [[ ! -d "$unit_file.d" ]] || reject production_unit_dropin_forbidden
      if systemctl is-active --quiet "$unit"; then reject production_units_must_be_stopped; fi
      if systemctl is-enabled --quiet "$unit"; then reject production_units_must_be_disabled; fi
      if systemctl is-failed --quiet "$unit"; then reject production_units_must_not_be_failed; fi
    fi
  done
fi

if [[ ${#errors[@]} -eq 0 ]]; then
  report ready true
  exit 0
fi

IFS=,
report errors "${errors[*]}"
report ready false
exit 1
