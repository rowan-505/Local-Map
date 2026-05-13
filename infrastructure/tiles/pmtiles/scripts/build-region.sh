#!/usr/bin/env bash
# Build a regional PMTiles archive from exports/<region>/*.geojson (tippecanoe + pmtiles).
# Writes regions/<region>/<region>-<version>.pmtiles and updates regions/<region>/current.json
# only after a successful archive write. Older *.pmtiles in that folder are never deleted.
#
# Loads optional variables (e.g. BASE_URL) from the repository root .env when not set in the environment.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/build-region.sh <region> <version>
# Example:
#   bash infrastructure/tiles/pmtiles/scripts/build-region.sh mandalay v1
#
# Arguments:
#   $1 = region
#   $2 = version (e.g. v1 → file <region>-v1.pmtiles)
#
# Optional:
#   BASE_URL=https://cdn.example.com bash .../build-region.sh yangon v2
#
# Prerequisites: tippecanoe, pmtiles CLI (e.g. brew install tippecanoe pmtiles)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
if [[ -n "${DATABASE_URL:-}" ]]; then
  local_map_log_database_url_host
else
  echo "[env] DATABASE_URL not set (not required for build; export step needs it)" >&2
fi

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/build-region.sh <region> <version>" >&2
  echo "example: bash infrastructure/tiles/pmtiles/scripts/build-region.sh yangon v2" >&2
  exit 1
fi

REGION="$1"
VERSION="$2"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXPORTS="${PMTILES_ROOT}/exports/${REGION}"
OUT_DIR="${PMTILES_ROOT}/regions/${REGION}"
OUT_PMTILES="${OUT_DIR}/${REGION}-${VERSION}.pmtiles"
MBTILES="${PMTILES_ROOT}/.tmp-build-${REGION}-${VERSION}-$$.mbtiles"
PMTILES_NEW="${OUT_DIR}/${REGION}-${VERSION}.pmtiles.new.$$"
CURRENT_NEW="${OUT_DIR}/current.json.new.$$"
BUILD_STARTED_AT="$(date +%s)"
BUILD_SUCCESS=false
PMTILES_DEBUG="${PMTILES_DEBUG:-0}"

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

elapsed_seconds() {
  local now
  now="$(date +%s)"
  echo "$((now - BUILD_STARTED_AT))s"
}

log() {
  echo "[$(timestamp)] [build] $*" >&2
}

debug() {
  if [[ "$PMTILES_DEBUG" == "1" ]]; then
    log "DEBUG: $*"
  fi
}

cleanup() {
  if [[ "$BUILD_SUCCESS" != "true" ]]; then
    log "cleanup after failure/interruption: removing temp files"
  fi
  rm -f "$MBTILES" "$PMTILES_NEW" "$CURRENT_NEW"
}

feature_count() {
  python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("features", [])))' "$1"
}

echo "" >&2
log "region:            ${REGION}"
log "version:           ${VERSION}"
log "GeoJSON source:    ${EXPORTS}/"
log "PMTiles output:    ${OUT_PMTILES}"
log "current.json:      ${OUT_DIR}/current.json  (updated only after successful build)"
debug "PMTILES_DEBUG=1"
debug "temp mbtiles:      ${MBTILES}"
debug "temp pmtiles:      ${PMTILES_NEW}"
debug "temp current.json: ${CURRENT_NEW}"
echo "" >&2

for cmd in tippecanoe pmtiles python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: '${cmd}' not found. Install tippecanoe, pmtiles, and python3 (e.g. brew install tippecanoe pmtiles)." >&2
    exit 1
  fi
done

# GeoJSON basenames / vector layer names (must match packages/map-style/base-map.json source-layer).
LAYERS=(
  buildings
  streets
  road_labels
  water_polygons
  water_lines
  landuse
  admin_boundaries
  admin_areas
)

for base in "${LAYERS[@]}"; do
  f="${EXPORTS}/${base}.geojson"
  if [[ ! -f "$f" ]]; then
    echo "error: missing ${f}" >&2
    echo "  Run: npm run tiles:export -- ${REGION} ${VERSION}" >&2
    echo "  or:  bash infrastructure/tiles/pmtiles/scripts/export-region.sh ${REGION} ${VERSION}" >&2
    exit 1
  fi
done

log "input GeoJSON file sizes:"
for base in "${LAYERS[@]}"; do
  f="${EXPORTS}/${base}.geojson"
  ls -lh "$f" >&2
