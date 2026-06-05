#!/usr/bin/env bash
# Clip Natural Earth (incl. Myanmar highlight) and rebuild overview PMTiles.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/rebuild-overview.sh [version]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
VERSION="${1:-v1}"

bash "${REPO_ROOT}/infrastructure/tiles/scripts/clip-natural-earth-overview.sh"
bash "${SCRIPT_DIR}/build-overview.sh" "$VERSION"
