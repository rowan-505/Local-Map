#!/usr/bin/env bash
# =============================================================================
# Admin-fast-core: OSM admin boundaries -> raw -> staging -> core.core_admin_areas
#
# Independent from tools/data-pipeline/local-osm and road-fast-core.
# Does not upload to Supabase or write import_review.
#
# Stage order:
#   00_create_admin_snapshot.sql
#   00_cleanup_current_snapshot.sql  (before osm2pgsql)
#   01_import_admin_to_tmp.sh
#   02–07 SQL stages
#
# Usage:
#   ./run_admin_fast_core_pipeline.sh imports/myanmar_admin_2026_06_03_v1.env
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <import-env-file>

  Exactly one argument: path to a sourced imports/*.env file.

  Runs stages 00 (snapshot + cleanup), 01–07. Stops on first error.
  All output is appended to a timestamped log under LOG_DIR.

Copy template:
  cp imports/template.full.env imports/myanmar_admin_2026_06_03_v1.env
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
require_var TMP_ADMIN_SCHEMA
require_var RAW_SCHEMA
require_var STAGING_SCHEMA
require_var SYSTEM_SCHEMA
require_var CORE_SCHEMA

FORCE_RECALCULATE_VERIFIED="${FORCE_RECALCULATE_VERIFIED:-false}"
case "$(printf '%s' "${FORCE_RECALCULATE_VERIFIED}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes) FORCE_RECALCULATE_VERIFIED_BOOL=true ;;
  *) FORCE_RECALCULATE_VERIFIED_BOOL=false ;;
esac

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

if [[ "${TMP_ADMIN_SCHEMA}" != "tmp_admin_import" ]]; then
  echo "error: TMP_ADMIN_SCHEMA must be tmp_admin_import (lua/osm2pgsql_admin_only.lua is fixed to that schema)" >&2
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

export TMP_ADMIN_SCHEMA RAW_SCHEMA STAGING_SCHEMA SYSTEM_SCHEMA CORE_SCHEMA
export SNAPSHOT_VERSION SNAPSHOT_REF BATCH_NAME SOURCE_CODE REGION_CODE PBF_PATH LOCAL_DATABASE_URL
export FORCE_RECALCULATE_VERIFIED FORCE_RECALCULATE_VERIFIED_BOOL

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
LOG_FILE="${LOG_DIR}/admin-fast-core_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

run_stage_begin() {
  local stage_name="$1"
  log ""
  log "=== ${stage_name} START $(utc_now) ==="
}

run_stage_end() {
  local stage_name="$1"
  log "=== ${stage_name} END $(utc_now) ==="
}

print_resolved_config() {
  log "pipeline: admin-fast-core (not local-osm; not road-fast-core; no import_review)"
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
  log "TMP_ADMIN_SCHEMA=${TMP_ADMIN_SCHEMA}"
  log "RAW_SCHEMA=${RAW_SCHEMA}"
  log "STAGING_SCHEMA=${STAGING_SCHEMA}"
  log "SYSTEM_SCHEMA=${SYSTEM_SCHEMA}"
  log "CORE_SCHEMA=${CORE_SCHEMA}"
  log "FORCE_RECALCULATE_VERIFIED=${FORCE_RECALCULATE_VERIFIED} (psql boolean=${FORCE_RECALCULATE_VERIFIED_BOOL})"
}

# Shared psql -v set for every SQL stage (unused vars are harmless).
run_psql_sql() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v source_code="${SOURCE_CODE}" \
    -v region_code="${REGION_CODE}" \
    -v snapshot_ref="${SNAPSHOT_REF}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v batch_name="${BATCH_NAME}" \
    -v checksum="${CHECKSUM}" \
    -v tmp_admin_schema="${TMP_ADMIN_SCHEMA}" \
    -v raw_schema="${RAW_SCHEMA}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v core_schema="${CORE_SCHEMA}" \
    -v force_recalculate_verified="${FORCE_RECALCULATE_VERIFIED}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${sql_file}" \
    2>&1 | tee -a "${LOG_FILE}"
}

run_sql_stage() {
  local stage_name="$1"
  local sql_file="$2"
  run_stage_begin "${stage_name}"
  run_psql_sql "${sql_file}"
  run_stage_end "${stage_name}"
}

run_shell_stage() {
  local stage_name="$1"
  local sh_file="$2"
  if [[ ! -f "${sh_file}" ]]; then
    echo "error: shell stage not found: ${sh_file}" >&2
    exit 1
  fi
  run_stage_begin "${stage_name}"
  bash "${sh_file}" 2>&1 | tee -a "${LOG_FILE}"
  run_stage_end "${stage_name}"
}

log "admin-fast-core pipeline START $(utc_now)"
log "log file: ${LOG_FILE}"
print_resolved_config

run_sql_stage "00_create_admin_snapshot" "${SCRIPT_DIR}/00_create_admin_snapshot.sql"
run_sql_stage "00_cleanup_current_snapshot" "${SCRIPT_DIR}/00_cleanup_current_snapshot.sql"
run_shell_stage "01_import_admin_to_tmp" "${SCRIPT_DIR}/01_import_admin_to_tmp.sh"
run_sql_stage "02_validate_tmp_admin" "${SCRIPT_DIR}/02_validate_tmp_admin.sql"
run_sql_stage "03_tmp_admin_to_raw" "${SCRIPT_DIR}/03_tmp_admin_to_raw.sql"
run_sql_stage "04_raw_admin_to_staging" "${SCRIPT_DIR}/04_raw_admin_to_staging.sql"
run_sql_stage "05_validate_staging_admin" "${SCRIPT_DIR}/05_validate_staging_admin.sql"
run_sql_stage "06_promote_admin_to_core" "${SCRIPT_DIR}/06_promote_admin_to_core.sql"
run_sql_stage "07_verify_core_admin" "${SCRIPT_DIR}/07_verify_core_admin.sql"

log ""
log "admin-fast-core pipeline END $(utc_now) OK"
