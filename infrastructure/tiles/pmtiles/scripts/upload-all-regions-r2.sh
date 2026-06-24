#!/usr/bin/env bash
# Bulk-upload all regional PMTiles to Cloudflare R2 using the existing low-level upload-r2.sh.
#
# For each region folder under infrastructure/tiles/pmtiles/regions/<region>/ that has a
# current.json, this reads the version (and filename) and uploads the resolved local
# PMTiles file via upload-r2.sh.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/upload-all-regions-r2.sh
#   npm run tiles:upload:regions
#
# Overwrite protection is inherited from upload-r2.sh: existing R2 keys are NOT overwritten
# unless OVERWRITE=true is set, e.g.:
#   OVERWRITE=true npm run tiles:upload:regions
#
# Environment overrides (passed through to upload-r2.sh):
#   R2_REMOTE, R2_BUCKET, R2_PUBLIC_BASE_URL, OVERWRITE
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REGIONS_DIR="${PMTILES_ROOT}/regions"
UPLOAD_R2="${SCRIPT_DIR}/upload-r2.sh"

if [[ ! -d "$REGIONS_DIR" ]]; then
  echo "error: regions directory not found: ${REGIONS_DIR}" >&2
  exit 1
fi

if [[ ! -f "$UPLOAD_R2" ]]; then
  echo "error: low-level upload script not found: ${UPLOAD_R2}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found in PATH (required to read current.json)" >&2
  exit 1
fi

# Read a string field from a JSON file. Prints the value (empty if missing/null).
json_field() {
  local file="$1" field="$2"
  node -e '
    const fs = require("fs");
    const [file, field] = process.argv.slice(1);
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const v = data[field];
      if (v === undefined || v === null) { process.exit(0); }
      process.stdout.write(String(v));
    } catch (e) {
      process.exit(2);
    }
  ' "$file" "$field"
}

UPLOADED=0
SKIPPED=0
FAILED=0

echo "[tiles:upload:regions] scanning ${REGIONS_DIR}" >&2
echo "" >&2

for entry in "${REGIONS_DIR}"/*; do
  # Skip non-directory files like manifest.json.
  if [[ ! -d "$entry" ]]; then
    continue
  fi

  REGION="$(basename "$entry")"
  CURRENT_JSON="${entry}/current.json"

  if [[ ! -f "$CURRENT_JSON" ]]; then
    echo "[skip] ${REGION}: no current.json" >&2
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if ! VERSION="$(json_field "$CURRENT_JSON" version)"; then
    echo "[fail] ${REGION}: could not parse ${CURRENT_JSON}" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  if [[ -z "$VERSION" ]]; then
    echo "[fail] ${REGION}: missing 'version' in current.json" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  if [[ ! "$VERSION" =~ ^v[0-9]+$ ]]; then
    echo "[fail] ${REGION}: invalid version '${VERSION}' (expected v1, v2, ...)" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  FILENAME="$(json_field "$CURRENT_JSON" filename || true)"
  if [[ -z "$FILENAME" ]]; then
    FILENAME="${REGION}-${VERSION}.pmtiles"
  fi

  LOCAL_FILE="${entry}/${FILENAME}"

  if [[ ! -f "$LOCAL_FILE" ]]; then
    echo "[fail] ${REGION}: PMTiles file not found: ${LOCAL_FILE}" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  echo "" >&2
  echo "[upload] ${REGION} ${VERSION} -> ${LOCAL_FILE}" >&2
  if bash "$UPLOAD_R2" "$LOCAL_FILE" "$REGION" "$VERSION"; then
    UPLOADED=$((UPLOADED + 1))
  else
    echo "[fail] ${REGION}: upload failed" >&2
    FAILED=$((FAILED + 1))
  fi
done

echo "" >&2
echo "===== tiles:upload:regions summary =====" >&2
echo "  Uploaded: ${UPLOADED}" >&2
echo "  Skipped:  ${SKIPPED}" >&2
echo "  Failed:   ${FAILED}" >&2
echo "========================================" >&2

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
