# shellcheck shell=bash
# Shared helpers for tools/routing/smoke-test-*.sh

routing_lib_init() {
    ROUTING_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ROUTING_TOOLS_ROOT="${ROUTING_LIB_DIR}"
    REPO_ROOT="$(cd "${ROUTING_LIB_DIR}/../.." && pwd)" # tools/routing -> repo root
    VALHALLA_SCRIPTS_DIR="${REPO_ROOT}/infrastructure/routing/valhalla/scripts"

    API_URL="${API_URL:-http://localhost:${PORT:-3001}}"
    VALHALLA_BASE_URL="${VALHALLA_BASE_URL:-http://127.0.0.1:8002}"

    ROUTING_PASS=0
    ROUTING_FAIL=0
}

routing_load_env() {
    local f
    for f in "${REPO_ROOT}/apps/api/.env" "${REPO_ROOT}/.env"; do
        if [[ -f "${f}" ]]; then
            # shellcheck disable=SC1090
            set -a
            source "${f}"
            set +a
            API_URL="${API_URL:-http://localhost:${PORT:-3001}}"
            VALHALLA_BASE_URL="${VALHALLA_BASE_URL:-http://127.0.0.1:8002}"
            return 0
        fi
    done
    return 0
}

routing_require_cmd() {
    local cmd="$1"
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "error: required command not found: ${cmd}" >&2
        exit 1
    fi
}

routing_tmp_response() {
    mktemp "${TMPDIR:-/tmp}/coremap-routing-smoke.XXXXXX"
}

routing_pass() {
    ROUTING_PASS=$((ROUTING_PASS + 1))
    echo "  ok: $*"
}

routing_fail() {
    ROUTING_FAIL=$((ROUTING_FAIL + 1))
    echo "  FAIL: $*" >&2
}

routing_summary() {
    echo ""
    echo "==> Summary: ${ROUTING_PASS} passed, ${ROUTING_FAIL} failed"
    if [[ "${ROUTING_FAIL}" -gt 0 ]]; then
        return 1
    fi
    return 0
}

# POST JSON; prints "HTTP_CODE" on first line, body in file at $2
routing_curl_json() {
    local method="$1"
    local url="$2"
    local body_file="$3"
    local body="${4:-}"

    local curl_args=(-sS -o "${body_file}" -w "%{http_code}")
    if [[ -n "${body}" ]]; then
        curl_args+=(-H "Content-Type: application/json" -d "${body}")
    fi
    if [[ "${method}" != "GET" ]]; then
        curl_args+=(-X "${method}")
    fi

    local http_code
    http_code="$(curl "${curl_args[@]}" "${url}")"
    printf '%s' "${http_code}"
}

# Myanmar fixture coordinates (lat / lng) — OSM road graph dependent.
readonly KYAUKTAN_LAT=16.6590
readonly KYAUKTAN_LNG=96.3168
readonly KYAUKTAN_LOCAL_LAT=16.6520
readonly KYAUKTAN_LOCAL_LNG=96.3220
readonly THANLYIN_LAT=16.7551
readonly THANLYIN_LNG=96.2575
readonly YANGON_LAT=16.8661
readonly YANGON_LNG=96.1951
readonly BAGO_LAT=17.3220
readonly BAGO_LNG=96.4663
readonly MANDALAY_LAT=21.9588
readonly MANDALAY_LNG=96.0891

routing_json_get() {
    # usage: routing_json_get FILE dot.path (e.g. summary.distanceMeters)
    local file="$1"
    local path="$2"
    python3 - "${file}" "${path}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
cur = data
for key in sys.argv[2].split("."):
    if key:
        cur = cur[key]
print("" if cur is None else cur)
PY
}
