#!/usr/bin/env bash
# Restart the local Martin Docker container used by apps/web (VITE_MARTIN_TILE_URL=http://localhost:3002).
#
# Requires:
#   - DATABASE_URL in the environment (Supabase pooler URL with sslmode=require)
#   - Docker
#
# First-time start (same flags as an existing coremap-martin-local container):
#   export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require'
#   docker run -d --rm --name coremap-martin-local \
#     -p 3002:3000 \
#     -e DATABASE_URL \
#     -v "$(pwd)/config.local.yaml:/config.yaml:ro" \
#     ghcr.io/maplibre/martin:1.7.0 \
#     --config /config.yaml --webui enable-for-all
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARTIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTAINER_NAME="${MARTIN_CONTAINER_NAME:-coremap-martin-local}"

if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "Restarting ${CONTAINER_NAME}..."
  docker restart "${CONTAINER_NAME}" >/dev/null
  echo "Restarted ${CONTAINER_NAME} (http://localhost:3002)."
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Container ${CONTAINER_NAME} not found and DATABASE_URL is unset." >&2
  echo "Export DATABASE_URL, then re-run or start manually from ${MARTIN_DIR}." >&2
  exit 1
fi

echo "Starting ${CONTAINER_NAME}..."
docker run -d --rm --name "${CONTAINER_NAME}" \
  -p 3002:3000 \
  -e DATABASE_URL \
  -v "${MARTIN_DIR}/config.local.yaml:/config.yaml:ro" \
  ghcr.io/maplibre/martin:1.7.0 \
  --config /config.yaml --webui enable-for-all >/dev/null

echo "Started ${CONTAINER_NAME} (http://localhost:3002)."
