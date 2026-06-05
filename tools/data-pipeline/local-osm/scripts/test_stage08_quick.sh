#!/usr/bin/env bash
# Quick timing check for stage 08 only (~1 min for 822k roads insert_candidate run).
# Requires stages 01–07 already completed for the env snapshot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${SCRIPT_DIR}"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 imports/<import>.env" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$1"

: "${LOCAL_DATABASE_URL:?}"
: "${SNAPSHOT_VERSION:?}"

WORK_MEM="${PIPELINE_PSQL_WORK_MEM:-512MB}"
MAINT_MEM="${PIPELINE_PSQL_MAINTENANCE_WORK_MEM:-1GB}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
ENTITY_FAMILIES="${ENTITY_FAMILIES:-roads}"

echo "=== stage08 quick test (08_assign_statuses.sql only) ==="
echo "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
echo "ENTITY_FAMILIES=${ENTITY_FAMILIES}"
echo "work_mem=${WORK_MEM} maintenance_work_mem=${MAINT_MEM}"
echo ""

START_TS="$(date +%s)"
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "SET work_mem = '${WORK_MEM}'; SET maintenance_work_mem = '${MAINT_MEM}';" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v staging_schema="${STAGING_SCHEMA}" \
  -v entity_families="${ENTITY_FAMILIES}" \
  -f "${SCRIPT_DIR}/08_assign_statuses.sql" 2>&1 | grep -E 'NOTICE:  stage08|ERROR|COMMIT'
END_TS="$(date +%s)"
echo ""
echo "=== stage08 quick test finished in $((END_TS - START_TS))s ==="
