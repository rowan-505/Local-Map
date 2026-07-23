#!/usr/bin/env bash
# Fast Yangon downtown SAMPLE family classify with live % logs.
# Flow: stage 05 → keep named (+ optional row cap) → stages 06–10.
# Does NOT write core. Does NOT upload Import Review by default.
# Local writes only — refuses --target production.
#
# Usage:
#   ./scripts/run_yangon_downtown_family_sample.sh <family> [sample_limit]
# family: buildings | landuse | water_lines | water_polygons | roads | places
# sample_limit: max named rows kept before F2 (default 80; 0 = all named)
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

FAMILY="${1:-}"
SAMPLE_LIMIT="${2:-80}"
if [[ -z "${FAMILY}" || "${FAMILY}" == --* ]]; then
  echo "usage: $(basename "$0") <family> [sample_limit]" >&2
  exit 1
fi

BASE_ENV="${SCRIPT_DIR}/imports/yangon_downtown_sample_2026_07_23.env"
if [[ ! -f "${BASE_ENV}" ]]; then
  echo "error: missing ${BASE_ENV}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "${BASE_ENV}"; set +a
# shellcheck source=../lib/database_target_safety.sh
source "${SCRIPT_DIR}/../lib/database_target_safety.sh"
DB_TARGET=local
db_target_refuse_production_for_sample "run_yangon_downtown_family_sample.sh"
[[ -n "${LOCAL_DATABASE_URL:-}" ]] || {
  echo "error: LOCAL_DATABASE_URL is required (no DATABASE_URL fallback)" >&2
  exit 1
}
db_target_refuse_ambiguous_local_vs_production
echo "LOCAL_DATABASE_URL=$(db_target_mask_url "${LOCAL_DATABASE_URL}")"

staging_table_for_family() {
  case "$1" in
    buildings) echo staging_building_candidates ;;
    landuse) echo staging_landuse_candidates ;;
    water_lines) echo staging_water_line_candidates ;;
    water_polygons) echo staging_water_polygon_candidates ;;
    roads) echo staging_road_candidates ;;
    places) echo staging_place_candidates ;;
    *) echo "" ;;
  esac
}

TABLE="$(staging_table_for_family "${FAMILY}")"
if [[ -z "${TABLE}" ]]; then
  echo "error: unsupported family=${FAMILY}" >&2
  exit 1
fi

ENV_EXTRACT="${SCRIPT_DIR}/imports/yangon_downtown_sample_${FAMILY}_extract.env"
ENV_COMPARE="${SCRIPT_DIR}/imports/yangon_downtown_sample_${FAMILY}_compare.env"
cp "${BASE_ENV}" "${ENV_EXTRACT}"
cp "${BASE_ENV}" "${ENV_COMPARE}"
{
  echo ""
  echo "export ENTITY_FAMILIES='${FAMILY}'"
  echo "export PIPELINE_FROM_STAGE='05'"
  echo "export PIPELINE_TO_STAGE='05'"
  echo "export BATCH_NAME=\"yangon_downtown_${FAMILY}_sample_extract_2026_07_23\""
  echo "export REMOTE_REVIEW_UPLOAD_ENABLED=false"
  echo "export CLASSIFICATION_REPORT_ENABLED=false"
} >> "${ENV_EXTRACT}"
{
  echo ""
  echo "export ENTITY_FAMILIES='${FAMILY}'"
  echo "export PIPELINE_FROM_STAGE='06'"
  echo "export BATCH_NAME=\"yangon_downtown_${FAMILY}_sample_compare_2026_07_23\""
  echo "export REMOTE_REVIEW_UPLOAD_ENABLED=false"
  echo "export CLASSIFICATION_REPORT_ENABLED=true"
} >> "${ENV_COMPARE}"

