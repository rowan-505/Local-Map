#!/usr/bin/env bash
# Build Myanmar overview PMTiles from Natural Earth + MIMU admin1.
#
# Prerequisites:
#   - Natural Earth clipped GeoJSONSeq (clip-natural-earth-overview.sh), including
#     mmr_admin0_z0_2 / z3_4 / z5_6.geojsonseq (high-precision land-aligned tiers)
#   - MIMU mmr_admin1.geojsonseq
#
# Boundary layers are built in a separate tippecanoe pass with minimal simplification,
# then merged via tile-join so global --simplification=10 does not destroy coast detail.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/build-overview.sh [version]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
DATA="${REPO_ROOT}/infrastructure/tiles/data/processed"
OVERVIEW_DIR="${REPO_ROOT}/infrastructure/tiles/pmtiles/overview/regions"

VERSION="${1:-v1}"
OUTPUT="${OVERVIEW_DIR}/myanmar-overview-${VERSION}.pmtiles"

command -v tippecanoe >/dev/null 2>&1 || { echo "error: tippecanoe required (brew install tippecanoe)" >&2; exit 1; }
command -v tile-join >/dev/null 2>&1 || { echo "error: tile-join required (brew install tippecanoe)" >&2; exit 1; }
command -v pmtiles >/dev/null 2>&1 || { echo "error: pmtiles required (brew install pmtiles)" >&2; exit 1; }

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "error: missing input: $1" >&2
    exit 1
  fi
}

NE="${DATA}/natural-earth/clipped"
MIMU="${DATA}/mimu/mmr_admin1.geojsonseq"

for f in \
  "${NE}/land.geojsonseq" \
  "${NE}/ocean.geojsonseq" \
  "${NE}/coastline.geojsonseq" \
  "${NE}/countries.geojsonseq" \
  "${NE}/country_boundaries.geojsonseq" \
  "${NE}/mmr_admin0_z0_2.geojsonseq" \
  "${NE}/mmr_admin0_z3_4.geojsonseq" \
  "${NE}/mmr_admin0_z5_6.geojsonseq" \
  "${NE}/populated_places.geojsonseq" \
  "${NE}/lakes.geojsonseq" \
  "${NE}/rivers.geojsonseq" \
  "$MIMU"
do
  require_file "$f"
done

mkdir -p "$OVERVIEW_DIR"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/overview-build.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

BASE_MBTILES="${TMP_DIR}/base.mbtiles"
BOUNDARY_MBTILES="${TMP_DIR}/boundary.mbtiles"
MERGED_MBTILES="${TMP_DIR}/merged.mbtiles"

echo "[build-overview] output=${OUTPUT}" >&2
echo "[build-overview] pass 1/3: base layers (land/ocean/labels)" >&2

tippecanoe \
  -o "$BASE_MBTILES" \
  -Z0 -z8 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --coalesce \
  --simplify-only-low-zooms \
  --simplification=10 \
  --force \
  -L "land:${NE}/land.geojsonseq" \
  -L "ocean:${NE}/ocean.geojsonseq" \
  -L "coastline:${NE}/coastline.geojsonseq" \
  -L "countries:${NE}/countries.geojsonseq" \
  -L "country_boundaries:${NE}/country_boundaries.geojsonseq" \
  -L "populated_places:${NE}/populated_places.geojsonseq" \
  -L "lakes:${NE}/lakes.geojsonseq" \
  -L "rivers:${NE}/rivers.geojsonseq" \
  -L "mmr_admin1:${MIMU}"

echo "[build-overview] pass 2/3: high-precision Myanmar admin0 boundary tiers" >&2

tippecanoe \
  -o "$BOUNDARY_MBTILES" \
  -Z0 -z8 \
  --no-line-simplification \
  --no-simplification-of-shared-nodes \
  --simplification=1 \
  --full-detail=8 \
  --no-tile-size-limit \
  --no-feature-limit \
  --force \
  -L "mmr_admin0_z0_2:${NE}/mmr_admin0_z0_2.geojsonseq" \
  -L "mmr_admin0_z3_4:${NE}/mmr_admin0_z3_4.geojsonseq" \
  -L "mmr_admin0_z5_6:${NE}/mmr_admin0_z5_6.geojsonseq"

echo "[build-overview] pass 3/3: tile-join + pmtiles convert" >&2

tile-join -o "$MERGED_MBTILES" "$BASE_MBTILES" "$BOUNDARY_MBTILES"
pmtiles convert "$MERGED_MBTILES" "$OUTPUT"

echo "[build-overview] layer summary:" >&2
pmtiles show "$OUTPUT" 2>&1 | head -35 >&2 || true

echo "[build-overview] SUCCESS: ${OUTPUT}" >&2
