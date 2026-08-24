#!/usr/bin/env bash
# Exact-ID, name-metadata-only Myanmar OSM refresh dry-run.
# Core production tables are read only; only PostgreSQL TEMP objects are written.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_OSM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
ENV_FILE="${1:-${LOCAL_OSM_DIR}/imports/myanmar_national_dry_run_2026_07_23.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

PBF_PATH="${STREET_NAME_PBF_PATH:-${LOCAL_OSM_DIR}/data/osm/myanmar-260823.osm.pbf}"
SOURCE_VERSION="${STREET_NAME_SOURCE_VERSION:-2026-08-23}"
REPORT_DIR="${STREET_NAME_REPORT_DIR:-${LOCAL_OSM_DIR}/reports/street-name-refresh/${SOURCE_VERSION}}"
OSMIUM_BIN="${OSMIUM_BIN:-osmium}"
PSQL_BIN="${PSQL_BIN:-psql}"
FILTERED_PBF="${REPORT_DIR}/name-ways.osm.pbf"
FILTERED_XML="${REPORT_DIR}/name-ways.osm"
WAYS_CSV="${REPORT_DIR}/name-ways.csv"
SOURCE_SUMMARY="${REPORT_DIR}/source-summary.json"
CLASSIFIED_CSV="${REPORT_DIR}/classified-current-names.csv"
OTHER_LANGUAGE_CSV="${REPORT_DIR}/other-language-names.review.csv"
SECONDARY_CSV="${REPORT_DIR}/secondary-historical-names.review.csv"
DB_SUMMARY="${REPORT_DIR}/classification-summary.json"
BASELINE_JSON="${REPORT_DIR}/database-baseline.json"
REPORT_MD="${REPORT_DIR}/dry-run-report.md"

mkdir -p "${REPORT_DIR}"

for tool in "${OSMIUM_BIN}" "${PSQL_BIN}" python3; do
  command -v "${tool}" >/dev/null || { echo "error: missing tool ${tool}" >&2; exit 1; }
done
[[ -f "${PBF_PATH}" ]] || { echo "error: missing PBF ${PBF_PATH}" >&2; exit 1; }

PBF_TIMESTAMP="$("${OSMIUM_BIN}" fileinfo -g header.option.osmosis_replication_timestamp "${PBF_PATH}")"
WAYS_SCANNED="$("${OSMIUM_BIN}" fileinfo -e -g data.count.ways "${PBF_PATH}")"

echo "=== 1) extract name-bearing way metadata (no referenced nodes) ==="
if [[ ! -f "${FILTERED_PBF}" ]]; then
  "${OSMIUM_BIN}" tags-filter --omit-referenced --overwrite \
    --output "${FILTERED_PBF}" "${PBF_PATH}" \
    w/name 'w/name:*' w/official_name w/short_name w/loc_name w/alt_name w/old_name
fi
if [[ ! -f "${FILTERED_XML}" ]]; then
  "${OSMIUM_BIN}" cat --overwrite --object-type way --output-format osm \
    --output "${FILTERED_XML}" "${FILTERED_PBF}"
fi

echo "=== 2) parse OSM way IDs and tags ==="
python3 "${SCRIPT_DIR}/parse_name_ways.py" \
  --input "${FILTERED_XML}" \
  --output-csv "${WAYS_CSV}" \
  --summary-json "${SOURCE_SUMMARY}" \
  --pbf-path "${PBF_PATH}" \
  --pbf-timestamp "${PBF_TIMESTAMP}" \
  --ways-scanned "${WAYS_SCANNED}"

PROD_URL="${SUPABASE_READ_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${PROD_URL}" ]]; then
  echo "error: set SUPABASE_READ_DATABASE_URL (preferred) or DATABASE_URL" >&2
  exit 1
fi

PROD_PSQL_URL="$(PROD_URL="${PROD_URL}" python3 - <<'PY'
import os, urllib.parse
raw = os.environ["PROD_URL"].strip().strip('"').strip("'")
p = urllib.parse.urlparse(raw)
q = urllib.parse.parse_qs(p.query)
keep = {"sslmode": q.get("sslmode", ["require"])[0]}
print(urllib.parse.urlunparse(p._replace(query=urllib.parse.urlencode(keep))))
PY
)"

