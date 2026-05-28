#!/usr/bin/env bash
# Smoke-test walk / auto / motorcycle routes against local Valhalla.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

valhalla_lib_init
valhalla_load_env_file
valhalla_require_cmd curl

BASE="$(valhalla_base_url)"

valhalla_route_smoke() {
    local name="$1"
    local costing="$2"
    local from_lat="$3"
    local from_lon="$4"
    local to_lat="$5"
    local to_lon="$6"

    echo "==> ${name} (costing=${costing})"
    local body
    body="$(cat <<EOF
{
  "locations": [
    {"lat": ${from_lat}, "lon": ${from_lon}},
    {"lat": ${to_lat}, "lon": ${to_lon}}
  ],
  "costing": "${costing}",
  "directions_options": {"units": "kilometers"}
}
EOF
)"

    local response http_code
    response="$(mktemp)"
    http_code="$(curl -sS -o "${response}" -w "%{http_code}" \
        -H "Content-Type: application/json" \
        -d "${body}" \
        "${BASE}/route")"

    if [[ "${http_code}" != "200" ]]; then
        echo "error: ${name} failed HTTP ${http_code}" >&2
        cat "${response}" >&2
        rm -f "${response}"
        return 1
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 - "${response}" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
trip = data.get("trip", {})
summary = trip.get("summary", {})
print(
    f"    distance_km={summary.get('length', '?')}, "
    f"duration_min={round(float(summary.get('time', 0)) / 60, 1)}"
)
PY
    else
        echo "    (install python3 for summary parsing)"
    fi
    rm -f "${response}"
    echo ""
}

echo "Smoke tests against ${BASE}"
echo ""

# Yangon: downtown-ish segment
FROM_LAT=16.8661
FROM_LON=96.1951
TO_LAT=16.8409
TO_LON=96.1735

failures=0
valhalla_route_smoke "Yangon walk" "pedestrian" "${FROM_LAT}" "${FROM_LON}" "${TO_LAT}" "${TO_LON}" || failures=$((failures + 1))
valhalla_route_smoke "Yangon auto" "auto" "${FROM_LAT}" "${FROM_LON}" "${TO_LAT}" "${TO_LON}" || failures=$((failures + 1))
valhalla_route_smoke "Yangon motorcycle" "motorcycle" "${FROM_LAT}" "${FROM_LON}" "${TO_LAT}" "${TO_LON}" || failures=$((failures + 1))

if [[ "${failures}" -gt 0 ]]; then
    echo "error: ${failures} smoke test(s) failed." >&2
    exit 1
fi

echo "All smoke tests passed."
