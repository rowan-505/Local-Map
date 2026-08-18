#!/usr/bin/env bash
# Prepare + apply national protected areas to production Core.
# Default: dry-run. Apply requires explicit confirmation gates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCAL_OSM="${REPO_ROOT}/tools/data-pipeline/local-osm"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"

SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_08_11_national_protected_areas_dry_run_v1}"
REGION_CODE="${REGION_CODE:-mm-core-protected-areas-v1}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
ART_ROOT="${SCRIPT_DIR}/artifacts/protected_areas_national_2026_08_13"
PKG="${ART_ROOT}/prepare_package"
REPORT="${LOCAL_OSM}/reports/protected_areas_national_apply_2026_08_13.md"

MODE="dry_run"
CONFIRMATION=""
SKIP_PREPARE=false

usage() {
  cat <<'EOF'
usage: run_protected_areas_national_import.sh [--dry-run|--apply] [--skip-prepare]

Default: --dry-run (exports package, registers snapshot if needed, ROLLBACKs Core write).

--apply requires:
  EXECUTE_PROTECTED_AREAS_DIRECT_CORE=I_UNDERSTAND
  --confirmation 'IMPORT protected_areas mm-core-protected-areas-v1 osm_myanmar_2026_08_11_national_protected_areas_dry_run_v1'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --skip-prepare) SKIP_PREPARE=true; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -r "${ENV_FILE}" ]] || { echo "missing env file: ${ENV_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${ENV_FILE}"

LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL required}"
WRITE_URL="${SUPABASE_WRITE_DATABASE_URL:?SUPABASE_WRITE_DATABASE_URL required}"
READ_URL="${SUPABASE_READ_DATABASE_URL:-${WRITE_URL}}"

mkdir -p "${PKG}" "$(dirname "${REPORT}")"
SAFE_CSV="${PKG}/protected_areas.safe.csv"
REVIEW_CSV="${PKG}/protected_areas.review.csv"

if [[ "${SKIP_PREPARE}" != "true" ]]; then
  echo "=== 1) export safe + review CSVs from local staging ==="
  python3 - <<PY
from pathlib import Path
src = Path("${SCRIPT_DIR}/export/export_protected_areas.sql").read_text()
src = src.replace(
    "\\copy direct_protected_areas_export_safe TO :'output_path' WITH (FORMAT csv, HEADER true)",
    "\\copy direct_protected_areas_export_safe TO '${SAFE_CSV}' WITH (FORMAT csv, HEADER true)",
)
src = src.replace(
    "\\copy direct_protected_areas_export_review TO :'review_path' WITH (FORMAT csv, HEADER true)",
    "\\copy direct_protected_areas_export_review TO '${REVIEW_CSV}' WITH (FORMAT csv, HEADER true)",
)
Path("${PKG}/_export_protected_areas_body.sql").write_text(src)
PY
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -f "${PKG}/_export_protected_areas_body.sql" \
    | tee "${PKG}/export_protected_areas.log"
fi

[[ -r "${SAFE_CSV}" ]] || { echo "missing safe CSV: ${SAFE_CSV}" >&2; exit 1; }
[[ -r "${REVIEW_CSV}" ]] || { echo "missing review CSV: ${REVIEW_CSV}" >&2; exit 1; }

echo "=== 2) register production snapshot (idempotent) ==="
PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/sql/register_protected_areas_snapshot_supabase.sql" \
  | tee "${PKG}/register_snapshot.log"

EXPECTED_CONFIRMATION="IMPORT protected_areas ${REGION_CODE} ${SNAPSHOT_VERSION}"

echo "=== 3) direct-core import mode=${MODE} ==="
EXTRA=()
if [[ "${MODE}" == "apply" ]]; then
  EXTRA+=(--apply --confirmation "${CONFIRMATION:-${EXPECTED_CONFIRMATION}}")
  export EXECUTE_PROTECTED_AREAS_DIRECT_CORE="${EXECUTE_PROTECTED_AREAS_DIRECT_CORE:-I_UNDERSTAND}"
else
  EXTRA+=(--dry-run)
fi

export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"

