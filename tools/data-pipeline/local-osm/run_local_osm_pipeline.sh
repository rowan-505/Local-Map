#!/usr/bin/env bash
# Local-first OSM import pipeline. Core promotion stays disabled.
#
# After Stage 10, optional outbound review tooling:
#   11_prepare_remote_review_package.sql  (stage J — local system.* tables)
#   12_upload_remote_review_package.ts    (stage K — Supabase import_review.* only)
#   13_verify_remote_review_upload.sql    (stage L — local linkage summary)
#
# Optional:
#   14_verify_lineage_alignment.sql — after J/L when REMOTE_LINEAGE_ALIGNMENT_VERIFY=true
#     (staging ↔ package lineage + payload mirrors; FAIL stops the runner if checks fail).
#   15_entity_coverage_report.sql — final read-only staging/package health report
#     when LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true.
#
# Modes:
#   REMOTE_REVIEW_UPLOAD_ENABLED=true     → runs J → K → L (requires SUPABASE_DATABASE_URL).
#   REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true→ runs J → L only (no Supabase).
#   REMOTE_LINEAGE_ALIGNMENT_VERIFY=true  → optional 14_verify_lineage_alignment.sql after Stage L when J/K/L path runs
#   LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true → optional Stage 15 after Stage 14/final verification
#
# Usage:
#   ./run_local_osm_pipeline.sh imports/kyauktan_2026_07_v4.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <import-env-file>

  <import-env-file>  Full per-import env file (e.g. imports/kyauktan_2026_07_v4.env)

Copy and edit the template:
  cp imports/template.full.env imports/kyauktan_2026_07_v4.env

  Stages 11–13 after stage 10 when enabled in the env file:
  REMOTE_REVIEW_UPLOAD_ENABLED=true        → 11_prepare_remote_review_package.sql → 12_upload_remote_review_package.ts → 13_verify_remote_review_upload.sql
  REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true   → 11 → 13 (local only; skips Supabase Stage 12)

See README.md / README_REMOTE_REVIEW.md for lineage fields and REMOTE_LINEAGE_ALIGNMENT_VERIFY (optional Stage 14 local SQL).

Optional after 11→13 completes (same env gated flags above):
  REMOTE_LINEAGE_ALIGNMENT_VERIFY=true → 14_verify_lineage_alignment.sql after Stage L (local staging + package payload lineage).

Optional final read-only report:
  LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true → 15_entity_coverage_report.sql after Stage 14/final verification.
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

IMPORT_ENV_ARG="$1"

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

if ! IMPORT_ENV_FILE="$(resolve_import_env_file "${IMPORT_ENV_ARG}")"; then
  echo "error: import env file not found: ${IMPORT_ENV_ARG}" >&2
  echo "       (tried relative path and ${SCRIPT_DIR}/${IMPORT_ENV_ARG})" >&2
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
require_var LOG_DIR

# OSM2PGSQL_FLEX_FILE is optional — Stage 02 auto-selects entity-specific Lua when unset.

