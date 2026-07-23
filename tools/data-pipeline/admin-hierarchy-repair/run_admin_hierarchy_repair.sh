#!/usr/bin/env bash
# =============================================================================
# Admin hierarchy repair + entity admin_area backfill (core only).
#
# Does not touch import_review. Never deletes rows.
#
# Usage:
#   ./run_admin_hierarchy_repair.sh imports/local_repair.env
#   ./run_admin_hierarchy_repair.sh --hierarchy-only imports/supabase.env
#   ./run_admin_hierarchy_repair.sh --inspect-only imports/supabase.env
#   DRY_RUN=true ./run_admin_hierarchy_repair.sh --hierarchy-only imports/supabase.env
#   CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh --hierarchy-only imports/supabase.env
#   ./run_admin_hierarchy_repair.sh --from-stage 04 imports/local_repair.env
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

INSPECT_ONLY=false
HIERARCHY_ONLY=false
FROM_STAGE=""
IMPORT_ENV_FILE=""
POSITIONAL=()

# Preserve CLI exports so they override values inside the env file.
DRY_RUN_BEFORE_SOURCE="${DRY_RUN-__UNSET__}"
FORCE_RECALCULATE_VERIFIED_BEFORE_SOURCE="${FORCE_RECALCULATE_VERIFIED-__UNSET__}"
FORCE_MANUAL_OVERRIDE_BEFORE_SOURCE="${FORCE_MANUAL_OVERRIDE-__UNSET__}"
CONFIRM_WRITE_BEFORE_SOURCE="${CONFIRM_WRITE-__UNSET__}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") [options] <import-env-file>

Requires exactly one env file (sourced before stages run).

Options:
  --hierarchy-only   Run core hierarchy stages only (00, 01, 02, 03); skips 04–07
  --inspect-only     Run read-only stages only (00, 02; or 00, 02, 07 without --hierarchy-only)
  --from-stage NN    Start at stage NN (00–07)

Env file (required variables):
  LOCAL_DATABASE_URL

Env file (optional, with defaults):
  DRY_RUN=false
  FORCE_RECALCULATE_VERIFIED=false
  FORCE_MANUAL_OVERRIDE=false
  CONFIRM_WRITE=false
  LOG_DIR=logs

Write safety:
  Mutating stages (01, 03–06) require CONFIRM_WRITE=true unless DRY_RUN=true.
  CLI exports of DRY_RUN / FORCE_* / CONFIRM_WRITE override the env file.

Stages (full run):
  00 inspect admin area health
  01 repair admin hierarchy (parent_id)
  02 verify admin hierarchy
  03 create assignment functions
  04 backfill places admin_area_id
  05 backfill roads admin_area_id
  06 backfill buildings admin_area_id
  07 verify entity admin assignment
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hierarchy-only)
      HIERARCHY_ONLY=true
      shift
      ;;
    --inspect-only)
      INSPECT_ONLY=true
      shift
      ;;
    --from-stage)
      FROM_STAGE="${2:-}"
      if [[ -z "${FROM_STAGE}" ]]; then
        echo "error: --from-stage requires a stage number (00–07)" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 1 ]]; then
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

if ! IMPORT_ENV_FILE="$(resolve_import_env_file "${POSITIONAL[0]}")"; then
  echo "error: import env file not found: ${POSITIONAL[0]}" >&2
  echo "       (tried relative path and ${SCRIPT_DIR}/${POSITIONAL[0]})" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${IMPORT_ENV_FILE}"

if [[ "${DRY_RUN_BEFORE_SOURCE}" != __UNSET__ ]]; then
  DRY_RUN="${DRY_RUN_BEFORE_SOURCE}"
else
  DRY_RUN="${DRY_RUN:-false}"
fi

if [[ "${FORCE_RECALCULATE_VERIFIED_BEFORE_SOURCE}" != __UNSET__ ]]; then
  FORCE_RECALCULATE_VERIFIED="${FORCE_RECALCULATE_VERIFIED_BEFORE_SOURCE}"
else
  FORCE_RECALCULATE_VERIFIED="${FORCE_RECALCULATE_VERIFIED:-false}"
fi

if [[ "${FORCE_MANUAL_OVERRIDE_BEFORE_SOURCE}" != __UNSET__ ]]; then
  FORCE_MANUAL_OVERRIDE="${FORCE_MANUAL_OVERRIDE_BEFORE_SOURCE}"
else
  FORCE_MANUAL_OVERRIDE="${FORCE_MANUAL_OVERRIDE:-false}"
fi

if [[ "${CONFIRM_WRITE_BEFORE_SOURCE}" != __UNSET__ ]]; then
  CONFIRM_WRITE="${CONFIRM_WRITE_BEFORE_SOURCE}"
else
  CONFIRM_WRITE="${CONFIRM_WRITE:-false}"
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset in ${IMPORT_ENV_FILE}" >&2
    exit 1
  fi
}

require_var LOCAL_DATABASE_URL

LOG_DIR="${LOG_DIR:-logs}"

