#!/usr/bin/env bash
# =============================================================================
# Stage 02: import_to_tmp (local-only)
# Load OSM PBF into tmp_import via osm2pgsql flex. Does not touch raw/staging/core/system.
#
# Requires (from sourced import env): LOCAL_DATABASE_URL, PBF_PATH
# Optional:
#   OSM2PGSQL (default: osm2pgsql)
#   OSMIUM (default: osmium) — required for entity-specific imports (admin_areas / roads)
#   TMP_IMPORT_SCHEMA (default: tmp_import)
#   OSM2PGSQL_EXTRA_ARGS
#   CHECKSUM (optional; runner exports sha256 of PBF for prefilter cache keys)
#   ENTITY_FAMILIES (default: all) — when admin_areas or roads only, auto-selects
#     entity-specific Lua unless OSM2PGSQL_FLEX_FILE is explicitly set.
#   OSM2PGSQL_FLEX_FILE — optional override for flex Lua config path
#
# Entity-specific imports pre-filter the source PBF with osmium tags-filter before
# osm2pgsql. Lua-only filtering still reads the entire PBF and --slim writes every
# node to scratch tables, which looks hung on whole-country extracts.
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

TMP_IMPORT_SCHEMA="${TMP_IMPORT_SCHEMA:-tmp_import}"
OSM2PGSQL_BIN="${OSM2PGSQL:-osm2pgsql}"
OSMIUM_BIN="${OSMIUM:-osmium}"
LOG_DIR="${LOG_DIR:-logs}"
ENTITY_FAMILIES="${ENTITY_FAMILIES:-all}"
ENTITY_FAMILIES="$(printf '%s' "${ENTITY_FAMILIES}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

resolve_tmp_import_mode() {
  case "${ENTITY_FAMILIES}" in
    all|'') echo "full" ;;
    admin_areas) echo "admin_areas_only" ;;
    roads) echo "roads_only" ;;
    *) echo "full" ;;
  esac
}

resolve_osm2pgsql_flex_file() {
  if [[ -n "${OSM2PGSQL_FLEX_FILE:-}" ]]; then
    printf '%s\n' "${OSM2PGSQL_FLEX_FILE}"
    return 0
  fi

  case "$(resolve_tmp_import_mode)" in
    admin_areas_only)
      printf '%s\n' "${SCRIPT_DIR}/lua/osm2pgsql_admin_areas_only.lua"
      ;;
    roads_only)
      printf '%s\n' "${SCRIPT_DIR}/lua/osm2pgsql_roads_only.lua"
      ;;
    *)
      printf '%s\n' "${SCRIPT_DIR}/lua/osm2pgsql_tmp_import.lua"
      ;;
  esac
}

resolve_expected_tmp_tables() {
  case "$(resolve_tmp_import_mode)" in
    admin_areas_only) printf '%s\n' "osm_admin_polygons" ;;
    roads_only) printf '%s\n' "osm_road_lines" ;;
    *) printf '%s\n' "osm_points osm_lines osm_polygons" ;;
  esac
}

resolve_stage02_pbf() {
  STAGE02_PBF="${PBF_PATH}"
  STAGE02_USE_SLIM="true"
  STAGE02_PREFILTERED="false"

  if [[ "${TMP_IMPORT_MODE}" == "full" ]]; then
    return 0
  fi

  if ! command -v "${OSMIUM_BIN}" >/dev/null 2>&1; then
    echo "error: ENTITY_FAMILIES=${ENTITY_FAMILIES} requires osmium-tool to pre-filter the PBF before osm2pgsql." >&2
    echo "       Without pre-filter, osm2pgsql scans the entire extract and --slim stores every node — it looks stuck for minutes." >&2
    echo "       Install: brew install osmium-tool" >&2
    exit 1
  fi

  local checksum="${CHECKSUM:-}"
  if [[ -z "${checksum}" ]]; then
    checksum="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"
  fi

  local prefilter_dir="${LOG_DIR}/stage02_prefilter"
  mkdir -p "${prefilter_dir}"

  STAGE02_PBF="${prefilter_dir}/${checksum}_${TMP_IMPORT_MODE}.osm.pbf"
  STAGE02_USE_SLIM="false"
  STAGE02_PREFILTERED="true"

  if [[ -f "${STAGE02_PBF}" ]]; then
    echo "Reusing cached prefiltered PBF: ${STAGE02_PBF}"
    return 0
  fi

  echo "Prefiltering source PBF with osmium tags-filter (required for fast ${TMP_IMPORT_MODE} import)..."

  case "${TMP_IMPORT_MODE}" in
    admin_areas_only)
      "${OSMIUM_BIN}" tags-filter --progress -O -o "${STAGE02_PBF}" "${PBF_PATH}" \
        r/boundary=administrative w/boundary=administrative
      ;;
    roads_only)
      "${OSMIUM_BIN}" tags-filter --progress -O -o "${STAGE02_PBF}" "${PBF_PATH}" w/highway
      ;;
    *)
      echo "error: unsupported tmp import mode for prefilter: ${TMP_IMPORT_MODE}" >&2
      exit 1
      ;;
  esac

  echo "Prefiltered PBF ready: ${STAGE02_PBF} ($(du -h "${STAGE02_PBF}" | awk '{print $1}'))"
}

