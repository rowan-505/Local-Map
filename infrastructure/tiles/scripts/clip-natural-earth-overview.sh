#!/usr/bin/env bash
set -euo pipefail

# CoreMap Myanmar overview bbox
# GDAL -spat order: minLng minLat maxLng maxLat
MIN_LNG=75
MIN_LAT=0
MAX_LNG=115
MAX_LAT=36

ROOT="infrastructure/tiles"
NE_UNZIPPED="$ROOT/data/natural-earth/unzipped"
OUT="$ROOT/data/processed/natural-earth/clipped"

mkdir -p "$OUT"

echo "Clipping Natural Earth data to bbox:"
echo "  minLng=$MIN_LNG minLat=$MIN_LAT maxLng=$MAX_LNG maxLat=$MAX_LAT"
echo ""

clip_layer() {
  local name="$1"
  local src="$2"
  local dst="$3"

  if [ ! -f "$src" ]; then
    echo "❌ Missing source for $name:"
    echo "   $src"
    exit 1
  fi

  echo "→ Clipping $name"

  ogr2ogr \
    -f GeoJSONSeq \
    -t_srs EPSG:4326 \
    -spat "$MIN_LNG" "$MIN_LAT" "$MAX_LNG" "$MAX_LAT" \
    "$dst" \
    "$src"

  echo "  ✅ $dst"
}

clip_layer \
  "land" \
  "$NE_UNZIPPED/ne_10m_land/ne_10m_land.shp" \
  "$OUT/land.geojsonseq"

clip_layer \
  "ocean" \
  "$NE_UNZIPPED/ne_10m_ocean/ne_10m_ocean.shp" \
  "$OUT/ocean.geojsonseq"

clip_layer \
  "coastline" \
  "$NE_UNZIPPED/ne_10m_coastline/ne_10m_coastline.shp" \
  "$OUT/coastline.geojsonseq"

clip_layer \
  "countries" \
  "$NE_UNZIPPED/ne_10m_admin_0_countries/ne_10m_admin_0_countries.shp" \
  "$OUT/countries.geojsonseq"

clip_layer \
  "country_boundaries" \
  "$NE_UNZIPPED/ne_10m_admin_0_boundary_lines_land/ne_10m_admin_0_boundary_lines_land.shp" \
  "$OUT/country_boundaries.geojsonseq"

clip_layer \
  "admin1_global" \
  "$NE_UNZIPPED/ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.shp" \
  "$OUT/admin1_global.geojsonseq"

clip_layer \
  "populated_places" \
  "$NE_UNZIPPED/ne_10m_populated_places/ne_10m_populated_places.shp" \
  "$OUT/populated_places.geojsonseq"

clip_layer \
  "lakes" \
  "$NE_UNZIPPED/ne_10m_lakes/ne_10m_lakes.shp" \
  "$OUT/lakes.geojsonseq"

clip_layer \
  "rivers" \
  "$NE_UNZIPPED/ne_10m_rivers_lake_centerlines/ne_10m_rivers_lake_centerlines.shp" \
  "$OUT/rivers.geojsonseq"

echo ""
echo "✅ Natural Earth clipping complete."
echo "Output folder:"
echo "  $OUT"