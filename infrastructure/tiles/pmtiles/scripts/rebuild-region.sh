#!/usr/bin/env bash
# Export + build for any region/version.
#
# Usage:
#   npm run tiles:rebuild -- yangon v2
#   npm run tiles:rebuild -- yangon v2 --skip-buildings
#   npm run tiles:rebuild -- yangon v2 --roads-only
#   npm run tiles:rebuild -- yangon v2 --light-only
#
# Build without re-export (faster when exports/ already exists):
#   npm run tiles:build -- yangon v2
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/rebuild-region.sh <region> <version> [build options]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REGION="$1"
VERSION="$2"
shift 2
EXTRA_BUILD_ARGS=("$@")

EXPORT_DIR="${PMTILES_ROOT}/exports/${REGION}"
OUT_PMTILES="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"
REBUILD_STARTED_AT="$(date +%s)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/build-stages.sh"
export PMTILES_PIPELINE_SCOPE=rebuild
export PMTILES_PIPELINE_STARTED_AT="$REBUILD_STARTED_AT"
export PMTILES_STAGE_STARTED_AT="$REBUILD_STARTED_AT"
export PMTILES_REBUILD_ACTIVE=1

echo "" >&2
echo "[rebuild] region=${REGION} version=${VERSION}" >&2
echo "[rebuild] export=${EXPORT_DIR}/" >&2
echo "[rebuild] output=${OUT_PMTILES}" >&2
echo "[rebuild] stages: export 0-25% → build 25-100%" >&2
echo "" >&2

pmtiles_stage 0.00 "pipeline start (export + build)"

bash "${SCRIPT_DIR}/export-region.sh" "$REGION" "$VERSION"
if [[ ${#EXTRA_BUILD_ARGS[@]} -gt 0 ]]; then
  bash "${SCRIPT_DIR}/build-region.sh" "$REGION" "$VERSION" "${EXTRA_BUILD_ARGS[@]}"
else
  bash "${SCRIPT_DIR}/build-region.sh" "$REGION" "$VERSION"
fi

pmtiles_stage 100.00 "rebuild complete"
echo "[rebuild] done: ${REGION} ${VERSION}" >&2
