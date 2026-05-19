#!/usr/bin/env bash
# Register or reuse the local OSM import boundary before Stage A.
# Requires the caller to source a full imports/*.env file first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset" >&2
    exit 1
  fi
}

require_var LOCAL_DATABASE_URL
require_var BOUNDARY_GEOJSON_PATH
require_var BOUNDARY_CODE
require_var BOUNDARY_NAME
require_var BOUNDARY_VERSION
require_var REGION_CODE
require_var PBF_PATH

if [[ ! -f "${BOUNDARY_GEOJSON_PATH}" ]]; then
  echo "error: BOUNDARY_GEOJSON_PATH does not exist: ${BOUNDARY_GEOJSON_PATH}" >&2
  exit 1
fi

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "error: shasum is required to calculate SHA256 checksums" >&2
  exit 1
fi

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "error: ogr2ogr is required to load the boundary GeoJSON" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required to register the boundary" >&2
  exit 1
fi

BOUNDARY_REF="$(basename "${BOUNDARY_GEOJSON_PATH}")"
BOUNDARY_CHECKSUM="$(shasum -a 256 "${BOUNDARY_GEOJSON_PATH}" | awk '{print $1}')"
PBF_CHECKSUM="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"

echo "boundary_ref=${BOUNDARY_REF}" >&2
echo "boundary_checksum=${BOUNDARY_CHECKSUM}" >&2
echo "pbf_checksum=${PBF_CHECKSUM}" >&2

psql "${LOCAL_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -c "create schema if not exists tmp_import;" \
  -c "drop table if exists tmp_import.import_boundary_tmp;" \
  -c "drop table if exists tmp_import.tmp_import_boundaries;" >/dev/null

ogr2ogr \
  -f PostgreSQL "PG:${LOCAL_DATABASE_URL}" \
  "${BOUNDARY_GEOJSON_PATH}" \
  -nln tmp_import.tmp_import_boundaries \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom \
  -overwrite

psql "${LOCAL_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -c "create table tmp_import.import_boundary_tmp as select * from tmp_import.tmp_import_boundaries;" >/dev/null

BOUNDARY_RESULT="$(
  psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v boundary_code="${BOUNDARY_CODE}" \
    -v boundary_name="${BOUNDARY_NAME}" \
    -v boundary_version="${BOUNDARY_VERSION}" \
    -v boundary_ref="${BOUNDARY_REF}" \
    -v source_file_path="${BOUNDARY_GEOJSON_PATH}" \
    -v checksum="${BOUNDARY_CHECKSUM}" \
    -v region_code="${REGION_CODE}" \
    -At -F $'\t' \
    -f "${SCRIPT_DIR}/00_register_boundary.sql"
)"

echo "${BOUNDARY_RESULT}"

BOUNDARY_ID="$(printf '%s\n' "${BOUNDARY_RESULT}" | awk -F $'\t' 'NF > 0 && $1 ~ /^[0-9]+$/ { print $1; exit }')"

if [[ -z "${BOUNDARY_ID}" ]]; then
  echo "error: could not parse boundary_id from 00_register_boundary.sql output" >&2
  exit 1
fi

echo "registered_boundary_id=${BOUNDARY_ID}" >&2

if [[ -n "${BOUNDARY_ID_OUTPUT_FILE:-}" ]]; then
  printf '%s\n' "${BOUNDARY_ID}" > "${BOUNDARY_ID_OUTPUT_FILE}"
fi

if [[ -n "${PBF_CHECKSUM_OUTPUT_FILE:-}" ]]; then
  printf '%s\n' "${PBF_CHECKSUM}" > "${PBF_CHECKSUM_OUTPUT_FILE}"
fi
