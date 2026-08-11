#!/usr/bin/env bash
# National safety dry-run in family batches (faster than one giant Stage 05).
# Guards: no Import Review upload, no direct-Core apply / no Supabase core writes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

# shellcheck source=../lib/progress_heartbeat.sh
source "${ROOT}/../lib/progress_heartbeat.sh"

ENV_FILE="${ROOT}/imports/myanmar_national_dry_run_2026_07_23.env"
LOG="${ROOT}/logs/myanmar_national_dry_run_batched_$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p "${ROOT}/logs" "${ROOT}/reports" "${ROOT}/imports/_batch"

PROGRESS_LOG_FILE="${LOG}"
# Batches: A, B, C, D_buildings_sql, D_classify, FINAL_08_10, FINAL_15 = 7
progress_init "national_dry_run_batched" 7

echo "batched national dry-run start $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "${LOG}"
echo "log=${LOG}" | tee -a "${LOG}"
echo "progress: 1-second heartbeat enabled" | tee -a "${LOG}"

make_batch_env() {
  local families="$1"
  local out="$2"
  # Base env, then force ENTITY_FAMILIES (pipeline sources env and would otherwise overwrite).
  {
    cat "${ENV_FILE}"
    echo ""
    echo "# --- batch override (generated) ---"
    echo "export ENTITY_FAMILIES='${families}'"
    echo "export REMOTE_REVIEW_UPLOAD_ENABLED=false"
    echo "export CLASSIFICATION_REPORT_ENABLED=true"
    echo "export LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true"
  } > "${out}"
}

run_batch() {
  local label="$1"
  local families="$2"
  local from_stage="${3:-05}"
  local to_stage="${4:-10}"
  local batch_env="${ROOT}/imports/_batch/myanmar_national_${label}.env"
  make_batch_env "${families}" "${batch_env}"
  echo "" | tee -a "${LOG}"
  echo "=== BATCH ${label} families=${families} stages ${from_stage}-${to_stage} $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
  progress_begin_phase "BATCH_${label}" "families=${families} stages=${from_stage}-${to_stage}"
  export PIPELINE_FROM_STAGE="${from_stage}"
  export PIPELINE_TO_STAGE="${to_stage}"
  # Outer batched runner owns the 1s heartbeat; disable inner pipeline heartbeat.
  export PROGRESS_DISABLE=1
  local t0 t1 rc=0
  t0=$(date +%s)
  set +e
  ./run_local_osm_pipeline.sh "${batch_env}" 2>&1 | tee -a "${LOG}" &
  local tee_pid=$!
  wait "${tee_pid}" || rc=$?
  set -e
  unset PROGRESS_DISABLE
  t1=$(date +%s)
  echo "BATCH ${label} duration_sec=$((t1 - t0)) exit=${rc}" | tee -a "${LOG}"
  if [[ "${rc}" -ne 0 ]]; then
    progress_set_detail "BATCH ${label} FAILED exit=${rc}"
    progress_print_once
    progress_stop_heartbeat
    exit "${rc}"
  fi
  progress_end_phase "ok BATCH ${label}"
}

# Raw already loaded for snapshot osm_myanmar_2026_07_21_national_dry_run_v1 (id 13).
run_batch "A_places_roads" "places,roads" 05 10
run_batch "B_admin_barriers" "admin_areas,routing_barriers" 05 10
run_batch "C_landuse_water" "landuse,water_lines,water_polygons" 05 10

echo "" | tee -a "${LOG}"
echo "=== BATCH D_buildings_core_eligible $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
progress_begin_phase "BATCH_D_buildings_sql" "core-eligible buildings extract"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
t0=$(date +%s)
set +e
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -f "${ROOT}/national_buildings_core_eligible_stage.sql" 2>&1 | tee -a "${LOG}" &
wait $! || { progress_stop_heartbeat; exit 1; }
set -e
progress_end_phase "ok buildings core-eligible sql"
run_batch "D_buildings_classify" "buildings" 06 10
t1=$(date +%s)
echo "BATCH D_buildings wall_sec=$((t1 - t0))" | tee -a "${LOG}"

echo "" | tee -a "${LOG}"
echo "=== FINAL classify+reports all families $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
ALL_FAMILIES='places,roads,admin_areas,landuse,water_lines,water_polygons,routing_barriers,buildings'
export PIPELINE_FROM_STAGE=08
export PIPELINE_TO_STAGE=10
make_batch_env "${ALL_FAMILIES}" "${ROOT}/imports/_batch/myanmar_national_FINAL.env"
progress_begin_phase "FINAL_08_10" "reclass+08c+18 all families"
export PROGRESS_DISABLE=1
set +e
./run_local_osm_pipeline.sh "${ROOT}/imports/_batch/myanmar_national_FINAL.env" 2>&1 | tee -a "${LOG}" &
wait $! || { progress_stop_heartbeat; exit 1; }
set -e
unset PROGRESS_DISABLE
progress_end_phase "ok FINAL_08_10"
export PIPELINE_FROM_STAGE=15
export PIPELINE_TO_STAGE=15
progress_begin_phase "FINAL_15" "entity coverage report"
export PROGRESS_DISABLE=1
set +e
./run_local_osm_pipeline.sh "${ROOT}/imports/_batch/myanmar_national_FINAL.env" 2>&1 | tee -a "${LOG}" &
wait $! || { progress_stop_heartbeat; exit 1; }
set -e
unset PROGRESS_DISABLE
progress_end_phase "ok FINAL_15"

progress_finish "national dry-run complete"
echo "batched national dry-run end $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "${LOG}"
