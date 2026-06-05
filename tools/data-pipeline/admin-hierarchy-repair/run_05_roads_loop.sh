#!/usr/bin/env bash
# Loop 05_backfill_roads_admin_area.sql until done=true (one chunk per psql call).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-imports/admin_hierarchy_roads_2026_06_05.env}"

DRY_RUN_BEFORE_SOURCE="${DRY_RUN-__UNSET__}"
LIMIT_ROWS_BEFORE_SOURCE="${LIMIT_ROWS-__UNSET__}"
LAST_ID_BEFORE_SOURCE="${LAST_ID-__UNSET__}"

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
  LIMIT_ROWS="${LIMIT_ROWS:-200}"
fi

if [[ "${LAST_ID_BEFORE_SOURCE}" != __UNSET__ ]]; then
  LAST_ID="${LAST_ID_BEFORE_SOURCE}"
else
  LAST_ID="${LAST_ID:-0}"
fi

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${DB_URL}" ]]; then
  echo "error: set DATABASE_URL or LOCAL_DATABASE_URL in env file" >&2
  exit 1
fi

CHUNK_N=0
TOTAL_INSPECTED=0
TOTAL_MATCHED=0
TOTAL_UPDATED=0

log() {
  echo "$*" >&2
}

while true; do
  CHUNK_N=$((CHUNK_N + 1))
  log "=== roads chunk run #${CHUNK_N} last_id=${LAST_ID} dry_run=${DRY_RUN} ==="

  RESULT_LINE="$(
    psql "${DB_URL}" -v ON_ERROR_STOP=1 \
      -v dry_run="${DRY_RUN}" \
      -v limit_rows="${LIMIT_ROWS}" \
      -v last_id="${LAST_ID}" \
      -v write_admin_repair_metadata=false \
      -q -t -A -F',' \
      -f "${SCRIPT_DIR}/05_backfill_roads_admin_area.sql" 2>&1 | tee /dev/stderr | awk -F',' '/^[0-9]+,/ {print; exit}'
  )"

  if [[ -z "${RESULT_LINE}" ]]; then
    echo "error: could not parse chunk_result row from 05 output" >&2
    exit 1
  fi

  IFS=',' read -r LAST_ID INSPECTED MATCHED UPDATED ELAPSED DONE <<<"${RESULT_LINE}"
  TOTAL_INSPECTED=$((TOTAL_INSPECTED + INSPECTED))
  TOTAL_MATCHED=$((TOTAL_MATCHED + MATCHED))
  TOTAL_UPDATED=$((TOTAL_UPDATED + UPDATED))

  log "chunk #${CHUNK_N}: inspected=${INSPECTED} matched=${MATCHED} updated=${UPDATED} last_id=${LAST_ID} done=${DONE}"

  if [[ "${DONE}" == "t" || "${INSPECTED}" == "0" ]]; then
    log "roads backfill finished: chunks=${CHUNK_N} total_inspected=${TOTAL_INSPECTED} total_matched=${TOTAL_MATCHED} total_updated=${TOTAL_UPDATED}"
    exit 0
  fi
done