done

log "validating GeoJSON before tippecanoe"
validated_count=0
for base in "${LAYERS[@]}"; do
  f="${EXPORTS}/${base}.geojson"
  log "validating layer: ${base}"
  if ! python3 -m json.tool "$f" >/dev/null; then
    echo "error: invalid GeoJSON before tippecanoe: ${f}" >&2
    echo "  Run: npm run tiles:export -- ${REGION} ${VERSION}" >&2
    exit 1
  fi
  log "JSON validation passed: ${base}.geojson"
  validated_count=$((validated_count + 1))
done
log "JSON validation passed for ${validated_count} GeoJSON files"

log "starting buildings layer inspection"
buildings_count="$(feature_count "${EXPORTS}/buildings.geojson")"
log "buildings.geojson feature count: ${buildings_count}"

log "starting streets layer inspection"
streets_count="$(feature_count "${EXPORTS}/streets.geojson")"
log "streets.geojson feature count: ${streets_count}"

mkdir -p "$OUT_DIR"

log "cleaning temp files"
rm -f "$MBTILES" "$PMTILES_NEW" "$CURRENT_NEW"
log "temp paths cleared: mbtiles=${MBTILES}, pmtiles.new=${PMTILES_NEW}, current.new=${CURRENT_NEW}"
debug "elapsed after temp cleanup: $(elapsed_seconds)"
echo "" >&2

trap cleanup EXIT

log "starting tippecanoe -> ${MBTILES}"
named=()
for base in "${LAYERS[@]}"; do
  named+=(--named-layer="${base}:${EXPORTS}/${base}.geojson")
done

tippecanoe_cmd=(
  tippecanoe
  -o "$MBTILES"
  --force
  -pC
  --progress-interval=5
  --minimum-zoom=8
  --maximum-zoom=18
  --drop-densest-as-needed
  --attribution="Local Map"
  "${named[@]}"
)

if [[ "$PMTILES_DEBUG" == "1" ]]; then
  debug "full tippecanoe command:"
  printf '  ' >&2
  printf '%q ' "${tippecanoe_cmd[@]}" >&2
  printf '\n' >&2
fi

tippecanoe_started_at="$(date +%s)"
if "${tippecanoe_cmd[@]}"; then
  tippecanoe_elapsed="$(( $(date +%s) - tippecanoe_started_at ))s"
  log "tippecanoe completed successfully in ${tippecanoe_elapsed}"
else
  status=$?
  log "FAILURE: tippecanoe exited ${status}. Temp files will be removed; did not write or update ${OUT_PMTILES} or current.json."
  exit 1
fi

log "converting mbtiles to pmtiles -> ${PMTILES_NEW}"
if pmtiles convert "$MBTILES" "$PMTILES_NEW"; then
  log "pmtiles convert completed successfully"
else
  status=$?
  log "FAILURE: pmtiles convert exited ${status}. Temp files will be removed; did not update ${OUT_PMTILES} or current.json."
  exit 1
fi

mv -f "$PMTILES_NEW" "$OUT_PMTILES"
log "installed PMTiles: ${OUT_PMTILES}"

BASE_URL="${BASE_URL:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"
filename="${REGION}-${VERSION}.pmtiles"
url="${BASE_URL}/regions/${REGION}/${filename}"
CURRENT="${OUT_DIR}/current.json"

log "updating current.json -> ${CURRENT}"
{
  printf '{\n'
  printf '  "region": "%s",\n' "$REGION"
  printf '  "version": "%s",\n' "$VERSION"
  printf '  "filename": "%s",\n' "$filename"
  printf '  "url": "%s"\n' "$url"
  printf '}\n'
} >"$CURRENT_NEW"
mv -f "$CURRENT_NEW" "$CURRENT"
log "updated current.json -> ${CURRENT}"

trap - EXIT
rm -f "$MBTILES"
BUILD_SUCCESS=true

final_size="$(ls -lh "$OUT_PMTILES" | awk '{print $5}')"
total_elapsed="$(elapsed_seconds)"
echo "" >&2
log "SUCCESS"
log "output PMTiles:       ${OUT_PMTILES}"
log "output file size:     ${final_size}"
log "current.json:         ${CURRENT}"
log "total build duration: ${total_elapsed}"
debug "elapsed build time:   ${total_elapsed}"
log "older versioned .pmtiles in ${OUT_DIR}/ were not deleted"
