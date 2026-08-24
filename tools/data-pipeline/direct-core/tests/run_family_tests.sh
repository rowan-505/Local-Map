#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIRECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DIRECT_DIR}/../../.." && pwd)"

if [[ "${1:-}" == "--static" && $# -eq 1 ]]; then
  RUN_DATABASE_TESTS="false"
elif [[ "${1:-}" == "--target" && "${2:-}" == "local" && $# -eq 2 ]]; then
  RUN_DATABASE_TESTS="true"
else
  echo "usage: $0 --static | --target local" >&2
  exit 2
fi

families=(
  places roads buildings landuse water_lines water_polygons routing_barriers settlements
)

for family in "${families[@]}"; do
  loader="${DIRECT_DIR}/sql/${family}.sql"
  exporter="${DIRECT_DIR}/export/export_${family}.sql"
  [[ -r "${loader}" ]] || { echo "missing ${loader}" >&2; exit 1; }
  [[ -r "${exporter}" ]] || { echo "missing ${exporter}" >&2; exit 1; }

  grep -q '^BEGIN;' "${loader}"
  grep -q 'CREATE TEMP TABLE' "${loader}"
  grep -q '\\copy .* FROM PROGRAM' "${loader}"
  grep -Eq "NOT IN ?\\('safe_new','safe_update'\\)" "${loader}"
  grep -q 'identity resolves to multiple Core rows' "${loader}"
  grep -q 'system.system_import_batches' "${loader}"
  grep -q 'system.system_publish_batches' "${loader}"
  grep -q 'system.system_publish_items' "${loader}"
  grep -q '^ROLLBACK;' "${loader}"
  if grep -q 'import_work\.' "${loader}"; then
    echo "${family}: loader must not reference import_work" >&2
    exit 1
  fi
  if [[ "${family}" == "buildings" ]]; then
    grep -q 'source_feature_type' "${loader}"
    grep -q 'source_feature_id' "${loader}"
    grep -q 'is_geometry_manually_edited' "${loader}"
    grep -q 'is_attributes_manually_edited' "${loader}"
  fi
  if [[ "${family}" == "settlements" ]]; then
    grep -q 'core.core_settlements' "${loader}"
    grep -q 'ref.ref_settlement_types' "${loader}"
    grep -q 'township_id required' "${loader}"
    grep -q 'invalid Point geometry' "${loader}"
    if grep -q 'INSERT INTO core.core_places' "${loader}"; then
      echo "${family}: loader must not write core_places" >&2
      exit 1
    fi
    if grep -q 'INSERT INTO core.core_admin_areas' "${loader}"; then
      echo "${family}: loader must not write core_admin_areas" >&2
      exit 1
    fi
  fi

  grep -q "import_class IN('safe_new','safe_update')" "${exporter}"
  grep -q "import_class='invalid'" "${exporter}"
done

grep -q 'EXECUTE_SETTLEMENTS_DIRECT_CORE' "${DIRECT_DIR}/run_direct_core_import.sh"
grep -q "'core_settlements', 'settlements', false, false," \
  "${REPO_ROOT}/tools/data-pipeline/prod-mirror/03_refresh_prod_mirror.sql"
grep -q "'core_places', 'places', true, true," \
  "${REPO_ROOT}/tools/data-pipeline/prod-mirror/03_refresh_prod_mirror.sql"
grep -q "'core_streets', 'roads', true, true," \
  "${REPO_ROOT}/tools/data-pipeline/prod-mirror/03_refresh_prod_mirror.sql"

if find "${REPO_ROOT}/tools/data-pipeline/import-work" -type f \
    ! -path '*/reports/*' -print -quit | grep -q .; then
  echo "retired loader directory still contains operational files" >&2
  exit 1
fi

while IFS= read -r active_ref; do
  [[ "${active_ref}" == "${SCRIPT_DIR}/run_family_tests.sh" ]] && continue
  echo "production-capable file still references import_work: ${active_ref}" >&2
  exit 1
done < <(
  rg -l 'import_work\.' "${REPO_ROOT}/tools" \
    --glob '*.sh' --glob '*.ts' --glob '*.sql' \
    --glob '!data-pipeline/import-work/reports/**' \
    --glob '!data-pipeline/local-osm/reports/**'
)

if [[ "${RUN_DATABASE_TESTS}" == "false" ]]; then
  echo "direct-core static family checks: PASS"
  exit 0
fi
if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  echo "LOCAL_DATABASE_URL is required for --target local" >&2
  exit 2
fi

PAGER=cat psql "${LOCAL_DATABASE_URL}" \
  -X -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/family_contract_tests.sql"

echo "direct-core family contract tests: PASS"

PAGER=cat psql "${LOCAL_DATABASE_URL}" \
  -X -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/settlements_tiny_sample.sql"

echo "direct-core settlements tiny sample: PASS"
