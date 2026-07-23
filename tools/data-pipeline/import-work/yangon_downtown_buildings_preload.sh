#!/usr/bin/env bash
# Export Yangon downtown safe_new buildings from LOCAL staging → import_work.
# Does not write core.*.
#
# Default mode is dry_run (export + report only). Production writes need:
#   --target production --apply --confirmation 'PRELOAD buildings <batch_code>'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

TARGET=""
MODE="dry_run"
CONFIRMATION=""
ENV_FILE=""
BATCH_CODE="${BATCH_CODE:-buildings_yangon_downtown_safe_2026_07_23}"
SNAPSHOT_ID="${SNAPSHOT_ID:-10}"
SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_07_21_yangon_downtown_sample_v1}"
FAMILY="buildings"

usage() {
  cat <<'EOF'
usage: yangon_downtown_buildings_preload.sh --target local|production [options]

Options:
  --env-file PATH
  --batch-code CODE
  --snapshot-id N
  --snapshot-version TEXT
  --mode dry_run|apply   (default: dry_run)
  --apply                shorthand for --mode apply
  --confirmation TEXT    production apply: PRELOAD buildings <batch_code>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --batch-code|--batch) BATCH_CODE="${2:-}"; shift 2 ;;
    --snapshot-id) SNAPSHOT_ID="${2:-}"; shift 2 ;;
    --snapshot-version) SNAPSHOT_VERSION="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      # Back-compat: bare env file path as first positional
      if [[ -z "${ENV_FILE}" && -f "$1" ]]; then ENV_FILE="$1"; shift; continue; fi
      safe_loader_die "unknown argument: $1"
      ;;
  esac
done

ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../local-osm/imports/yangon_city_production_pilot_2026_07_23.env}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

[[ -n "${TARGET}" ]] || { usage >&2; safe_loader_die "missing --target local|production"; }

safe_loader_preload_preflight "${TARGET}" "${MODE}" "${FAMILY}" "${BATCH_CODE}" "${CONFIRMATION}"

TMP_CSV="$(mktemp -t yangon_buildings_XXXXXX.csv)"
TMP_SQL="$(mktemp -t yangon_buildings_XXXXXX.sql)"
trap 'rm -f "${TMP_CSV}" "${TMP_SQL}"' EXIT

echo "=== export local staging (snapshot_id=${SNAPSHOT_ID}, safe_new only) ==="
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "\\copy (
  SELECT
    s.external_id,
    s.import_class AS classification,
    s.canonical_name,
    nullif(btrim(coalesce(s.normalized_data->'tags'->>'name:en', '')), '') AS name_en,
    nullif(btrim(coalesce(
      s.normalized_data->'tags'->>'name:my',
      s.normalized_data->'tags'->>'name:mm',
      s.normalized_data->'tags'->>'name:my-MM',
      ''
    )), '') AS name_mm,
    s.class_code,
    ST_AsText(s.geom) AS geom_wkt,
    coalesce(
      nullif(s.normalized_data->'building'->>'area_m2', '')::numeric,
      ST_Area(s.geom::geography)::numeric
    ) AS area_m2,
    NULLIF(regexp_replace(coalesce(s.normalized_data->'tags'->>'building:levels', ''), '[^0-9].*', ''), '')::integer AS levels,
    NULLIF(regexp_replace(coalesce(s.normalized_data->'tags'->>'height', ''), '[^0-9.].*', ''), '')::numeric AS height_m,
    s.confidence_score,
    coalesce(s.source_refs, '{}'::jsonb)::text AS source_refs,
    coalesce(s.normalized_data, '{}'::jsonb)::text AS normalized_data,
    s.normalized_hash AS source_hash,
    s.core_selection_reason,
    NULL::bigint AS admin_area_id
  FROM staging.staging_building_candidates AS s
  WHERE s.source_snapshot_id = ${SNAPSHOT_ID}
    AND s.import_class = 'safe_new'
    AND s.eligible_for_core IS TRUE
    AND coalesce(s.pmtiles_only_reason, '') = ''
  ORDER BY s.id
) TO '${TMP_CSV}' WITH (FORMAT csv, HEADER true)"

ROWS="$(python3 -c "import csv; print(sum(1 for _ in open('${TMP_CSV}'))-1)")"
echo "exported_rows=${ROWS}"
if [[ "${ROWS}" -le 0 || "${ROWS}" -gt 200 ]]; then
  safe_loader_die "unexpected export size ${ROWS} (want 1..200 for downtown pilot)"
fi

if ! safe_loader_preload_should_write "${MODE}"; then
  echo "dry_run: skipping import_work write (would preload ${ROWS} rows into batch_code=${BATCH_CODE})"
  echo "to apply: --target ${TARGET} --apply --confirmation 'PRELOAD ${FAMILY} ${BATCH_CODE}'"
  exit 0
fi

cat > "${TMP_SQL}" <<SQL
\\set ON_ERROR_STOP on
DROP TABLE IF EXISTS yangon_downtown_building_export_raw;
CREATE TEMP TABLE yangon_downtown_building_export_raw (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom_wkt text,
    area_m2 numeric,
    levels integer,
    height_m numeric,
    confidence_score numeric,
    source_refs text,
    normalized_data text,
    source_hash text,
    core_selection_reason text,
    admin_area_id bigint
);
\\copy yangon_downtown_building_export_raw FROM '${TMP_CSV}' WITH (FORMAT csv, HEADER true);

DROP TABLE IF EXISTS yangon_downtown_building_export;
CREATE TEMP TABLE yangon_downtown_building_export AS
SELECT
    external_id,
    classification,
    canonical_name,
    name_en,
    name_mm,
    class_code,
    ST_SetSRID(ST_GeomFromText(geom_wkt), 4326) AS geom,
    area_m2,
    levels,
    height_m,
    confidence_score,
    source_refs::jsonb AS source_refs,
    normalized_data::jsonb AS normalized_data,
    source_hash,
    core_selection_reason,
    admin_area_id
FROM yangon_downtown_building_export_raw;

\\ir ${SCRIPT_DIR}/yangon_downtown_buildings_preload.sql
SQL

echo "=== load into import_work batch=${BATCH_CODE} ==="
PAGER=cat psql "${SAFE_LOADER_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v batch_code="${BATCH_CODE}" \
  -v snapshot_id="${SNAPSHOT_ID}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -f "${TMP_SQL}"

echo "preload finished batch_code=${BATCH_CODE} rows=${ROWS}"
