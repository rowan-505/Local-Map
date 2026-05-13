#!/usr/bin/env bash
# Upload a local PMTiles archive to Cloudflare R2 (versioned object key; never overwrites blindly).
#
# Prerequisites: wrangler installed and authenticated (`wrangler login`).
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/upload-r2.sh <local_pmtiles_file> <region> <version>
#
# Example:
#   bash infrastructure/tiles/pmtiles/scripts/upload-r2.sh \
#     infrastructure/tiles/pmtiles/output/yangon-v2.pmtiles \
#     yangon \
#     v2
#
# Object key:
#   coremap-tiles-prod/basemaps/<region>/<version>/basemap.pmtiles
set -euo pipefail

usage() {
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/upload-r2.sh <local_pmtiles_file> <region> <version>" >&2
  echo "example: bash infrastructure/tiles/pmtiles/scripts/upload-r2.sh \\" >&2
  echo "  infrastructure/tiles/pmtiles/output/yangon-v2.pmtiles yangon v2" >&2
}

if [[ $# -ne 3 ]]; then
  usage
  exit 1
fi

LOCAL_FILE="$1"
REGION="$2"
VERSION="$3"

BUCKET="coremap-tiles-prod"
OBJECT_KEY="basemaps/${REGION}/${VERSION}/basemap.pmtiles"
REMOTE="${BUCKET}/${OBJECT_KEY}"

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "error: local file does not exist or is not a regular file: ${LOCAL_FILE}" >&2
  exit 1
fi

if [[ -z "$REGION" ]]; then
  echo "error: region must not be empty" >&2
  exit 1
fi

if [[ "$REGION" == *"/"* || "$REGION" == *".."* ]]; then
  echo "error: region must not contain '/' or '..'" >&2
  exit 1
fi

if [[ -z "$VERSION" ]]; then
  echo "error: version must not be empty" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
  echo "error: version must look like v1, v2, v3 (start with 'v' and use digits only, e.g. v2)" >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "error: wrangler not found in PATH (install Wrangler, then run: wrangler login)" >&2
  exit 1
fi

echo "Uploading to remote Cloudflare R2:" >&2
echo "  local:  ${LOCAL_FILE}" >&2
echo "  remote: ${REMOTE}" >&2

wrangler r2 object put "${REMOTE}" \
  --file "${LOCAL_FILE}" \
  --remote

echo "" >&2
echo "Upload finished." >&2
echo "" >&2
echo "Temporary public URL (replace YOUR_R2_PUBLIC_DOMAIN with the hostname from the R2 dashboard):" >&2
echo "  https://YOUR_R2_PUBLIC_DOMAIN/${OBJECT_KEY}" >&2
echo "" >&2
echo "Future production URL (after you connect tiles.yourdomain.com):" >&2
echo "  https://tiles.yourdomain.com/${OBJECT_KEY}" >&2