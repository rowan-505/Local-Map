# shellcheck shell=bash
# Shared helpers for infrastructure/routing/valhalla/scripts/*.sh

valhalla_lib_init() {
    VALHALLA_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    VALHALLA_ROOT="$(cd "${VALHALLA_LIB_DIR}/.." && pwd)"
    VALHALLA_CONFIG_DIR="${VALHALLA_ROOT}/config"
    VALHALLA_COMPOSE_FILE="${VALHALLA_ROOT}/docker-compose.yml"

    VALHALLA_PORT="${VALHALLA_PORT:-8002}"
    VALHALLA_DATA_DIR="${VALHALLA_DATA_DIR:-${VALHALLA_ROOT}/data/builds}"
    VALHALLA_PBF_PATH="${VALHALLA_PBF_PATH:-${VALHALLA_ROOT}/data/osm/myanmar-latest.osm.pbf}"
    VALHALLA_PBF_BASENAME="$(basename "${VALHALLA_PBF_PATH}")"

    VALHALLA_MIN_X="${VALHALLA_MIN_X:-92.0}"
    VALHALLA_MIN_Y="${VALHALLA_MIN_Y:-9.5}"
    VALHALLA_MAX_X="${VALHALLA_MAX_X:-101.5}"
    VALHALLA_MAX_Y="${VALHALLA_MAX_Y:-28.5}"

    export VALHALLA_PORT VALHALLA_DATA_DIR VALHALLA_PBF_PATH
    export VALHALLA_MIN_X VALHALLA_MIN_Y VALHALLA_MAX_X VALHALLA_MAX_Y
}

valhalla_load_env_file() {
    local env_file="${VALHALLA_ROOT}/.env"
    if [[ -f "$env_file" ]]; then
        # shellcheck disable=SC1090
        set -a
        source "$env_file"
        set +a
        valhalla_lib_init
    fi
}

valhalla_require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "error: required command not found: ${cmd}" >&2
        exit 1
    fi
}

valhalla_require_docker() {
    valhalla_require_cmd docker
    if ! docker info >/dev/null 2>&1; then
        echo "error: Docker daemon is not running or not accessible." >&2
        exit 1
    fi
}

valhalla_require_compose() {
    valhalla_require_docker
    if docker compose version >/dev/null 2>&1; then
        VALHALLA_COMPOSE=(docker compose -f "${VALHALLA_COMPOSE_FILE}")
        return 0
    fi
    if command -v docker-compose >/dev/null 2>&1; then
        VALHALLA_COMPOSE=(docker-compose -f "${VALHALLA_COMPOSE_FILE}")
        return 0
    fi
    echo "error: docker compose (v2) or docker-compose is required." >&2
    exit 1
}

valhalla_fail_missing_pbf() {
    echo "error: OSM PBF not found." >&2
    echo "  expected: ${VALHALLA_PBF_PATH}" >&2
    echo "" >&2
    echo "Download Myanmar extract (example):" >&2
    echo "  mkdir -p \"$(dirname "${VALHALLA_PBF_PATH}")\"" >&2
    echo "  curl -L -o \"${VALHALLA_PBF_PATH}\" \\" >&2
    echo "    https://download.geofabrik.de/asia/myanmar-latest.osm.pbf" >&2
    echo "" >&2
    echo "Or set VALHALLA_PBF_PATH to your local file." >&2
    exit 1
}

valhalla_require_pbf() {
    if [[ ! -f "${VALHALLA_PBF_PATH}" ]]; then
        valhalla_fail_missing_pbf
    fi
    if [[ ! -s "${VALHALLA_PBF_PATH}" ]]; then
        echo "error: PBF file exists but is empty: ${VALHALLA_PBF_PATH}" >&2
        exit 1
    fi
}

valhalla_has_built_tiles() {
    [[ -d "${VALHALLA_DATA_DIR}/valhalla_tiles" ]] \
        || [[ -f "${VALHALLA_DATA_DIR}/valhalla_tiles.tar" ]]
}

valhalla_require_built_tiles() {
    if valhalla_has_built_tiles; then
        return 0
    fi
    echo "error: Valhalla tiles not found in ${VALHALLA_DATA_DIR}." >&2
    echo "  Run: infrastructure/routing/valhalla/scripts/build-valhalla.sh" >&2
    exit 1
}

valhalla_prepare_custom_files() {
    mkdir -p "${VALHALLA_DATA_DIR}"

    local pbf_dest="${VALHALLA_DATA_DIR}/${VALHALLA_PBF_BASENAME}"
    local pbf_abs
    pbf_abs="$(cd "$(dirname "${VALHALLA_PBF_PATH}")" && pwd)/$(basename "${VALHALLA_PBF_PATH}")"

    if [[ -L "${pbf_dest}" ]] || [[ -f "${pbf_dest}" ]]; then
        rm -f "${pbf_dest}"
    fi
    ln -sf "${pbf_abs}" "${pbf_dest}"

    local config_dest="${VALHALLA_DATA_DIR}/valhalla.json"
    if [[ ! -f "${config_dest}" ]] && [[ -f "${VALHALLA_CONFIG_DIR}/valhalla.json.template" ]]; then
        cp "${VALHALLA_CONFIG_DIR}/valhalla.json.template" "${config_dest}"
        echo "info: copied config/valhalla.json.template -> data/builds/valhalla.json"
        echo "      edit data/builds/valhalla.json before rebuild if you need custom service settings."
    fi
}

valhalla_base_url() {
    echo "http://127.0.0.1:${VALHALLA_PORT}"
}
