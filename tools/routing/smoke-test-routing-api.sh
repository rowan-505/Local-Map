#!/usr/bin/env bash
# Smoke-test CoreMap Fastify POST /api/routing/route (Valhalla adapter).
# Requires: API with ROUTING_ENABLED=true, Valhalla up at VALHALLA_BASE_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

routing_lib_init
routing_load_env
routing_require_cmd curl
routing_require_cmd python3

API_BASE="${API_URL%/}"
ROUTE_URL="${API_BASE}/api/routing/route"
HEALTH_URL="${API_BASE}/api/routing/health"

echo "CoreMap routing API smoke tests"
echo "  API:     ${API_BASE}"
echo "  Valhalla env: ${VALHALLA_BASE_URL:-<unset>}"
echo "  ROUTING_ENABLED: ${ROUTING_ENABLED:-<unset>}"
echo ""

if [[ "${ROUTING_ENABLED:-false}" != "true" ]]; then
    echo "warn: ROUTING_ENABLED is not true — route success tests will likely return 503." >&2
    echo "      Set ROUTING_ENABLED=true in apps/api/.env and restart the API." >&2
    echo ""
fi

routing_api_route_request() {
    local name="$1"
    local profile="$2"
    local from_lat="$3"
    local from_lng="$4"
    local to_lat="$5"
    local to_lng="$6"
    local extra_json="${7:-}"

    local payload
    payload="$(python3 - "${profile}" "${from_lat}" "${from_lng}" "${to_lat}" "${to_lng}" "${extra_json}" <<'PY'
import json, sys
profile, flat, flng, tlat, tlng = sys.argv[1:6]
extra = json.loads(sys.argv[6] or "{}")
body = {
    "origin": {"lat": float(flat), "lng": float(flng)},
    "destination": {"lat": float(tlat), "lng": float(tlng)},
    "profile": profile,
    "preference": "fastest",
}
body.update(extra)
print(json.dumps(body))
PY
)"

    local resp http
    resp="$(routing_tmp_response)"
    http="$(routing_curl_json POST "${ROUTE_URL}" "${resp}" "${payload}")"

    echo "==> ${name} (profile=${profile}, HTTP ${http})"
    if [[ "${http}" != "200" ]]; then
        routing_fail "${name} expected HTTP 200, got ${http}"
        head -c 800 "${resp}" >&2 || true
        echo "" >&2
        rm -f "${resp}"
        return 1
    fi

    local status
    status="$(routing_json_get "${resp}" "status" 2>/dev/null || echo "")"
    if [[ "${status}" != "ok" && "${status}" != "no_route" ]]; then
        routing_fail "${name} expected status ok|no_route, got '${status}'"
        python3 -m json.tool "${resp}" 2>/dev/null | head -n 30 >&2 || cat "${resp}" >&2
        rm -f "${resp}"
        return 1
    fi

    local dist dur
    dist="$(routing_json_get "${resp}" "summary.distanceMeters")"
    dur="$(routing_json_get "${resp}" "summary.durationSeconds")"
    routing_pass "${name} status=${status} distance_m=${dist} duration_s=${dur}"
    rm -f "${resp}"
    return 0
}

routing_api_expect_http() {
    local name="$1"
    local expect_http="$2"
    local payload="$3"
    local expect_code="${4:-}"

    local resp http
    resp="$(routing_tmp_response)"
    http="$(routing_curl_json POST "${ROUTE_URL}" "${resp}" "${payload}")"

    echo "==> ${name} (expect HTTP ${expect_http})"
    if [[ "${http}" != "${expect_http}" ]]; then
        routing_fail "${name} expected HTTP ${expect_http}, got ${http}"
        cat "${resp}" >&2
        rm -f "${resp}"
        return 1
    fi

    if [[ -n "${expect_code}" ]]; then
        local code
        code="$(routing_json_get "${resp}" "code" 2>/dev/null || echo "")"
        if [[ "${code}" != "${expect_code}" ]]; then
            routing_fail "${name} expected code ${expect_code}, got '${code}'"
            cat "${resp}" >&2
            rm -f "${resp}"
            return 1
        fi
    fi

    routing_pass "${name} HTTP ${http}"
    rm -f "${resp}"
    return 0
}

