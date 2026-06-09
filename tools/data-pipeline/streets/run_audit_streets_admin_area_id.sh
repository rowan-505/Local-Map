#!/usr/bin/env bash
# Read-only audit: core.core_streets.admin_area_id quality (roads only).
#
# Usage:
#   ./run_audit_streets_admin_area_id.sh imports/local.env
#   DATABASE_URL='postgresql://...' ./run_audit_streets_admin_area_id.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-}"

if [[ -n "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/${ENV_FILE}"
fi

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${DB_URL}" ]]; then
  echo "error: set DATABASE_URL or LOCAL_DATABASE_URL (or pass an env file)" >&2
  exit 1
fi

exec psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/audit_streets_admin_area_id.sql"
