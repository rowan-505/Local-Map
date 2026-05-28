#!/usr/bin/env bash
# Build Valhalla routing tiles from a local OSM PBF (first run or forced rebuild).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

valhalla_lib_init
valhalla_load_env_file
valhalla_require_compose
valhalla_require_pbf
valhalla_prepare_custom_files

echo "==> CoreMap Valhalla tile build"
echo "    PBF:  ${VALHALLA_PBF_PATH}"
echo "    data: ${VALHALLA_DATA_DIR}"
echo "    bbox: ${VALHALLA_MIN_X},${VALHALLA_MIN_Y} .. ${VALHALLA_MAX_X},${VALHALLA_MAX_Y}"
echo ""
echo "    Myanmar country extract can take a long time and significant RAM/disk."
echo "    For faster iteration, use a regional PBF and tighten VALHALLA_MIN_* / VALHALLA_MAX_*."
echo ""

export use_tiles_ignore_pbf=False
export force_rebuild=True
export force_rebuild_elevation="${force_rebuild_elevation:-False}"
export build_elevation="${build_elevation:-False}"
export build_admins="${build_admins:-True}"
export build_time_zones="${build_time_zones:-True}"

cd "${VALHALLA_ROOT}"

"${VALHALLA_COMPOSE[@]}" down --remove-orphans 2>/dev/null || true

echo "==> Starting build container (logs follow; first build may take hours)..."
"${VALHALLA_COMPOSE[@]}" up --abort-on-container-exit valhalla
exit_code=$?
"${VALHALLA_COMPOSE[@]}" down --remove-orphans 2>/dev/null || true

if ! valhalla_has_built_tiles; then
    echo "error: build finished but no valhalla_tiles/ or valhalla_tiles.tar in ${VALHALLA_DATA_DIR}." >&2
    exit "${exit_code:-1}"
fi

echo ""
echo "==> Build complete."
echo "    Start service: ${VALHALLA_ROOT}/scripts/start-valhalla.sh"

exit "${exit_code}"
