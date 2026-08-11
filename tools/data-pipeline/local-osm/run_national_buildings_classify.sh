#!/usr/bin/env bash
# National buildings: core-eligible staging SQL → classify (06–10 + optional 18).
# Never runs full Stage 05 buildings (~5.58M footprints).
#
# Usage:
#   ./run_national_buildings_classify.sh
#   PIPELINE_TO_STAGE=18 ./run_national_buildings_classify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT}/imports/_batch/myanmar_national_buildings_core_eligible.env"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"
RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
LOG="${LOG_DIR}/myanmar_national_buildings_classify_${RUN_TS}.log"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL required}"
: "${SNAPSHOT_VERSION:?SNAPSHOT_VERSION required}"

echo "=== national buildings core-eligible classify ===" | tee "${LOG}"
echo "snapshot_version=${SNAPSHOT_VERSION}" | tee -a "${LOG}"
echo "log=${LOG}" | tee -a "${LOG}"

echo "" | tee -a "${LOG}"
echo "=== 1) core-eligible staging SQL (not Stage 05) $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
t0=$(date +%s)
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -f "${ROOT}/national_buildings_core_eligible_stage.sql" 2>&1 | tee -a "${LOG}"
t1=$(date +%s)
echo "core_eligible_sql_wall_sec=$((t1 - t0))" | tee -a "${LOG}"

echo "" | tee -a "${LOG}"
echo "=== 2) classify stages ${PIPELINE_FROM_STAGE:-06}-${PIPELINE_TO_STAGE:-10} $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
export PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-06}"
export PIPELINE_TO_STAGE="${PIPELINE_TO_STAGE:-10}"
export ENTITY_FAMILIES='buildings'
export CLASSIFICATION_REPORT_ENABLED="${CLASSIFICATION_REPORT_ENABLED:-true}"

t2=$(date +%s)
"${ROOT}/run_local_osm_pipeline.sh" "${ENV_FILE}" 2>&1 | tee -a "${LOG}"
t3=$(date +%s)
echo "classify_wall_sec=$((t3 - t2))" | tee -a "${LOG}"
echo "total_wall_sec=$((t3 - t0))" | tee -a "${LOG}"
echo "finished log=${LOG}"
