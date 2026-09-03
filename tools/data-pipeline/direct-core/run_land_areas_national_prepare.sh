#!/usr/bin/env bash
# Local prepare only: re-export landuse safe CSV + coastline artifact for the
# approved national land/coastline dry-run snapshot. Does NOT write production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCAL_OSM="${REPO_ROOT}/tools/data-pipeline/local-osm"
PIPELINE_ENV="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
ROOT_ENV="${REPO_ROOT}/.env"

SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_08_11_national_land_coastline_dry_run_v1}"
REGION_CODE="${REGION_CODE:-mm-core-land-areas-v1}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
ART_ROOT="${SCRIPT_DIR}/artifacts/land_coastline_national_2026_08_13"
PKG="${ART_ROOT}/prepare_package"

load_env_file() {
  local file="$1"
  [[ -r "${file}" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
}

if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  load_env_file "${PIPELINE_ENV}" || true
fi
if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  load_env_file "${ROOT_ENV}" || true
fi
if [[ -z "${LOCAL_DATABASE_URL:-}" ]]; then
  echo "error: LOCAL_DATABASE_URL is required." >&2
  echo "Set it in tools/data-pipeline/prod-mirror/00_env.sh (copy 00_env.example.sh) or in the repo-root .env." >&2
  exit 1
fi

mkdir -p "${PKG}"

SAFE_CSV="${PKG}/landuse.safe.csv"
REJECT_CSV="${PKG}/landuse.invalid.csv"
COAST_CSV="${PKG}/coastline.national.csv"
COUNT_REPORT="${PKG}/classification_counts.txt"

echo "=== land/coastline national prepare (local only) ==="
echo "snapshot_version=${SNAPSHOT_VERSION}"
echo "region_code_alias=${REGION_CODE}"
echo "artifact_dir=${PKG}"

echo "=== export landuse safe_new/safe_update ==="
python3 - <<PY
from pathlib import Path
src = Path("${SCRIPT_DIR}/export/export_landuse.sql").read_text()
src = src.replace(
    "\\copy direct_landuse_export_safe TO :'output_path' WITH (FORMAT csv, HEADER true)",
    "\\copy direct_landuse_export_safe TO '${SAFE_CSV}' WITH (FORMAT csv, HEADER true)",
)
src = src.replace(
    "\\copy direct_landuse_export_invalid TO :'rejection_path' WITH (FORMAT csv, HEADER true)",
    "\\copy direct_landuse_export_invalid TO '${REJECT_CSV}' WITH (FORMAT csv, HEADER true)",
)
Path("${PKG}/_export_landuse_body.sql").write_text(src)
PY
PAGER=cat psql "${LOCAL_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v staging_schema="${STAGING_SCHEMA}" \
  -f "${PKG}/_export_landuse_body.sql" \
  | tee "${PKG}/export_landuse.log"

echo "=== export national coastline artifact ==="
python3 - <<PY
from pathlib import Path
src = Path("${SCRIPT_DIR}/export/export_coastline.sql").read_text()
src = src.replace(
    "\\copy coastline_export_rows TO :'output_path' WITH (FORMAT csv, HEADER true)",
    "\\copy coastline_export_rows TO '${COAST_CSV}' WITH (FORMAT csv, HEADER true)",
)
Path("${PKG}/_export_coastline_body.sql").write_text(src)
PY
PAGER=cat psql "${LOCAL_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v staging_schema="${STAGING_SCHEMA}" \
  -f "${PKG}/_export_coastline_body.sql" \
  | tee "${PKG}/export_coastline.log"

echo "=== classification + unmapped counts ==="
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL | tee "${COUNT_REPORT}"
\\pset pager off
SELECT 'landuse_import_class' AS section, coalesce(import_class, 'null') AS bucket, count(*)::bigint AS n
FROM ${STAGING_SCHEMA}.staging_landuse_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots WHERE snapshot_version = '${SNAPSHOT_VERSION}'
)
GROUP BY 1, 2
ORDER BY n DESC;

SELECT 'landuse_core_eligible' AS section,
  count(*) FILTER (WHERE eligible_for_core IS TRUE) AS core_eligible,
  count(*) FILTER (WHERE eligible_for_core IS FALSE) AS pmtiles_flag,
  count(*) FILTER (WHERE eligible_for_core IS TRUE AND import_class IN ('safe_new','safe_update')) AS direct_core_exportable,
  count(*) FILTER (WHERE eligible_for_core IS TRUE AND import_class IN (
    'duplicate','conflict','manual_protected','verified_conflict','possible_delete'
  )) AS ir_conflict
FROM ${STAGING_SCHEMA}.staging_landuse_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots WHERE snapshot_version = '${SNAPSHOT_VERSION}'
);

SELECT 'unmapped_landuse' AS section, count(*)::bigint AS n,
  count(DISTINCT (tag_key, tag_value))::bigint AS distinct_combos
FROM ${STAGING_SCHEMA}.staging_osm_unmapped_tags
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots WHERE snapshot_version = '${SNAPSHOT_VERSION}'
)
AND entity_family = 'landuse';

SELECT 'coastline_staging' AS section, count(*)::bigint AS way_count
FROM ${STAGING_SCHEMA}.staging_coastline_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots WHERE snapshot_version = '${SNAPSHOT_VERSION}'
);
SQL

SAFE_ROWS=$(($(wc -l < "${SAFE_CSV}") - 1))
COAST_ROWS=$(($(wc -l < "${COAST_CSV}") - 1))
echo "safe_csv_rows=${SAFE_ROWS}"
echo "coast_csv_rows=${COAST_ROWS}"
echo "region_alias_for_later_apply=${REGION_CODE}"
echo "confirmation_later=IMPORT landuse ${REGION_CODE} ${SNAPSHOT_VERSION}"
echo "DONE prepare — no production writes"