if [[ "${LOG_DIR}" != /* ]]; then
  LOG_DIR="${SCRIPT_DIR}/${LOG_DIR}"
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required" >&2
  exit 1
fi

is_truthy() {
  local v
  v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "${v}" in
    true | t | 1 | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

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
LOG_FILE="${LOG_DIR}/admin-hierarchy-repair_${RUN_TS}.log"

export DRY_RUN FORCE_RECALCULATE_VERIFIED FORCE_MANUAL_OVERRIDE CONFIRM_WRITE

INSPECT_ENTITY_ASSIGNMENT=false
if [[ "${HIERARCHY_ONLY}" != true && "${INSPECT_ONLY}" != true ]]; then
  INSPECT_ENTITY_ASSIGNMENT=true
fi

LIMIT_ROWS="${LIMIT_ROWS:-1000}"
WRITE_ADMIN_REPAIR_METADATA="${WRITE_ADMIN_REPAIR_METADATA:-false}"

PSQL_BASE_ARGS=(
  -v ON_ERROR_STOP=1
  -1
  -v dry_run="${DRY_RUN}"
  -v force_recalculate_verified="${FORCE_RECALCULATE_VERIFIED}"
  -v force_manual_override="${FORCE_MANUAL_OVERRIDE}"
  -v confirm_write="${CONFIRM_WRITE}"
  -v limit_rows="${LIMIT_ROWS}"
  -v write_admin_repair_metadata="${WRITE_ADMIN_REPAIR_METADATA}"
)

if [[ "${INSPECT_ENTITY_ASSIGNMENT}" == true ]]; then
  PSQL_BASE_ARGS+=(-v inspect_entity_assignment=1)
fi

if [[ -n "${PSQL_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  PSQL_BASE_ARGS+=(${PSQL_EXTRA_ARGS})
fi

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

run_sql() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    "${PSQL_BASE_ARGS[@]}" \
    -f "${sql_file}" \
    2>&1 | tee -a "${LOG_FILE}"
}

stage_num() {
  local file="$1"
  basename "${file}" | sed -E 's/^([0-9]+).*/\1/'
}

should_run_stage() {
  local stage="$1"
  if [[ -n "${FROM_STAGE}" && "${stage}" -lt "${FROM_STAGE}" ]]; then
    return 1
  fi
  return 0
}

is_mutating_stage() {
  local stage="$1"
  case "${stage}" in
    01 | 03 | 04 | 05 | 06) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ "${INSPECT_ONLY}" == true ]]; then
  if [[ "${HIERARCHY_ONLY}" == true ]]; then
    STAGES=(
      "00_inspect_admin_area_health.sql"
      "02_verify_admin_area_hierarchy.sql"
    )
  else
    STAGES=(
      "00_inspect_admin_area_health.sql"
      "02_verify_admin_area_hierarchy.sql"
      "07_verify_entity_admin_assignment.sql"
    )
  fi
elif [[ "${HIERARCHY_ONLY}" == true ]]; then
  STAGES=(
    "00_inspect_admin_area_health.sql"
    "01_repair_admin_area_hierarchy.sql"
    "02_verify_admin_area_hierarchy.sql"
    "03_create_admin_assignment_functions.sql"
  )
else
  STAGES=(
    "00_inspect_admin_area_health.sql"
    "01_repair_admin_area_hierarchy.sql"
    "02_verify_admin_area_hierarchy.sql"
    "03_create_admin_assignment_functions.sql"
    "04_backfill_places_admin_area.sql"
    "05_backfill_roads_admin_area.sql"
    "06_backfill_buildings_admin_area.sql"
    "07_verify_entity_admin_assignment.sql"
  )
fi

log "admin-hierarchy-repair pipeline started at ${RUN_TS}"
log "log file: ${LOG_FILE}"
log "import env file: ${IMPORT_ENV_FILE}"
log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
log "DRY_RUN=${DRY_RUN}"
log "FORCE_RECALCULATE_VERIFIED=${FORCE_RECALCULATE_VERIFIED}"
log "FORCE_MANUAL_OVERRIDE=${FORCE_MANUAL_OVERRIDE}"
log "CONFIRM_WRITE=${CONFIRM_WRITE}"
log "LIMIT_ROWS=${LIMIT_ROWS}"
log "WRITE_ADMIN_REPAIR_METADATA=${WRITE_ADMIN_REPAIR_METADATA}"
log "LOG_DIR=${LOG_DIR}"
log "INSPECT_ONLY=${INSPECT_ONLY}"
log "HIERARCHY_ONLY=${HIERARCHY_ONLY}"
log "inspect_entity_assignment=${INSPECT_ENTITY_ASSIGNMENT}"
log "FROM_STAGE=${FROM_STAGE:-<start>}"

if is_truthy "${DRY_RUN}"; then
  log "DRY_RUN=true: mutating stages compute planned counts only (no row UPDATE)."
elif is_truthy "${CONFIRM_WRITE}"; then
  log "CONFIRM_WRITE=true: mutating stages may apply database changes."
else
  log "CONFIRM_WRITE is not true — mutating stages will be blocked."
fi

for rel in "${STAGES[@]}"; do
  stage="$(stage_num "${rel}")"
  if ! should_run_stage "${stage}"; then
    log ""
    log "skip stage ${stage} (${rel}) — before --from-stage ${FROM_STAGE}"
    continue
  fi

  if is_mutating_stage "${stage}" && ! is_truthy "${DRY_RUN}" && ! is_truthy "${CONFIRM_WRITE}"; then
    log ""
    log "error: stage ${stage} (${rel}) writes to the database."
    log "       Set CONFIRM_WRITE=true in the env file or environment, or run with DRY_RUN=true."
    exit 1
  fi

  stage_start="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  log ""
  log "=== stage ${stage}: ${rel} (started ${stage_start}) ==="
  run_sql "${SCRIPT_DIR}/${rel}"
  log "=== stage ${stage}: finished $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="
done

log ""
log "admin-hierarchy-repair pipeline finished OK at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
