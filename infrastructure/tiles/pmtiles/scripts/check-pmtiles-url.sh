#!/usr/bin/env bash
# Verify a public PMTiles URL: plain HEAD plus Range + Origin (CORS) checks.
# Parses curl output with grep/awk only (no jq). macOS / bash 3.2 friendly.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh <pmtiles_url> <origin>
#
# Example:
#   bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \
#     https://pub-xxxxx.r2.dev/basemaps/yangon/v2/basemap.pmtiles \
#     http://localhost:5173
set -euo pipefail

usage() {
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh <pmtiles_url> <origin>" >&2
  echo "example: bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \\" >&2
  echo "  https://pub-xxxxx.r2.dev/basemaps/yangon/v2/basemap.pmtiles http://localhost:5173" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

URL="$1"
ORIGIN="$2"

if [[ -z "$URL" ]]; then
  echo "error: pmtiles_url must not be empty" >&2
  exit 1
fi

if [[ -z "$ORIGIN" ]]; then
  echo "error: origin must not be empty" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl not found in PATH" >&2
  exit 1
fi

# Strip CR for consistent parsing (some servers / proxies).
normalize_headers() {
  tr -d '\r'
}

# With curl -L, output may include multiple status/header blocks; use the final response.
http_status_from_block() {
  printf '%s\n' "$1" | grep -E '^HTTP/' | tail -1 | awk '{print $2}' || true
}

header_value() {
  local block="$1"
  local name="$2"
  printf '%s\n' "$block" | grep -i "^${name}:" | tail -1 | cut -d: -f2- | sed 's/^ //' || true
}

print_header_summary() {
  local label="$1"
  local block="$2"

  local status acao aranges crange clen etag cfcache

  status="$(http_status_from_block "$block")"
  acao="$(header_value "$block" "access-control-allow-origin")"
  aranges="$(header_value "$block" "accept-ranges")"
  crange="$(header_value "$block" "content-range")"
  clen="$(header_value "$block" "content-length")"
  etag="$(header_value "$block" "etag")"
  cfcache="$(header_value "$block" "cf-cache-status")"

  echo "${label}"
  echo "  HTTP status:                 ${status:-<missing>}"
  echo "  access-control-allow-origin: ${acao:-<missing>}"
  echo "  accept-ranges:               ${aranges:-<missing>}"
  echo "  content-range:               ${crange:-<missing>}"
  echo "  content-length:              ${clen:-<missing>}"
  echo "  etag:                        ${etag:-<missing>}"
  echo "  cf-cache-status:             ${cfcache:-<missing>}"
  echo ""
}

warn_status() {
  local ctx="$1"
  local code="$2"
  if [[ -z "$code" ]]; then
    echo "warning [${ctx}]: could not read HTTP status (empty or unparsable)." >&2
    return
  fi
  if [[ "$code" != "200" && "$code" != "206" ]]; then
    echo "warning [${ctx}]: HTTP status is ${code} (expected 200 or 206 for these checks)." >&2
  fi
}

echo "============================================================"
echo "1) HEAD request (equivalent: curl -I with follow + timeout)"
echo "   curl -I -L --max-time 60 <url>"
echo "   url: ${URL}"
echo "------------------------------------------------------------"
set +e
HEAD_RAW="$(curl -sS -I -L --max-time 60 "$URL" 2>&1 | normalize_headers)"
HEAD_EC=$?
set -e

if [[ "$HEAD_EC" -ne 0 ]]; then
  echo "warning: curl exited with code ${HEAD_EC} for HEAD request (output may be partial)." >&2
fi

printf '%s\n' "$HEAD_RAW"
echo ""

HEAD_STATUS="$(http_status_from_block "$HEAD_RAW")"
print_header_summary "Important headers (HEAD)" "$HEAD_RAW"
warn_status "HEAD" "$HEAD_STATUS"

echo "============================================================"
echo "2) Range + Origin request"
echo "   curl -I -L --max-time 60 -H \"Range: bytes=0-16383\" -H \"Origin: <origin>\" <url>"
echo "   origin: ${ORIGIN}"
echo "------------------------------------------------------------"
set +e
RANGE_RAW="$(curl -sS -I -L --max-time 60 \
  -H "Range: bytes=0-16383" \
  -H "Origin: ${ORIGIN}" \
  "$URL" 2>&1 | normalize_headers)"
RANGE_EC=$?
set -e

if [[ "$RANGE_EC" -ne 0 ]]; then
  echo "warning: curl exited with code ${RANGE_EC} for Range request (output may be partial)." >&2
fi

printf '%s\n' "$RANGE_RAW"
echo ""

RANGE_STATUS="$(http_status_from_block "$RANGE_RAW")"
print_header_summary "Important headers (Range + Origin)" "$RANGE_RAW"
warn_status "Range+Origin" "$RANGE_STATUS"

CRANGE="$(header_value "$RANGE_RAW" "content-range")"
if [[ -z "$CRANGE" ]]; then
  echo "warning [Range+Origin]: content-range is missing (PMTiles needs reliable Range support)." >&2
fi

ACAO="$(header_value "$RANGE_RAW" "access-control-allow-origin")"
if [[ -z "$ACAO" ]]; then
  echo "warning [Range+Origin]: access-control-allow-origin is missing (browser may block cross-origin tile reads)." >&2
fi

echo "Done."
