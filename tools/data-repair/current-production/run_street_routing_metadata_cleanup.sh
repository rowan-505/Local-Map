#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
MIGRATION="${REPO_ROOT}/infrastructure/database/migrations/supabase/162_core_street_routing_metadata.sql"
CLEANUP_SQL="${SCRIPT_DIR}/40_street_routing_metadata_cleanup.sql"
SAFETY_LIB="${REPO_ROOT}/tools/data-pipeline/lib/database_target_safety.sh"
EXPECTED_CONFIRMATION="NORMALIZE CoreMap street routing metadata"

MODE="dry_run"
CONFIRMATION=""

usage() {
  printf '%s\n' \
    "usage: $0 [--dry-run|--apply] [--confirmation TEXT]" \
    "" \
    "Production apply requires exactly:" \
    "  --confirmation '${EXPECTED_CONFIRMATION}'"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -r "${ENV_FILE}" ]] || { echo "error: missing env file: ${ENV_FILE}" >&2; exit 1; }
[[ -r "${SAFETY_LIB}" ]] || { echo "error: missing safety library: ${SAFETY_LIB}" >&2; exit 1; }
[[ -r "${MIGRATION}" ]] || { echo "error: missing migration: ${MIGRATION}" >&2; exit 1; }
[[ -r "${CLEANUP_SQL}" ]] || { echo "error: missing cleanup SQL: ${CLEANUP_SQL}" >&2; exit 1; }

# shellcheck disable=SC1090
source "${ENV_FILE}"
# shellcheck disable=SC1090
source "${SAFETY_LIB}"

db_target_preflight_write \
  production \
  "${MODE}" \
  write \
  "${EXPECTED_CONFIRMATION}" \
  "${CONFIRMATION}"

DB_PORT="$(python3 - "${DB_TARGET_DATABASE_URL}" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).port or 5432)
PY
)"
[[ "${DB_PORT}" != "6543" ]] || db_target_die \
  "transaction-mode pooler port 6543 is unsupported; direct/session connection required"

if [[ "${MODE}" != "apply" ]]; then
  echo "dry-run complete: target and write gates checked; no database writes performed"
  exit 0
fi

echo "applying migration 162 (metadata-only columns + validated CHECK)"
PAGER=cat psql "${DB_TARGET_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "${MIGRATION}"

echo "running sparse keyset cleanup (500 candidates per autocommit transaction)"
PAGER=cat psql "${DB_TARGET_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "${CLEANUP_SQL}"

echo "street routing metadata cleanup complete"
