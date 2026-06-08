#!/usr/bin/env bash
# Build a regional PMTiles archive from exports/<region>/*.geojson (tippecanoe + pmtiles).
# Writes regions/<region>/<region>-<version>.pmtiles and updates regions/<region>/current.json
# only after a successful archive write. Older *.pmtiles in that folder are never deleted.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/build-region.sh <region> <version> [options]
#
# Options:
#   --skip-buildings       omit buildings layer (faster debug build)
#   --roads-only           only streets + road_labels (fastest debug; no admin/water/landuse)
#   --light-only           admin/water/landuse only (no streets or road_labels)
#   --no-progress-ticker   disable estimated progress ticker during long commands
#
# Examples:
#   npm run tiles:build -- yangon v2
#   npm run tiles:build -- yangon v2 --skip-buildings
#   npm run tiles:build -- yangon v2 --roads-only
#
# Optional env:
#   PMTILES_MIN_ZOOM=8   PMTILES_MAX_ZOOM=20   PMTILES_DEBUG=1   BASE_URL=...
#
# Prerequisites: tippecanoe, tile-join, pmtiles, python3, ogr2ogr
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/build-stages.sh"

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/build-region.sh <region> <version> [--skip-buildings] [--roads-only] [--light-only] [--no-progress-ticker]" >&2
  exit 1
fi

REGION="$1"
VERSION="$2"
shift 2
SKIP_BUILDINGS="${SKIP_BUILDINGS:-0}"
ROADS_ONLY=0
LIGHT_ONLY=0
NO_PROGRESS_TICKER=0
BUILD_MODE="full"
[[ "$SKIP_BUILDINGS" == "1" ]] && SKIP_BUILDINGS=1 || SKIP_BUILDINGS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-buildings) SKIP_BUILDINGS=1 ;;
    --roads-only) ROADS_ONLY=1 ;;
    --light-only) LIGHT_ONLY=1 ;;
    --no-progress-ticker) NO_PROGRESS_TICKER=1 ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$NO_PROGRESS_TICKER" == "1" ]]; then
  export PMTILES_PROGRESS_TICKER_ENABLED=0
fi

PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXPORTS="${PMTILES_ROOT}/exports/${REGION}"
OUT_DIR="${PMTILES_ROOT}/regions/${REGION}"
OUT_PMTILES="${OUT_DIR}/${REGION}-${VERSION}.pmtiles"
PREP_DIR="${PMTILES_ROOT}/.tmp-prep-${REGION}-${VERSION}-$$"
MBTILES_ADMIN="${PMTILES_ROOT}/.tmp-build-admin-${REGION}-${VERSION}-$$.mbtiles"
MBTILES_LIGHT="${PMTILES_ROOT}/.tmp-build-light-${REGION}-${VERSION}-$$.mbtiles"
MBTILES_LABELS="${PMTILES_ROOT}/.tmp-build-labels-${REGION}-${VERSION}-$$.mbtiles"
MBTILES_STREETS="${PMTILES_ROOT}/.tmp-build-streets-${REGION}-${VERSION}-$$.mbtiles"
MBTILES="${PMTILES_ROOT}/.tmp-build-${REGION}-${VERSION}-$$.mbtiles"
PMTILES_NEW="${OUT_DIR}/${REGION}-${VERSION}.pmtiles.new.$$"
CURRENT_NEW="${OUT_DIR}/current.json.new.$$"
PREPARE_PY="${SCRIPT_DIR}/prepare-tippecanoe-input.py"
VALIDATE_GEOJSON_PY="${SCRIPT_DIR}/validate-geojson.py"
VERIFY_BUILD_PY="${SCRIPT_DIR}/verify-pmtiles-build.py"
BUILD_MANIFEST="${OUT_DIR}/${REGION}-${VERSION}.build-manifest.json"
PMTILES_ADMIN_MAX_ZOOM=14
BUILD_STARTED_AT="$(date +%s)"
BUILD_SUCCESS=false
PMTILES_DEBUG="${PMTILES_DEBUG:-0}"
PMTILES_MIN_ZOOM="${PMTILES_MIN_ZOOM:-8}"
PMTILES_MAX_ZOOM="${PMTILES_MAX_ZOOM:-20}"
PMTILES_CURRENT_STAGE="starting"
PMTILES_LAST_CMD=""

LOG_DIR="${PMTILES_ROOT}/logs"
mkdir -p "$LOG_DIR"
BUILD_LOG="${LOG_DIR}/build-${REGION}-${VERSION}-$(date '+%Y%m%dT%H%M%S').log"
export PMTILES_BUILD_LOG="$BUILD_LOG"

