#!/usr/bin/env bash
# Generic export + build for any region/version (parameterized pipeline).
# CDN/R2: mirror the same paths — regions/<region>/current.json and regions/<region>/<region>-<version>.pmtiles
#
# Usage (repo root):
#   npm run tiles:rebuild -- yangon v2
#   npm run tiles:rebuild -- mandalay v1
#   bash infrastructure/tiles/pmtiles/scripts/rebuild-region.sh <region> <version>
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/rebuild-region.sh <region> <version>" >&2
  echo "examples:" >&2
  echo "  npm run tiles:rebuild -- yangon v2" >&2
  echo "  npm run tiles:rebuild -- mandalay v1" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REGION="$1"
VERSION="$2"
EXPORT_DIR="${PMTILES_ROOT}/exports/${REGION}"
OUT_PMTILES="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"

echo "" >&2
echo "[rebuild] region:            ${REGION}" >&2
echo "[rebuild] version:           ${VERSION}" >&2
echo "[rebuild] GeoJSON export:    ${EXPORT_DIR}/" >&2
echo "[rebuild] PMTiles output:    ${OUT_PMTILES}" >&2
echo "[rebuild] running export then build…" >&2
echo "" >&2

bash "${SCRIPT_DIR}/export-region.sh" "$REGION" "$VERSION"
bash "${SCRIPT_DIR}/build-region.sh" "$REGION" "$VERSION"

echo "[rebuild] done: ${REGION} ${VERSION}" >&2