echo "=== 3) classify against Core using exact external_id only (read-only) ==="
"${PSQL_BIN}" "${PROD_PSQL_URL}" -X -v ON_ERROR_STOP=1 <<SQL
-- PostgreSQL forbids CREATE TEMP TABLE inside an explicitly READ ONLY
-- transaction. This normal transaction writes only ON COMMIT DROP temp objects;
-- every persistent Core/tiles relation is referenced by SELECT only.
BEGIN;
SET LOCAL statement_timeout = '5min';
CREATE TEMP TABLE temp_osm_name_ways (
    osm_way_id bigint PRIMARY KEY,
    osm_version integer,
    osm_timestamp timestamptz,
    tags jsonb NOT NULL
) ON COMMIT DROP;
\copy temp_osm_name_ways FROM '${WAYS_CSV}' WITH (FORMAT csv, HEADER true)
\i '${SCRIPT_DIR}/classify_source_fresh_names.sql'

\copy (SELECT osm_way_id, osm_version, osm_timestamp, source_tag, candidate_name, language_code, script_code, street_id, external_id, existing_name_id, existing_name, existing_source_refs, classification, classification_reason FROM temp_source_fresh_candidates ORDER BY osm_way_id, language_code, source_tag) TO '${CLASSIFIED_CSV}' WITH (FORMAT csv, HEADER true)
\copy (SELECT * FROM temp_other_language_names ORDER BY osm_way_id, source_tag) TO '${OTHER_LANGUAGE_CSV}' WITH (FORMAT csv, HEADER true)
\copy (SELECT * FROM temp_secondary_names ORDER BY osm_way_id, source_tag) TO '${SECONDARY_CSV}' WITH (FORMAT csv, HEADER true)

\copy (WITH counts AS (SELECT classification, count(*)::bigint AS n FROM temp_source_fresh_candidates GROUP BY classification), matched AS (SELECT count(DISTINCT source.osm_way_id)::bigint AS exact_core_matches FROM temp_osm_name_ways AS source WHERE EXISTS (SELECT 1 FROM core.core_streets AS street WHERE street.is_active IS TRUE AND street.deleted_at IS NULL AND street.external_id = 'osm:W:' || source.osm_way_id::text)), source_counts AS (SELECT count(*) FILTER (WHERE nullif(btrim(tags ->> 'name'), '') IS NOT NULL OR nullif(btrim(tags ->> 'name:my'), '') IS NOT NULL OR nullif(btrim(tags ->> 'name:en'), '') IS NOT NULL OR nullif(btrim(tags ->> 'name:und'), '') IS NOT NULL)::bigint AS ways_with_current_name_tag, count(*)::bigint AS metadata_ways FROM temp_osm_name_ways), projected AS (SELECT count(DISTINCT candidate.street_id)::bigint AS newly_named FROM temp_source_fresh_candidates AS candidate WHERE candidate.classification = 'safe_insert' AND NOT EXISTS (SELECT 1 FROM tiles.tiles_street_public_names_v AS public_name WHERE public_name.street_id = candidate.street_id)), active AS (SELECT count(*)::bigint AS active_streets FROM core.core_streets WHERE is_active IS TRUE AND deleted_at IS NULL), named AS (SELECT count(*)::bigint AS named_streets FROM tiles.tiles_street_public_names_v AS public_name JOIN core.core_streets AS street ON street.id = public_name.street_id WHERE street.is_active IS TRUE AND street.deleted_at IS NULL) SELECT jsonb_build_object('exact_core_matches', matched.exact_core_matches, 'unmatched_osm_way_ids', source_counts.metadata_ways - matched.exact_core_matches, 'ways_with_current_name_tag', source_counts.ways_with_current_name_tag, 'current_name_candidate_rows', (SELECT count(*) FROM temp_source_fresh_candidates), 'safe_insert', coalesce((SELECT n FROM counts WHERE classification='safe_insert'),0), 'safe_update_source_derived', coalesce((SELECT n FROM counts WHERE classification='safe_update_source_derived'),0), 'noop', coalesce((SELECT n FROM counts WHERE classification='noop'),0), 'conflict', coalesce((SELECT n FROM counts WHERE classification='conflict'),0), 'manual_protected', coalesce((SELECT n FROM counts WHERE classification='manual_protected'),0), 'invalid', coalesce((SELECT n FROM counts WHERE classification='invalid'),0), 'no_matching_core_street_candidate_rows', coalesce((SELECT n FROM counts WHERE classification='no_matching_core_street'),0), 'current_named_streets', named.named_streets, 'projected_newly_named_streets', projected.newly_named, 'projected_named_streets', named.named_streets + projected.newly_named, 'projected_remaining_unnamed_streets', active.active_streets - named.named_streets - projected.newly_named) FROM matched, source_counts, projected, active, named) TO '${DB_SUMMARY}'

