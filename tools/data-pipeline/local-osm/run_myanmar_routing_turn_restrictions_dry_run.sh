#!/usr/bin/env bash
# Local-only national routing turn-restriction dry-run.
# Does NOT write Supabase production / core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/imports/myanmar_national_routing_turn_restrictions_dry_run_2026_08_13.env"
# shellcheck disable=SC1090
source "${ENV_FILE}"

FULL_PBF="${SCRIPT_DIR}/data/osm/myanmar-260811.osm.pbf"
OUT_PBF="${PBF_PATH}"
ART_DIR="${SCRIPT_DIR}/artifacts/routing_turn_restrictions_national_2026_08_13"
REPORT="${SCRIPT_DIR}/reports/routing_turn_restrictions_national_dry_run_2026_08_13.md"
OSMIUM_BIN="${OSMIUM_BIN:-osmium}"
RELS_PBF="${ART_DIR}/type_restriction_relations_only.osm.pbf"
COMPLETE_PBF="${ART_DIR}/type_restriction_complete.osm.pbf"

mkdir -p "${ART_DIR}" "$(dirname "${REPORT}")" "${SCRIPT_DIR}/data/osm" "${LOG_DIR}"

psql_local() {
  psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
}

echo "=== 0) local mirror DDL + identity helpers ==="
psql_local -f "${REPO_ROOT}/infrastructure/database/migrations/local/019_routing_turn_restriction_dry_run_mirror.sql"
psql_local -f "${SCRIPT_DIR}/pipeline_source_identity.sql"
psql_local -f "${SCRIPT_DIR}/pipeline_entity_families_functions.sql"

echo "=== 1) osmium extract: type=restriction relations + complete members ==="
if [[ ! -f "${FULL_PBF}" ]]; then
  echo "error: missing full PBF ${FULL_PBF}" >&2
  exit 1
fi

# Relations only (no incomplete member stubs).
if [[ ! -f "${RELS_PBF}" ]]; then
  if "${OSMIUM_BIN}" tags-filter --help 2>&1 | grep -q -- '--omit-referenced'; then
    "${OSMIUM_BIN}" tags-filter --progress --omit-referenced -O -o "${RELS_PBF}" "${FULL_PBF}" \
      r/type=restriction
  else
    "${OSMIUM_BIN}" tags-filter --progress -O -o "${RELS_PBF}" "${FULL_PBF}" \
      r/type=restriction
  fi
fi

# Pull full member ways/nodes from the country PBF so via nodes have coordinates.
if [[ ! -f "${COMPLETE_PBF}" ]]; then
  "${OSMIUM_BIN}" getid --progress -r -O -o "${COMPLETE_PBF}" "${FULL_PBF}" -I "${RELS_PBF}"
fi

if [[ ! -f "${OUT_PBF}" ]] || [[ "${COMPLETE_PBF}" -nt "${OUT_PBF}" ]]; then
  cp -f "${COMPLETE_PBF}" "${OUT_PBF}"
fi
echo "filtered PBF: ${OUT_PBF} ($(du -h "${OUT_PBF}" | awk '{print $1}'))"
osmium fileinfo -e "${OUT_PBF}" | tee "${ART_DIR}/pbf_fileinfo.txt" | rg -n 'Number of|Size' || true

echo "=== 2) sync prod_mirror turn restrictions from production (read-only) ==="
set -a
# shellcheck disable=SC1091
source "${REPO_ROOT}/.env"
set +a
PROD_URL="${SUPABASE_READ_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${PROD_URL}" ]]; then
  echo "error: set SUPABASE_READ_DATABASE_URL or DATABASE_URL for prod_mirror sync" >&2
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

psql "${PROD_PSQL_URL}" -v ON_ERROR_STOP=1 -c "\\copy (
  SELECT id, public_id, restriction_type, from_street_id, to_street_id,
         via_node_external_id, via_street_id, via_geom, except_modes, condition,
         external_id, source_refs, normalized_data, is_active,
         is_verified, verification_status, verified_at, verified_by, verification_note,
         created_at, updated_at
  FROM routing.routing_turn_restrictions
) TO STDOUT" > "${ART_DIR}/_prod_routing_turn_restrictions.copy"

psql_local -c "TRUNCATE prod_mirror.core_routing_turn_restrictions;"
psql_local -c "\\copy prod_mirror.core_routing_turn_restrictions (
  id, public_id, restriction_type, from_street_id, to_street_id,
  via_node_external_id, via_street_id, via_geom, except_modes, condition,
  external_id, source_refs, normalized_data, is_active,
  is_verified, verification_status, verified_at, verified_by, verification_note,
  created_at, updated_at
) FROM STDIN" < "${ART_DIR}/_prod_routing_turn_restrictions.copy"
psql_local -c "
UPDATE prod_mirror.core_routing_turn_restrictions SET mirrored_at = now();
SELECT count(*) AS mirrored_turn_restrictions FROM prod_mirror.core_routing_turn_restrictions;
SELECT count(*) AS mirrored_streets FROM prod_mirror.core_streets WHERE deleted_at IS NULL;
"

