#!/usr/bin/env bash
# Verify all uploaded regional PMTiles on Cloudflare R2 (public URLs).
#
# For each region folder under infrastructure/tiles/pmtiles/regions/<region>/ that has a
# current.json, this reads the version, builds the public URL, and runs:
#   1) a HEAD request   (expects HTTP 200)
#   2) a Range request  (bytes=0-1023, expects HTTP 206)
#
# A region passes only if both checks succeed.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/verify-all-regions-r2.sh
#   npm run tiles:verify:regions
#
# Environment overrides:
#   R2_PUBLIC_BASE_URL   public base URL (default: https://tiles.coremapmm.com)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REGIONS_DIR="${PMTILES_ROOT}/regions"

R2_PUBLIC_BASE_URL="${R2_PUBLIC_BASE_URL:-https://tiles.coremapmm.com}"

if [[ ! -d "$REGIONS_DIR" ]]; then
  echo "error: regions directory not found: ${REGIONS_DIR}" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl not found in PATH" >&2
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

# Print just the final HTTP status code from a curl -I -L response (handles redirects).
http_status() {
  printf '%s\n' "$1" | tr -d '\r' | grep -E '^HTTP/' | tail -1 | awk '{print $2}' || true
}

PASSED=0
FAILED=0
SKIPPED=0

echo "[tiles:verify:regions] base url: ${R2_PUBLIC_BASE_URL%/}" >&2
echo "[tiles:verify:regions] scanning ${REGIONS_DIR}" >&2
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

  if ! VERSION="$(json_field "$CURRENT_JSON" version)" || [[ -z "$VERSION" ]]; then
    echo "[skip] ${REGION}: missing/unparsable version in current.json" >&2
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  URL="${R2_PUBLIC_BASE_URL%/}/basemaps/${REGION}/${VERSION}/basemap.pmtiles"

  set +e
  HEAD_RAW="$(curl -sS -I -L --max-time 60 "$URL" 2>&1)"
  HEAD_EC=$?
  RANGE_RAW="$(curl -sS -I -L --max-time 60 -H "Range: bytes=0-1023" "$URL" 2>&1)"
  RANGE_EC=$?
  set -e

  HEAD_STATUS="$(http_status "$HEAD_RAW")"
  RANGE_STATUS="$(http_status "$RANGE_RAW")"

  HEAD_OK=false
  RANGE_OK=false
  [[ "$HEAD_EC" -eq 0 && "$HEAD_STATUS" == "200" ]] && HEAD_OK=true
  [[ "$RANGE_EC" -eq 0 && "$RANGE_STATUS" == "206" ]] && RANGE_OK=true

  if [[ "$HEAD_OK" == "true" && "$RANGE_OK" == "true" ]]; then
    echo "[pass] ${REGION} ${VERSION}: HEAD=${HEAD_STATUS} Range=${RANGE_STATUS}" >&2
    echo "       ${URL}" >&2
    PASSED=$((PASSED + 1))
  else
    echo "[fail] ${REGION} ${VERSION}: HEAD=${HEAD_STATUS:-<none>} (want 200) Range=${RANGE_STATUS:-<none>} (want 206)" >&2
    echo "       ${URL}" >&2
    FAILED=$((FAILED + 1))
  fi
done

echo "" >&2
echo "===== tiles:verify:regions summary =====" >&2
echo "  Passed:  ${PASSED}" >&2
echo "  Failed:  ${FAILED}" >&2
echo "  Skipped: ${SKIPPED}" >&2
echo "========================================" >&2

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
