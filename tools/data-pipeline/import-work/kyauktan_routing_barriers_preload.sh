#!/usr/bin/env bash
# Export Kyauktan safe_new routing barriers from LOCAL staging → import_work.
# Does not write routing.* core and does not rebuild Valhalla.
#
# Default mode is dry_run (export + report only). Production writes need:
#   --target production --apply --confirmation 'PRELOAD routing_barriers <batch_code>'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

TARGET=""
MODE="dry_run"
CONFIRMATION=""
ENV_FILE=""
BATCH_CODE="${BATCH_CODE:-routing_barriers_kyauktan_safe_2026_07_23}"
CLI_SNAPSHOT_ID=""
CLI_SNAPSHOT_VERSION=""
FAMILY="routing_barriers"

usage() {
  cat <<'EOF'
usage: kyauktan_routing_barriers_preload.sh --target local|production [options]

Options:
  --env-file PATH
  --batch-code CODE
  --snapshot-id N
  --snapshot-version TEXT
  --mode dry_run|apply   (default: dry_run)
  --apply                shorthand for --mode apply
  --confirmation TEXT    production apply: PRELOAD routing_barriers <batch_code>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --batch-code|--batch) BATCH_CODE="${2:-}"; shift 2 ;;
    --snapshot-id) CLI_SNAPSHOT_ID="${2:-}"; shift 2 ;;
    --snapshot-version) CLI_SNAPSHOT_VERSION="${2:-}"; shift 2 ;;
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

ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../local-osm/imports/kyauktan_2026_05_15_v2.env}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# Prefer kyauktan env; fall back to yangon pilot env for production URL if needed.
if [[ -z "${SUPABASE_DATABASE_URL:-}${SUPABASE_WRITE_DATABASE_URL:-}" ]]; then
  FALLBACK="${SCRIPT_DIR}/../local-osm/imports/yangon_city_production_pilot_2026_07_23.env"
  if [[ -f "${FALLBACK}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${FALLBACK}"
    set +a
  fi
fi

BATCH_CODE="${BATCH_CODE:-routing_barriers_kyauktan_safe_2026_07_23}"
SNAPSHOT_ID="${CLI_SNAPSHOT_ID:-${SNAPSHOT_ID_OVERRIDE:-4}}"
SNAPSHOT_VERSION="${CLI_SNAPSHOT_VERSION:-${SNAPSHOT_VERSION_OVERRIDE:-osm_myanmar_2026_05_15_kyauktan_v2}}"

[[ -n "${TARGET}" ]] || { usage >&2; safe_loader_die "missing --target local|production"; }

safe_loader_preload_preflight "${TARGET}" "${MODE}" "${FAMILY}" "${BATCH_CODE}" "${CONFIRMATION}"

TMP_CSV="$(mktemp -t kyauktan_rbar_XXXXXX.csv)"
TMP_SQL="$(mktemp -t kyauktan_rbar_XXXXXX.sql)"
trap 'rm -f "${TMP_CSV}" "${TMP_SQL}"' EXIT

echo "=== export local staging (snapshot_id=${SNAPSHOT_ID}, safe_new/safe_update) ==="
PAGER=cat psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "\\copy (
  SELECT
    s.external_id,
    s.import_class AS classification,
    s.barrier_type,
    coalesce(s.access_tags, '{}'::jsonb)::text AS access_tags,
    CASE WHEN s.point_geom IS NOT NULL THEN ST_AsText(s.point_geom) ELSE NULL END AS point_wkt,
    CASE WHEN s.geom IS NOT NULL THEN ST_AsText(s.geom) ELSE NULL END AS geom_wkt,
    s.confidence_score,
    coalesce(s.source_refs, '{}'::jsonb)::text AS source_refs,
    coalesce(s.normalized_data, '{}'::jsonb)::text AS normalized_data,
    NULL::text AS source_hash,
    s.id AS local_staging_id
  FROM staging.staging_routing_barrier_candidates AS s
  WHERE s.source_snapshot_id = ${SNAPSHOT_ID}
    AND s.import_class IN ('safe_new', 'safe_update')
  ORDER BY s.id
) TO '${TMP_CSV}' WITH (FORMAT csv, HEADER true)"

ROWS="$(python3 -c "import csv; print(sum(1 for _ in open('${TMP_CSV}'))-1)")"
echo "exported_rows=${ROWS}"
if [[ "${ROWS}" -le 0 || "${ROWS}" -gt 50 ]]; then
  safe_loader_die "unexpected export size ${ROWS} (want 1..50 for Kyauktan barriers pilot)"
fi

if ! safe_loader_preload_should_write "${MODE}"; then
  echo "dry_run: skipping import_work write (would preload ${ROWS} rows into batch_code=${BATCH_CODE})"
  echo "to apply: --target ${TARGET} --apply --confirmation 'PRELOAD ${FAMILY} ${BATCH_CODE}'"
  exit 0
fi

cat > "${TMP_SQL}" <<SQL
\\set ON_ERROR_STOP on
DROP TABLE IF EXISTS kyauktan_routing_barrier_export_raw;
CREATE TEMP TABLE kyauktan_routing_barrier_export_raw (
    external_id text,
    classification text,
    barrier_type text,
    access_tags text,
    point_wkt text,
    geom_wkt text,
    confidence_score numeric,
    source_refs text,
    normalized_data text,
    source_hash text,
    local_staging_id bigint
);
\\copy kyauktan_routing_barrier_export_raw FROM '${TMP_CSV}' WITH (FORMAT csv, HEADER true);

DROP TABLE IF EXISTS kyauktan_routing_barrier_export;
CREATE TEMP TABLE kyauktan_routing_barrier_export AS
SELECT
    external_id,
    classification,
    barrier_type,
    access_tags::jsonb,
    CASE WHEN point_wkt IS NOT NULL AND btrim(point_wkt) <> ''
         THEN ST_SetSRID(ST_GeomFromText(point_wkt), 4326) END AS point_geom,
    CASE WHEN geom_wkt IS NOT NULL AND btrim(geom_wkt) <> ''
         THEN ST_SetSRID(ST_GeomFromText(geom_wkt), 4326) END AS geom,
    confidence_score,
    source_refs::jsonb,
    normalized_data::jsonb,
    source_hash,
    local_staging_id
FROM kyauktan_routing_barrier_export_raw;

\\set batch_code '${BATCH_CODE}'
\\set snapshot_id '${SNAPSHOT_ID}'
\\set snapshot_version '${SNAPSHOT_VERSION}'
\\ir ${SCRIPT_DIR}/kyauktan_routing_barriers_preload.sql
SQL

echo "=== load into import_work batch=${BATCH_CODE} ==="
PAGER=cat psql "${SAFE_LOADER_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${TMP_SQL}"
echo "preload finished batch_code=${BATCH_CODE} rows=${ROWS}"
