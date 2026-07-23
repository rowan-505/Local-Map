#!/usr/bin/env bash
# Export local staging roads → target import_work.road_rows.
# Default mode is dry_run (export + report only). Production writes need:
#   --target production --apply --confirmation 'PRELOAD roads <batch_code>'
#
# Usage:
#   ./yangon_roads_preload.sh --target production --batch-code ... --snapshot-id 12 \
#     --snapshot-version ... --limit 500 [--classification safe_update]
#   ./yangon_roads_preload.sh --target production --batch-code ... --allowlist-probe --limit 5
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

TARGET=""
MODE="dry_run"
CONFIRMATION=""
BATCH_CODE=""
SNAPSHOT_ID=""
SNAPSHOT_VERSION=""
LIMIT="0"
CLASSIFICATION="safe_update"
EXPORT_MODE="staging" # staging | allowlist_probe
ENV_FILE=""
FAMILY="roads"

usage() {
  cat <<'EOF'
usage: yangon_roads_preload.sh --target local|production --batch-code <code> [options]

Options:
  --env-file PATH
  --batch-code CODE
  --snapshot-id N
  --snapshot-version TEXT
  --limit N
  --classification safe_update|safe_new
  --allowlist-probe      export allowlist probe sample (was --mode allowlist_probe)
  --mode dry_run|apply   (default: dry_run)
  --apply                shorthand for --mode apply
  --confirmation TEXT    production apply: PRELOAD roads <batch_code>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --batch-code|--batch) BATCH_CODE="${2:-}"; shift 2 ;;
    --snapshot-id) SNAPSHOT_ID="${2:-}"; shift 2 ;;
    --snapshot-version) SNAPSHOT_VERSION="${2:-}"; shift 2 ;;
    --limit) LIMIT="${2:-0}"; shift 2 ;;
    --classification) CLASSIFICATION="${2:-}"; shift 2 ;;
    --allowlist-probe) EXPORT_MODE="allowlist_probe"; shift ;;
    --mode)
      case "${2:-}" in
        dry_run|apply) MODE="${2}"; shift 2 ;;
        # Back-compat: old --mode staging|allowlist_probe
        staging) EXPORT_MODE="staging"; shift 2 ;;
        allowlist_probe) EXPORT_MODE="allowlist_probe"; shift 2 ;;
        *) safe_loader_die "unknown --mode: ${2:-} (want dry_run|apply, or legacy staging|allowlist_probe)" ;;
      esac
      ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      # Back-compat: bare env file path as first positional
      if [[ -z "${ENV_FILE}" && -f "$1" ]]; then ENV_FILE="$1"; shift; continue; fi
      safe_loader_die "unknown argument: $1"
      ;;
  esac
done