echo "=== 3) run local-osm pipeline stages through raw (01–04) ==="
unset PIPELINE_FROM_STAGE || true
export PIPELINE_TO_STAGE=04
export SKIP_PROD_MIRROR_PREFLIGHT=true
"${SCRIPT_DIR}/run_local_osm_pipeline.sh" "${ENV_FILE}"

SNAP_ID="$(psql_local -At -c "SELECT id FROM system.system_source_snapshots WHERE snapshot_version='${SNAPSHOT_VERSION}' ORDER BY id DESC LIMIT 1")"
if [[ -z "${SNAP_ID}" ]]; then
  echo "error: snapshot ${SNAPSHOT_VERSION} not found" >&2
  exit 1
fi
echo "snapshot_id=${SNAP_ID}"

echo "=== 3b) verify tmp_import.osm_restrictions survived Stage 04 ==="
RESTR_N="$(psql_local -At -c "SELECT count(*) FROM tmp_import.osm_restrictions")"
if [[ "${RESTR_N}" -lt 1 ]]; then
  echo "error: tmp_import.osm_restrictions is empty after Stage 02/04" >&2
  exit 1
fi
echo "tmp_import.osm_restrictions=${RESTR_N}"

echo "=== 4) normalize / match / classify dry-run ==="
psql_local \
  -v snapshot_id="${SNAP_ID}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v region_code="${REGION_CODE}" \
  -v touch_m=5 \
  -f "${SCRIPT_DIR}/routing_turn_restrictions_dry_run.sql" \
  | tee "${ART_DIR}/summary.json"

echo "=== 5) export classification CSVs ==="
TR_SELECT="
  SELECT
    s.id AS local_id,
    s.external_id,
    s.restriction_type,
    s.import_class,
    s.match_status,
    s.auto_action,
    s.from_external_id,
    s.via_external_id,
    s.to_external_id,
    s.source_refs->>'from_street_id' AS from_street_id,
    s.source_refs->>'to_street_id' AS to_street_id,
    s.source_refs->>'prod_turn_restriction_id' AS prod_turn_restriction_id,
    s.normalized_data->>'structure_class' AS structure_class,
    s.normalized_data->>'from_street_match_status' AS from_street_match_status,
    s.normalized_data->>'to_street_match_status' AS to_street_match_status,
    s.normalized_data->>'import_class_reason' AS import_class_reason,
    ST_AsEWKT(s.via_geom) AS via_ewkt,
    s.source_refs::text AS source_refs,
    s.normalized_data::text AS normalized_data,
    s.confidence_score
  FROM staging.staging_routing_turn_restriction_candidates s
  WHERE s.source_snapshot_id = ${SNAP_ID}
"

psql_local -c "\\copy (
${TR_SELECT} AND s.import_class = 'safe_new' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.safe_new.csv"

psql_local -c "\\copy (
${TR_SELECT} AND s.import_class = 'safe_update' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.safe_update.csv"

psql_local -c "\\copy (
${TR_SELECT} AND s.import_class IN ('review', 'conflict') ORDER BY s.import_class, s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.review.csv"

psql_local -c "\\copy (
${TR_SELECT} AND s.import_class = 'skipped' ORDER BY s.restriction_type NULLS LAST, s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.skipped.csv"

psql_local -c "\\copy (
${TR_SELECT} AND s.import_class = 'unchanged' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.unchanged.csv"

psql_local -c "\\copy (
  SELECT
    coalesce(normalized_data->>'structure_class', '(none)') AS structure_class,
    count(*)::bigint AS n
  FROM staging.staging_routing_turn_restriction_candidates
  WHERE source_snapshot_id = ${SNAP_ID}
    AND import_class = 'skipped'
  GROUP BY 1
  ORDER BY n DESC, structure_class
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_turn_restrictions.unsupported_by_structure.csv"

echo "=== 6) write markdown report ==="
export TR_DRY_RUN_ART_DIR="${ART_DIR}"
export TR_DRY_RUN_REPORT="${REPORT}"
python3 - <<'PY'
import csv, json, pathlib, os
from collections import Counter

art = pathlib.Path(os.environ["TR_DRY_RUN_ART_DIR"])
report = pathlib.Path(os.environ["TR_DRY_RUN_REPORT"])
summary_raw = (art / "summary.json").read_text(encoding="utf-8").strip().splitlines()
summary_line = next((ln for ln in reversed(summary_raw) if ln.strip().startswith("{")), "{}")
summary = json.loads(summary_line)

def read_csv(name):
    path = art / name
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

