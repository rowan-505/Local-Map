#!/usr/bin/env bash
# Local-only national routing-barriers dry-run.
# Does NOT write Supabase production / core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/imports/myanmar_national_routing_barriers_dry_run_2026_08_13.env"
# shellcheck disable=SC1090
source "${ENV_FILE}"

FULL_PBF="${SCRIPT_DIR}/data/osm/myanmar-260811.osm.pbf"
OUT_PBF="${PBF_PATH}"
ART_DIR="${SCRIPT_DIR}/artifacts/routing_barriers_national_2026_08_13"
REPORT="${SCRIPT_DIR}/reports/routing_barriers_national_dry_run_2026_08_13.md"
OSMIUM_BIN="${OSMIUM_BIN:-osmium}"
SUPPORTED_NODES_PBF="${ART_DIR}/supported_barrier_nodes.osm.pbf"
ALL_NODES_PBF="${ART_DIR}/all_barrier_nodes.osm.pbf"
PARENTS_PBF="${ART_DIR}/supported_barrier_parents.osm.pbf"
HIGHWAYS_PBF="${ART_DIR}/supported_barrier_highways.osm.pbf"
HIGHWAYS_COMPLETE_PBF="${ART_DIR}/supported_barrier_highways_complete.osm.pbf"

mkdir -p "${ART_DIR}" "$(dirname "${REPORT}")" "${SCRIPT_DIR}/data/osm" "${LOG_DIR}"

psql_local() {
  psql "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 "$@"
}

echo "=== 0) local mirror DDL + identity helpers ==="
psql_local -f "${REPO_ROOT}/infrastructure/database/migrations/local/018_routing_barrier_dry_run_mirror.sql"
psql_local -f "${SCRIPT_DIR}/pipeline_source_identity.sql"
psql_local -f "${SCRIPT_DIR}/pipeline_entity_families_functions.sql"

echo "=== 1) osmium extract: all barrier nodes + supported parent highways ==="
if [[ ! -f "${FULL_PBF}" ]]; then
  echo "error: missing full PBF ${FULL_PBF}" >&2
  exit 1
fi

if [[ ! -f "${ALL_NODES_PBF}" ]]; then
  "${OSMIUM_BIN}" tags-filter --progress -O -o "${ALL_NODES_PBF}" "${FULL_PBF}" n/barrier
fi

if [[ ! -f "${SUPPORTED_NODES_PBF}" ]]; then
  "${OSMIUM_BIN}" tags-filter --progress -O -o "${SUPPORTED_NODES_PBF}" "${FULL_PBF}" \
    n/barrier=gate \
    n/barrier=lift_gate \
    n/barrier=swing_gate \
    n/barrier=bollard \
    n/barrier=block \
    n/barrier=chain \
    n/barrier=cycle_barrier \
    n/barrier=toll_booth \
    n/barrier=border_control \
    n/barrier=cattle_grid
fi

if [[ ! -f "${PARENTS_PBF}" ]]; then
  "${OSMIUM_BIN}" getparents --progress -O -o "${PARENTS_PBF}" "${FULL_PBF}" -I "${SUPPORTED_NODES_PBF}"
fi

if [[ ! -f "${HIGHWAYS_PBF}" ]]; then
  "${OSMIUM_BIN}" tags-filter --progress -O -o "${HIGHWAYS_PBF}" "${PARENTS_PBF}" w/highway
fi

# Pull way node refs from the full country PBF so osm2pgsql has geometries.
if [[ ! -f "${HIGHWAYS_COMPLETE_PBF}" ]]; then
  "${OSMIUM_BIN}" getid --progress -r -O -o "${HIGHWAYS_COMPLETE_PBF}" "${FULL_PBF}" -I "${HIGHWAYS_PBF}"
fi

if [[ ! -f "${OUT_PBF}" ]]; then
  "${OSMIUM_BIN}" merge --progress -O -o "${OUT_PBF}" "${ALL_NODES_PBF}" "${HIGHWAYS_COMPLETE_PBF}"
fi
echo "filtered PBF: ${OUT_PBF} ($(du -h "${OUT_PBF}" | awk '{print $1}'))"

echo "=== 2) sync prod_mirror.core_routing_barriers from production (read-only) ==="
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
  SELECT id, public_id, barrier_type, core_street_id, geom, is_active,
         source_refs, normalized_data, is_verified, verification_status,
         verified_at, verified_by, verification_note, created_at, updated_at
  FROM routing.routing_barriers
) TO STDOUT" > "${ART_DIR}/_prod_routing_barriers.copy"

