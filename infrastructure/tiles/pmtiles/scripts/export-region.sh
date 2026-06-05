#!/usr/bin/env bash
# Export basemap GeoJSON from PostGIS for PMTiles builds.
# Writes into exports/<region>/ (clean folder each run).
# Does not export tiles.tiles_places_v or POI layers.
#
# Regional exports are spatially filtered to the state/region polygon plus a
# configurable buffer (default 10 km) so each archive contains only that
# region's data with slight overlap at borders.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"

if [[ -f "${SCRIPT_DIR}/build-stages.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/build-stages.sh"
  export PMTILES_PIPELINE_SCOPE="${PMTILES_PIPELINE_SCOPE:-export}"
  if [[ -z "${PMTILES_PIPELINE_STARTED_AT:-}" ]]; then
    export PMTILES_PIPELINE_STARTED_AT="$(date +%s)"
    export PMTILES_STAGE_STARTED_AT="$PMTILES_PIPELINE_STARTED_AT"
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set." >&2
  exit 1
fi

local_map_log_database_url_host

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>" >&2
  echo "supported regions: $(pmtiles_region_list_supported)" >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "error: python3 required" >&2; exit 1; }
command -v ogr2ogr >/dev/null 2>&1 || { echo "error: ogr2ogr required (brew install gdal)" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "error: psql required" >&2; exit 1; }

REGION="$1"
VERSION="$2"
PMTILES_REGION_BUFFER_METERS="${PMTILES_REGION_BUFFER_METERS:-10000}"
PMTILES_REGION_SUBDIVIDE_SEGMENTS="${PMTILES_REGION_SUBDIVIDE_SEGMENTS:-512}"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT="${PMTILES_ROOT}/exports/${REGION}"
PLANNED_PMTILES="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"

if ! pmtiles_region_is_supported "$REGION"; then
  echo "error: unsupported region '${REGION}'. Supported: $(pmtiles_region_list_supported)" >&2
  exit 1
fi

BOUNDARY_INFO="$(pmtiles_resolve_region_boundary "$REGION")" || exit 1
IFS='|' read -r REGION_ADMIN_AREA_ID REGION_BOUNDARY_NAME REGION_AREA_KM2 <<<"$BOUNDARY_INFO"

echo "" >&2
echo "[export] region=${REGION} version=${VERSION}" >&2
echo "[export] boundary id=${REGION_ADMIN_AREA_ID} name=${REGION_BOUNDARY_NAME} area_km2=${REGION_AREA_KM2}" >&2
echo "[export] clip buffer=${PMTILES_REGION_BUFFER_METERS}m (PMTILES_REGION_BUFFER_METERS)" >&2
echo "[export] subdivide segments=${PMTILES_REGION_SUBDIVIDE_SEGMENTS} (PMTILES_REGION_SUBDIVIDE_SEGMENTS)" >&2
echo "[export] output=${OUT}/" >&2
echo "[export] planned PMTiles=${PLANNED_PMTILES}" >&2
echo "" >&2

declare -a LAYERS=(
  "buildings:tiles_buildings_v"
  "streets:tiles_streets_v"
  "road_labels:tiles_road_labels_v"
  "water_polygons:tiles_water_polygons_v"
  "water_lines:tiles_water_lines_v"
  "landuse:tiles_landuse_v"
  "admin_boundaries:tiles_admin_boundaries_v"
  "admin_areas:tiles_admin_areas_v"
  "admin_area_label_points:tiles_admin_area_label_points_v"
  "village_labels:tiles_village_labels_v"
)

rm -rf "$OUT"
mkdir -p "$OUT"

if declare -F pmtiles_stage >/dev/null 2>&1; then
  pmtiles_stage 2.00 "export: clean folder ready"
fi

export_geojson_feature_count() {
  python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("features", [])))' "$1"
}

export_geojson_human_size() {
  ls -lh "$1" | awk '{print $5}'
}

export PGOPTIONS="${PGOPTIONS:--c statement_timeout=3600000}"

layer_index=0
layer_total="${#LAYERS[@]}"
for entry in "${LAYERS[@]}"; do
  layer_index=$((layer_index + 1))
  base="${entry%%:*}"
  view="${entry##*:}"
  table="tiles.${view}"
  dest="${OUT}/${base}.geojson"
  clip_sql="$(pmtiles_clipped_layer_sql "$view" "$REGION_ADMIN_AREA_ID" "$PMTILES_REGION_BUFFER_METERS" "$PMTILES_REGION_SUBDIVIDE_SEGMENTS")"

  if declare -F pmtiles_stage >/dev/null 2>&1; then
    pct="$(awk -v i="$layer_index" -v t="$layer_total" 'BEGIN { printf "%.2f", 3.0 + (i / t) * 22.0 }')"
    pmtiles_stage "$pct" "export layer ${layer_index}/${layer_total}: ${base} <- ${table} (clipped)"
  else
    echo "[export] layer: ${base}.geojson <- ${table} (clipped)" >&2
  fi

  ogr2ogr -overwrite -f GeoJSON "$dest" "PG:${DATABASE_URL}" \
    -sql "${clip_sql}" \
    -s_srs EPSG:4326 \
    -t_srs EPSG:4326

  python3 -m json.tool "$dest" >/dev/null || {
    echo "error: invalid GeoJSON: ${dest}" >&2
    exit 1
  }

  feature_n="$(export_geojson_feature_count "$dest")"
  file_size="$(export_geojson_human_size "$dest")"
  echo "[export] clipped ${base}: ${feature_n} features, ${file_size}" >&2
done

if declare -F pmtiles_stage >/dev/null 2>&1; then
  pmtiles_stage 25.00 "export complete (ready for tiles:build)"
fi

echo "[export] SUCCESS: ${layer_total} clipped layers exported to ${OUT}/" >&2