safe_new = read_csv("routing_turn_restrictions.safe_new.csv")
safe_update = read_csv("routing_turn_restrictions.safe_update.csv")
review = read_csv("routing_turn_restrictions.review.csv")
skipped = read_csv("routing_turn_restrictions.skipped.csv")
unchanged = read_csv("routing_turn_restrictions.unchanged.csv")
unsupported = read_csv("routing_turn_restrictions.unsupported_by_structure.csv")

lines = []
lines.append("# Routing turn restrictions national dry-run (2026-08-13)")
lines.append("")
lines.append("Local-only dry-run against `myanmar-260811.osm.pbf`.")
lines.append("No Supabase production writes. No street re-import. No Valhalla / PMTiles changes.")
lines.append("")
lines.append("## V1 scope")
lines.append("")
lines.append("- OSM `type=restriction` relations only")
lines.append("- Exactly one `from` way, one `to` way, one `via` node")
lines.append("- Supported restriction values map to Core `routing.routing_turn_restrictions`")
lines.append("- Via-way / multi-member / unsupported type → skipped")
lines.append("- Core street resolve: OSM way identity + nearest segment at via (same multi-segment rule as barriers)")
lines.append("")
lines.append("## Counts")
lines.append("")
lines.append("| Metric | Value |")
lines.append("|---|---:|")
lines.append(f"| total restriction relations | **{summary.get('total_restriction_relations')}** |")
lines.append(f"| V1 simple candidates | **{summary.get('v1_simple_candidates')}** |")
lines.append(f"| unsupported/skipped | **{summary.get('unsupported_skipped')}** |")
lines.append(f"| with via geometry | **{summary.get('with_via_geom')}** |")
lines.append(f"| missing via geometry | **{summary.get('missing_via_geom')}** |")
lines.append(f"| from street resolved | **{summary.get('from_resolved')}** |")
lines.append(f"| to street resolved | **{summary.get('to_resolved')}** |")
lines.append(f"| both streets resolved | **{summary.get('both_streets_resolved')}** |")
lines.append(f"| prod_mirror turn restrictions | {summary.get('prod_mirror_turn_restrictions')} |")
lines.append(f"| prod_mirror streets | {summary.get('prod_mirror_streets')} |")
lines.append("")
lines.append("### Import class")
lines.append("")
lines.append("| class | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("import_class") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Structure class")
lines.append("")
lines.append("| structure | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("by_structure_class") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Restriction types (all)")
lines.append("")
lines.append("| restriction | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("by_restriction_type_all") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Restriction types (V1 simple)")
lines.append("")
lines.append("| restriction | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("by_restriction_type_v1_simple") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Unsupported / skipped by structure")
lines.append("")
lines.append("| structure | n |")
lines.append("|---|---:|")
for row in unsupported:
    lines.append(f"| `{row['structure_class']}` | {row['n']} |")
lines.append("")
lines.append("## Safe examples (up to 20)")
lines.append("")
lines.append("| external_id | type | from_way | to_way | from_street | to_street |")
lines.append("|---|---|---|---|---|---|")
for row in safe_new[:20]:
    lines.append(
        f"| `{row.get('external_id')}` | `{row.get('restriction_type')}` | `{row.get('from_external_id')}` | `{row.get('to_external_id')}` | `{row.get('from_street_id')}` | `{row.get('to_street_id')}` |"
    )
if not safe_new:
    lines.append("| _(none)_ | | | | | |")
lines.append("")
lines.append("## Anomaly classes")
lines.append("")
reason_counts = Counter(r.get("import_class_reason") or "" for r in review + skipped)
lines.append("| reason | n |")
lines.append("|---|---:|")
for reason, n in reason_counts.most_common(30):
    if not reason:
        continue
    lines.append(f"| {reason} | {n} |")
lines.append("")
lines.append("### Review / conflict samples")
lines.append("")
lines.append("| class | external_id | type | from_match | to_match | reason |")
lines.append("|---|---|---|---|---|---|")
for row in review[:30]:
    lines.append(
        f"| `{row.get('import_class')}` | `{row.get('external_id')}` | `{row.get('restriction_type')}` | `{row.get('from_street_match_status')}` | `{row.get('to_street_match_status')}` | {row.get('import_class_reason')} |"
    )
lines.append("")
lines.append("## Artifacts")
lines.append("")
for name in [
    "routing_turn_restrictions.safe_new.csv",
    "routing_turn_restrictions.safe_update.csv",
    "routing_turn_restrictions.review.csv",
    "routing_turn_restrictions.skipped.csv",
    "routing_turn_restrictions.unchanged.csv",
    "routing_turn_restrictions.unsupported_by_structure.csv",
    "summary.json",
]:
    lines.append(f"- `tools/data-pipeline/local-osm/artifacts/routing_turn_restrictions_national_2026_08_13/{name}`")
lines.append("")
lines.append("## STOP")
lines.append("")
lines.append("Dry-run complete. No production import performed.")
lines.append("")

report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {report}")
PY

echo "DONE"
echo "report: ${REPORT}"
echo "artifacts: ${ART_DIR}"
