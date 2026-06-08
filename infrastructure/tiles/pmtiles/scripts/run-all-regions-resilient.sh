#!/usr/bin/env bash
# Export + build all regional PMTiles until every region succeeds.
#
# - Skips regions that already have a completed .pmtiles (PMTILES_SKIP_COMPLETED=1).
# - Yangon uses YANGON_VERSION when set (default v2).
# - Retries failed regions automatically; continues through errors per pass.
# - Waits if another tiles build/rebuild is already running.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/run-all-regions-resilient.sh [version]
#   npm run tiles:rebuild:regions:resilient -- v1
#
# Env:
#   YANGON_VERSION=v2          Yangon archive version (default v2)
#   PMTILES_SKIP_COMPLETED=1   Skip existing archives (default 1)
#   PMTILES_SKIP_MIN_BYTES=    Min file size to treat as complete (default 1 MiB)
#   RESILIENT_POLL_SECONDS=600 Poll interval while waiting (default 600 = 10 min)
#   RESILIENT_MAX_PASSES=      Max full passes (default unlimited)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_all-regions-common.sh"

VERSION="${1:-v1}"
export YANGON_VERSION="${YANGON_VERSION:-v2}"
export PMTILES_SKIP_COMPLETED="${PMTILES_SKIP_COMPLETED:-1}"
export PMTILES_ROOT="$PMTILES_ROOT"
POLL_SECONDS="${RESILIENT_POLL_SECONDS:-600}"
MAX_PASSES="${RESILIENT_MAX_PASSES:-0}"
LOG_DIR="${PMTILES_ROOT}/logs"
mkdir -p "$LOG_DIR"
SUPERVISOR_LOG="${LOG_DIR}/resilient-all-$(date '+%Y%m%dT%H%M%S').log"

exec > >(tee -a "$SUPERVISOR_LOG") 2>&1

resilient_now() { date '+%Y-%m-%d %H:%M:%S'; }

resilient_pipeline_busy() {
  pgrep -f 'infrastructure/tiles/pmtiles/scripts/(rebuild|build)-(region|all-regions)\.sh' >/dev/null 2>&1 \
    || pgrep -x tippecanoe >/dev/null 2>&1 \
    || pgrep -x tile-join >/dev/null 2>&1 \
    || pgrep -f 'pmtiles convert' >/dev/null 2>&1
}

resilient_wait_for_idle() {
  while resilient_pipeline_busy; do
    echo "[resilient] $(resilient_now) pipeline busy (tippecanoe/tile-join/build running) — next check in ${POLL_SECONDS}s"
    sleep "$POLL_SECONDS"
  done
}

resilient_incomplete_regions() {
  all_regions_list_incomplete "$VERSION"
}

resilient_count_incomplete() {
  resilient_incomplete_regions | sed '/^$/d' | wc -l | tr -d ' '
}

resilient_first_incomplete() {
  resilient_incomplete_regions | sed '/^$/d' | head -n 1
}

echo ""
echo "[resilient] started $(resilient_now)"
echo "[resilient] version=${VERSION} yangon_version=${YANGON_VERSION}"
echo "[resilient] skip_completed=${PMTILES_SKIP_COMPLETED} min_bytes=$(all_regions_min_complete_bytes)"
echo "[resilient] poll_seconds=${POLL_SECONDS}"
echo "[resilient] supervisor_log=${SUPERVISOR_LOG}"
echo "[resilient] regions: $(pmtiles_region_list_supported)"
echo ""

pass=0
while true; do
  pass=$((pass + 1))
  if [[ "$MAX_PASSES" -gt 0 && "$pass" -gt "$MAX_PASSES" ]]; then
    echo "[resilient] $(resilient_now) reached RESILIENT_MAX_PASSES=${MAX_PASSES}; stopping"
    exit 1
  fi

  incomplete="$(resilient_count_incomplete)"
  if [[ "$incomplete" -eq 0 ]]; then
    echo "[resilient] $(resilient_now) ALL REGIONS COMPLETE (pass=${pass})"
    for region in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
      local_ver="$(all_regions_resolve_version "$region" "$VERSION")"
      out="${PMTILES_ROOT}/regions/${region}/${region}-${local_ver}.pmtiles"
      echo "[resilient]   ${region} ${local_ver}: $(all_regions_human_size "$out")"
    done
    exit 0
  fi

  start_region="$(resilient_first_incomplete)"
  echo "[resilient] $(resilient_now) pass=${pass} incomplete=${incomplete} next_start=${start_region:-<none>}"
  resilient_incomplete_regions | sed 's/^/[resilient]   pending: /'

  resilient_wait_for_idle

  echo "[resilient] $(resilient_now) launching rebuild-all from ${start_region}"
  set +e
  bash "${SCRIPT_DIR}/rebuild-all-regions.sh" "$VERSION" "$start_region" --continue-on-error
  rc=$?
  set -e

  incomplete_after="$(resilient_count_incomplete)"
  echo "[resilient] $(resilient_now) pass=${pass} finished rc=${rc} incomplete=${incomplete_after}"

  if [[ "$incomplete_after" -eq 0 ]]; then
    echo "[resilient] $(resilient_now) ALL REGIONS COMPLETE"
    exit 0
  fi

  echo "[resilient] $(resilient_now) waiting ${POLL_SECONDS}s before retry pass"
  sleep "$POLL_SECONDS"
done
