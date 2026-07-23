#!/usr/bin/env bash
# Export Yangon downtown safe_new water lines from LOCAL staging → import_work.
# Does not write core.*.
#
# Default mode is dry_run (export + report only). Production writes need:
#   --target production --apply --confirmation 'PRELOAD water_lines <batch_code>'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/safe_loader_contract.sh
source "${SCRIPT_DIR}/lib/safe_loader_contract.sh"

TARGET=""
MODE="dry_run"
CONFIRMATION=""
ENV_FILE=""
BATCH_CODE="${BATCH_CODE:-water_lines_yangon_downtown_safe_2026_07_23}"
CLI_SNAPSHOT_ID=""
CLI_SNAPSHOT_VERSION=""
FAMILY="water_lines"

usage() {
  cat <<'EOF'
usage: yangon_downtown_water_lines_preload.sh --target local|production [options]

Options:
  --env-file PATH
  --batch-code CODE
  --snapshot-id N
  --snapshot-version TEXT
  --mode dry_run|apply   (default: dry_run)
  --apply                shorthand for --mode apply
  --confirmation TEXT    production apply: PRELOAD water_lines <batch_code>
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

ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../local-osm/imports/yangon_city_production_pilot_2026_07_23.env}"
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

BATCH_CODE="${BATCH_CODE:-water_lines_yangon_downtown_safe_2026_07_23}"
SNAPSHOT_ID="${CLI_SNAPSHOT_ID:-${SNAPSHOT_ID_OVERRIDE:-10}}"
SNAPSHOT_VERSION="${CLI_SNAPSHOT_VERSION:-${SNAPSHOT_VERSION_OVERRIDE:-osm_myanmar_2026_07_21_yangon_downtown_sample_v1}}"

[[ -n "${TARGET}" ]] || { usage >&2; safe_loader_die "missing --target local|production"; }

safe_loader_preload_preflight "${TARGET}" "${MODE}" "${FAMILY}" "${BATCH_CODE}" "${CONFIRMATION}"

TMP_CSV="$(mktemp -t yangon_wlines_XXXXXX.csv)"
TMP_SQL="$(mktemp -t yangon_wlines_XXXXXX.sql)"
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
      ''
    )), '') AS name_mm,
    s.class_code,
    ST_AsText(s.geom) AS geom_wkt,
    coalesce(s.source_refs, '{}'::jsonb)::text AS source_refs,
    coalesce(s.normalized_data, '{}'::jsonb)::text AS normalized_data,
    s.normalized_hash AS source_hash,
    s.core_selection_reason
  FROM staging.staging_water_line_candidates AS s
  WHERE s.source_snapshot_id = ${SNAPSHOT_ID}
    AND s.import_class = 'safe_new'
    AND s.eligible_for_core IS TRUE
    AND coalesce(s.pmtiles_only_reason, '') = ''
  ORDER BY s.id
) TO '${TMP_CSV}' WITH (FORMAT csv, HEADER true)"

ROWS="$(python3 -c "import csv; print(sum(1 for _ in open('${TMP_CSV}'))-1)")"
echo "exported_rows=${ROWS}"
if [[ "${ROWS}" -le 0 || "${ROWS}" -gt 50 ]]; then
  safe_loader_die "unexpected export size ${ROWS} (want 1..50 for downtown water_lines pilot)"
fi

if ! safe_loader_preload_should_write "${MODE}"; then
  echo "dry_run: skipping import_work write (would preload ${ROWS} rows into batch_code=${BATCH_CODE})"
  echo "to apply: --target ${TARGET} --apply --confirmation 'PRELOAD ${FAMILY} ${BATCH_CODE}'"
  exit 0
fi

cat > "${TMP_SQL}" <<SQL
\\set ON_ERROR_STOP on
DROP TABLE IF EXISTS yangon_downtown_water_line_export_raw;
CREATE TEMP TABLE yangon_downtown_water_line_export_raw (
    external_id text, classification text, canonical_name text,
    name_en text, name_mm text, class_code text, geom_wkt text,
    source_refs text, normalized_data text, source_hash text, core_selection_reason text
);
\\copy yangon_downtown_water_line_export_raw FROM '${TMP_CSV}' WITH (FORMAT csv, HEADER true);

DROP TABLE IF EXISTS yangon_downtown_water_line_export;
CREATE TEMP TABLE yangon_downtown_water_line_export AS
SELECT
    external_id, classification, canonical_name, name_en, name_mm, class_code,
    ST_SetSRID(ST_GeomFromText(geom_wkt), 4326) AS geom,
    source_refs::jsonb, normalized_data::jsonb, source_hash, core_selection_reason
FROM yangon_downtown_water_line_export_raw;

\\set batch_code '${BATCH_CODE}'
\\set snapshot_id '${SNAPSHOT_ID}'
\\set snapshot_version '${SNAPSHOT_VERSION}'
\\ir ${SCRIPT_DIR}/yangon_downtown_water_lines_preload.sql
SQL

echo "=== load into import_work batch=${BATCH_CODE} ==="
PAGER=cat psql "${SAFE_LOADER_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${TMP_SQL}"
echo "preload finished batch_code=${BATCH_CODE} rows=${ROWS}"
