#!/usr/bin/env bash
# Resume local-osm pipeline from stage 08 onward (requires stages 01–07 already completed).
#
# Usage (from tools/data-pipeline/local-osm):
#   ./run_resume_from_stage08.sh imports/myanmar_roads_only_2026_06_03.env
#
# Prerequisites:
#   - Stages 01–07 finished for the same SNAPSHOT_VERSION in the env file
#   - Cancel any stuck psql session on stage 08 first (Ctrl+C or pg_cancel_backend)
#
# Optional overrides:
#   PIPELINE_PSQL_WORK_MEM=1GB ./run_resume_from_stage08.sh imports/...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-08}"
exec "${SCRIPT_DIR}/run_local_osm_pipeline.sh" "$@"
