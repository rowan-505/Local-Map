#!/usr/bin/env bash
# Upload a local PMTiles archive to Cloudflare R2 via rclone (versioned object key; never overwrites blindly).
#
# Prerequisites: rclone installed and an R2 remote configured (default remote name: "r2").
#   See: rclone config  (create an S3-compatible remote pointing at your R2 account)
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
#
# Environment overrides:
#   R2_REMOTE            rclone remote name        (default: r2)
#   R2_BUCKET            R2 bucket name            (default: coremap-tiles-prod)
#   R2_PUBLIC_BASE_URL   public base URL for URLs  (default: https://tiles.coremapmm.com)
#   OVERWRITE            set to "true" to allow replacing an existing remote object
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

R2_REMOTE="${R2_REMOTE:-r2}"
R2_BUCKET="${R2_BUCKET:-coremap-tiles-prod}"
R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://tiles.coremapmm.com}"
OVERWRITE="${OVERWRITE:-false}"

OBJECT_KEY="basemaps/${REGION}/${VERSION}/basemap.pmtiles"
REMOTE_PATH="${R2_REMOTE}:${R2_BUCKET}/${OBJECT_KEY}"
PUBLIC_URL="${R2_PUBLIC_BASE_URL%/}/${OBJECT_KEY}"

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

if ! command -v rclone >/dev/null 2>&1; then
  echo "error: rclone not found in PATH (install rclone, then run: rclone config)" >&2
  exit 1
fi

echo "Uploading to remote Cloudflare R2 via rclone:" >&2
echo "  local:      ${LOCAL_FILE}" >&2
echo "  remote key: ${R2_BUCKET}/${OBJECT_KEY}" >&2
echo "  remote:     ${REMOTE_PATH}" >&2
echo "  public url: ${PUBLIC_URL}" >&2
echo "  overwrite:  ${OVERWRITE}" >&2

# Overwrite protection: refuse to replace an existing object unless OVERWRITE=true.
if rclone lsf "${REMOTE_PATH}" >/dev/null 2>&1; then
  if [[ "$OVERWRITE" != "true" ]]; then
    echo "" >&2
    echo "error: remote object already exists: ${REMOTE_PATH}" >&2
    echo "       refusing to overwrite. Re-run with OVERWRITE=true to replace it." >&2
    exit 1
  fi
  echo "  note: remote object exists and OVERWRITE=true -> replacing." >&2
fi

if ! rclone copyto "${LOCAL_FILE}" "${REMOTE_PATH}" --s3-no-check-bucket --progress; then
  echo "" >&2
  echo "Upload FAILED." >&2
  echo "  local:      ${LOCAL_FILE}" >&2
  echo "  remote key: ${R2_BUCKET}/${OBJECT_KEY}" >&2
  exit 1
fi

echo "" >&2
echo "Upload finished successfully." >&2
echo "  local:      ${LOCAL_FILE}" >&2
echo "  remote key: ${R2_BUCKET}/${OBJECT_KEY}" >&2
echo "  public url: ${PUBLIC_URL}" >&2
