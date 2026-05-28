#!/usr/bin/env bash
# Direct Valhalla HTTP smoke tests (no Fastify). Myanmar fixtures + costing matrix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

# Reuse Valhalla port/PBF helpers from infrastructure scripts.
# shellcheck source=../../infrastructure/routing/valhalla/scripts/_lib.sh
source "${SCRIPT_DIR}/../../infrastructure/routing/valhalla/scripts/_lib.sh"

routing_lib_init
valhalla_lib_init
valhalla_load_env_file
routing_load_env
routing_require_cmd curl
routing_require_cmd python3

BASE="$(valhalla_base_url)"
echo "Valhalla direct smoke tests"
echo "  base: ${BASE}"
echo ""

valhalla_direct_route() {
    local name="$1"
    local costing="$2"
    local from_lat="$3"
    local from_lon="$4"
    local to_lat="$5"
    local to_lon="$6"
    local expect_http="${7:-200}"

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

    local resp http
    resp="$(routing_tmp_response)"
    http="$(routing_curl_json POST "${BASE}/route" "${resp}" "${body}")"

    echo "==> ${name} (costing=${costing}, HTTP ${http})"
    if [[ "${http}" != "${expect_http}" ]]; then
        # Valhalla returns HTTP 400 for unroutable long trips (e.g. walk > 250km) — not a service outage.
        if [[ "${http}" == "400" ]]; then
            local err_code
            err_code="$(routing_json_get "${resp}" "error_code" 2>/dev/null || echo "")"
            if [[ "${err_code}" == "154" || "${err_code}" == "171" || "${err_code}" == "442" ]]; then
                routing_pass "${name} engine no_route (HTTP 400, error_code=${err_code})"
                rm -f "${resp}"
                return 0
            fi
        fi
        routing_fail "${name} expected HTTP ${expect_http}, got ${http}"
        head -c 600 "${resp}" >&2 || true
        echo "" >&2
        rm -f "${resp}"
        return 1
    fi

    if [[ "${expect_http}" == "200" ]]; then
        python3 - "${resp}" <<'PY' || { routing_fail "could not parse Valhalla trip"; exit 1; }
import json, sys
data = json.load(open(sys.argv[1]))
trip = data.get("trip") or {}
summary = trip.get("summary") or {}
if not summary and data.get("error"):
    raise SystemExit(f"Valhalla error: {data.get('error')}")
length = summary.get("length")
time_s = summary.get("time")
print(f"    distance_km={length}, duration_min={round(float(time_s or 0) / 60, 1)}")
PY
        routing_pass "${name}"
    else
        routing_pass "${name} HTTP ${http}"
    fi
    rm -f "${resp}"
}

# Status probe
resp="$(routing_tmp_response)"
http="$(routing_curl_json GET "${BASE}/status" "${resp}")"
echo "==> GET /status (HTTP ${http})"
if [[ "${http}" == "200" ]]; then
    routing_pass "valhalla status"
else
    routing_fail "valhalla status expected 200, got ${http} (is Valhalla running?)"
fi
rm -f "${resp}"

declare -a VALHALLA_CASES=(
    "kyauktan-local-short|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${KYAUKTAN_LOCAL_LAT}|${KYAUKTAN_LOCAL_LNG}"
    "kyauktan-to-thanlyin|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${THANLYIN_LAT}|${THANLYIN_LNG}"
    "kyauktan-to-yangon-downtown|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${YANGON_LAT}|${YANGON_LNG}"
    "yangon-to-bago|${YANGON_LAT}|${YANGON_LNG}|${BAGO_LAT}|${BAGO_LNG}"
    "yangon-to-mandalay|${YANGON_LAT}|${YANGON_LNG}|${MANDALAY_LAT}|${MANDALAY_LNG}"
)

valhalla_costing_for_mode() {
    case "$1" in
        walk) echo pedestrian ;;
        car) echo auto ;;
        motorcycle) echo motorcycle ;;
        *) echo auto ;;
    esac
}

for mode in walk car motorcycle; do
    costing="$(valhalla_costing_for_mode "${mode}")"
    for entry in "${VALHALLA_CASES[@]}"; do
        IFS='|' read -r slug flat flon tlat tlon <<<"${entry}"
        valhalla_direct_route "${slug} (${mode})" "${costing}" "${flat}" "${flon}" "${tlat}" "${tlon}" 200 || true
    done
done

# Invalid coordinate — Valhalla may return non-200 or error object in 200 body
echo "==> invalid coordinate (expect non-success)"
resp="$(routing_tmp_response)"
bad_body='{"locations":[{"lat":95,"lon":96.2},{"lat":16.87,"lon":96.2}],"costing":"auto"}'
http="$(routing_curl_json POST "${BASE}/route" "${resp}" "${bad_body}")"
if [[ "${http}" == "200" ]]; then
    if python3 - "${resp}" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
raise SystemExit(0 if d.get("error") or not (d.get("trip") or {}).get("summary") else 1)
PY
    then
        routing_pass "invalid coordinate rejected in body"
    else
        routing_fail "invalid coordinate returned trip success"
    fi
else
    routing_pass "invalid coordinate HTTP ${http}"
fi
rm -f "${resp}"

routing_summary
exit $?
