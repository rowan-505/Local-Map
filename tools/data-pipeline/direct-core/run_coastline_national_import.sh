#!/usr/bin/env bash
# National Myanmar coastline → core.core_coastlines via replace_active_coastline.
# Default: --dry-run (no replace call). Apply requires explicit gates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"

SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_08_11_national_land_coastline_dry_run_v1}"
DEFAULT_CSV="${SCRIPT_DIR}/artifacts/land_coastline_national_2026_08_13/prepare_package/coastline.national.csv"
CSV_PATH="${COASTLINE_CSV:-${DEFAULT_CSV}}"
MODE="dry_run"
CONFIRMATION=""

usage() {
  cat <<'EOF'
usage: run_coastline_national_import.sh [--dry-run|--apply] [--csv PATH]

Default: --dry-run (validates artifact + production counts; does NOT call replace).

--apply requires:
  EXECUTE_COASTLINES_DIRECT_CORE=I_UNDERSTAND
  --confirmation 'IMPORT coastlines MM osm_myanmar_2026_08_11_national_land_coastline_dry_run_v1'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --csv) CSV_PATH="${2:-}"; shift 2 ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -r "${ENV_FILE}" ]] || { echo "missing env file: ${ENV_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${ENV_FILE}"

[[ -r "${CSV_PATH}" ]] || { echo "missing coastline CSV: ${CSV_PATH}" >&2; exit 1; }
CSV_PATH="$(cd "$(dirname "${CSV_PATH}")" && pwd)/$(basename "${CSV_PATH}")"

EXPECTED_CONFIRMATION="IMPORT coastlines MM ${SNAPSHOT_VERSION}"

if [[ "${MODE}" == "apply" ]]; then
  if [[ "${EXECUTE_COASTLINES_DIRECT_CORE:-}" != "I_UNDERSTAND" ]]; then
    echo "error: set EXECUTE_COASTLINES_DIRECT_CORE=I_UNDERSTAND for apply" >&2
    exit 1
  fi
  if [[ "${CONFIRMATION}" != "${EXPECTED_CONFIRMATION}" ]]; then
    echo "error: confirmation must be exactly: ${EXPECTED_CONFIRMATION}" >&2
    exit 1
  fi
  DB_URL="${SUPABASE_WRITE_DATABASE_URL:?SUPABASE_WRITE_DATABASE_URL required}"
  DRY_RUN_SQL="false"
else
  DB_URL="${SUPABASE_READ_DATABASE_URL:-${SUPABASE_WRITE_DATABASE_URL:?database URL required}}"
  DRY_RUN_SQL="true"
fi

# Refuse transaction-mode pooler (TEMP + session state).
DB_PORT="$(python3 - "${DB_URL}" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).port or 5432)
PY
)"
[[ "${DB_PORT}" != "6543" ]] || { echo "error: port 6543 refused" >&2; exit 1; }

echo "=== coastline national import ==="
echo "mode=${MODE}"
echo "csv=${CSV_PATH}"
echo "snapshot_version=${SNAPSHOT_VERSION}"
echo "region_code=MM"
echo "dry_run_sql=${DRY_RUN_SQL}"

export DIRECT_CORE_CSV="${CSV_PATH}"
export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"

PAGER=cat psql "${DB_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v dry_run="${DRY_RUN_SQL}" \
  -f "${SCRIPT_DIR}/sql/coastlines.sql"

echo "=== done mode=${MODE} ==="
if [[ "${MODE}" == "dry_run" ]]; then
  echo "STOP: review dry-run report before --apply"
fi