\copy (WITH active AS (SELECT * FROM core.core_streets WHERE is_active IS TRUE AND deleted_at IS NULL) SELECT jsonb_build_object('active_streets', count(*), 'street_id_fingerprint', sum(hashtextextended(id::text, 0)::numeric), 'external_id_fingerprint', sum(hashtextextended(id::text || E'\x1f' || coalesce(external_id, ''), 0)::numeric), 'geometry_fingerprint', sum(hashtextextended(encode(st_asewkb(geom), 'hex'), 0)::numeric), 'manual_override_fingerprint', sum(hashtextextended(id::text || E'\x1f' || manual_override::text, 0)::numeric), 'public_named_streets', (SELECT count(*) FROM tiles.tiles_street_public_names_v), 'public_label_rows', (SELECT count(*) FROM tiles.tiles_road_labels_v)) FROM active) TO '${BASELINE_JSON}'
COMMIT;
SQL

echo "=== 4) write dry-run report ==="
python3 - "${SOURCE_SUMMARY}" "${DB_SUMMARY}" "${REPORT_MD}" <<'PY'
import json, pathlib, sys
source = json.loads(pathlib.Path(sys.argv[1]).read_text())
db = json.loads(pathlib.Path(sys.argv[2]).read_text())
tags = source["tag_counts"]
lines = [
    "# Source-fresh street-name refresh dry-run",
    "",
    f"Source PBF timestamp: `{source['pbf_timestamp']}`  ",
    f"Source SHA-256: `{source['pbf_sha256']}`  ",
    "Matching: exact `core.core_streets.external_id = 'osm:W:' || osm_way_id` only.",
    "No geometry was decoded, compared, or written.",
    "",
    "| Metric | Count |",
    "|---|---:|",
    f"| OSM ways scanned | {source['osm_ways_scanned']:,} |",
    f"| OSM ways with inspected name metadata | {source['name_metadata_ways']:,} |",
    f"| exact active Core street matches | {db['exact_core_matches']:,} |",
    f"| unmatched OSM way IDs | {db['unmatched_osm_way_ids']:,} |",
    f"| ways carrying a current-name tag | {db['ways_with_current_name_tag']:,} |",
    f"| current-name candidate rows | {db['current_name_candidate_rows']:,} |",
    f"| `name` | {tags['name']:,} |",
    f"| `name:my` | {tags['name:my']:,} |",
    f"| `name:en` | {tags['name:en']:,} |",
    f"| `name:und` | {tags['name:und']:,} |",
    f"| other `name:*` values (review only) | {tags['other_name:*']:,} |",
    f"| safe inserts | {db['safe_insert']:,} |",
    f"| safe OSM-derived updates | {db['safe_update_source_derived']:,} |",
    f"| noops | {db['noop']:,} |",
    f"| conflicts | {db['conflict']:,} |",
    f"| manual protected | {db['manual_protected']:,} |",
    f"| invalid | {db['invalid']:,} |",
    f"| current-name candidates without matching Core street | {db['no_matching_core_street_candidate_rows']:,} |",
    f"| current publicly named streets | {db['current_named_streets']:,} |",
    f"| projected newly named streets | {db['projected_newly_named_streets']:,} |",
    f"| projected publicly named streets | {db['projected_named_streets']:,} |",
    f"| projected remaining unnamed streets | {db['projected_remaining_unnamed_streets']:,} |",
    "",
    "Secondary and historical tags, and unsupported language-specific tags, are exported for review and are never promoted by this workflow.",
]
pathlib.Path(sys.argv[3]).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

echo "dry-run report: ${REPORT_MD}"