TMP_IMPORT_MODE="$(resolve_tmp_import_mode)"
OSM2PGSQL_FLEX_FILE="$(resolve_osm2pgsql_flex_file)"
EXPECTED_TMP_TABLES="$(resolve_expected_tmp_tables)"

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist or is not a file: ${PBF_PATH}" >&2
  exit 1
fi

if [[ ! -f "${OSM2PGSQL_FLEX_FILE}" ]]; then
  echo "error: OSM2PGSQL_FLEX_FILE does not exist: ${OSM2PGSQL_FLEX_FILE}" >&2
  echo "hint: repo flex configs live under ${SCRIPT_DIR}/lua/" >&2
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

resolve_stage02_pbf

START_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage02_import_to_tmp start: ${START_TS}"
echo "ENTITY_FAMILIES=${ENTITY_FAMILIES}"
echo "tmp_import_mode=${TMP_IMPORT_MODE}"
echo "OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
echo "expected tmp_import tables: ${EXPECTED_TMP_TABLES}"
echo "stage02_pbf=${STAGE02_PBF}"
echo "stage02_prefiltered=${STAGE02_PREFILTERED}"
echo "stage02_slim_mode=${STAGE02_USE_SLIM}"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
create schema if not exists ${TMP_IMPORT_SCHEMA};
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_points;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_lines;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_polygons;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_admin_polygons;
drop table if exists ${TMP_IMPORT_SCHEMA}.osm_road_lines;
SQL

OSM2PGSQL_ARGS=(
  -d "${LOCAL_DATABASE_URL}"
  --create
  --output=flex
  --style "${OSM2PGSQL_FLEX_FILE}"
  --schema="${TMP_IMPORT_SCHEMA}"
  --drop
)

if [[ "${STAGE02_USE_SLIM}" == "true" ]]; then
  OSM2PGSQL_ARGS+=( --slim )
fi

# Flex Lua defines projection 4326 per column; --schema keeps slim scratch tables out of public.
# shellcheck disable=SC2086
"${OSM2PGSQL_BIN}" \
  "${OSM2PGSQL_ARGS[@]}" \
  ${OSM2PGSQL_EXTRA_ARGS:-} \
  "${STAGE02_PBF}"

END_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "stage02_import_to_tmp end: ${END_TS}"

echo "tmp_import row counts:"
case "${TMP_IMPORT_MODE}" in
  admin_areas_only)
    psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
select 'osm_admin_polygons' as table_name, count(*)::bigint as row_count
from ${TMP_IMPORT_SCHEMA}.osm_admin_polygons;
"
    ;;
  roads_only)
    psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
select 'osm_road_lines' as table_name, count(*)::bigint as row_count
from ${TMP_IMPORT_SCHEMA}.osm_road_lines;
"
    ;;
  *)
    psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
select 'osm_points' as table_name, count(*)::bigint as row_count from ${TMP_IMPORT_SCHEMA}.osm_points
union all
select 'osm_lines', count(*)::bigint from ${TMP_IMPORT_SCHEMA}.osm_lines
union all
select 'osm_polygons', count(*)::bigint from ${TMP_IMPORT_SCHEMA}.osm_polygons
order by table_name;
"
    ;;
esac
