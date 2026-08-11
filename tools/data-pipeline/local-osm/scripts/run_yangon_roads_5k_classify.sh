#!/usr/bin/env bash
# Read-only Yangon roads F2 classify precondition (5000 roads).
# Copies a Yangon-intersecting subset from national staging snap 8 into a
# dedicated snapshot, then runs stages 06–10. Does NOT write core.
# Local writes only — refuses --target production.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${SCRIPT_DIR}"
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH}"

for arg in "$@"; do
  case "${arg}" in
    --target=production|--target=prod|--target=local)
      echo "error: this sample script refuses --target (local writes only)." >&2
      exit 1
      ;;
    --target)
      echo "error: this sample script refuses --target (local writes only)." >&2
      exit 1
      ;;
  esac
done
prev=""
for arg in "$@"; do
  if [[ "${prev}" == "--target" ]]; then
    echo "error: this sample script refuses --target ${arg} (local writes only)." >&2
    exit 1
  fi
  prev="${arg}"
done

SAMPLE_LIMIT="${1:-5000}"
if [[ "${SAMPLE_LIMIT}" == --* ]]; then
  echo "usage: $(basename "$0") [sample_limit]" >&2
  exit 1
fi
BASE_ENV="${SCRIPT_DIR}/imports/yangon_roads_pilot_2026_07_23.env"
[[ -f "${BASE_ENV}" ]] || { echo "missing ${BASE_ENV}" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "${BASE_ENV}"
set +a

# shellcheck source=../lib/database_target_safety.sh
source "${SCRIPT_DIR}/../lib/database_target_safety.sh"
DB_TARGET=local
db_target_refuse_production_for_sample "run_yangon_roads_5k_classify.sh"
[[ -n "${LOCAL_DATABASE_URL:-}" ]] || {
  echo "error: LOCAL_DATABASE_URL is required (no DATABASE_URL fallback)" >&2
  exit 1
}
db_target_refuse_ambiguous_local_vs_production
echo "LOCAL_DATABASE_URL=$(db_target_mask_url "${LOCAL_DATABASE_URL}")"

SNAPSHOT_VERSION="osm_myanmar_2026_07_21_yangon_roads_5k_v1"
SNAPSHOT_REF="yangon-roads-5k-from-snap8"
BATCH_NAME="yangon_roads_5k_classify_2026_07_23"

echo "=== yangon roads 5k classify sample_limit=${SAMPLE_LIMIT} ==="
START=$(date +%s)

PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v sample_limit="${SAMPLE_LIMIT}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v snapshot_ref="${SNAPSHOT_REF}" <<'SQL'
\pset pager off
\timing on

DO $$
DECLARE
  v_limit integer := greatest(coalesce(NULLIF(current_setting('pipeline.sample_limit', true), '')::integer, 0), 0);
BEGIN
  -- placeholder; vars come from psql -v below via temp params
  NULL;
END $$;

CREATE TEMP TABLE params (
  sample_limit integer NOT NULL,
  snapshot_version text NOT NULL,
  snapshot_ref text NOT NULL
);
INSERT INTO params VALUES (
  greatest(coalesce(NULLIF(btrim(:'sample_limit'), '')::integer, 5000), 1),
  btrim(:'snapshot_version'),
  btrim(:'snapshot_ref')
);

DO $$
DECLARE
  v_src_registry bigint;
  v_import_batch bigint;
  v_boundary bigint;
  v_snap_id bigint;
  v_limit integer;
  v_version text;
  v_ref text;
  v_before bigint;
  v_after bigint;
  v_admin geometry;
BEGIN
  SELECT sample_limit, snapshot_version, snapshot_ref
  INTO v_limit, v_version, v_ref FROM params;

  -- Production Yangon city polygon (prod_mirror id 5271 ≈ former local clip 2043).
  SELECT geom INTO v_admin
  FROM prod_mirror.core_admin_areas
  WHERE id = 5271 AND deleted_at IS NULL;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'prod_mirror admin area 5271 (ရန်ကုန်မြို့) missing — refresh prod_mirror';
  END IF;

  SELECT source_registry_id, import_batch_id, boundary_id
  INTO v_src_registry, v_import_batch, v_boundary
  FROM system.system_source_snapshots WHERE id = 9;

  INSERT INTO system.system_source_snapshots (
    source_registry_id, import_batch_id, snapshot_ref, snapshot_version,
    region_code, captured_at, boundary_id
  )
  SELECT
    v_src_registry, v_import_batch, v_ref, v_version,
    'MM-YANGON', now(), v_boundary
  WHERE NOT EXISTS (
    SELECT 1 FROM system.system_source_snapshots WHERE snapshot_version = v_version
  );

  SELECT id INTO v_snap_id
  FROM system.system_source_snapshots WHERE snapshot_version = v_version;

  DELETE FROM staging.staging_road_candidates WHERE source_snapshot_id = v_snap_id;

  INSERT INTO staging.staging_road_candidates (
    source_snapshot_id, external_id, canonical_name, road_class_id, geom,
    is_oneway, length_m, confidence_score, match_status, matched_core_edge_id,
    normalized_data, source_refs, raw_id, class_code, auto_action,
    review_status, review_decision, normalized_hash, validation_status,
    validation_notes, source_status, geometry_hash
  )
  SELECT
    v_snap_id, s.external_id, s.canonical_name, s.road_class_id, s.geom,
    s.is_oneway, s.length_m, s.confidence_score,
    coalesce(nullif(btrim(s.match_status), ''), 'new_auto'),
    NULL,
    coalesce(s.normalized_data, '{}'::jsonb),
    coalesce(s.source_refs, '{}'::jsonb),
    s.raw_id, s.class_code, NULL,
    coalesce(s.review_status, 'pending'),
    NULL,
    s.normalized_hash,
    coalesce(s.validation_status, 'pending'),
    s.validation_notes, s.source_status, s.geometry_hash
  FROM staging.staging_road_candidates AS s
  WHERE s.source_snapshot_id = 8
    AND s.geom && v_admin
    AND ST_Intersects(s.geom, v_admin)
  ORDER BY s.id
  LIMIT v_limit;

  GET DIAGNOSTICS v_after = ROW_COUNT;

  SELECT count(*) INTO v_before
  FROM staging.staging_road_candidates WHERE source_snapshot_id = v_snap_id;

  RAISE NOTICE 'yangon_5k_roads [100%%] snapshot_id=% copied=% kept=% limit=%',
    v_snap_id, v_after, v_before, v_limit;

  IF v_before < least(v_limit, 1000) THEN
    RAISE EXCEPTION 'copied too few roads (%); abort', v_before;
  END IF;
END $$;

SELECT id AS snapshot_id, snapshot_version
FROM system.system_source_snapshots
WHERE snapshot_version = :'snapshot_version';

SELECT count(*) AS staged_roads
FROM staging.staging_road_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots
  WHERE snapshot_version = :'snapshot_version'
);
SQL