# Optional boundary GeoJSON — empty/unset => whole-region import (no clipping).
BOUNDARY_GEOJSON_PATH="$(printf '%s' "${BOUNDARY_GEOJSON_PATH:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
export BOUNDARY_GEOJSON_PATH

if [[ -n "${BOUNDARY_GEOJSON_PATH}" ]]; then
  BOUNDARY_MODE="CLIPPED"
  require_var BOUNDARY_CODE
  require_var BOUNDARY_NAME
  require_var BOUNDARY_VERSION
  BOUNDARY_ID=""
else
  BOUNDARY_MODE="WHOLE_REGION"
  BOUNDARY_ID=""
fi
export BOUNDARY_MODE
export BOUNDARY_ID

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "error: shasum is required to calculate the PBF checksum" >&2
  exit 1
fi

CHECKSUM="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"
export CHECKSUM
ALLOW_BOUNDARY_UPDATE="${ALLOW_BOUNDARY_UPDATE:-false}"
export ALLOW_BOUNDARY_UPDATE

TMP_IMPORT_SCHEMA="${TMP_IMPORT_SCHEMA:-tmp_import}"
RAW_SCHEMA="${RAW_SCHEMA:-raw}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
SYSTEM_SCHEMA="${SYSTEM_SCHEMA:-system}"
IMPORT_REVIEW_SCHEMA="${IMPORT_REVIEW_SCHEMA:-import_review}"

# ENTITY_FAMILIES: all | comma-separated pipeline slugs (default all).
PIPELINE_ENTITY_FAMILIES_ALLOWED=(
  places roads buildings landuse water_lines water_polygons
  admin_areas bus_stops bus_routes bus_route_variants bus_route_stops
  addresses address_components place_address_links
  routing_barriers routing_roads routing_turn_restrictions
)

normalize_entity_families() {
  local raw="${1:-all}"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  if [[ -z "${raw}" || "${raw}" == "all" || "${raw}" == "*" ]]; then
    printf '%s' "all"
    return 0
  fi

  local -a parts=()
  local part
  IFS=',' read -r -a parts <<< "${raw}"
  local -a normalized=()
  local allowed slug found

  for part in "${parts[@]}"; do
    part="$(printf '%s' "${part}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
    [[ -z "${part}" ]] && continue

    found=0
    for allowed in "${PIPELINE_ENTITY_FAMILIES_ALLOWED[@]}"; do
      if [[ "${part}" == "${allowed}" ]]; then
        found=1
        break
      fi
    done
    if [[ "${found}" -ne 1 ]]; then
      echo "error: unsupported ENTITY_FAMILIES slug \"${part}\"" >&2
      echo "       allowed: ${PIPELINE_ENTITY_FAMILIES_ALLOWED[*]}" >&2
      exit 1
    fi

    local duplicate=0
    for slug in "${normalized[@]:-}"; do
      if [[ "${slug}" == "${part}" ]]; then
        duplicate=1
        break
      fi
    done
    if [[ "${duplicate}" -eq 0 ]]; then
      normalized+=("${part}")
    fi
  done

  if [[ "${#normalized[@]}" -eq 0 ]]; then
    echo "error: ENTITY_FAMILIES resolved to an empty set: ${1}" >&2
    exit 1
  fi

  local IFS=','
  printf '%s' "${normalized[*]}"
}

ENTITY_FAMILIES="$(normalize_entity_families "${ENTITY_FAMILIES:-all}")"
export ENTITY_FAMILIES

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
LOG_FILE="${LOG_DIR}/local-osm-pipeline_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

# Resume from a stage (e.g. 08) after stages 01–07 already completed. Empty = full pipeline.
PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-}"
PIPELINE_PSQL_WORK_MEM="${PIPELINE_PSQL_WORK_MEM:-512MB}"
PIPELINE_PSQL_MAINTENANCE_WORK_MEM="${PIPELINE_PSQL_MAINTENANCE_WORK_MEM:-1GB}"

pipeline_stage_num() {
  printf '%d' "$((10#${1//[^0-9]/}))" 2>/dev/null || printf '%d' 0
}

pipeline_should_run_stage() {
  local stage_id="$1"
  if [[ -z "${PIPELINE_FROM_STAGE}" ]]; then
    return 0
  fi
  local from_num
  local stage_num
  from_num="$(pipeline_stage_num "${PIPELINE_FROM_STAGE}")"
  stage_num="$(pipeline_stage_num "${stage_id}")"
  [[ "${stage_num}" -ge "${from_num}" ]]
}

pipeline_skip_stage_log() {
  local stage_name="$1"
  log ""
  log "=== ${stage_name} (skipped — PIPELINE_FROM_STAGE=${PIPELINE_FROM_STAGE}) ==="
}

run_psql() {
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -c "SET work_mem = '${PIPELINE_PSQL_WORK_MEM}';" \
    -c "SET maintenance_work_mem = '${PIPELINE_PSQL_MAINTENANCE_WORK_MEM}';" \
    -c "SET temp_buffers = '64MB';" \
    "$@" \
    2>&1 | tee -a "${LOG_FILE}"
}