# Tee all stdout/stderr to terminal and build log.
exec 3>&1 4>&2
exec > >(tee -a "$BUILD_LOG" >&3)
exec 2> >(tee -a "$BUILD_LOG" >&4)

export PMTILES_PIPELINE_SCOPE=build
export PMTILES_PIPELINE_STARTED_AT="$BUILD_STARTED_AT"
export PMTILES_STAGE_STARTED_AT="$BUILD_STARTED_AT"

# Stage milestones (source of truth). Rebuild maps build phase onto 25–100%.
if [[ "${PMTILES_REBUILD_ACTIVE:-0}" == "1" ]]; then
  PCT_INPUT=28.95
  PCT_VALIDATE=32.89
  PCT_PREPARE=38.42
  PCT_LIGHT=43.16
  PCT_STREETS=64.47
  PCT_LABELS=80.26
  PCT_FINALIZE=92.11
  PCT_DONE=100.00
else
  PCT_INPUT=5.00
  PCT_VALIDATE=15.00
  PCT_PREPARE=22.00
  PCT_LIGHT=28.00
  PCT_STREETS=55.00
  PCT_LABELS=75.00
  PCT_FINALIZE=90.00
  PCT_DONE=100.00
fi

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(timestamp)] [build] $*" >&2; }
debug() { [[ "$PMTILES_DEBUG" == "1" ]] && log "DEBUG: $*"; }

on_build_error() {
  local exit_code=$?
  local line="${1:-?}"
  local cmd="${2:-?}"
  pmtiles_pipeline_stop_watchers || true
  log "BUILD FAILED"
  log "  line: ${line}"
  log "  exit code: ${exit_code}"
  log "  stage: ${PMTILES_CURRENT_STAGE}"
  log "  command: ${cmd}"
  if [[ -n "${PMTILES_LAST_CMD}" ]]; then
    log "  last logged command: ${PMTILES_LAST_CMD}"
  fi
  log "  log file: ${BUILD_LOG}"
  exit "${exit_code}"
}
trap 'on_build_error ${LINENO} "${BASH_COMMAND}"' ERR

build_stage() {
  PMTILES_CURRENT_STAGE="$2"
  pmtiles_stage "$1" "$2"
}

run_logged() {
  local name="$1"
  shift
  PMTILES_CURRENT_STAGE="${name}"
  PMTILES_LAST_CMD="$(printf '%q ' "$@")"
  if [[ -z "${PMTILES_TICKER_PID:-}" ]]; then
    log "running: ${name}"
    pmtiles_stage_note "command: ${PMTILES_LAST_CMD}"
  fi
  "$@"
}

run_tippecanoe_tickered() {
  local pct_start="$1"
  local pct_end="$2"
  local stage_label="$3"
  shift 3

  PMTILES_CURRENT_STAGE="${stage_label}"
  PMTILES_LAST_CMD="$(printf '%q ' "$@")"
  log "running tippecanoe: ${stage_label}"
  log "  ${PMTILES_LAST_CMD}"

  pmtiles_ticker_start "$pct_start" "$pct_end" "${stage_label}"
  pmtiles_run_tippecanoe "${stage_label}" "$@"
  pmtiles_ticker_stop
}

close_log_fds() {
  exec 3>&- 4>&- 2>/dev/null || true
}

cleanup() {
  pmtiles_pipeline_stop_watchers || true
  if [[ "$BUILD_SUCCESS" != "true" ]]; then
    log "cleanup after failure: removing temp prep/mbtiles (keeps exports/ and published .pmtiles)"
    log "failure log preserved at: ${BUILD_LOG}"
  fi
  rm -rf "$PREP_DIR"
  rm -f "$MBTILES_ADMIN" "$MBTILES_LIGHT" "$MBTILES_LABELS" "$MBTILES_STREETS" "$MBTILES" "$PMTILES_NEW" "$CURRENT_NEW"
  close_log_fds
}

feature_count() {
  python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("features", [])))' "$1"
}

human_size() { ls -lh "$1" | awk '{print $5}'; }

