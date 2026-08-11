#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=../lib/database_target_safety.sh
source "${REPO_ROOT}/tools/data-pipeline/lib/database_target_safety.sh"

FAMILY=""
TARGET=""
CSV_PATH=""
REGION_CODE=""
SNAPSHOT_VERSION=""
MODE="dry_run"
CONFIRMATION=""
ENV_FILE=""

usage() {
  cat <<'EOF'
usage: run_direct_core_import.sh --family FAMILY --target local|production \
  --csv PATH --region-code CODE --snapshot-version VERSION [options]

Options:
  --dry-run                 default; complete transaction then ROLLBACK
  --apply                   commit one regional transaction
  --confirmation TEXT       required for production --apply
  --env-file PATH           source database URL variables

Production confirmation:
  IMPORT <family> <region_code> <snapshot_version>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --family) FAMILY="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --csv) CSV_PATH="${2:-}"; shift 2 ;;
    --region-code) REGION_CODE="${2:-}"; shift 2 ;;
    --snapshot-version) SNAPSHOT_VERSION="${2:-}"; shift 2 ;;
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) db_target_die "unknown argument: $1" ;;
  esac
done

if [[ -n "${ENV_FILE}" ]]; then
  [[ -r "${ENV_FILE}" ]] || db_target_die "env file not readable: ${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

[[ -n "${FAMILY}" ]] || { usage >&2; db_target_die "missing --family"; }
[[ -n "${TARGET}" ]] || { usage >&2; db_target_die "missing --target"; }
[[ -n "${CSV_PATH}" ]] || { usage >&2; db_target_die "missing --csv"; }
[[ -r "${CSV_PATH}" ]] || db_target_die "CSV file not readable: ${CSV_PATH}"
[[ -n "${REGION_CODE}" ]] || db_target_die "missing --region-code"
[[ -n "${SNAPSHOT_VERSION}" ]] || db_target_die "missing --snapshot-version"

case "${FAMILY}" in
  places)
    SQL_FILE="${SCRIPT_DIR}/sql/places.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,primary_name,name_my,name_en,category_id,admin_area_id,point_ewkt,importance_score,popularity_score,confidence_score,source_refs,normalized_data"
    ;;
  roads)
    SQL_FILE="${SCRIPT_DIR}/sql/roads.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,canonical_name,name_my,name_en,road_class_id,admin_area_id,geom_ewkt,is_oneway,bridge,tunnel,layer,surface,source_refs,normalized_data"
    ;;
  buildings)
    SQL_FILE="${SCRIPT_DIR}/sql/buildings.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,name_und,name_my,name_en,building_type_id,admin_area_id,geom_ewkt,levels,height_m,confidence_score,source_refs,normalized_data"
    ;;
  landuse)
    SQL_FILE="${SCRIPT_DIR}/sql/landuse.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,name_und,name_my,name_en,landuse_class_id,class_code,admin_area_id,geom_ewkt,confidence_score,detail_level,source_tags,source_refs,normalized_data"
    ;;
  water_lines)
    SQL_FILE="${SCRIPT_DIR}/sql/water_lines.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,name_und,name_my,name_en,class_code,geom_ewkt,source_refs,normalized_data"
    ;;
  water_polygons)
    SQL_FILE="${SCRIPT_DIR}/sql/water_polygons.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,name_und,name_my,name_en,class_code,geom_ewkt,source_refs,normalized_data"
    ;;
  routing_barriers)
    SQL_FILE="${SCRIPT_DIR}/sql/routing_barriers.sql"
    EXPECTED_HEADER="classification,local_staging_id,external_id,barrier_type,core_street_id,point_ewkt,access_tags,source_refs,normalized_data"
    ;;
  *) db_target_die "unsupported family: ${FAMILY}" ;;
esac

[[ -r "${SQL_FILE}" ]] || db_target_die "missing family SQL: ${SQL_FILE}"
[[ "${REGION_CODE}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || db_target_die "region-code must be one simple code"
case "$(printf '%s' "${REGION_CODE}" | tr '[:upper:]' '[:lower:]')" in
  all|countrywide|mm|mmr|myanmar|national|nationwide)
    db_target_die "nationwide region-code is refused: ${REGION_CODE}"
    ;;
esac

ACTUAL_HEADER="$(head -n 1 "${CSV_PATH}" | tr -d '\r')"
[[ "${ACTUAL_HEADER}" == "${EXPECTED_HEADER}" ]] \
  || db_target_die "CSV header mismatch for ${FAMILY}"

CSV_DIR="$(cd "$(dirname "${CSV_PATH}")" && pwd)"
CSV_PATH="${CSV_DIR}/$(basename "${CSV_PATH}")"

db_target_refuse_ambiguous_local_vs_production
db_target_resolve "${TARGET}" write
db_target_print_identity "${DB_TARGET_DATABASE_URL}" "${DB_TARGET}"

DB_PORT="$(python3 - "${DB_TARGET_DATABASE_URL}" <<'PY'
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
print(u.port or 5432)
PY
)"
[[ "${DB_PORT}" != "6543" ]] \
  || db_target_die "transaction-mode pooler port 6543 cannot preserve session TEMP state"

EXPECTED_CONFIRMATION="IMPORT ${FAMILY} ${REGION_CODE} ${SNAPSHOT_VERSION}"
REQUIRED_CONFIRMATION=""
if [[ "${MODE}" == "apply" && "${DB_TARGET}" == "production" ]]; then
  REQUIRED_CONFIRMATION="${EXPECTED_CONFIRMATION}"
fi
db_target_require_write_gates \
  "${DB_TARGET}" "${MODE}" \
  "${REQUIRED_CONFIRMATION}" \
  "${CONFIRMATION}"

# Extra one-time gate for national buildings production apply.
if [[ "${MODE}" == "apply" && "${DB_TARGET}" == "production" && "${FAMILY}" == "buildings" ]]; then
  if [[ "${EXECUTE_BUILDINGS_DIRECT_CORE:-}" != "I_UNDERSTAND" ]]; then
    db_target_die "set EXECUTE_BUILDINGS_DIRECT_CORE=I_UNDERSTAND for buildings production apply"
  fi
fi

DRY_RUN_SQL="true"
[[ "${MODE}" == "apply" ]] && DRY_RUN_SQL="false"

echo "=== direct_core_import ==="
echo "family=${FAMILY}"
echo "region_code=${REGION_CODE}"
echo "snapshot_version=${SNAPSHOT_VERSION}"
echo "mode=${MODE}"
echo "csv=${CSV_PATH}"
echo "transaction_scope=one_region"

DIRECT_CORE_CSV="${CSV_PATH}" PAGER=cat psql "${DB_TARGET_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -v region_code="${REGION_CODE}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v dry_run="${DRY_RUN_SQL}" \
  -f "${SQL_FILE}"
