#!/usr/bin/env bash
# Build all 15 regional PMTiles from existing exports/ (no database export).
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/build-all-regions.sh <version> [start_region] [--continue-on-error]
#   npm run tiles:build:regions -- v1
#   YANGON_VERSION=v2 npm run tiles:build:regions -- v1
#
# Requires exports/<region>/*.geojson for each region. Use tiles:rebuild:regions for export + build.
# Logs: infrastructure/tiles/pmtiles/logs/build-all-<timestamp>.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_all-regions-common.sh"

all_regions_print_usage() {
  echo "usage: build-all-regions.sh <version> [start_region] [--continue-on-error] [build options]" >&2
  echo "env:  YANGON_VERSION=<ver>  CONTINUE_ON_ERROR=1" >&2
  echo "regions: $(pmtiles_region_list_supported)" >&2
  echo "note: build-only — run tiles:rebuild:regions when exports are missing or stale" >&2
}

all_regions_parse_args "$@"
all_regions_run_pipeline build build-all build-all
