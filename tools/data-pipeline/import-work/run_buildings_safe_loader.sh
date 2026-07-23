#!/usr/bin/env bash
# Buildings safe loader — contract-aware runner.
#
# Usage:
#   ./run_buildings_safe_loader.sh --target local|production --batch-code <code> [--dry-run|--apply] \
#       [--confirmation 'APPLY buildings <batch_id>'] [--sample-limit N] [--skip-cleanup] [--env-file path]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

TARGET=""
BATCH_CODE=""
MODE="dry_run"
CONFIRMATION=""
SAMPLE_LIMIT="${SAMPLE_LIMIT:-0}"
SKIP_CLEANUP=false
ENV_FILE=""
PREFLIGHT_ONLY=false

usage() {
  cat <<'EOF'
usage: run_buildings_safe_loader.sh --target local|production --batch-code <code> [options]

Required:
  --target local|production
  --batch-code <import_work.import_batches.batch_code>

Mode (default: --dry-run):
  --dry-run
  --apply

Production apply only:
  --confirmation 'APPLY buildings <batch_id>'

Optional:
  --sample-limit N
  --skip-cleanup
  --preflight-only
  --env-file <path>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --batch-code|--batch) BATCH_CODE="${2:-}"; shift 2 ;;
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    --sample-limit) SAMPLE_LIMIT="${2:-0}"; shift 2 ;;
    --skip-cleanup) SKIP_CLEANUP=true; shift ;;
    --preflight-only) PREFLIGHT_ONLY=true; shift ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) safe_loader_die "unknown argument: $1" ;;
  esac
done

if [[ -n "${ENV_FILE}" ]]; then
  [[ -f "${ENV_FILE}" ]] || safe_loader_die "env file not found: ${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

[[ -n "${TARGET}" ]] || { usage >&2; safe_loader_die "missing --target"; }
[[ -n "${BATCH_CODE}" ]] || { usage >&2; safe_loader_die "missing --batch-code"; }

DRY_RUN_SQL="true"
if [[ "${MODE}" == "apply" ]]; then
  DRY_RUN_SQL="false"
fi

safe_loader_preflight "${TARGET}" "${MODE}" "buildings" "${BATCH_CODE}" "${CONFIRMATION}"

if [[ "${PREFLIGHT_ONLY}" == "true" ]]; then
  echo "preflight_only=true — loader SQL skipped"
  exit 0
fi

LOG_DIR="${SCRIPT_DIR}/reports"
mkdir -p "${LOG_DIR}"
RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
SAFE_BATCH="${BATCH_CODE//\//_}"
LOG_FILE="${LOG_DIR}/buildings_loader_${SAFE_LOADER_TARGET}_${SAFE_BATCH}_${MODE}_${RUN_TS}.log"

echo ""
echo "=== buildings_safe_loader ==="
echo "target=${SAFE_LOADER_TARGET}"
echo "mode=${MODE}"
echo "dry_run_sql=${DRY_RUN_SQL}"
echo "sample_limit=${SAMPLE_LIMIT}"
echo "batch_id=${SAFE_LOADER_BATCH_ID}"
echo "batch_code=${SAFE_LOADER_BATCH_CODE}"
echo "source_snapshot_id=${SAFE_LOADER_SNAPSHOT_ID}"
echo "source_snapshot_version=${SAFE_LOADER_SNAPSHOT_VERSION}"
echo "expected_row_count=${SAFE_LOADER_EXPECTED_ROWS:-}"
echo "loaded_row_count=${SAFE_LOADER_LOADED_ROWS:-}"
echo "log=${LOG_FILE}"
echo "started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

set +e
stdbuf -oL -eL psql "${SAFE_LOADER_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v batch_code="${BATCH_CODE}" \
  -v dry_run="${DRY_RUN_SQL}" \
  -v sample_limit="${SAMPLE_LIMIT}" \
  -c "SET client_min_messages TO notice;" \
  -f "${SCRIPT_DIR}/buildings_safe_loader.sql" \
  2> >(
    while IFS= read -r line || [[ -n "${line}" ]]; do
      ts="$(date -u +"%H:%M:%S")"
      printf '[%s] %s\n' "${ts}" "${line}"
      printf '[%s] %s\n' "${ts}" "${line}" >> "${LOG_FILE}"
    done
  ) \
  > >(
    while IFS= read -r line || [[ -n "${line}" ]]; do
      ts="$(date -u +"%H:%M:%S")"
      printf '[%s] %s\n' "${ts}" "${line}"
      printf '[%s] %s\n' "${ts}" "${line}" >> "${LOG_FILE}"
    done
  )
LOADER_RC=$?
set -e

echo ""
echo "finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "loader_exit=${LOADER_RC}"
echo "log=${LOG_FILE}"

if [[ "${LOADER_RC}" -ne 0 ]]; then
  exit "${LOADER_RC}"
fi

if [[ "${MODE}" == "apply" && "${SKIP_CLEANUP}" != "true" ]]; then
  safe_loader_cleanup_batch "${SAFE_LOADER_DATABASE_URL}" "${BATCH_CODE}" "${SCRIPT_DIR}"
fi

exit 0
