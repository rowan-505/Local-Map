#!/usr/bin/env bash
# Quick health check against local Valhalla.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

valhalla_lib_init
valhalla_load_env_file
valhalla_require_cmd curl

BASE="$(valhalla_base_url)"
STATUS_URL="${BASE}/status"

echo "==> GET ${STATUS_URL}"
http_code="$(curl -sS -o /tmp/coremap-valhalla-status.json -w "%{http_code}" "${STATUS_URL}" || true)"

if [[ "${http_code}" != "200" ]]; then
    echo "error: Valhalla status returned HTTP ${http_code}" >&2
    echo "  Is the service running? Try: ${VALHALLA_ROOT}/scripts/start-valhalla.sh" >&2
    cat /tmp/coremap-valhalla-status.json 2>/dev/null || true
    exit 1
fi

echo "ok: Valhalla responded HTTP 200"
if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool /tmp/coremap-valhalla-status.json 2>/dev/null | head -n 20 || cat /tmp/coremap-valhalla-status.json
else
    head -c 500 /tmp/coremap-valhalla-status.json
    echo ""
fi

echo ""
echo "Sample route (auto, Yangon) — POST ${BASE}/route"
curl -sS "${BASE}/route" \
    -H "Content-Type: application/json" \
    -d '{
  "locations": [
    {"lat": 16.8661, "lon": 96.1951},
    {"lat": 16.8409, "lon": 96.1735}
  ],
  "costing": "auto",
  "directions_options": {"units": "kilometers"}
}' | {
    if command -v python3 >/dev/null 2>&1; then
        python3 -m json.tool | head -n 40
    else
        head -c 1200
        echo ""
    fi
}

echo ""
echo "For more checks: ${VALHALLA_ROOT}/scripts/smoke-test-routes.sh"