"${SCRIPT_DIR}/run_direct_core_import.sh" \
  --family protected_areas \
  --target production \
  --csv "${SAFE_CSV}" \
  --region-code "${REGION_CODE}" \
  --snapshot-version "${SNAPSHOT_VERSION}" \
  --env-file "${ENV_FILE}" \
  "${EXTRA[@]}" \
  | tee "${PKG}/import_${MODE}.log"

if [[ "${MODE}" == "apply" ]]; then
  echo "=== 4) upload review-only rows ==="
  export DIRECT_CORE_REVIEW_CSV="${REVIEW_CSV}"
  PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -f "${SCRIPT_DIR}/sql/upload_protected_areas_review.sql" \
    | tee "${PKG}/review_upload.log"

  echo "=== 5) final validation ==="
  PAGER=cat psql "${READ_URL}" -v ON_ERROR_STOP=1 <<'SQL' | tee "${PKG}/final_validation.log"
\pset pager off
SELECT 'baseline_after' AS section,
  (SELECT count(*) FROM core.core_protected_areas) AS protected_total,
  (SELECT count(*) FROM core.core_protected_areas WHERE is_active AND deleted_at IS NULL) AS protected_active,
  (SELECT count(*) FROM core.core_protected_area_names) AS names_total,
  (SELECT count(*) FROM import_review.protected_area_candidates) AS review_candidates;

SELECT 'class_counts' AS section, pac.code, count(*)::bigint AS n
FROM core.core_protected_areas p
JOIN ref.ref_protected_area_classes pac ON pac.id = p.protected_area_class_id
WHERE p.is_active AND p.deleted_at IS NULL
GROUP BY 1, 2
ORDER BY n DESC;

SELECT 'quality_gates' AS section,
  count(*) FILTER (WHERE protected_area_class_id IS NULL) AS null_class_fk,
  count(*) FILTER (WHERE geom IS NULL OR ST_IsEmpty(geom)) AS empty_geom,
  count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
  count(*) FILTER (
    WHERE source_registry_id IS NULL
      AND external_id LIKE 'osm:%'
  ) AS missing_registry_osm,
  count(*) FILTER (
    WHERE source_snapshot_id IS NULL
      AND external_id LIKE 'osm:%'
  ) AS missing_snapshot_osm,
  count(*) FILTER (
    WHERE (source_feature_type IS NULL OR source_feature_id IS NULL)
      AND external_id LIKE 'osm:%'
  ) AS missing_source_identity_osm
FROM core.core_protected_areas
WHERE deleted_at IS NULL;

SELECT 'duplicate_source_identity' AS section, count(*)::bigint AS n
FROM (
  SELECT source_registry_id, source_feature_type, source_feature_id
  FROM core.core_protected_areas
  WHERE deleted_at IS NULL
    AND source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
) d;

SELECT 'tiles_smoke' AS section, count(*)::bigint AS n,
  count(DISTINCT protected_area_class_code)::bigint AS distinct_classes
FROM tiles.tiles_protected_areas_v;

SELECT 'search_smoke_named' AS section, count(*)::bigint AS n
FROM search.v_search_protected_areas_source;

SELECT 'examples' AS section, pac.code, p.external_id,
  left(coalesce(
    (SELECT n.name FROM core.core_protected_area_names n
     WHERE n.protected_area_id = p.id AND n.language_code = 'en' AND n.is_primary
     LIMIT 1),
    (SELECT n.name FROM core.core_protected_area_names n
     WHERE n.protected_area_id = p.id AND n.is_primary
     ORDER BY n.language_code LIMIT 1),
    p.external_id
  ), 80) AS sample_name
FROM core.core_protected_areas p
JOIN ref.ref_protected_area_classes pac ON pac.id = p.protected_area_class_id
WHERE p.is_active AND p.deleted_at IS NULL
  AND pac.code IN ('national_park', 'nature_reserve', 'wildlife_protected_area', 'forest_reserve', 'marine_protected_area', 'other')
ORDER BY pac.sort_order, p.id
LIMIT 12;
SQL
fi

echo "=== done mode=${MODE} ==="
echo "artifacts: ${PKG}"
if [[ "${MODE}" == "dry_run" ]]; then
  echo "STOP: review dry-run logs, then re-run with --apply"
fi
