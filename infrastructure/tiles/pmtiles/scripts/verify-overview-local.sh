#!/usr/bin/env bash
# Sanity-check local overview PMTiles layout before starting the web app.
set -euo pipefail

PMTILES_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERVIEW_DIR="${PMTILES_ROOT}/overview/regions"
PMTILES_FILE="${OVERVIEW_DIR}/myanmar-overview-v1.pmtiles"
CURRENT_JSON="${PMTILES_ROOT}/overview/current.json"
SERVE_URL="${OVERVIEW_SERVE_URL:-http://localhost:8080}"
PMTILES_HTTP_URL="${SERVE_URL}/overview/regions/myanmar-overview-v1.pmtiles"
CURRENT_HTTP_URL="${SERVE_URL}/overview/current.json"

fail=0

echo "Overview PMTiles local verify"
echo "  expected file:  ${PMTILES_FILE}"
echo "  expected json:  ${CURRENT_JSON}"
echo ""

if [[ ! -f "$PMTILES_FILE" ]]; then
  echo "❌ Missing PMTiles file."
  echo "   Place myanmar-overview-v1.pmtiles at:"
  echo "   infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles"
  echo "   (The file is gitignored — copy or build it locally.)"
  fail=1
else
  size="$(wc -c < "$PMTILES_FILE" | tr -d ' ')"
  magic="$(head -c 7 "$PMTILES_FILE" || true)"
  if [[ "$magic" == "PMTiles" ]]; then
    echo "✅ PMTiles file present (${size} bytes, header looks valid)"
  else
    echo "⚠️  PMTiles file exists but header is not 'PMTiles' (got: ${magic})"
    fail=1
  fi
fi

if [[ ! -f "$CURRENT_JSON" ]]; then
  echo "❌ Missing current.json at ${CURRENT_JSON}"
  fail=1
else
  echo "✅ current.json present"
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import json, sys
path = "${CURRENT_JSON}"
with open(path) as f:
    doc = json.load(f)
url = doc.get("url", "")
if not url:
    print("❌ current.json: missing url field", file=sys.stderr)
    sys.exit(1)
print(f"   url field: {url}")
PY
  fi
fi

if command -v curl >/dev/null 2>&1; then
  echo ""
  echo "Optional HTTP checks (is 'npm run tiles:serve' running on ${SERVE_URL}?)"
  if curl -sf --max-time 3 "${CURRENT_HTTP_URL}" >/dev/null 2>&1; then
    echo "✅ GET ${CURRENT_HTTP_URL}"
  else
    echo "ℹ️  ${CURRENT_HTTP_URL} not reachable (start: npm run tiles:serve)"
  fi
  if curl -sf --max-time 3 -H "Range: bytes=0-6" "${PMTILES_HTTP_URL}" >/dev/null 2>&1; then
    echo "✅ GET ${PMTILES_HTTP_URL} (range request)"
  else
    echo "ℹ️  ${PMTILES_HTTP_URL} not reachable yet"
  fi
fi

if [[ -f "$PMTILES_FILE" ]] && command -v pmtiles >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "PMTiles metadata vs style registry:"
  if python3 "${PMTILES_ROOT}/scripts/validate-overview-pmtiles-metadata.py" "$PMTILES_FILE"; then
    :
  else
    fail=1
  fi
fi

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "Fix the issues above, then see docs/tiles/pmtiles/overview-local-dev.md"
  exit 1
fi

echo "Next:"
echo "  1. npm run tiles:serve          # terminal 1 — port 8080, CORS on"
echo "  2. cd apps/web && VITE_MAP_BASEMAP=overview npm run dev   # terminal 2"
echo "  3. Open http://localhost:5173 — Myanmar overview at z≈4.7"
