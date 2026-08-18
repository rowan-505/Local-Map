#!/usr/bin/env bash
# Local-only national protected-areas dry-run.
# Does NOT write Supabase production / core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/imports/myanmar_national_protected_areas_dry_run_2026_08_13.env"
# shellcheck disable=SC1090
source "${ENV_FILE}"

FULL_PBF="${SCRIPT_DIR}/data/osm/myanmar-260811.osm.pbf"
OUT_PBF="${PBF_PATH}"
ART_DIR="${SCRIPT_DIR}/artifacts/protected_areas_national_2026_08_13"
REPORT="${SCRIPT_DIR}/reports/protected_areas_national_dry_run_2026_08_13.md"
OSMIUM_BIN="${OSMIUM_BIN:-osmium}"

mkdir -p "${ART_DIR}" "$(dirname "${REPORT}")" "${SCRIPT_DIR}/data/osm" "${LOG_DIR}"

echo "=== 0) local migration 017 + normalize functions ==="
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -f "${REPO_ROOT}/infrastructure/database/migrations/local/017_protected_area_staging.sql"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/pipeline_osm_category_normalize.sql"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/pipeline_entity_families_functions.sql"

echo "=== 1) osmium tags-filter protected candidates from full PBF ==="
if [[ ! -f "${FULL_PBF}" ]]; then
  echo "error: missing full PBF ${FULL_PBF}" >&2
  exit 1
fi
if [[ ! -f "${OUT_PBF}" ]]; then
  "${OSMIUM_BIN}" tags-filter --progress -O -o "${OUT_PBF}" "${FULL_PBF}" \
    wr/boundary=protected_area \
    wr/boundary=national_park \
    wr/leisure=nature_reserve
fi
echo "filtered PBF: ${OUT_PBF} ($(du -h "${OUT_PBF}" | awk '{print $1}'))"

echo "=== 2) sync prod_mirror.core_protected_areas from production (read-only) ==="
set -a
# shellcheck disable=SC1091
source "${REPO_ROOT}/.env"
set +a
PROD_URL="${SUPABASE_READ_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${PROD_URL}" ]]; then
  echo "error: set SUPABASE_READ_DATABASE_URL or DATABASE_URL for prod_mirror sync" >&2
  exit 1
fi
psql "${PROD_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
  SELECT id, public_id, protected_area_class_id, admin_area_id, geom, centroid, area_m2,
         external_id, source_registry_id, source_snapshot_id, source_feature_type, source_feature_id,
         region_code, source_tags, source_refs, normalized_data, confidence_score,
         is_verified, verification_status, manual_override, is_active, deleted_at, created_at, updated_at
  FROM core.core_protected_areas
) TO STDOUT" > "${ART_DIR}/_prod_protected_areas.copy"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "TRUNCATE prod_mirror.core_protected_areas;"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy prod_mirror.core_protected_areas (
  id, public_id, protected_area_class_id, admin_area_id, geom, centroid, area_m2,
  external_id, source_registry_id, source_snapshot_id, source_feature_type, source_feature_id,
  region_code, source_tags, source_refs, normalized_data, confidence_score,
  is_verified, verification_status, manual_override, is_active, deleted_at, created_at, updated_at
) FROM STDIN" < "${ART_DIR}/_prod_protected_areas.copy"
psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
UPDATE prod_mirror.core_protected_areas SET mirrored_at = now();
UPDATE prod_mirror.mirror_meta SET refreshed_at = now() WHERE id = 1;
SELECT count(*) AS mirrored_protected_areas FROM prod_mirror.core_protected_areas;
"

echo "=== 3) run local-osm pipeline stages 01–10 (protected_areas only) ==="
unset PIPELINE_FROM_STAGE || true
export PIPELINE_TO_STAGE=10
export SKIP_PROD_MIRROR_PREFLIGHT=false
"${SCRIPT_DIR}/run_local_osm_pipeline.sh" "${ENV_FILE}"

echo "=== 4) export classification CSVs + quality summary ==="
SNAP_ID="$(psql "${LOCAL_DATABASE_URL}" -At -c "SELECT id FROM system.system_source_snapshots WHERE snapshot_version='${SNAPSHOT_VERSION}' ORDER BY id DESC LIMIT 1")"
if [[ -z "${SNAP_ID}" ]]; then
  echo "error: snapshot ${SNAPSHOT_VERSION} not found" >&2
  exit 1
fi

PA_SELECT="
  SELECT
    s.id, s.external_id, s.canonical_name, s.class_code, s.protected_area_class_id,
    s.import_class, s.validation_status, s.match_status, s.auto_action, s.eligible_for_core,
    s.area_m2,
    s.normalized_data->>'name_en' AS name_en,
    s.normalized_data->>'name_mm' AS name_mm,
    s.normalized_data->>'name_und' AS name_und,
    s.normalized_data->>'protect_class' AS protect_class,
    s.normalized_data->>'protection_title' AS protection_title,
    s.normalized_data->>'designation' AS designation,
    s.normalized_data->>'boundary' AS boundary,
    s.normalized_data->>'leisure' AS leisure,
    ST_AsEWKT(s.geom) AS geom_ewkt,
    ST_AsEWKT(s.centroid) AS centroid_ewkt,
    s.source_refs::text AS source_refs,
    s.normalized_data::text AS normalized_data,
    s.confidence_score
  FROM staging.staging_protected_area_candidates s
  WHERE s.source_snapshot_id = ${SNAP_ID}
