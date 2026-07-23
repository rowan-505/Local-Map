#!/usr/bin/env bash
# Durable wrapper for national dry-run stages 05–10 (no upload, no core write).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"
LOG="${ROOT}/logs/myanmar_national_dry_run_durable_$(date -u +%Y%m%dT%H%M%SZ).log"
export PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-05}"
export PIPELINE_TO_STAGE="${PIPELINE_TO_STAGE:-10}"
echo "durable national dry-run start $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "${LOG}"
echo "PIPELINE_FROM_STAGE=${PIPELINE_FROM_STAGE} PIPELINE_TO_STAGE=${PIPELINE_TO_STAGE}" | tee -a "${LOG}"
./run_local_osm_pipeline.sh imports/myanmar_national_dry_run_2026_07_23.env 2>&1 | tee -a "${LOG}"
echo "durable national dry-run end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$?" | tee -a "${LOG}"
