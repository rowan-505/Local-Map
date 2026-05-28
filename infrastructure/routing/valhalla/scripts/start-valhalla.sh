#!/usr/bin/env bash
# Start Valhalla HTTP service (requires built tiles).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

valhalla_lib_init
valhalla_load_env_file
valhalla_require_compose
valhalla_require_built_tiles
valhalla_prepare_custom_files

export use_tiles_ignore_pbf=True
export force_rebuild=False
export force_rebuild_elevation=False

cd "${VALHALLA_ROOT}"

echo "==> Starting Valhalla on port ${VALHALLA_PORT} (data: ${VALHALLA_DATA_DIR})"
"${VALHALLA_COMPOSE[@]}" up -d valhalla

echo ""
echo "    Status: $(valhalla_base_url)/status"
echo "    Logs:   ${VALHALLA_COMPOSE[*]} logs -f valhalla"
echo "    Test:   ${VALHALLA_ROOT}/scripts/test-valhalla.sh"
