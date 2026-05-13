#!/usr/bin/env bash
# Local static server for the PMTiles tree (same URL layout as CDN / R2).
set -euo pipefail

PMTILES_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PMTILES_ROOT/../../.." && pwd)"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: npx not found. Install Node.js so npx is available." >&2
  exit 1
fi

echo "" >&2
echo "  Local PMTiles static server" >&2
echo "  --------------------------" >&2
echo "  Repo root:     ${REPO_ROOT}" >&2
echo "  Served path:   infrastructure/tiles/pmtiles" >&2
echo "  Listen:        http://localhost:8080" >&2
echo "  CORS:          enabled (--cors)" >&2
echo "" >&2
echo "  Example URLs (Yangon region):" >&2
echo "    http://localhost:8080/regions/yangon/current.json" >&2
echo "    http://localhost:8080/regions/yangon/yangon-v1.pmtiles" >&2
echo "" >&2
echo "  Command: npx serve infrastructure/tiles/pmtiles -l 8080 --cors" >&2
echo "" >&2

cd "$REPO_ROOT"
exec npx --yes serve infrastructure/tiles/pmtiles -l 8080 --cors