# --- Health ---
resp="$(routing_tmp_response)"
http="$(routing_curl_json GET "${HEALTH_URL}" "${resp}")"
echo "==> GET /api/routing/health (HTTP ${http})"
if [[ "${http}" == "200" ]]; then
    routing_pass "routing health"
else
    routing_fail "routing health expected 200, got ${http}"
fi
rm -f "${resp}"

# --- Myanmar route matrix (walk / car / motorcycle) ---
if [[ "${SMOKE_API_VALIDATION_ONLY:-}" == "1" ]]; then
    echo "skip: route matrix (SMOKE_API_VALIDATION_ONLY=1)"
else
declare -a ROUTE_CASES=(
    "kyauktan-local-short|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${KYAUKTAN_LOCAL_LAT}|${KYAUKTAN_LOCAL_LNG}"
    "kyauktan-to-thanlyin|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${THANLYIN_LAT}|${THANLYIN_LNG}"
    "kyauktan-to-yangon-downtown|${KYAUKTAN_LAT}|${KYAUKTAN_LNG}|${YANGON_LAT}|${YANGON_LNG}"
    "yangon-to-bago|${YANGON_LAT}|${YANGON_LNG}|${BAGO_LAT}|${BAGO_LNG}"
    "yangon-to-mandalay|${YANGON_LAT}|${YANGON_LNG}|${MANDALAY_LAT}|${MANDALAY_LNG}"
)

for profile in walk car motorcycle; do
    for entry in "${ROUTE_CASES[@]}"; do
        IFS='|' read -r slug flat flng tlat tlng <<<"${entry}"
        routing_api_route_request "${slug} (${profile})" "${profile}" "${flat}" "${flng}" "${tlat}" "${tlng}" || true
    done
done
fi

# --- Validation / policy errors (400) ---
# Fastify route schema may return {message: "body/..."} before Zod ROUTING_VALIDATION_ERROR.
routing_api_expect_http "invalid coordinate (lat out of range)" 400 "$(cat <<EOF
{
  "origin": {"lat": 95, "lng": 96.2},
  "destination": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "profile": "walk"
}
EOF
)" "" || true

routing_api_expect_http "same origin and destination" 400 "$(cat <<EOF
{
  "origin": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "destination": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "profile": "walk"
}
EOF
)" "ROUTING_VALIDATION_ERROR" || true

routing_api_expect_http "disabled bus mode in allowedModes" 400 "$(cat <<EOF
{
  "origin": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "destination": {"lat": ${KYAUKTAN_LAT}, "lng": ${KYAUKTAN_LNG}},
  "profile": "car",
  "allowedModes": ["bus"]
}
EOF
)" "ROUTING_MODE_DISABLED" || true

# --- Routing disabled (503) when env says so ---
if [[ "${ROUTING_ENABLED:-false}" != "true" ]]; then
    routing_api_expect_http "routing disabled" 503 "$(cat <<EOF
{
  "origin": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "destination": {"lat": ${KYAUKTAN_LAT}, "lng": ${KYAUKTAN_LNG}},
  "profile": "walk"
}
EOF
)" "ROUTING_DISABLED" || true
fi

# --- Valhalla down (503) — opt-in: API enabled but engine unreachable ---
if [[ "${SMOKE_EXPECT_VALHALLA_DOWN:-}" == "1" ]]; then
    if [[ "${ROUTING_ENABLED:-false}" != "true" ]]; then
        echo "skip: SMOKE_EXPECT_VALHALLA_DOWN=1 but ROUTING_ENABLED is not true" >&2
    else
        echo "note: SMOKE_EXPECT_VALHALLA_DOWN=1 — ensure Valhalla is stopped or VALHALLA_BASE_URL is wrong on API." >&2
        routing_api_expect_http "valhalla unreachable" 503 "$(cat <<EOF
{
  "origin": {"lat": ${YANGON_LAT}, "lng": ${YANGON_LNG}},
  "destination": {"lat": ${KYAUKTAN_LAT}, "lng": ${KYAUKTAN_LNG}},
  "profile": "walk"
}
EOF
)" "ROUTING_ENGINE_UNAVAILABLE" || true
    fi
fi

routing_summary
exit $?