collect_validation_inputs_json() {
  python3 - "$EXPORTS" "${LAYERS[@]}" <<'PY'
import json
import sys
from pathlib import Path

exports = Path(sys.argv[1])
layers = sys.argv[2:]
out: dict[str, dict[str, int]] = {}
for base in layers:
    path = exports / f"{base}.geojson"
    stat = path.stat()
    out[f"{base}.geojson"] = {"size_bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}
print(json.dumps(out))
PY
}

print_prepare_stats() {
  local base="$1"
  local stats="${PREP_DIR}/${base}.annotated.geojsonseq.stats.json"
  [[ -f "$stats" ]] || return 0
  python3 - "$stats" <<'PY'
import json, sys
stats = json.load(open(sys.argv[1], encoding="utf-8"))
layer = stats["layer"]
before = stats["input_features"]
after = stats["output_features"]
visible = stats.get("visible_at_zoom", {})
print(f"  {layer:22s} before={before:>8d}  after={after:>8d}  "
      f"visible@z8={visible.get('8', before):>8}  "
      f"z10={visible.get('10', before):>8}  "
      f"z12={visible.get('12', before):>8}  "
      f"z14={visible.get('14', before):>8}")
if layer == "streets" and stats.get("road_class_histogram"):
    top = list(stats["road_class_histogram"].items())[:6]
    summary = ", ".join(f"{k}={v}" for k, v in top)
    print(f"  {'':22s} top classes: {summary}")
PY
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  local_map_log_database_url_host
fi

echo "" >&2
log "region=${REGION} version=${VERSION} zoom=z${PMTILES_MIN_ZOOM}-z${PMTILES_MAX_ZOOM}"
log "source=${EXPORTS}/ output=${OUT_PMTILES}"
if [[ "$ROADS_ONLY" == "1" && "$LIGHT_ONLY" == "1" ]]; then
  echo "error: --roads-only and --light-only are mutually exclusive" >&2
  exit 1
fi
if [[ "$ROADS_ONLY" == "1" ]]; then
  BUILD_MODE="roads-only"
elif [[ "$LIGHT_ONLY" == "1" ]]; then
  BUILD_MODE="light-only"
elif [[ "$SKIP_BUILDINGS" == "1" ]]; then
  BUILD_MODE="skip-buildings"
else
  BUILD_MODE="full"
fi

log "mode: ${BUILD_MODE} estimated_progress_ticker=$([[ "${PMTILES_PROGRESS_TICKER_ENABLED:-1}" == "1" ]] && echo on || echo off)"
log "log file: ${BUILD_LOG}"
echo "" >&2

for cmd in tippecanoe tile-join pmtiles python3 ogr2ogr ogrinfo; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "error: '${cmd}' not found (brew install gdal tippecanoe pmtiles)" >&2
    exit 1
  }
done

ALL_LAYERS=(
  buildings streets road_labels water_polygons water_lines
  landuse admin_boundaries admin_areas admin_area_label_points village_labels
)

INVENTORY_LAYERS=(
  streets road_labels admin_areas admin_boundaries admin_area_label_points
  buildings landuse water_lines water_polygons
)

LIGHT_LAYER_BASES=(
  buildings water_polygons water_lines landuse admin_boundaries admin_areas
  admin_area_label_points village_labels
)

LAYERS=()
if [[ "$ROADS_ONLY" == "1" ]]; then
  LAYERS=(streets road_labels)
  log "roads-only: streets + road_labels (no admin/water/landuse)"
elif [[ "$LIGHT_ONLY" == "1" ]]; then
  LAYERS=("${LIGHT_LAYER_BASES[@]}")
  log "light-only: admin/water/landuse/buildings (no streets or road_labels)"
else
  LAYERS=("${ALL_LAYERS[@]}")
  if [[ "$SKIP_BUILDINGS" == "1" ]]; then
    filtered=()
    for base in "${LAYERS[@]}"; do
      [[ "$base" != "buildings" ]] && filtered+=("$base")
    done
    LAYERS=("${filtered[@]}")
    log "skip-buildings: all layers except buildings"
  fi
fi

for base in "${LAYERS[@]}"; do
  [[ -f "${EXPORTS}/${base}.geojson" ]] || {
    echo "error: missing ${EXPORTS}/${base}.geojson — run: npm run tiles:export -- ${REGION} ${VERSION}" >&2
    exit 1
  }
done

build_stage "$PCT_INPUT" "input inventory"
printf '  %-22s %8s %12s\n' "layer" "size" "features" >&2
for base in "${INVENTORY_LAYERS[@]}"; do
  f="${EXPORTS}/${base}.geojson"
  if [[ -f "$f" ]]; then
    printf '  %-22s %8s %12s\n' "${base}.geojson" "$(human_size "$f")" "$(feature_count "$f")" >&2
  else
    printf '  %-22s %8s %12s\n' "${base}.geojson" "—" "missing" >&2
  fi
done
echo "" >&2

build_stage "$PCT_VALIDATE" "validating GeoJSON"
for base in "${LAYERS[@]}"; do
  run_logged "validate GeoJSON: ${base}" python3 "$VALIDATE_GEOJSON_PY" \
    "${EXPORTS}/${base}.geojson" \
    --manifest "$BUILD_MANIFEST" \
    --layer "${base}.geojson"
done
pmtiles_stage_note "validated ${#LAYERS[@]} layer(s) (full parse under ${PMTILES_GEOJSON_FULL_VALIDATE_MAX_BYTES:-33554432} bytes, else ogrinfo)"

mkdir -p "$OUT_DIR"
trap cleanup EXIT

rm -rf "$PREP_DIR"
mkdir -p "$PREP_DIR"
rm -f "$MBTILES_LIGHT" "$MBTILES_LABELS" "$MBTILES_STREETS" "$MBTILES" "$PMTILES_NEW" "$CURRENT_NEW"

build_stage "$PCT_PREPARE" "preparing GeoJSONSeq + zoom hints"
pmtiles_ticker_start "$PCT_PREPARE" "$PCT_LIGHT" "preparing GeoJSONSeq + zoom hints"

LIGHT_LAYERS=()
HAS_STREETS=0
HAS_LABELS=0
prepare_i=0
for base in "${LAYERS[@]}"; do
  prepare_i=$((prepare_i + 1))
  src="${EXPORTS}/${base}.geojson"
  seq_in="${PREP_DIR}/${base}.geojsonseq"
  seq_out="${PREP_DIR}/${base}.annotated.geojsonseq"

  case "$base" in
    streets)
      run_logged "ogr2ogr streets GeoJSONSeq" ogr2ogr -overwrite -f GeoJSONSeq "$seq_in" "$src"
      run_logged "prepare-tippecanoe streets" python3 "$PREPARE_PY" "$base" "$seq_in" "$seq_out"
      HAS_STREETS=1
      ;;
    road_labels)
      count="$(feature_count "$src")"
      if [[ "$count" == "0" ]]; then
        log "road_labels: 0 features — skipping label tile pass (streets layer still included)"
        : >"$seq_out"
      else
        run_logged "ogr2ogr road_labels GeoJSONSeq" ogr2ogr -overwrite -f GeoJSONSeq "$seq_in" "$src"
        run_logged "prepare-tippecanoe road_labels" python3 "$PREPARE_PY" "$base" "$seq_in" "$seq_out"
        HAS_LABELS=1
      fi
      ;;
    *)
      count="$(feature_count "$src")"
      if [[ "$count" == "0" ]]; then
        : >"$seq_out"
      elif [[ "$base" == "admin_areas" || "$base" == "admin_boundaries" ]]; then
        run_logged "ogr2ogr ${base} GeoJSONSeq" ogr2ogr -overwrite -f GeoJSONSeq "$seq_in" "$src"
        run_logged "prepare-tippecanoe ${base}" python3 "$PREPARE_PY" "$base" "$seq_in" "$seq_out"
        LIGHT_LAYERS+=("$base")
      else
        run_logged "prepare-tippecanoe ${base}" python3 "$PREPARE_PY" "$base" "$src" "$seq_out"
        LIGHT_LAYERS+=("$base")
      fi
      ;;
  esac
