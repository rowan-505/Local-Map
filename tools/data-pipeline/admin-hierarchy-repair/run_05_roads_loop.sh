#!/usr/bin/env bash
# Loop 05_backfill_roads_admin_area.sql until done=true (one chunk per psql call).
#
# Usage:
#   DRY_RUN=true ./run_05_roads_loop.sh imports/admin_hierarchy_roads_2026_06_05.env
#   CONFIRM_WRITE=true ./run_05_roads_loop.sh imports/admin_hierarchy_roads_2026_06_05.env
#   LIMIT_ROWS=5000 LAST_ID=0 DRY_RUN=true ./run_05_roads_loop.sh imports/<name>.env
#
# Does NOT run on app startup — manual operator script only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-imports/admin_hierarchy_roads_2026_06_05.env}"

DRY_RUN_BEFORE_SOURCE="${DRY_RUN-__UNSET__}"
LIMIT_ROWS_BEFORE_SOURCE="${LIMIT_ROWS-__UNSET__}"
LAST_ID_BEFORE_SOURCE="${LAST_ID-__UNSET__}"
CONFIRM_WRITE_BEFORE_SOURCE="${CONFIRM_WRITE-__UNSET__}"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/${ENV_FILE}"

if [[ "${DRY_RUN_BEFORE_SOURCE}" != __UNSET__ ]]; then
  DRY_RUN="${DRY_RUN_BEFORE_SOURCE}"
else
  DRY_RUN="${DRY_RUN:-false}"
fi

if [[ "${LIMIT_ROWS_BEFORE_SOURCE}" != __UNSET__ ]]; then
  LIMIT_ROWS="${LIMIT_ROWS_BEFORE_SOURCE}"
else
  LIMIT_ROWS="${LIMIT_ROWS:-5000}"
fi

if [[ "${LAST_ID_BEFORE_SOURCE}" != __UNSET__ ]]; then
  LAST_ID="${LAST_ID_BEFORE_SOURCE}"
else
  LAST_ID="${LAST_ID:-0}"
fi

if [[ "${CONFIRM_WRITE_BEFORE_SOURCE}" != __UNSET__ ]]; then
  CONFIRM_WRITE="${CONFIRM_WRITE_BEFORE_SOURCE}"
else
  CONFIRM_WRITE="${CONFIRM_WRITE:-false}"
fi

if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  echo "error: set LOCAL_DATABASE_URL in env file (DATABASE_URL is not accepted)" >&2
  exit 1
fi
DB_URL="${LOCAL_DATABASE_URL}"

DRY_RUN_NORM="$(printf '%s' "${DRY_RUN}" | tr '[:upper:]' '[:lower:]')"
if [[ "${DRY_RUN_NORM}" != "true" && "${DRY_RUN_NORM}" != "t" && "${DRY_RUN_NORM}" != "1" && "${DRY_RUN_NORM}" != "yes" ]]; then
  CONFIRM_NORM="$(printf '%s' "${CONFIRM_WRITE}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${CONFIRM_NORM}" != "true" && "${CONFIRM_NORM}" != "t" && "${CONFIRM_NORM}" != "1" && "${CONFIRM_NORM}" != "yes" ]]; then
    echo "error: set CONFIRM_WRITE=true to apply updates, or DRY_RUN=true to plan only" >&2
    exit 1
  fi
fi

CHUNK_N=0
TOTAL_SCANNED=0
TOTAL_UPDATED=0
TOTAL_UNCHANGED=0
TOTAL_NO_MATCH=0
TOTAL_INVALID=0
TOTAL_WOULD_CLEAR=0

log() {
  echo "$*" >&2
}

while true; do
  CHUNK_N=$((CHUNK_N + 1))
  log "=== roads admin backfill chunk #${CHUNK_N} last_id=${LAST_ID} dry_run=${DRY_RUN} limit_rows=${LIMIT_ROWS} ==="

  RESULT_LINE="$(
    psql "${DB_URL}" -v ON_ERROR_STOP=1 \
      -v dry_run="${DRY_RUN}" \
      -v limit_rows="${LIMIT_ROWS}" \
      -v last_id="${LAST_ID}" \
      -q -t -A -F',' \
      -f "${SCRIPT_DIR}/05_backfill_roads_admin_area.sql" 2>&1 | tee /dev/stderr | awk -F',' '/^[0-9]+,/ {print; exit}'
  )"

  if [[ -z "${RESULT_LINE}" ]]; then
    echo "error: could not parse chunk_result row from 05 output" >&2
    exit 1
  fi

  IFS=',' read -r LAST_ID SCANNED UPDATED UNCHANGED NO_MATCH INVALID_EXISTING WOULD_CLEAR ELAPSED DONE <<<"${RESULT_LINE}"
  TOTAL_SCANNED=$((TOTAL_SCANNED + SCANNED))
  TOTAL_UPDATED=$((TOTAL_UPDATED + UPDATED))
  TOTAL_UNCHANGED=$((TOTAL_UNCHANGED + UNCHANGED))
  TOTAL_NO_MATCH=$((TOTAL_NO_MATCH + NO_MATCH))
  TOTAL_INVALID=$((TOTAL_INVALID + INVALID_EXISTING))
  TOTAL_WOULD_CLEAR=$((TOTAL_WOULD_CLEAR + WOULD_CLEAR))

  log "chunk #${CHUNK_N}: scanned=${SCANNED} updated=${UPDATED} unchanged=${UNCHANGED} no_match=${NO_MATCH} invalid_existing=${INVALID_EXISTING} would_clear_invalid=${WOULD_CLEAR} last_id=${LAST_ID} done=${DONE}"

  if [[ "${DONE}" == "t" || "${SCANNED}" == "0" ]]; then
    log "roads admin backfill finished: chunks=${CHUNK_N} scanned=${TOTAL_SCANNED} updated=${TOTAL_UPDATED} unchanged=${TOTAL_UNCHANGED} no_match=${TOTAL_NO_MATCH} invalid_existing=${TOTAL_INVALID} would_clear_invalid=${TOTAL_WOULD_CLEAR}"
    exit 0
  fi
done