if [[ -n "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

# Default env for URLs
if [[ -z "${LOCAL_DATABASE_URL:-}" || -z "${SUPABASE_DATABASE_URL:-}${SUPABASE_WRITE_DATABASE_URL:-}" ]]; then
  FALLBACK="${SCRIPT_DIR}/../local-osm/imports/yangon_roads_pilot_2026_07_23.env"
  if [[ -f "${FALLBACK}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${FALLBACK}"
    set +a
  fi
fi

[[ -n "${TARGET}" ]] || { usage >&2; safe_loader_die "missing --target"; }
[[ -n "${BATCH_CODE}" ]] || { usage >&2; safe_loader_die "missing --batch-code"; }

safe_loader_preload_preflight "${TARGET}" "${MODE}" "${FAMILY}" "${BATCH_CODE}" "${CONFIRMATION}"

TMP_CSV="$(mktemp -t yangon_roads_XXXXXX.csv)"
trap 'rm -f "${TMP_CSV}"' EXIT

if [[ "${EXPORT_MODE}" == "allowlist_probe" ]]; then
  SNAPSHOT_ID="${SNAPSHOT_ID:-12}"
  SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_07_21_yangon_roads_5k_v1}"
  LIMIT="${LIMIT:-5}"
  echo "=== allowlist_probe: export ${LIMIT} matched roads with forced surface tag ==="
  PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "\\copy (
    WITH sample AS (
      SELECT s.*
      FROM staging.staging_road_candidates AS s
      WHERE s.source_snapshot_id = ${SNAPSHOT_ID}
      ORDER BY s.id
      LIMIT ${LIMIT}
    )
    SELECT
      s.external_id,
      'safe_update'::text AS classification,
      s.canonical_name,
      NULL::text AS name_en,
      NULL::text AS name_mm,
      coalesce(s.class_code, p.road_class) AS class_code,
      ST_AsText(s.geom) AS geom_wkt,
      coalesce(s.is_oneway, false) AS is_oneway,
      false AS bridge,
      false AS tunnel,
      0 AS layer,
      'asphalt'::text AS surface,
      p.admin_area_id,
      coalesce(s.confidence_score, 70) AS confidence_score,
      coalesce(s.source_refs, '{}'::jsonb)::text AS source_refs,
      (coalesce(s.normalized_data, '{}'::jsonb) || jsonb_build_object('probe','allowlist_surface'))::text AS normalized_data,
      NULL::text AS source_hash,
      s.id AS local_staging_id,
      p.core_id AS target_core_id
    FROM sample AS s
    JOIN prod_mirror.core_streets AS p
      ON p.external_id = s.external_id
    WHERE p.deleted_at IS NULL
  ) TO '${TMP_CSV}' WITH (FORMAT csv, HEADER true)"
else
  [[ -n "${SNAPSHOT_ID}" ]] || safe_loader_die "missing --snapshot-id"
  [[ -n "${SNAPSHOT_VERSION}" ]] || safe_loader_die "missing --snapshot-version"
  echo "=== export staging snap=${SNAPSHOT_ID} class=${CLASSIFICATION} limit=${LIMIT} ==="
  LIMIT_SQL=""
  if [[ "${LIMIT}" != "0" ]]; then
    LIMIT_SQL="LIMIT ${LIMIT}"
  fi
  PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "\\copy (
    SELECT
      s.external_id,
      s.import_class AS classification,
      s.canonical_name,
      NULL::text AS name_en,
      NULL::text AS name_mm,
      s.class_code,
      ST_AsText(s.geom) AS geom_wkt,
      coalesce(s.is_oneway, false) AS is_oneway,
      coalesce((s.normalized_data->>'bridge') IN ('yes','true','1'), false) AS bridge,
      coalesce((s.normalized_data->>'tunnel') IN ('yes','true','1'), false) AS tunnel,
      coalesce(nullif(btrim(s.normalized_data->>'layer'), '')::int, 0) AS layer,
      nullif(btrim(coalesce(s.normalized_data->>'surface', s.normalized_data->'tags'->>'surface')), '') AS surface,
      NULL::bigint AS admin_area_id,
      s.confidence_score,
      coalesce(s.source_refs, '{}'::jsonb)::text AS source_refs,
      coalesce(s.normalized_data, '{}'::jsonb)::text AS normalized_data,
      NULL::text AS source_hash,
      s.id AS local_staging_id,
      p.core_id AS target_core_id
    FROM staging.staging_road_candidates AS s
    LEFT JOIN prod_mirror.core_streets AS p
      ON system.pipeline_osm_identity_key(p.external_id)
       = system.pipeline_osm_identity_key(s.external_id)
      AND p.deleted_at IS NULL
    WHERE s.source_snapshot_id = ${SNAPSHOT_ID}
      AND s.import_class = '${CLASSIFICATION}'
    ORDER BY s.id
    ${LIMIT_SQL}
  ) TO '${TMP_CSV}' WITH (FORMAT csv, HEADER true)"
fi

ROWS="$(python3 -c "import csv; print(sum(1 for _ in open('${TMP_CSV}'))-1)")"
echo "exported_rows=${ROWS}"
if [[ "${ROWS}" -le 0 ]]; then
  safe_loader_die "exported 0 rows"
fi

if ! safe_loader_preload_should_write "${MODE}"; then
  echo "dry_run: skipping import_work write (would preload ${ROWS} rows into batch_code=${BATCH_CODE})"
  echo "to apply: --target ${TARGET} --apply --confirmation 'PRELOAD ${FAMILY} ${BATCH_CODE}'"
  exit 0
fi

PAGER=cat psql "${SAFE_LOADER_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -v batch_code="${BATCH_CODE}" \
  -v snapshot_id="${SNAPSHOT_ID}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" <<SQL
\\set ON_ERROR_STOP on
DROP TABLE IF EXISTS yangon_road_export_raw;
CREATE TEMP TABLE yangon_road_export_raw (
    external_id text,
    classification text,
    canonical_name text,
    name_en text,
    name_mm text,
    class_code text,
    geom_wkt text,
    is_oneway boolean,
    bridge boolean,
    tunnel boolean,
    layer integer,
    surface text,
    admin_area_id bigint,
    confidence_score numeric,
    source_refs text,
    normalized_data text,
    source_hash text,
    local_staging_id bigint,
    target_core_id bigint
);
\\copy yangon_road_export_raw FROM '${TMP_CSV}' WITH (FORMAT csv, HEADER true);

DROP TABLE IF EXISTS yangon_road_export;
CREATE TEMP TABLE yangon_road_export AS
SELECT
    external_id,
    classification,
    canonical_name,
    name_en,
    name_mm,
    class_code,
    ST_SetSRID(ST_GeomFromText(geom_wkt), 4326) AS geom,
    is_oneway,
    bridge,
    tunnel,
    layer,
    surface,
    admin_area_id,
    confidence_score,
    source_refs::jsonb,
    normalized_data::jsonb,
    source_hash,
    local_staging_id,
    target_core_id
FROM yangon_road_export_raw;

\\ir ${SCRIPT_DIR}/yangon_roads_preload.sql
SQL

echo "preload complete batch_code=${BATCH_CODE} rows=${ROWS}"