filter_progress() {
  while IFS= read -r line; do
    ts="$(date -u +"%H:%M:%S")"
    if [[ "${line}" == *"=== "* ]] || [[ "${line}" == *"[pipeline "* ]] || [[ "${line}" == *"finished"* ]] \
      || [[ "${line}" == *"NOTICE"* && ( "${line}" == *"%"* || "${line}" == *"stage07"* ) ]] \
      || [[ "${line}" == *"ERROR"* ]] || [[ "${line}" == *"error:"* ]]; then
      printf '[%s] %s\n' "${ts}" "${line}"
    fi
  done
}

echo "=== downtown sample family=${FAMILY} sample_limit=${SAMPLE_LIMIT} ==="
START=$(date +%s)

echo "[progress] stage 05 extract only..."
stdbuf -oL -eL ./run_local_osm_pipeline.sh "${ENV_EXTRACT}" 2>&1 | filter_progress

echo "[progress] keep named (+ cap) on staging.${TABLE}..."
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v staging_table="${TABLE}" \
  -v sample_limit="${SAMPLE_LIMIT}" <<'SQL'
CREATE TEMP TABLE sample_filter_params (
  snapshot_version text NOT NULL,
  staging_table text NOT NULL,
  sample_limit integer NOT NULL
);
INSERT INTO sample_filter_params (snapshot_version, staging_table, sample_limit)
VALUES (
  :'snapshot_version',
  :'staging_table',
  greatest(coalesce(NULLIF(btrim(:'sample_limit'), '')::integer, 0), 0)
);

DO $$
DECLARE
  v_snapshot_id bigint;
  v_before bigint;
  v_after_named bigint;
  v_after_cap bigint;
  v_limit integer;
  v_table text;
  v_snapshot_version text;
BEGIN
  SELECT snapshot_version, staging_table, sample_limit
  INTO v_snapshot_version, v_table, v_limit
  FROM sample_filter_params;

  SELECT id INTO v_snapshot_id
  FROM system.system_source_snapshots
  WHERE snapshot_version = v_snapshot_version;
  IF v_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'snapshot not found: %', v_snapshot_version;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM staging.%I WHERE source_snapshot_id = $1',
    v_table
  ) INTO v_before USING v_snapshot_id;

  EXECUTE format(
    $q$
    DELETE FROM staging.%I
    WHERE source_snapshot_id = $1
      AND nullif(btrim(canonical_name), '') IS NULL
    $q$,
    v_table
  ) USING v_snapshot_id;

  EXECUTE format(
    'SELECT count(*) FROM staging.%I WHERE source_snapshot_id = $1',
    v_table
  ) INTO v_after_named USING v_snapshot_id;

  IF v_limit > 0 AND v_after_named > v_limit THEN
    EXECUTE format(
      $q$
      DELETE FROM staging.%I
      WHERE id IN (
        SELECT id
        FROM staging.%I
        WHERE source_snapshot_id = $1
        ORDER BY id
        OFFSET $2
      )
      $q$,
      v_table,
      v_table
    ) USING v_snapshot_id, v_limit;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM staging.%I WHERE source_snapshot_id = $1',
    v_table
  ) INTO v_after_cap USING v_snapshot_id;

  RAISE NOTICE 'sample_filter [100%%] table=% before=% named=% kept=% limit=%',
    v_table, v_before, v_after_named, v_after_cap, v_limit;
END $$;
SQL

echo "[progress] stages 06–10 compare/classify..."
stdbuf -oL -eL ./run_local_osm_pipeline.sh "${ENV_COMPARE}" 2>&1 | filter_progress

END=$(date +%s)
echo "DURATION_SEC=$((END-START)) family=${FAMILY}"

PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
SELECT '${FAMILY}' AS family_run, import_class, count(*) AS n
FROM staging.${TABLE}
WHERE source_snapshot_id = (
  SELECT id FROM system.system_source_snapshots
  WHERE snapshot_version = '${SNAPSHOT_VERSION}'
)
GROUP BY 1, 2
ORDER BY n DESC;
SQL