"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
${PA_SELECT} AND s.import_class = 'safe_new' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/protected_areas.safe_new.csv"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
${PA_SELECT} AND s.import_class = 'safe_update' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/protected_areas.safe_update.csv"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
${PA_SELECT} AND (
  s.import_class IN ('conflict','duplicate','manual_protected','verified_conflict')
  OR coalesce(s.auto_action,'') IN ('needs_review','conflict')
) ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/protected_areas.review.csv"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
  SELECT entity_family, osm_feature_type, osm_id, external_id, tag_key, tag_value, reason, tags::text
  FROM staging.staging_osm_unmapped_tags
  WHERE source_snapshot_id = ${SNAP_ID} AND entity_family = 'protected_areas'
  ORDER BY id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/protected_areas.unmapped.csv"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
  SELECT
    s.id, s.external_id, s.class_code, s.import_class, s.area_m2,
    CASE
      WHEN s.area_m2 < 100 THEN 'tiny_lt_100m2'
      WHEN s.area_m2 > 5e9 THEN 'huge_gt_5000km2'
      ELSE NULL
    END AS size_flag,
    NOT ST_IsValid(s.geom) AS invalid_geom,
    ST_IsValidReason(s.geom) AS invalid_reason,
    EXISTS (
      SELECT 1 FROM staging.staging_protected_area_candidates o
      WHERE o.source_snapshot_id = s.source_snapshot_id
        AND o.id <> s.id
        AND o.geom && s.geom
        AND ST_Equals(o.geom, s.geom)
    ) AS duplicate_geometry,
    NOT system.pipeline_geom_in_myanmar_bounds(s.geom) AS outside_land_bbox
  FROM staging.staging_protected_area_candidates s
  WHERE s.source_snapshot_id = ${SNAP_ID}
  ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/protected_areas.spatial_quality.csv"

psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_id="${SNAP_ID}" \
  -f "${SCRIPT_DIR}/export_protected_areas_dry_run.sql" \
  | tee "${ART_DIR}/export_dry_run.log"

python3 - <<PY
import json, pathlib, re
art = pathlib.Path("${ART_DIR}")
log = (art / "export_dry_run.log").read_text()
m = re.search(r"\\{.*\\}", log, re.S)
summary = json.loads(m.group(0)) if m else {"raw": log}
report = pathlib.Path("${REPORT}")
lines = [
  "# Protected areas national dry-run (2026-08-13)",
  "",
  "Local pipeline only. **No production writes.**",
  "",
  f"- Snapshot: `{summary.get('snapshot_id')}` / `${SNAPSHOT_VERSION}`",
  f"- Source PBF filter: boundary=protected_area|national_park, leisure=nature_reserve",
  "",
  "## Counts",
  "",
  f"| Metric | Value |",
  f"|---|---|",
  f"| raw candidates | {summary.get('raw_candidates')} |",
  f"| unique source candidates | {summary.get('unique_source_candidates')} |",
  f"| valid geometry | {summary.get('valid_geometry')} |",
  f"| invalid geometry | {summary.get('invalid_geometry')} |",
  f"| named | {summary.get('named_count')} |",
  f"| Myanmar names | {summary.get('myanmar_name_count')} |",
  f"| English names | {summary.get('english_name_count')} |",
  "",
  "## Class distribution",
  "",
  "```json",
  json.dumps(summary.get("class_distribution"), indent=2, ensure_ascii=False),
  "```",
  "",
  "## Import class distribution",
  "",
  "```json",
  json.dumps(summary.get("import_class_distribution"), indent=2, ensure_ascii=False),
  "```",
  "",
  "## Spatial quality",
  "",
  "```json",
  json.dumps(summary.get("spatial"), indent=2, ensure_ascii=False),
  "```",
  "",
  "## Top unmapped (not auto-added to ref)",
  "",
  "### protect_class",
  "```json",
  json.dumps(summary.get("top_unmapped_protect_class"), indent=2, ensure_ascii=False),
  "```",
  "",
  "### designation",
  "```json",
  json.dumps(summary.get("top_unmapped_designation"), indent=2, ensure_ascii=False),
  "```",
  "",
  "### protection_title",
  "```json",
  json.dumps(summary.get("top_unmapped_protection_title"), indent=2, ensure_ascii=False),
  "```",
  "",
  "## Artifacts",
  "",
  f"- `{art / 'protected_areas.safe_new.csv'}`",
  f"- `{art / 'protected_areas.safe_update.csv'}`",
  f"- `{art / 'protected_areas.review.csv'}`",
  f"- `{art / 'protected_areas.unmapped.csv'}`",
  f"- `{art / 'protected_areas.spatial_quality.csv'}`",
  "",
]
report.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
print("wrote", report)
PY

echo "=== done (local dry-run only; production untouched) ==="
echo "artifacts: ${ART_DIR}"
echo "report: ${REPORT}"