print_resolved_config() {
  log "import env file: ${IMPORT_ENV_FILE}"
  log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
  log "SOURCE_CODE=${SOURCE_CODE}"
  log "REGION_CODE=${REGION_CODE}"
  log "BOUNDARY_MODE=${BOUNDARY_MODE}"
  log "PBF_PATH=${PBF_PATH}"
  if [[ "${BOUNDARY_MODE}" == "CLIPPED" ]]; then
    log "BOUNDARY_GEOJSON_PATH=${BOUNDARY_GEOJSON_PATH}"
    log "BOUNDARY_CODE=${BOUNDARY_CODE}"
    log "BOUNDARY_NAME=${BOUNDARY_NAME}"
    log "BOUNDARY_VERSION=${BOUNDARY_VERSION}"
  else
    log "BOUNDARY_GEOJSON_PATH=(not set — whole-region import, no clipping)"
  fi
  log "SNAPSHOT_REF=${SNAPSHOT_REF}"
  log "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
  log "BATCH_NAME=${BATCH_NAME}"
  log "CHECKSUM=${CHECKSUM}"
  log "ALLOW_BOUNDARY_UPDATE=${ALLOW_BOUNDARY_UPDATE}"
  if [[ -n "${OSM2PGSQL_FLEX_FILE:-}" ]]; then
    log "OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
  else
    log "OSM2PGSQL_FLEX_FILE=(auto from ENTITY_FAMILIES in Stage 02)"
  fi
  log "LOG_DIR=${LOG_DIR}"
  log "TMP_IMPORT_SCHEMA=${TMP_IMPORT_SCHEMA}"
  log "RAW_SCHEMA=${RAW_SCHEMA}"
  log "STAGING_SCHEMA=${STAGING_SCHEMA}"
  log "SYSTEM_SCHEMA=${SYSTEM_SCHEMA}"
  log "IMPORT_REVIEW_SCHEMA=${IMPORT_REVIEW_SCHEMA}"
  log "ENTITY_FAMILIES=${ENTITY_FAMILIES}"
  log "PIPELINE_FROM_STAGE=${PIPELINE_FROM_STAGE:-<full run>}"
  log "PIPELINE_PSQL_WORK_MEM=${PIPELINE_PSQL_WORK_MEM}"
  log "PIPELINE_PSQL_MAINTENANCE_WORK_MEM=${PIPELINE_PSQL_MAINTENANCE_WORK_MEM}"
  if [[ -n "${REMOTE_REVIEW_UPLOAD_ENABLED:-}" || -n "${REMOTE_REVIEW_PREPARE_VERIFY_ONLY:-}" || -n "${REMOTE_REVIEW_PACKAGE_NAME:-}" || -n "${REMOTE_LINEAGE_ALIGNMENT_VERIFY:-}" || -n "${LOCAL_ENTITY_COVERAGE_REPORT_ENABLED:-}" ]]; then
    log "REMOTE_REVIEW_UPLOAD_ENABLED=${REMOTE_REVIEW_UPLOAD_ENABLED:-}"
    log "REMOTE_REVIEW_PREPARE_VERIFY_ONLY=${REMOTE_REVIEW_PREPARE_VERIFY_ONLY:-}"
    log "REMOTE_REVIEW_PACKAGE_NAME=${REMOTE_REVIEW_PACKAGE_NAME:-}"
    log "REMOTE_REVIEW_ENTITY_FAMILY=${REMOTE_REVIEW_ENTITY_FAMILY:-}"
    log "REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=${REMOTE_REVIEW_MAX_ROWS_PER_FAMILY:-}"
    log "REMOTE_REVIEW_BATCH_ID=${REMOTE_REVIEW_BATCH_ID:-}"
    log "REMOTE_LINEAGE_ALIGNMENT_VERIFY=${REMOTE_LINEAGE_ALIGNMENT_VERIFY:-}"
    log "LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=${LOCAL_ENTITY_COVERAGE_REPORT_ENABLED:-}"
    if is_remote_review_upload_requested; then
      log "SUPABASE_DATABASE_URL=$(mask_database_url "${SUPABASE_DATABASE_URL:-}")"
    fi
  fi
}

