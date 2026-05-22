#!/usr/bin/env bash
# Export basemap GeoJSON from PostGIS for PMTiles builds.
# Writes into exports/<region>/ (clean folder each run to avoid corrupt/partial GeoJSON for tippecanoe).
# Does not export tiles.tiles_places_v or other POI layers.
#
# Loads DATABASE_URL from the repository root .env when not already set in the environment.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>
# Example:
#   bash infrastructure/tiles/pmtiles/scripts/export-region.sh yangon v2
#
# Arguments:
#   $1 = region (e.g. yangon, mandalay)
#   $2 = version slug for the upcoming PMTiles (e.g. v1) — logged for traceability; GeoJSON path is exports/<region>/
#
# Prerequisites: GDAL ogr2ogr, python3 (for json.tool validation)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set." >&2
  echo "  Add DATABASE_URL to ${LOCAL_MAP_ROOT_ENV_FILE} or export it in your shell." >&2
  echo "  bash infrastructure/tiles/pmtiles/scripts/export-region.sh yangon v1" >&2
  exit 1
fi

local_map_log_database_url_host

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>" >&2
  echo "example: bash infrastructure/tiles/pmtiles/scripts/export-region.sh mandalay v1" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required to validate GeoJSON (python3 -m json.tool)." >&2
  exit 1
fi

REGION="$1"
VERSION="$2"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT="${PMTILES_ROOT}/exports/${REGION}"
PLANNED_PMTILES="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "error: ogr2ogr not found. Install GDAL (e.g. brew install gdal)." >&2
  exit 1
fi

echo "" >&2
echo "[export] region:            ${REGION}" >&2
echo "[export] version:           ${VERSION}  (labels the PMTiles file from the next build step)" >&2
echo "[export] GeoJSON export:    ${OUT}/" >&2
echo "[export] planned PMTiles:   ${PLANNED_PMTILES}" >&2
echo "" >&2

echo "[export] cleaning export folder (rm -rf, then mkdir -p)…" >&2
rm -rf "$OUT"
mkdir -p "$OUT"
echo "[export] clean export folder ready: ${OUT}/" >&2
echo "" >&2

# GeoJSON basename -> tiles schema view (basemap only; excludes tiles.tiles_places_v and POIs).
declare -a LAYERS=(
  "buildings:tiles_buildings_v"
  "streets:tiles_streets_v"
  "road_labels:tiles_road_labels_v"
  "water_polygons:tiles_water_polygons_v"
  "water_lines:tiles_water_lines_v"
  "landuse:tiles_landuse_v"
  "admin_boundaries:tiles_admin_boundaries_v"
  "admin_areas:tiles_admin_areas_v"
  "village_labels:tiles_village_labels_v"
)

for entry in "${LAYERS[@]}"; do
  base="${entry%%:*}"
  view="${entry##*:}"
  table="tiles.${view}"
  dest="${OUT}/${base}.geojson"

  rm -f "$dest"
  echo "[export] layer: ${base}.geojson  <-  ${table}" >&2
  ogr2ogr -overwrite -f GeoJSON "$dest" "PG:${DATABASE_URL}" \
    -sql "SELECT * FROM ${table}" \
    -t_srs EPSG:4326

  echo "[export] validating JSON: ${dest}" >&2
  if ! python3 -m json.tool "$dest" >/dev/null; then
    echo "error: GeoJSON validation failed for ${dest} (invalid JSON — tippecanoe would fail)." >&2
    echo "  Fix the source data or ogr2ogr output; export stopped." >&2
    exit 1
  fi
  echo "[export] JSON validation passed: ${base}.geojson" >&2
  echo "" >&2
done

echo "[export] SUCCESS: all ${#LAYERS[@]} basemap layers exported and validated (POIs / tiles.tiles_places_v not included)." >&2
