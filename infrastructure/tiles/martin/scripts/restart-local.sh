#!/usr/bin/env bash
# Start or restart the local Martin Docker container for apps/web
# (VITE_MARTIN_TILE_URL=http://localhost:3002).
#
# DATABASE_URL is loaded from (first match wins):
#   1. Already-exported shell env
#   2. infrastructure/tiles/martin/.env
#
# First-time setup:
#   cp infrastructure/tiles/martin/env.example infrastructure/tiles/martin/.env
#   # edit .env and set DATABASE_URL
#   npm run tiles:martin:restart-local
#
# If you change DATABASE_URL in .env, recreate the container:
#   docker rm -f coremap-martin-local
#   npm run tiles:martin:restart-local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARTIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTAINER_NAME="${MARTIN_CONTAINER_NAME:-coremap-martin-local}"
HOST_PORT="${MARTIN_HOST_PORT:-3002}"
ENV_FILE="${MARTIN_DIR}/.env"

load_env_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  # shellcheck disable=SC1090
  set -a
  source "$file"
  set +a
  return 0
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  if load_env_file "${ENV_FILE}"; then
    echo "Loaded DATABASE_URL from ${ENV_FILE}"
  fi
fi

CONTAINER_NAME="${MARTIN_CONTAINER_NAME:-${CONTAINER_NAME}}"
HOST_PORT="${MARTIN_HOST_PORT:-${HOST_PORT}}"

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"
}

if container_exists; then
  if container_running; then
    echo "Container ${CONTAINER_NAME} already exists and is running."
    echo "  URL: http://localhost:${HOST_PORT}"
    echo "  Tip: docker restart ${CONTAINER_NAME}"
    echo "  Tip: to apply a new DATABASE_URL from .env → docker rm -f ${CONTAINER_NAME} && $0"
    exit 0
  fi

  echo "Container ${CONTAINER_NAME} exists but is stopped. Starting it..."
  docker start "${CONTAINER_NAME}" >/dev/null
  echo "Started ${CONTAINER_NAME} (http://localhost:${HOST_PORT})."
  echo "  Note: start keeps the old container env. Recreate to pick up .env changes:"
  echo "    docker rm -f ${CONTAINER_NAME} && $0"
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: Container ${CONTAINER_NAME} not found and DATABASE_URL is unset." >&2
  echo "" >&2
  echo "Create ${ENV_FILE} from the example:" >&2
  echo "  cp ${MARTIN_DIR}/env.example ${ENV_FILE}" >&2
  echo "  # set DATABASE_URL=postgresql://...sslmode=require" >&2
  echo "" >&2
  echo "Or export DATABASE_URL in your shell, then re-run." >&2
  exit 1
fi

echo "No existing container. Starting ${CONTAINER_NAME}..."
container_id="$(
  docker run -d --rm --name "${CONTAINER_NAME}" \
    -p "${HOST_PORT}:3000" \
    -e DATABASE_URL \
    -v "${MARTIN_DIR}/config.local.yaml:/config.yaml:ro" \
    ghcr.io/maplibre/martin:1.7.0 \
    --config /config.yaml --webui enable-for-all
)"

# --rm removes failed containers immediately; wait briefly and verify it stayed up.
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if ! container_exists; then
    break
  fi
  if container_running && curl -sf "http://127.0.0.1:${HOST_PORT}/catalog" >/dev/null 2>&1; then
    ready=1
    break
  fi
done

if [[ "${ready}" -ne 1 ]]; then
  echo "error: ${CONTAINER_NAME} did not become ready on http://localhost:${HOST_PORT}." >&2
  echo "  Common causes:" >&2
  echo "    - DATABASE_URL has Prisma-only params (pgbouncer, connection_limit, pool_timeout)" >&2
  echo "    - transaction pooler :6543 hangs; use direct :5432 or session mode" >&2
  echo "  Inspect logs: docker logs ${CONTAINER_NAME} 2>/dev/null || true" >&2
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  echo "  container id was: ${container_id}" >&2
  exit 1
fi

echo "Started ${CONTAINER_NAME} (http://localhost:${HOST_PORT})."
