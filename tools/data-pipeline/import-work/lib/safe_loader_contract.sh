#!/usr/bin/env bash
# =============================================================================
# Shared safe-loader contract helper (NOT a generic loader framework).
#
# Builds on tools/data-pipeline/lib/database_target_safety.sh for target
# resolution. Family runners keep typed work tables and allowlists.
# =============================================================================

_SAFE_LOADER_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../lib/database_target_safety.sh
source "${_SAFE_LOADER_LIB_DIR}/../../lib/database_target_safety.sh"

# Default production project ref (Production Baseline v1 / Map Project).
SAFE_LOADER_PRODUCTION_PROJECT_REF="${SAFE_LOADER_PRODUCTION_PROJECT_REF:-${DB_TARGET_PRODUCTION_PROJECT_REF}}"
DB_TARGET_PRODUCTION_PROJECT_REF="${SAFE_LOADER_PRODUCTION_PROJECT_REF}"

safe_loader_mask_url() { db_target_mask_url "$@"; }
safe_loader_url_fingerprint() { db_target_url_fingerprint "$@"; }
safe_loader_die() { db_target_die "$@"; }
safe_loader_require_cmd() { db_target_require_cmd "$@"; }

# Resolve database URL from explicit target only (never DATABASE_URL).
# Sets: SAFE_LOADER_TARGET, SAFE_LOADER_DATABASE_URL, SAFE_LOADER_TARGET_LABEL
safe_loader_resolve_target() {
  local target="${1:-}"
  db_target_resolve "${target}" write
  SAFE_LOADER_TARGET="${DB_TARGET}"
  SAFE_LOADER_DATABASE_URL="${DB_TARGET_DATABASE_URL}"
  SAFE_LOADER_TARGET_LABEL="${DB_TARGET_LABEL}"
}

safe_loader_refuse_ambiguous_urls() {
  db_target_refuse_ambiguous_local_vs_production
}

safe_loader_verify_production_identity() {
  local url="${1:-}"
  db_target_verify_production_identity "${url}"
}

safe_loader_print_identity() {
  local url="${1:-${SAFE_LOADER_DATABASE_URL}}"
  local target="${2:-${SAFE_LOADER_TARGET}}"
  DB_TARGET_LABEL="${SAFE_LOADER_TARGET_LABEL:-}"
  DB_TARGET_ROLE="write"
  db_target_print_identity "${url}" "${target}"
  SAFE_LOADER_DB_NAME="${DB_TARGET_DB_NAME}"
  SAFE_LOADER_SERVER_ADDR="${DB_TARGET_SERVER_ADDR}"
  SAFE_LOADER_SERVER_PORT="${DB_TARGET_SERVER_PORT}"
  SAFE_LOADER_DB_USER="${DB_TARGET_DB_USER}"
}

# Load batch header; refuse missing batch or snapshot identity.
safe_loader_require_batch_identity() {
  local url="${1:-${SAFE_LOADER_DATABASE_URL}}"
  local batch_code="${2:-}"
  local expected_family="${3:-}"

  [[ -n "${batch_code}" ]] || safe_loader_die "batch_code is required"

  local row
  row="$(
    PAGER=cat psql "${url}" -v ON_ERROR_STOP=1 -v batch_code="${batch_code}" -At -F '|' <<'SQL'
SELECT id, batch_code, entity_family,
       coalesce(source_snapshot_id::text, ''),
       source_snapshot_version, status,
       coalesce(expected_row_count::text, ''),
       coalesce(loaded_row_count::text, '')
FROM import_work.import_batches
WHERE batch_code = :'batch_code'
LIMIT 1;
SQL
  )" || safe_loader_die "failed to read import_work.import_batches for batch_code=${batch_code}"

  [[ -n "${row}" ]] || safe_loader_die "batch not found: ${batch_code}"

  SAFE_LOADER_BATCH_ID="$(echo "${row}" | cut -d'|' -f1)"
  SAFE_LOADER_BATCH_CODE="$(echo "${row}" | cut -d'|' -f2)"
  SAFE_LOADER_ENTITY_FAMILY="$(echo "${row}" | cut -d'|' -f3)"
  SAFE_LOADER_SNAPSHOT_ID="$(echo "${row}" | cut -d'|' -f4)"
  SAFE_LOADER_SNAPSHOT_VERSION="$(echo "${row}" | cut -d'|' -f5)"
  SAFE_LOADER_BATCH_STATUS="$(echo "${row}" | cut -d'|' -f6)"
  SAFE_LOADER_EXPECTED_ROWS="$(echo "${row}" | cut -d'|' -f7)"
  SAFE_LOADER_LOADED_ROWS="$(echo "${row}" | cut -d'|' -f8)"

  if [[ -n "${expected_family}" && "${SAFE_LOADER_ENTITY_FAMILY}" != "${expected_family}" ]]; then
    safe_loader_die \
      "batch ${batch_code} entity_family=${SAFE_LOADER_ENTITY_FAMILY} (expected ${expected_family})"
  fi
  if [[ -z "${SAFE_LOADER_SNAPSHOT_VERSION}" ]]; then
    safe_loader_die "batch ${batch_code} missing source_snapshot_version"
  fi
  if [[ -z "${SAFE_LOADER_SNAPSHOT_ID}" ]]; then
    safe_loader_die "batch ${batch_code} missing source_snapshot_id (required by safe-loader contract)"
  fi

  echo "batch_id=${SAFE_LOADER_BATCH_ID}"
  echo "batch_code=${SAFE_LOADER_BATCH_CODE}"
  echo "entity_family=${SAFE_LOADER_ENTITY_FAMILY}"
  echo "source_snapshot_id=${SAFE_LOADER_SNAPSHOT_ID}"
  echo "source_snapshot_version=${SAFE_LOADER_SNAPSHOT_VERSION}"
  echo "batch_status=${SAFE_LOADER_BATCH_STATUS}"
  echo "expected_row_count=${SAFE_LOADER_EXPECTED_ROWS:-}"
  echo "loaded_row_count=${SAFE_LOADER_LOADED_ROWS:-}"
}

