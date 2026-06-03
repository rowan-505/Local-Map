#!/usr/bin/env bash
# =============================================================================
# Stage 01: import_admin_to_tmp
# Load administrative boundary polygons from PBF into tmp_admin_import.osm_admin_polygons
# via osm2pgsql flex (lua/osm2pgsql_admin_only.lua).
#
# Requires: LOCAL_DATABASE_URL, PBF_PATH, OSM2PGSQL_FLEX_FILE, TMP_ADMIN_SCHEMA
# Schema is recreated by 00_cleanup_current_snapshot before this stage runs.
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

TMP_ADMIN_SCHEMA="${TMP_ADMIN_SCHEMA:-tmp_admin_import}"
OSM2PGSQL_BIN="${OSM2PGSQL:-osm2pgsql}"

if [[ "${TMP_ADMIN_SCHEMA}" != "tmp_admin_import" ]]; then
  echo "error: TMP_ADMIN_SCHEMA must be tmp_admin_import (fixed in lua/osm2pgsql_admin_only.lua)" >&2
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

echo "stage01: checking database connection..."
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c 'select 1 as psql_ok;' >/dev/null

START_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage01_import_admin_to_tmp start: ${START_TS}"
echo "stage01: PBF_PATH=${PBF_PATH}"
echo "stage01: OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
echo "stage01: TMP_ADMIN_SCHEMA=${TMP_ADMIN_SCHEMA}"
echo "stage01: target table=${TMP_ADMIN_SCHEMA}.osm_admin_polygons"

OSM2PGSQL_ARGS=(
  -d "${LOCAL_DATABASE_URL}"
  -O flex
  -S "${OSM2PGSQL_FLEX_FILE}"
  --create
  --slim
  --drop
)

if [[ -n "${OSM2PGSQL_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  OSM2PGSQL_ARGS+=(${OSM2PGSQL_EXTRA_ARGS})
fi

echo "stage01: running osm2pgsql (administrative boundaries only via flex lua)..."
# shellcheck disable=SC2086
"${OSM2PGSQL_BIN}" "${OSM2PGSQL_ARGS[@]}" "${PBF_PATH}"

END_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage01_import_admin_to_tmp end: ${END_TS}"

TABLE_EXISTS="$(psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -tA -c "
select exists (
    select 1
    from information_schema.tables
    where table_schema = '${TMP_ADMIN_SCHEMA}'
      and table_name = 'osm_admin_polygons'
      and table_type = 'BASE TABLE'
);
")"

if [[ "${TABLE_EXISTS}" != "t" ]]; then
  echo "error: ${TMP_ADMIN_SCHEMA}.osm_admin_polygons was not created by osm2pgsql" >&2
  exit 1
fi

echo "stage01: ${TMP_ADMIN_SCHEMA}.osm_admin_polygons row counts:"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
select
    count(*)::bigint as row_count,
    count(*) filter (where tags->>'boundary' = 'administrative')::bigint as administrative_boundary_count,
    count(*) filter (where tags ? 'admin_level')::bigint as admin_level_tag_count
from ${TMP_ADMIN_SCHEMA}.osm_admin_polygons;
"
