#!/usr/bin/env bash
# =============================================================================
# Road-fast-core: OSM highways -> raw -> staging -> core.core_streets
#
# Independent from tools/data-pipeline/local-osm.
# Does not upload to Supabase or write import_review.
#
# Usage:
#   ./run_road_fast_core_pipeline.sh imports/myanmar_roads_2026_06_03_v1.env
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <import-env-file>

  Exactly one argument: path to a sourced imports/*.env file.

  Runs stages 00–08 (road-fast-core only). Stops on first error.
  All output is appended to a timestamped log under LOG_DIR.

Copy template:
  cp imports/template.full.env imports/myanmar_roads_2026_06_03_v1.env
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

resolve_import_env_file() {
  local arg="$1"
  if [[ -f "${arg}" ]]; then
    echo "$(cd "$(dirname "${arg}")" && pwd)/$(basename "${arg}")"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/${arg}" ]]; then
    echo "${SCRIPT_DIR}/${arg}"
    return 0
  fi
  return 1
}

if ! IMPORT_ENV_FILE="$(resolve_import_env_file "$1")"; then
  echo "error: import env file not found: $1" >&2
  echo "       (tried relative path and ${SCRIPT_DIR}/$1)" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${IMPORT_ENV_FILE}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset in ${IMPORT_ENV_FILE}" >&2
    exit 1
  fi
}

require_var LOCAL_DATABASE_URL
require_var SOURCE_CODE
require_var REGION_CODE
require_var PBF_PATH
require_var SNAPSHOT_REF
require_var SNAPSHOT_VERSION
require_var BATCH_NAME
require_var OSM2PGSQL_FLEX_FILE
require_var LOG_DIR
require_var TMP_ROAD_SCHEMA
require_var RAW_SCHEMA
require_var STAGING_SCHEMA
require_var SYSTEM_SCHEMA
require_var CORE_SCHEMA

# Resolve paths relative to this pipeline directory.
if [[ "${OSM2PGSQL_FLEX_FILE}" != /* ]]; then
  OSM2PGSQL_FLEX_FILE="${SCRIPT_DIR}/${OSM2PGSQL_FLEX_FILE}"
fi
export OSM2PGSQL_FLEX_FILE

if [[ "${LOG_DIR}" != /* ]]; then
  LOG_DIR="${SCRIPT_DIR}/${LOG_DIR}"
fi
export LOG_DIR

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if [[ ! -f "${OSM2PGSQL_FLEX_FILE}" ]]; then
  echo "error: OSM2PGSQL_FLEX_FILE does not exist: ${OSM2PGSQL_FLEX_FILE}" >&2
  exit 1
fi

if [[ "${TMP_ROAD_SCHEMA}" != "tmp_road_import" ]]; then
  echo "error: TMP_ROAD_SCHEMA must be tmp_road_import (lua/osm2pgsql_roads_only.lua is fixed to that schema)" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "error: shasum is required to calculate the PBF checksum" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required" >&2
  exit 1
fi

CHECKSUM="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"
export CHECKSUM

APPLY_BOUNDARY_FILTER="${APPLY_BOUNDARY_FILTER:-false}"
CORE_PROMOTE_MODE="${CORE_PROMOTE_MODE:-upsert}"
ALLOW_BOUNDARY_UPDATE="${ALLOW_BOUNDARY_UPDATE:-false}"
BOUNDARY_ID="${BOUNDARY_ID:-}"

case "$(printf '%s' "${APPLY_BOUNDARY_FILTER}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes)
    APPLY_BOUNDARY_FILTER_BOOL=true
    if [[ -z "${BOUNDARY_ID}" ]]; then
      echo "error: APPLY_BOUNDARY_FILTER=true requires BOUNDARY_ID" >&2
      exit 1
    fi
    ;;
  *)
    APPLY_BOUNDARY_FILTER_BOOL=false
    BOUNDARY_ID=""
    ;;
esac

export TMP_ROAD_SCHEMA RAW_SCHEMA STAGING_SCHEMA SYSTEM_SCHEMA CORE_SCHEMA
export APPLY_BOUNDARY_FILTER CORE_PROMOTE_MODE ALLOW_BOUNDARY_UPDATE BOUNDARY_ID
export SNAPSHOT_VERSION SNAPSHOT_REF BATCH_NAME SOURCE_CODE REGION_CODE PBF_PATH LOCAL_DATABASE_URL

mask_database_url() {
  local url="$1"
  if [[ "${url}" =~ ^postgres(ql)?://([^:/@]+):[^@]*@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}:***@${BASH_REMATCH[3]}"
  elif [[ "${url}" =~ ^postgres(ql)?://([^@]+)@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}@${BASH_REMATCH[3]}"
  else
    echo "postgresql://***"
  fi
}

mkdir -p "${LOG_DIR}"
RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
SAFE_SNAPSHOT_VERSION="${SNAPSHOT_VERSION//\//_}"
LOG_FILE="${LOG_DIR}/road-fast-core_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

print_resolved_config() {
  log "pipeline: road-fast-core (not local-osm; no Supabase; no import_review)"
  log "import env file: ${IMPORT_ENV_FILE}"
  log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
  log "SOURCE_CODE=${SOURCE_CODE}"
  log "REGION_CODE=${REGION_CODE}"
  log "PBF_PATH=${PBF_PATH}"
  log "SNAPSHOT_REF=${SNAPSHOT_REF}"
  log "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
  log "BATCH_NAME=${BATCH_NAME}"
  log "CHECKSUM=${CHECKSUM}"
  log "OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
  log "LOG_DIR=${LOG_DIR}"
  log "TMP_ROAD_SCHEMA=${TMP_ROAD_SCHEMA}"
  log "RAW_SCHEMA=${RAW_SCHEMA}"
  log "STAGING_SCHEMA=${STAGING_SCHEMA}"
  log "SYSTEM_SCHEMA=${SYSTEM_SCHEMA}"
  log "CORE_SCHEMA=${CORE_SCHEMA}"
  log "APPLY_BOUNDARY_FILTER=${APPLY_BOUNDARY_FILTER_BOOL}"
  log "BOUNDARY_ID=${BOUNDARY_ID:-<none>}"
  log "CORE_PROMOTE_MODE=${CORE_PROMOTE_MODE}"
}

run_stage() {
  log ""
  log "=== $1 ==="
}

run_sql() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  # pipefail: failing psql exits the pipeline even through tee
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v region_code="${REGION_CODE}" \
    -v tmp_road_import_schema="${TMP_ROAD_SCHEMA}" \
    -v raw_schema="${RAW_SCHEMA}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v core_schema="${CORE_SCHEMA}" \
    -v apply_boundary_filter="${APPLY_BOUNDARY_FILTER_BOOL}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${sql_file}" \
    2>&1 | tee -a "${LOG_FILE}"
}

run_shell_stage() {
  local sh_file="$1"
  if [[ ! -f "${sh_file}" ]]; then
    echo "error: shell stage not found: ${sh_file}" >&2
    exit 1
  fi
  bash "${sh_file}" 2>&1 | tee -a "${LOG_FILE}"
}

log "road-fast-core pipeline started at ${RUN_TS}"
log "log file: ${LOG_FILE}"
print_resolved_config

run_stage "00_create_road_snapshot"
PAGER=cat psql "${LOCAL_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v source_code="${SOURCE_CODE}" \
  -v batch_name="${BATCH_NAME}" \
  -v snapshot_ref="${SNAPSHOT_REF}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v checksum="${CHECKSUM}" \
  ${PSQL_EXTRA_ARGS:-} \
  -f "${SCRIPT_DIR}/00_create_road_snapshot.sql" \
  2>&1 | tee -a "${LOG_FILE}"

run_stage "01_import_roads_to_tmp"
run_shell_stage "${SCRIPT_DIR}/01_import_roads_to_tmp.sh"

run_stage "02_validate_tmp_roads"
run_sql "${SCRIPT_DIR}/02_validate_tmp_roads.sql"

run_stage "03_tmp_roads_to_raw"
run_sql "${SCRIPT_DIR}/03_tmp_roads_to_raw.sql"

run_stage "04_raw_roads_to_staging"
run_sql "${SCRIPT_DIR}/04_raw_roads_to_staging.sql"

run_stage "05_validate_staging_roads"
run_sql "${SCRIPT_DIR}/05_validate_staging_roads.sql"

run_stage "06_promote_roads_to_core"
run_sql "${SCRIPT_DIR}/06_promote_roads_to_core.sql"

run_stage "08_indexes_core_roads"
run_sql "${SCRIPT_DIR}/08_indexes_core_roads.sql"

run_stage "07_verify_core_roads"
run_sql "${SCRIPT_DIR}/07_verify_core_roads.sql"

log ""
log "road-fast-core pipeline finished OK at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
