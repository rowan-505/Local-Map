#!/usr/bin/env bash
# =============================================================================
# Stage 01: import_roads_to_tmp
# Drop/recreate tmp_road_import, load highway ways from PBF via osm2pgsql flex.
#
# Requires: PBF_PATH, OSM2PGSQL_FLEX_FILE
# Connection: LOCAL_DATABASE_URL only (DATABASE_URL is refused).
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

require_var PBF_PATH
require_var OSM2PGSQL_FLEX_FILE

TMP_ROAD_SCHEMA="${TMP_ROAD_SCHEMA:-tmp_road_import}"
OSM2PGSQL_BIN="${OSM2PGSQL:-osm2pgsql}"

if [[ "${TMP_ROAD_SCHEMA}" != "tmp_road_import" ]]; then
  echo "error: TMP_ROAD_SCHEMA must be tmp_road_import (fixed in lua/osm2pgsql_roads_only.lua)" >&2
  exit 1
fi

if [[ "${OSM2PGSQL_FLEX_FILE}" != /* ]]; then
  OSM2PGSQL_FLEX_FILE="${SCRIPT_DIR}/${OSM2PGSQL_FLEX_FILE}"
fi

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if [[ ! -f "${OSM2PGSQL_FLEX_FILE}" ]]; then
  echo "error: OSM2PGSQL_FLEX_FILE does not exist: ${OSM2PGSQL_FLEX_FILE}" >&2
  exit 1
fi

if ! command -v "${OSM2PGSQL_BIN}" >/dev/null 2>&1; then
  echo "error: osm2pgsql not found (${OSM2PGSQL_BIN})" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required" >&2
  exit 1
fi

# Connection: LOCAL_DATABASE_URL only — never DATABASE_URL (avoids silent Supabase writes).
if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  echo "error: set LOCAL_DATABASE_URL (DATABASE_URL is refused for this local import script)" >&2
  exit 1
fi
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "note: DATABASE_URL is set but ignored; using LOCAL_DATABASE_URL only." >&2
fi
DB_CONN_URL="${LOCAL_DATABASE_URL}"
OSM2PGSQL_USE_PGENV=0

psql_cmd() {
  psql "${DB_CONN_URL}" -v ON_ERROR_STOP=1 "$@"
}

echo "stage01: checking database connection..."
psql_cmd -c 'select 1 as psql_ok;' >/dev/null

START_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage01_import_roads_to_tmp start: ${START_TS}"
echo "stage01: PBF_PATH=${PBF_PATH}"
echo "stage01: OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
echo "stage01: TMP_ROAD_SCHEMA=${TMP_ROAD_SCHEMA}"

echo "stage01: drop and recreate schema ${TMP_ROAD_SCHEMA}..."
psql_cmd <<SQL
drop schema if exists ${TMP_ROAD_SCHEMA} cascade;
create schema ${TMP_ROAD_SCHEMA};
SQL

OSM2PGSQL_ARGS=(
  -O flex
  -S "${OSM2PGSQL_FLEX_FILE}"
  --create
  --slim
  --drop
  --verbose
)

if [[ "${OSM2PGSQL_USE_PGENV}" -eq 0 ]]; then
  OSM2PGSQL_ARGS=(-d "${DB_CONN_URL}" "${OSM2PGSQL_ARGS[@]}")
fi

if [[ -n "${OSM2PGSQL_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  OSM2PGSQL_ARGS+=(${OSM2PGSQL_EXTRA_ARGS})
fi

echo "stage01: running osm2pgsql (highway ways only via flex lua)..."
# shellcheck disable=SC2086
"${OSM2PGSQL_BIN}" "${OSM2PGSQL_ARGS[@]}" "${PBF_PATH}"

END_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage01_import_roads_to_tmp end: ${END_TS}"

TABLE_EXISTS="$(psql_cmd -tA -c "
select exists (
    select 1
    from information_schema.tables
    where table_schema = '${TMP_ROAD_SCHEMA}'
      and table_name = 'osm_road_lines'
      and table_type = 'BASE TABLE'
);
")"

if [[ "${TABLE_EXISTS}" != "t" ]]; then
  echo "error: ${TMP_ROAD_SCHEMA}.osm_road_lines was not created by osm2pgsql" >&2
  exit 1
fi

echo "stage01: ${TMP_ROAD_SCHEMA}.osm_road_lines row counts:"
psql_cmd -c "
select
    count(*)::bigint as row_count,
    count(*) filter (where tags ? 'highway')::bigint as highway_tag_count
from ${TMP_ROAD_SCHEMA}.osm_road_lines;
"