is_remote_review_upload_requested() {
  case "$(printf '%s' "${REMOTE_REVIEW_UPLOAD_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_remote_review_prepare_verify_only_requested() {
  case "$(printf '%s' "${REMOTE_REVIEW_PREPARE_VERIFY_ONLY:-false}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_remote_lineage_alignment_verify_requested() {
  case "$(printf '%s' "${REMOTE_LINEAGE_ALIGNMENT_VERIFY:-false}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_entity_coverage_report_requested() {
  case "$(printf '%s' "${LOCAL_ENTITY_COVERAGE_REPORT_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_remote_review_stage_files() {
  local f
  for f in \
    "${SCRIPT_DIR}/11_prepare_remote_review_package.sql" \
    "${SCRIPT_DIR}/12_upload_remote_review_package.ts" \
    "${SCRIPT_DIR}/13_verify_remote_review_upload.sql"
  do
    if [[ ! -f "${f}" ]]; then
      echo "error: remote review stage file missing: ${f}" >&2
      exit 1
    fi
  done
}

run_stage_11_prepare_remote_review_j() {
  run_stage "11_prepare_remote_review_package (stage J)"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v entity_family="${REMOTE_REVIEW_ENTITY_FAMILY:-}" \
    -v max_rows_per_family="${REMOTE_REVIEW_MAX_ROWS_PER_FAMILY:-}" \
    -v package_name="${REMOTE_REVIEW_PACKAGE_NAME}" \
    -v replace_package=false \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/11_prepare_remote_review_package.sql"
}

run_stage_12_upload_remote_review_k() {
  run_stage "12_upload_remote_review_package (stage K)"
  local repo_root
  repo_root="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
  local tsx_bin="${repo_root}/node_modules/.bin/tsx"
  (
    cd "${repo_root}"
    export REMOTE_REVIEW_UPLOAD_ENABLED="true"
    export LOCAL_DATABASE_URL
    export SUPABASE_DATABASE_URL
    export REMOTE_REVIEW_PACKAGE_NAME
    export REMOTE_REVIEW_ENTITY_FAMILY="${REMOTE_REVIEW_ENTITY_FAMILY:-}"
    export REMOTE_REVIEW_MAX_ROWS_PER_FAMILY="${REMOTE_REVIEW_MAX_ROWS_PER_FAMILY:-}"
    export SUPABASE_DB_SSL_VERIFY_SERVER_CERT="${SUPABASE_DB_SSL_VERIFY_SERVER_CERT:-}"
    if [[ -x "${tsx_bin}" ]]; then
      "${tsx_bin}" "${SCRIPT_DIR}/12_upload_remote_review_package.ts"
    else
      npx tsx "${SCRIPT_DIR}/12_upload_remote_review_package.ts"
    fi
  ) 2>&1 | tee -a "${LOG_FILE}"
}

run_stage_13_verify_remote_review_l() {
  run_stage "13_verify_remote_review_upload (stage L)"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v package_name="${REMOTE_REVIEW_PACKAGE_NAME}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v import_review_schema="${IMPORT_REVIEW_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v entity_family="${REMOTE_REVIEW_ENTITY_FAMILY:-}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/13_verify_remote_review_upload.sql"
}

run_stage_14_verify_lineage_alignment() {
  run_stage "14_verify_lineage_alignment (remote-review lineage QA)"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v package_name="${REMOTE_REVIEW_PACKAGE_NAME}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/14_verify_lineage_alignment.sql"
}

run_stage_15_entity_coverage_report() {
  run_stage "15_entity_coverage_report"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v region_code="${REGION_CODE}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v import_review_schema="${IMPORT_REVIEW_SCHEMA}" \
    -v review_batch_id="${REMOTE_REVIEW_BATCH_ID:-}" \
    -v package_name="${REMOTE_REVIEW_PACKAGE_NAME:-}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v entity_family="${REMOTE_REVIEW_ENTITY_FAMILY:-}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/15_entity_coverage_report.sql"
}

finalize_remote_review_stages() {
  if is_remote_review_upload_requested && is_remote_review_prepare_verify_only_requested; then
    log ""
    log "Both REMOTE_REVIEW_UPLOAD_ENABLED and REMOTE_REVIEW_PREPARE_VERIFY_ONLY are true — using full upload path (J → K → L)."
  fi

  if ! is_remote_review_upload_requested && ! is_remote_review_prepare_verify_only_requested; then
    log ""
    log "REMOTE_REVIEW_UPLOAD_ENABLED / REMOTE_REVIEW_PREPARE_VERIFY_ONLY not set to true — skipping Stages 11–13."
    return 0
  fi

  require_remote_review_stage_files
  require_var REMOTE_REVIEW_PACKAGE_NAME

  log ""
  log "REMOTE_REVIEW_PACKAGE_NAME=${REMOTE_REVIEW_PACKAGE_NAME}"
  log "Stage J uses replace_package=false; reuse the same package name only if that row was deleted, or rerun J manually with -v replace_package=true."
  if [[ -n "${REMOTE_REVIEW_ENTITY_FAMILY:-}" ]]; then
    log "REMOTE_REVIEW_ENTITY_FAMILY=${REMOTE_REVIEW_ENTITY_FAMILY}"
  fi
  if [[ -n "${REMOTE_REVIEW_MAX_ROWS_PER_FAMILY:-}" ]]; then
    log "REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=${REMOTE_REVIEW_MAX_ROWS_PER_FAMILY}"
  fi

  if pipeline_should_run_stage "11"; then
    run_stage_11_prepare_remote_review_j
  else
    pipeline_skip_stage_log "11_prepare_remote_review_package (stage J)"
  fi

  if is_remote_review_upload_requested; then
    if pipeline_should_run_stage "12"; then
      require_var SUPABASE_DATABASE_URL
      log "REMOTE_REVIEW_UPLOAD_ENABLED=true — running Stage K (Supabase import_review only)."
      log "SUPABASE_DATABASE_URL=$(mask_database_url "${SUPABASE_DATABASE_URL}")"
      run_stage_12_upload_remote_review_k
    else
      pipeline_skip_stage_log "12_upload_remote_review_package (stage K)"
    fi
  else
    log "REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true — skipping Stage K (no Supabase upload)."
  fi

  if pipeline_should_run_stage "13"; then
    run_stage_13_verify_remote_review_l
  else
    pipeline_skip_stage_log "13_verify_remote_review_upload (stage L)"
  fi

  if is_remote_lineage_alignment_verify_requested; then
    if [[ ! -f "${SCRIPT_DIR}/14_verify_lineage_alignment.sql" ]]; then
      echo "error: REMOTE_LINEAGE_ALIGNMENT_VERIFY set but missing: ${SCRIPT_DIR}/14_verify_lineage_alignment.sql" >&2
      exit 1
    fi
    if pipeline_should_run_stage "14"; then
      run_stage_14_verify_lineage_alignment
    else
      pipeline_skip_stage_log "14_verify_lineage_alignment"
    fi
  fi
}

run_stage() {
  local stage_name="$1"
  log ""
  log "=== ${stage_name} ==="
}

run_sql() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v region_code="${REGION_CODE}" \
    -v tmp_import_schema="${TMP_IMPORT_SCHEMA}" \
    -v raw_schema="${RAW_SCHEMA}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${sql_file}"
}

run_shell_stage() {
  local sh_file="$1"
  if [[ ! -f "${sh_file}" ]]; then
    echo "error: shell stage not found: ${sh_file}" >&2
    exit 1
  fi
  bash "${sh_file}" 2>&1 | tee -a "${LOG_FILE}"
}

run_preflight_schema_compatibility() {
  local preflight_sql="${SCRIPT_DIR}/00_preflight_schema_compatibility.sql"
  if [[ ! -f "${preflight_sql}" ]]; then
    echo "error: preflight SQL file not found: ${preflight_sql}" >&2
    exit 1
  fi
  run_stage "00_preflight_schema_compatibility"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${preflight_sql}"
}

log "local-osm pipeline started at ${RUN_TS}"
log "log file: ${LOG_FILE}"
print_resolved_config

if is_remote_lineage_alignment_verify_requested &&
  ! is_remote_review_upload_requested &&
  ! is_remote_review_prepare_verify_only_requested; then
  log ""
  log "REMOTE_LINEAGE_ALIGNMENT_VERIFY=true has no effect until Stages 11–13 run — set REMOTE_REVIEW_UPLOAD_ENABLED or REMOTE_REVIEW_PREPARE_VERIFY_ONLY."
fi

if pipeline_should_run_stage "00"; then
  run_preflight_schema_compatibility
else
  pipeline_skip_stage_log "00_preflight_schema_compatibility"
fi

if [[ "${BOUNDARY_MODE}" == "CLIPPED" ]]; then
  if pipeline_should_run_stage "00"; then
    run_stage "00_register_boundary"
  else
    pipeline_skip_stage_log "00_register_boundary"
  fi
  run_stage_00_register_boundary() {
    local boundary_id_file="${LOG_DIR}/boundary_id_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.tmp"
    local pbf_checksum_file="${LOG_DIR}/pbf_checksum_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.tmp"

    BOUNDARY_ID_OUTPUT_FILE="${boundary_id_file}" \
    PBF_CHECKSUM_OUTPUT_FILE="${pbf_checksum_file}" \
      bash "${SCRIPT_DIR}/00_register_boundary.sh" 2>&1 | tee -a "${LOG_FILE}"

    if [[ ! -s "${boundary_id_file}" ]]; then
      echo "error: boundary registration did not produce BOUNDARY_ID" >&2
      exit 1
    fi

    BOUNDARY_ID="$(< "${boundary_id_file}")"
    export BOUNDARY_ID
    rm -f "${boundary_id_file}" "${pbf_checksum_file}"
    log "BOUNDARY_ID=${BOUNDARY_ID}"
  }
  if pipeline_should_run_stage "00"; then
    run_stage_00_register_boundary
  fi
else
  log ""
  log "=== 00_register_boundary (skipped) ==="
  log "No BOUNDARY_GEOJSON_PATH provided; running without clipping boundary (WHOLE_REGION mode)."
fi

if pipeline_should_run_stage "01"; then
  run_stage "01_create_snapshot"
  run_stage_01_create_snapshot() {
    run_psql \
      -v ON_ERROR_STOP=1 \
      -v source_code="${SOURCE_CODE}" \
      -v batch_name="${BATCH_NAME}" \
      -v snapshot_ref="${SNAPSHOT_REF}" \
      -v snapshot_version="${SNAPSHOT_VERSION}" \
      -v region_code="${REGION_CODE}" \
      -v checksum="${CHECKSUM}" \
      -v boundary_id="${BOUNDARY_ID:-}" \
      -v allow_boundary_update="${ALLOW_BOUNDARY_UPDATE}" \
      -v entity_families="${ENTITY_FAMILIES}" \
      ${PSQL_EXTRA_ARGS:-} \
      -f "${SCRIPT_DIR}/01_create_snapshot.sql"
  }
  run_stage_01_create_snapshot
else
  pipeline_skip_stage_log "01_create_snapshot"
fi

if pipeline_should_run_stage "02"; then
  run_stage "02_import_to_tmp"
  run_shell_stage "${SCRIPT_DIR}/02_import_to_tmp.sh"
else
  pipeline_skip_stage_log "02_import_to_tmp"
fi

if pipeline_should_run_stage "03"; then
  run_stage "03_validate_tmp"
  run_sql "${SCRIPT_DIR}/03_validate_tmp.sql"
else
  pipeline_skip_stage_log "03_validate_tmp"
fi

if pipeline_should_run_stage "04"; then
  run_stage "04_tmp_to_raw"
  run_sql "${SCRIPT_DIR}/04_tmp_to_raw.sql"
else
  pipeline_skip_stage_log "04_tmp_to_raw"
fi

if pipeline_should_run_stage "05"; then
  run_stage "05_raw_to_staging"
  run_sql "${SCRIPT_DIR}/05_raw_to_staging.sql"
else
  pipeline_skip_stage_log "05_raw_to_staging"
fi

if pipeline_should_run_stage "06"; then
  run_stage "06_diff_current_vs_previous"
  run_sql "${SCRIPT_DIR}/06_diff_current_vs_previous.sql"
else
  pipeline_skip_stage_log "06_diff_current_vs_previous"
fi

if pipeline_should_run_stage "07"; then
  run_stage "07_compare_with_prod_mirror"
  run_sql "${SCRIPT_DIR}/07_compare_with_prod_mirror.sql"
else
  pipeline_skip_stage_log "07_compare_with_prod_mirror"
fi

if pipeline_should_run_stage "08"; then
  run_stage "08_assign_statuses"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/08_assign_statuses.sql"
else
  pipeline_skip_stage_log "08_assign_statuses"
fi

if pipeline_should_run_stage "09"; then
  run_stage "09_create_review_views"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/09_create_review_views.sql"
else
  pipeline_skip_stage_log "09_create_review_views"
fi

if pipeline_should_run_stage "10"; then
  run_stage "10_summary_report"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/10_summary_report.sql"
else
  pipeline_skip_stage_log "10_summary_report"
fi

if is_remote_review_upload_requested || is_remote_review_prepare_verify_only_requested; then
  if pipeline_should_run_stage "11" \
    || pipeline_should_run_stage "12" \
    || pipeline_should_run_stage "13" \
    || pipeline_should_run_stage "14"; then
    finalize_remote_review_stages
  else
    pipeline_skip_stage_log "11-14_remote_review"
  fi
else
  if ! pipeline_should_run_stage "11"; then
    pipeline_skip_stage_log "11-14_remote_review (REMOTE_REVIEW_UPLOAD_ENABLED not set)"
  fi
fi

if is_entity_coverage_report_requested && pipeline_should_run_stage "15"; then
  run_stage_15_entity_coverage_report
elif is_entity_coverage_report_requested; then
  pipeline_skip_stage_log "15_entity_coverage_report"
fi

log ""
log "local-osm pipeline finished (no core promotion)."
