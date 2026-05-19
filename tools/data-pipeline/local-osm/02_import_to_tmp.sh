#!/usr/bin/env bash
# =============================================================================
# Stage 02: import_to_tmp (local-only)
# Load OSM PBF into tmp_import via osm2pgsql flex. Does not touch raw/staging/core/system.
#
# Requires (from sourced import env): LOCAL_DATABASE_URL, PBF_PATH, OSM2PGSQL_FLEX_FILE
# Optional: OSM2PGSQL (default: osm2pgsql), TMP_IMPORT_SCHEMA (default: tmp_import), OSM2PGSQL_EXTRA_ARGS
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset" >&2
    exit 1
  fi
}

require_var LOCAL_DATABASE_URL
require_var PBF_PATH
require_var OSM2PGSQL_FLEX_FILE

TMP_IMPORT_SCHEMA="${TMP_IMPORT_SCHEMA:-tmp_import}"
OSM2PGSQL_BIN="${OSM2PGSQL:-osm2pgsql}"

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist or is not a file: ${PBF_PATH}" >&2
  exit 1
fi

if [[ ! -f "${OSM2PGSQL_FLEX_FILE}" ]]; then
  echo "error: OSM2PGSQL_FLEX_FILE does not exist: ${OSM2PGSQL_FLEX_FILE}" >&2
  echo "hint: repo flex config lives at ${SCRIPT_DIR}/lua/osm2pgsql_tmp_import.lua (set OSM2PGSQL_FLEX_FILE accordingly)" >&2
  exit 1
fi

if ! command -v "${OSM2PGSQL_BIN}" >/dev/null 2>&1; then
  echo "error: osm2pgsql not found (${OSM2PGSQL_BIN}). Install osm2pgsql or set OSM2PGSQL to the binary path." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required" >&2
  exit 1
fi

if ! psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c 'select 1 as psql_ok;' >/dev/null; then
  echo "error: cannot connect to database with LOCAL_DATABASE_URL" >&2
  exit 1
fi

START_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage02_import_to_tmp start: ${START_TS}"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
create schema if not exists ${TMP_IMPORT_SCHEMA};
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_points;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_lines;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_polygons;
SQL

# Flex Lua defines projection 4326 per column; --schema keeps slim scratch tables out of public.
# shellcheck disable=SC2086
"${OSM2PGSQL_BIN}" \
  -d "${LOCAL_DATABASE_URL}" \
  --create \
  --output=flex \
  --style "${OSM2PGSQL_FLEX_FILE}" \
  --schema="${TMP_IMPORT_SCHEMA}" \
  --slim \
  --drop \
  ${OSM2PGSQL_EXTRA_ARGS:-} \
  "${PBF_PATH}"

END_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage02_import_to_tmp end: ${END_TS}"

echo "tmp_import row counts:"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
select 'osm_points' as table_name, count(*)::bigint as row_count from ${TMP_IMPORT_SCHEMA}.osm_points
union all
select 'osm_lines', count(*)::bigint from ${TMP_IMPORT_SCHEMA}.osm_lines
union all
select 'osm_polygons', count(*)::bigint from ${TMP_IMPORT_SCHEMA}.osm_polygons
order by table_name;
"
