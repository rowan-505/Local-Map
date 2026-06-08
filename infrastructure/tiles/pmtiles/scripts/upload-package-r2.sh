#!/usr/bin/env bash
# Resolve local PMTiles path from <region> <version>, then upload via upload-r2.sh.
#
# Usage:
#   npm run tiles:upload -- <region> <version>
#
# Examples:
#   npm run tiles:upload -- yangon v2
#   npm run tiles:upload -- bago v1
#   npm run tiles:upload -- overview v1
set -euo pipefail

usage() {
  echo "usage: npm run tiles:upload -- <region> <version>" >&2
  echo "" >&2
  echo "examples:" >&2
  echo "  npm run tiles:upload -- yangon v2" >&2
  echo "  npm run tiles:upload -- bago v1" >&2
  echo "  npm run tiles:upload -- overview v1" >&2
  echo "" >&2
  echo "local paths:" >&2
  echo "  regional: infrastructure/tiles/pmtiles/regions/<region>/<region>-<version>.pmtiles" >&2
  echo "  overview: infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-<version>.pmtiles" >&2
  echo "" >&2
  echo "R2 object key: coremap-tiles-prod/basemaps/<region>/<version>/basemap.pmtiles" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

REGION="$1"
VERSION="$2"

if [[ -z "$REGION" ]]; then
  echo "error: region must not be empty" >&2
  usage
  exit 1
fi

if [[ "$REGION" == *"/"* || "$REGION" == *".."* ]]; then
  echo "error: region must not contain '/' or '..'" >&2
  exit 1
fi

if [[ -z "$VERSION" ]]; then
  echo "error: version must not be empty" >&2
  usage
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
  echo "error: version must look like v1, v2, v3 (start with 'v' and use digits only, e.g. v2)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UPLOAD_R2="${SCRIPT_DIR}/upload-r2.sh"
BUCKET="coremap-tiles-prod"
OBJECT_KEY="basemaps/${REGION}/${VERSION}/basemap.pmtiles"

if [[ "$REGION" == "overview" ]]; then
  LOCAL_FILE="${PMTILES_ROOT}/overview/regions/myanmar-overview-${VERSION}.pmtiles"
else
  LOCAL_FILE="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"
fi

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "error: local PMTiles file not found: ${LOCAL_FILE}" >&2
  echo "hint: build first, e.g. npm run tiles:rebuild -- ${REGION} ${VERSION}" >&2
  exit 1
fi

echo "" >&2
echo "[tiles:upload] region=${REGION} version=${VERSION}" >&2
echo "[tiles:upload] local:  ${LOCAL_FILE}" >&2
echo "[tiles:upload] remote: ${BUCKET}/${OBJECT_KEY}" >&2
echo "" >&2

exec bash "${UPLOAD_R2}" "${LOCAL_FILE}" "${REGION}" "${VERSION}"