psql_local -c "TRUNCATE prod_mirror.core_routing_barriers;"
psql_local -c "\\copy prod_mirror.core_routing_barriers (
  id, public_id, barrier_type, core_street_id, geom, is_active,
  source_refs, normalized_data, is_verified, verification_status,
  verified_at, verified_by, verification_note, created_at, updated_at
) FROM STDIN" < "${ART_DIR}/_prod_routing_barriers.copy"
psql_local -c "
UPDATE prod_mirror.core_routing_barriers SET mirrored_at = now();
SELECT count(*) AS mirrored_routing_barriers FROM prod_mirror.core_routing_barriers;
"

echo "=== 3) run local-osm pipeline stages through raw/staging extract ==="
unset PIPELINE_FROM_STAGE || true
export PIPELINE_TO_STAGE=05
export SKIP_PROD_MIRROR_PREFLIGHT=true
"${SCRIPT_DIR}/run_local_osm_pipeline.sh" "${ENV_FILE}"

SNAP_ID="$(psql_local -At -c "SELECT id FROM system.system_source_snapshots WHERE snapshot_version='${SNAPSHOT_VERSION}' ORDER BY id DESC LIMIT 1")"
if [[ -z "${SNAP_ID}" ]]; then
  echo "error: snapshot ${SNAPSHOT_VERSION} not found" >&2
  exit 1
fi
echo "snapshot_id=${SNAP_ID}"

echo "=== 4) normalize / match / classify dry-run ==="
psql_local \
  -v snapshot_id="${SNAP_ID}" \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -v region_code="${REGION_CODE}" \
  -v touch_m=5 \
  -v spatial_fallback_m=5 \
  -v unrelated_m=25 \
  -f "${SCRIPT_DIR}/routing_barriers_dry_run.sql" \
  | tee "${ART_DIR}/summary.json"

echo "=== 5) export classification CSVs ==="
BAR_SELECT="
  SELECT
    s.id AS local_id,
    s.external_id,
    s.barrier_type,
    s.import_class,
    s.match_status,
    s.auto_action,
    s.source_refs->>'osm_id' AS osm_node_id,
    s.source_refs->>'osm_way_id' AS osm_way_id,
    s.source_refs->>'core_street_id' AS core_street_id,
    s.source_refs->>'prod_barrier_id' AS prod_barrier_id,
    s.normalized_data->>'way_match_status' AS way_match_status,
    s.normalized_data->>'street_match_status' AS street_match_status,
    s.normalized_data->>'import_class_reason' AS import_class_reason,
    s.access_tags::text AS access_rules,
    ST_AsEWKT(s.point_geom) AS point_ewkt,
    s.source_refs::text AS source_refs,
    s.normalized_data::text AS normalized_data,
    s.confidence_score
  FROM staging.staging_routing_barrier_candidates s
  WHERE s.source_snapshot_id = ${SNAP_ID}
"

psql_local -c "\\copy (
${BAR_SELECT} AND s.import_class = 'safe_new' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.safe_new.csv"

psql_local -c "\\copy (
${BAR_SELECT} AND s.import_class = 'safe_update' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.safe_update.csv"

psql_local -c "\\copy (
${BAR_SELECT} AND s.import_class IN ('review', 'conflict') ORDER BY s.import_class, s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.review.csv"

psql_local -c "\\copy (
${BAR_SELECT} AND s.import_class = 'skipped' ORDER BY s.barrier_type, s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.skipped.csv"

psql_local -c "\\copy (
${BAR_SELECT} AND s.import_class = 'unchanged' ORDER BY s.id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.unchanged.csv"

psql_local -c "\\copy (
  SELECT barrier_type, count(*)::bigint AS n
  FROM staging.staging_routing_barrier_candidates
  WHERE source_snapshot_id = ${SNAP_ID}
    AND import_class = 'skipped'
    AND coalesce((normalized_data->>'unsupported_barrier_type')::boolean, false)
  GROUP BY 1
  ORDER BY n DESC, barrier_type
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "${ART_DIR}/routing_barriers.unsupported_by_type.csv"

echo "=== 6) write markdown report ==="
python3 - <<PY
import csv, json, pathlib
from collections import Counter

