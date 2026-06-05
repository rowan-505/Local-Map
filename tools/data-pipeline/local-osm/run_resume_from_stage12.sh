#!/usr/bin/env bash
# Resume local-osm pipeline from stage 12 (Supabase upload) onward.
# Requires stage 11 package already prepared (same REMOTE_REVIEW_PACKAGE_NAME).
#
# Usage:
#   ./run_resume_from_stage12.sh imports/myanmar_roads_only_2026_06_03.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-12}"
exec "${SCRIPT_DIR}/run_local_osm_pipeline.sh" "$@"