safe_loader_require_mode_gates() {
  local target="${1:-${SAFE_LOADER_TARGET}}"
  local mode="${2:-}"
  local family="${3:-}"
  local batch_id="${4:-${SAFE_LOADER_BATCH_ID:-}}"
  local confirmation="${5:-}"
  local expected=""

  if [[ "${mode}" == "apply" && "${target}" == "production" ]]; then
    [[ -n "${family}" ]] || safe_loader_die "family required for production apply confirmation"
    [[ -n "${batch_id}" ]] || safe_loader_die "batch_id required for production apply confirmation"
    expected="APPLY ${family} ${batch_id}"
  fi

  DB_TARGET_DATABASE_URL="${SAFE_LOADER_DATABASE_URL}"
  db_target_require_write_gates "${target}" "${mode}" "${expected}" "${confirmation}"
}

safe_loader_cleanup_batch() {
  local url="${1:-${SAFE_LOADER_DATABASE_URL}}"
  local batch_code="${2:-${SAFE_LOADER_BATCH_CODE}}"
  local script_dir="${3:-}"

  [[ -n "${batch_code}" ]] || safe_loader_die "cleanup requires batch_code"
  [[ -n "${script_dir}" ]] || safe_loader_die "cleanup requires import-work script dir"
  [[ -f "${script_dir}/cleanup_import_work_batches.sql" ]] \
    || safe_loader_die "missing cleanup_import_work_batches.sql"

  echo "=== safe_loader cleanup import_work batch=${batch_code} ==="
  PAGER=cat psql "${url}" -v ON_ERROR_STOP=1 \
    -v batch_code="${batch_code}" \
    -f "${script_dir}/cleanup_import_work_batches.sql"
}

safe_loader_preflight() {
  local target="${1:-}"
  local mode="${2:-}"
  local family="${3:-}"
  local batch_code="${4:-}"
  local confirmation="${5:-}"

  safe_loader_refuse_ambiguous_urls
  safe_loader_resolve_target "${target}"
  safe_loader_print_identity "${SAFE_LOADER_DATABASE_URL}" "${SAFE_LOADER_TARGET}"
  safe_loader_require_batch_identity "${SAFE_LOADER_DATABASE_URL}" "${batch_code}" "${family}"
  safe_loader_require_mode_gates \
    "${SAFE_LOADER_TARGET}" "${mode}" "${family}" "${SAFE_LOADER_BATCH_ID}" "${confirmation}"
}

# Preload scripts write import_work (not core). Still require explicit target + gates.
# Production apply confirmation: "PRELOAD <family> <batch_code>"
safe_loader_preload_preflight() {
  local target="${1:-}"
  local mode="${2:-dry_run}"
  local family="${3:-}"
  local batch_code="${4:-}"
  local confirmation="${5:-}"
  local expected=""

  [[ -n "${target}" ]] || safe_loader_die "preload missing --target local|production"
  [[ -n "${family}" ]] || safe_loader_die "preload missing family"
  [[ -n "${batch_code}" ]] || safe_loader_die "preload missing batch_code"

  safe_loader_refuse_ambiguous_urls
  safe_loader_resolve_target "${target}"
  safe_loader_print_identity "${SAFE_LOADER_DATABASE_URL}" "${SAFE_LOADER_TARGET}"

  if [[ "${mode}" == "apply" && "${SAFE_LOADER_TARGET}" == "production" ]]; then
    expected="PRELOAD ${family} ${batch_code}"
  fi
  DB_TARGET_DATABASE_URL="${SAFE_LOADER_DATABASE_URL}"
  db_target_require_write_gates "${SAFE_LOADER_TARGET}" "${mode}" "${expected}" "${confirmation}"
}

# Returns 0 when the caller should perform the durable write.
safe_loader_preload_should_write() {
  local mode="${1:-dry_run}"
  [[ "${mode}" == "apply" ]]
}