done
pmtiles_ticker_stop

echo "" >&2
log "prepare summary (mode=${BUILD_MODE}): before/after features + tippecanoe visibility"
printf '  %-22s %s\n' "layer" "before/after + visible@z8/z10/z12/z14" >&2
for base in "${LAYERS[@]}"; do
  print_prepare_stats "$base"
done
echo "" >&2

common_flags=(
  tippecanoe --force -pC
  "--minimum-zoom=${PMTILES_MIN_ZOOM}"
  "--maximum-zoom=${PMTILES_MAX_ZOOM}"
  --drop-densest-as-needed
  --attribution="Local Map"
)

ADMIN_LIGHT=()
NON_ADMIN_LIGHT=()
for base in "${LIGHT_LAYERS[@]}"; do
  case "$base" in
    admin_areas|admin_boundaries) ADMIN_LIGHT+=("$base") ;;
    *) NON_ADMIN_LIGHT+=("$base") ;;
  esac
done

HAS_ADMIN_LIGHT=0
HAS_NON_ADMIN_LIGHT=0
HAS_LIGHT=0
[[ ${#ADMIN_LIGHT[@]} -gt 0 ]] && HAS_ADMIN_LIGHT=1
[[ ${#NON_ADMIN_LIGHT[@]} -gt 0 ]] && HAS_NON_ADMIN_LIGHT=1
[[ "$HAS_ADMIN_LIGHT" == "1" || "$HAS_NON_ADMIN_LIGHT" == "1" ]] && HAS_LIGHT=1

LIGHT_TICKER_END="$PCT_STREETS"
[[ "$LIGHT_ONLY" == "1" ]] && LIGHT_TICKER_END="$PCT_FINALIZE"
ADMIN_TICKER_END="$LIGHT_TICKER_END"
if [[ "$HAS_ADMIN_LIGHT" == "1" && "$HAS_NON_ADMIN_LIGHT" == "1" ]]; then
  ADMIN_TICKER_END="$(awk -v a="$PCT_LIGHT" -v b="$LIGHT_TICKER_END" 'BEGIN { printf "%.2f", (a + b) / 2 }')"
fi
NON_ADMIN_LIGHT_START="$PCT_LIGHT"
[[ "$HAS_ADMIN_LIGHT" == "1" ]] && NON_ADMIN_LIGHT_START="$ADMIN_TICKER_END"

admin_common_flags=(
  tippecanoe --force -pC
  "--minimum-zoom=${PMTILES_MIN_ZOOM}"
  "--maximum-zoom=${PMTILES_ADMIN_MAX_ZOOM}"
  --drop-densest-as-needed
  --attribution="Local Map"
)

if [[ "$HAS_ADMIN_LIGHT" == "1" ]]; then
  build_stage "$PCT_LIGHT" "building admin layers (admin_areas/admin_boundaries, max z${PMTILES_ADMIN_MAX_ZOOM})"
  admin_named=()
  for base in "${ADMIN_LIGHT[@]}"; do
    admin_named+=(--named-layer="${base}:${PREP_DIR}/${base}.annotated.geojsonseq")
  done
  admin_cmd=("${admin_common_flags[@]}" -o "$MBTILES_ADMIN" "${admin_named[@]}")
  run_tippecanoe_tickered "$PCT_LIGHT" "$ADMIN_TICKER_END" "building admin layers (z14)" "${admin_cmd[@]}"
fi

if [[ "$HAS_NON_ADMIN_LIGHT" == "1" ]]; then
  build_stage "$NON_ADMIN_LIGHT_START" "building light layers (water/landuse/buildings/labels)"
  light_named=()
  for base in "${NON_ADMIN_LIGHT[@]}"; do
    light_named+=(--named-layer="${base}:${PREP_DIR}/${base}.annotated.geojsonseq")
  done
  light_cmd=("${common_flags[@]}" -o "$MBTILES_LIGHT" "${light_named[@]}")
  run_tippecanoe_tickered "$NON_ADMIN_LIGHT_START" "$LIGHT_TICKER_END" "building light layers" "${light_cmd[@]}"
fi

if [[ "$HAS_STREETS" == "1" ]]; then
  build_stage "$PCT_STREETS" "building roads (streets dense pass)"
  # Per-feature minzoom hints reduce low/mid zoom density; coalesce instead of drop at high zoom.
  streets_cmd=(
    tippecanoe --force -pC
    "--minimum-zoom=${PMTILES_MIN_ZOOM}"
    "--maximum-zoom=${PMTILES_MAX_ZOOM}"
    --coalesce-densest-as-needed
    --coalesce-smallest-as-needed
    --simplify-only-low-zooms
    --simplification=10
    --no-feature-limit
    --maximum-tile-bytes=750000
    --read-parallel
    --reorder
    --attribution="Local Map"
    -l streets
    -o "$MBTILES_STREETS"
    "${PREP_DIR}/streets.annotated.geojsonseq"
  )
  run_tippecanoe_tickered "$PCT_STREETS" "$PCT_LABELS" "building roads" "${streets_cmd[@]}"
fi

if [[ "$HAS_LABELS" == "1" ]]; then
  build_stage "$PCT_LABELS" "building road labels"
  labels_cmd=(
    "${common_flags[@]}"
    -o "$MBTILES_LABELS"
    --named-layer="road_labels:${PREP_DIR}/road_labels.annotated.geojsonseq"
  )
  run_tippecanoe_tickered "$PCT_LABELS" "$PCT_FINALIZE" "building road labels" "${labels_cmd[@]}"
fi

join_inputs=()
[[ "$HAS_ADMIN_LIGHT" == "1" && -f "$MBTILES_ADMIN" ]] && join_inputs+=("$MBTILES_ADMIN")
[[ "$HAS_NON_ADMIN_LIGHT" == "1" && -f "$MBTILES_LIGHT" ]] && join_inputs+=("$MBTILES_LIGHT")
[[ "$HAS_STREETS" == "1" && -f "$MBTILES_STREETS" ]] && join_inputs+=("$MBTILES_STREETS")
[[ "$HAS_LABELS" == "1" && -f "$MBTILES_LABELS" ]] && join_inputs+=("$MBTILES_LABELS")

if [[ ${#join_inputs[@]} -eq 0 ]]; then
  echo "error: no mbtiles produced" >&2
  exit 1
fi

build_stage "$PCT_FINALIZE" "finalizing PMTiles"
pmtiles_ticker_start "$PCT_FINALIZE" "$PCT_DONE" "finalizing PMTiles"

if [[ ${#join_inputs[@]} -eq 1 ]]; then
  pmtiles_stage_start "copy single mbtiles"
  pmtiles_heartbeat_start "finalize" "$MBTILES"
  run_logged "copy single mbtiles" cp -f "${join_inputs[0]}" "$MBTILES"
  pmtiles_heartbeat_stop
  pmtiles_stage_finish "copy single mbtiles ($(human_size "$MBTILES"))"
else
  pmtiles_stage_start "tile-join"
  pmtiles_heartbeat_start "tile-join" "$MBTILES"
  run_logged "tile-join" tile-join -f -o "$MBTILES" "${join_inputs[@]}"
  pmtiles_heartbeat_stop
  pmtiles_stage_finish "tile-join ($(human_size "$MBTILES"))"
fi

pmtiles_stage_start "pmtiles convert"
pmtiles_heartbeat_start "pmtiles convert" "$PMTILES_NEW"
run_logged "pmtiles convert" pmtiles convert "$MBTILES" "$PMTILES_NEW"
pmtiles_heartbeat_stop
pmtiles_stage_finish "pmtiles convert ($(human_size "$PMTILES_NEW"))"
pmtiles_ticker_stop

mv -f "$PMTILES_NEW" "$OUT_PMTILES"
BASE_URL="${BASE_URL:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"
filename="${REGION}-${VERSION}.pmtiles"
url="${BASE_URL}/regions/${REGION}/${filename}"
CURRENT="${OUT_DIR}/current.json"

PMTILES_RECOMMENDED_MAP_MAX_ZOOM="${PMTILES_RECOMMENDED_MAP_MAX_ZOOM:-20}"
{
  printf '{\n  "region": "%s",\n  "version": "%s",\n  "filename": "%s",\n  "url": "%s",\n  "minZoom": %s,\n  "maxZoom": %s,\n  "minzoom": %s,\n  "maxzoom": %s,\n  "nativeMaxzoom": %s,\n  "recommendedMapMaxZoom": %s\n}\n' \
    "$REGION" "$VERSION" "$filename" "$url" \
    "$PMTILES_MIN_ZOOM" "$PMTILES_MAX_ZOOM" \
    "$PMTILES_MIN_ZOOM" "$PMTILES_MAX_ZOOM" \
    "$PMTILES_MAX_ZOOM" "$PMTILES_RECOMMENDED_MAP_MAX_ZOOM"
} >"$CURRENT_NEW"
mv -f "$CURRENT_NEW" "$CURRENT"

VALIDATION_INPUTS_JSON="$(collect_validation_inputs_json)"
run_logged "verify PMTiles output" python3 "$VERIFY_BUILD_PY" \
  "$REGION" "$VERSION" "$OUT_PMTILES" "$VALIDATION_INPUTS_JSON"

trap - EXIT
rm -rf "$PREP_DIR"
rm -f "$MBTILES_ADMIN" "$MBTILES_LIGHT" "$MBTILES_LABELS" "$MBTILES_STREETS" "$MBTILES"
BUILD_SUCCESS=true

build_stage "$PCT_DONE" "done"
log "SUCCESS output=${OUT_PMTILES} size=$(human_size "$OUT_PMTILES")"
log "build manifest=${BUILD_MANIFEST}"
log "current.json=${CURRENT}"
log "inspect layers: pmtiles show ${OUT_PMTILES}"
log "build log: ${BUILD_LOG}"
