#!/usr/bin/env bash
# Export + build all 15 regional PMTiles sequentially (overview untouched).
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/rebuild-all-regions.sh <version> [start_region] [--continue-on-error]
#   npm run tiles:rebuild:regions -- v1
#   YANGON_VERSION=v2 npm run tiles:rebuild:regions -- v1
#   CONTINUE_ON_ERROR=1 npm run tiles:rebuild:regions -- v1
#
# Per-region version: all regions use <version> except Yangon when YANGON_VERSION is set.
# PMTILES_SKIP_COMPLETED=1 skips regions whose .pmtiles already exists (>= 1 MiB).
# For unattended full-country runs: npm run tiles:rebuild:regions:resilient -- v1
# Default: stop on first failure. Logs: infrastructure/tiles/pmtiles/logs/rebuild-all-<timestamp>.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_all-regions-common.sh"

all_regions_print_usage() {
  echo "usage: rebuild-all-regions.sh <version> [start_region] [--continue-on-error] [build options]" >&2
  echo "env:  YANGON_VERSION=<ver>  CONTINUE_ON_ERROR=1" >&2
  echo "regions: $(pmtiles_region_list_supported)" >&2
  echo "example: YANGON_VERSION=v2 bash rebuild-all-regions.sh v1" >&2
}

all_regions_parse_args "$@"
all_regions_run_pipeline rebuild rebuild-all rebuild-all