art = pathlib.Path("""${ART_DIR}""")
report = pathlib.Path("""${REPORT}""")
summary_raw = (art / "summary.json").read_text(encoding="utf-8").strip().splitlines()
summary_line = next((ln for ln in reversed(summary_raw) if ln.strip().startswith("{")), "{}")
summary = json.loads(summary_line)

def read_csv(name):
    path = art / name
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

safe_new = read_csv("routing_barriers.safe_new.csv")
safe_update = read_csv("routing_barriers.safe_update.csv")
review = read_csv("routing_barriers.review.csv")
skipped = read_csv("routing_barriers.skipped.csv")
unchanged = read_csv("routing_barriers.unchanged.csv")
unsupported = read_csv("routing_barriers.unsupported_by_type.csv")

def fmt_obj(obj):
    if not isinstance(obj, dict):
        return str(obj)
    return "\n".join(f"| `{k}` | {v} |" for k, v in obj.items())

lines = []
lines.append("# Routing barriers national dry-run (2026-08-13)")
lines.append("")
lines.append("Local-only dry-run against `myanmar-260811.osm.pbf`.")
lines.append("No Supabase production writes. No street re-import. No Valhalla / PMTiles changes.")
lines.append("")
lines.append("## Counts")
lines.append("")
lines.append(f"| Metric | Value |")
lines.append(f"|---|---:|")
lines.append(f"| total barrier=* nodes | **{summary.get('total_barrier_nodes')}** |")
lines.append(f"| supported candidates | **{summary.get('supported_candidates')}** |")
lines.append(f"| unsupported/skipped (type) | **{summary.get('unsupported_skipped')}** |")
lines.append(f"| with source road (OSM way) | **{summary.get('with_source_road')}** |")
lines.append(f"| without source road | **{summary.get('without_source_road')}** |")
lines.append(f"| matched exactly one Core street | **{summary.get('matched_exact_one_core_street')}** |")
lines.append(f"| ambiguous Core match | **{summary.get('ambiguous_core_match')}** |")
lines.append(f"| unmatched Core street | **{summary.get('unmatched_core_street')}** |")
lines.append(f"| prod_mirror barriers | {summary.get('prod_mirror_barriers')} |")
lines.append(f"| prod_mirror streets | {summary.get('prod_mirror_streets')} |")
lines.append("")
lines.append("### Import class")
lines.append("")
lines.append("| class | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("import_class") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### All barrier=* types")
lines.append("")
lines.append("| barrier | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("by_barrier_type_all") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Supported types")
lines.append("")
lines.append("| barrier | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("by_barrier_type_supported") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("### Unsupported / skipped by type")
lines.append("")
lines.append("| barrier | n |")
lines.append("|---|---:|")
for row in unsupported:
    lines.append(f"| `{row['barrier_type']}` | {row['n']} |")
lines.append("")
lines.append("### Access-key distribution (supported)")
lines.append("")
lines.append("| key | n |")
lines.append("|---|---:|")
for k, v in sorted((summary.get("access_key_distribution") or {}).items(), key=lambda kv: (-kv[1], kv[0])):
    lines.append(f"| `{k}` | {v} |")
lines.append("")
lines.append("## Safe examples (up to 20)")
lines.append("")
lines.append("| external_id | barrier | osm_way | core_street_id | access_rules |")
lines.append("|---|---|---|---|---|")
for row in safe_new[:20]:
    lines.append(
        f"| `{row.get('external_id')}` | `{row.get('barrier_type')}` | `{row.get('osm_way_id')}` | `{row.get('core_street_id')}` | `{row.get('access_rules')}` |"
    )
if not safe_new:
    lines.append("| _(none)_ | | | | |")
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
lines.append("| class | external_id | barrier | street_match | reason |")
lines.append("|---|---|---|---|---|")
for row in review[:30]:
    lines.append(
        f"| `{row.get('import_class')}` | `{row.get('external_id')}` | `{row.get('barrier_type')}` | `{row.get('street_match_status')}` | {row.get('import_class_reason')} |"
    )
lines.append("")
lines.append("## Artifacts")
lines.append("")
for name in [
    "routing_barriers.safe_new.csv",
    "routing_barriers.safe_update.csv",
    "routing_barriers.review.csv",
    "routing_barriers.skipped.csv",
    "routing_barriers.unchanged.csv",
    "routing_barriers.unsupported_by_type.csv",
    "summary.json",
]:
    lines.append(f"- `tools/data-pipeline/local-osm/artifacts/routing_barriers_national_2026_08_13/{name}`")
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