ENV_COMPARE="${SCRIPT_DIR}/imports/yangon_roads_5k_classify.env"
cp "${BASE_ENV}" "${ENV_COMPARE}"
{
  echo ""
  echo "export SNAPSHOT_VERSION='${SNAPSHOT_VERSION}'"
  echo "export SNAPSHOT_REF='${SNAPSHOT_REF}'"
  echo "export ENTITY_FAMILIES='roads'"
  echo "export PIPELINE_FROM_STAGE='06'"
  echo "export PIPELINE_TO_STAGE='10'"
  echo "export BATCH_NAME='${BATCH_NAME}'"
  echo "export REMOTE_REVIEW_UPLOAD_ENABLED=false"
  echo "export CLASSIFICATION_REPORT_ENABLED=true"
} >> "${ENV_COMPARE}"

filter_progress() {
  while IFS= read -r line; do
    ts="$(date -u +"%H:%M:%S")"
    if [[ "${line}" == *"=== "* ]] || [[ "${line}" == *"[pipeline "* ]] || [[ "${line}" == *"finished"* ]] \
      || [[ "${line}" == *"NOTICE"* && ( "${line}" == *"%"* || "${line}" == *"stage07"* || "${line}" == *"yangon_5k"* ) ]] \
      || [[ "${line}" == *"ERROR"* ]] || [[ "${line}" == *"error:"* ]]; then
      printf '[%s] %s\n' "${ts}" "${line}"
    fi
  done
}

echo "[progress] stages 06–10 compare/classify..."
stdbuf -oL -eL ./run_local_osm_pipeline.sh "${ENV_COMPARE}" 2>&1 | filter_progress

END=$(date +%s)
echo "DURATION_SEC=$((END-START))"

PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
\pset pager off
SELECT import_class, count(*) AS n
FROM staging.staging_road_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots
  WHERE snapshot_version = '${SNAPSHOT_VERSION}'
)
GROUP BY 1
ORDER BY n DESC;

SELECT
  count(*) FILTER (WHERE import_class = 'unchanged') AS unchanged,
  count(*) FILTER (WHERE import_class = 'safe_update') AS safe_update,
  count(*) FILTER (WHERE import_class = 'safe_new') AS safe_new,
  count(*) FILTER (WHERE import_class = 'conflict') AS conflict,
  count(*) FILTER (WHERE import_class IN ('manual_protected','verified_conflict')) AS protected,
  count(*) AS total,
  round(
    100.0 * count(*) FILTER (WHERE import_class = 'unchanged')
    / nullif(count(*) FILTER (WHERE import_class IN ('unchanged','safe_update','conflict','manual_protected','verified_conflict')), 0),
    2
  ) AS pct_unchanged_among_matched
FROM staging.staging_road_candidates
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots
  WHERE snapshot_version = '${SNAPSHOT_VERSION}'
);
SQL
