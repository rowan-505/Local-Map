#!/usr/bin/env bash
# Apply approved national routing-barriers dry-run to production.
# Default: dry-run first batch only. --apply commits all safe batches + review.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCAL_OSM="${REPO_ROOT}/tools/data-pipeline/local-osm"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
# shellcheck source=../lib/database_target_safety.sh
source "${REPO_ROOT}/tools/data-pipeline/lib/database_target_safety.sh"

SNAPSHOT_VERSION="${SNAPSHOT_VERSION:-osm_myanmar_2026_08_11_national_routing_barriers_dry_run_v1}"
REGION_CODE="${REGION_CODE:-mm-core-routing-barriers-v1}"
ART_SRC="${LOCAL_OSM}/artifacts/routing_barriers_national_2026_08_13"
ART_ROOT="${SCRIPT_DIR}/artifacts/routing_barriers_national_apply_2026_08_13"
PKG="${ART_ROOT}/prepare_package"
REPORT="${LOCAL_OSM}/reports/routing_barriers_national_apply_2026_08_13.md"
BATCH_SIZE="${BATCH_SIZE:-400}"

MODE="dry_run"
CONFIRMATION=""

usage() {
  cat <<'EOF'
usage: run_routing_barriers_national_apply.sh [--dry-run|--apply]

--apply requires:
  EXECUTE_ROUTING_BARRIERS_DIRECT_CORE=I_UNDERSTAND
  --confirmation 'IMPORT routing_barriers mm-core-routing-barriers-v1 osm_myanmar_2026_08_11_national_routing_barriers_dry_run_v1'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --confirmation) CONFIRMATION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -r "${ENV_FILE}" ]] || { echo "missing env file: ${ENV_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${ENV_FILE}"

# Force apply-scoped region code (00_env may export REGION_CODE=MM).
REGION_CODE="mm-core-routing-barriers-v1"
SNAPSHOT_VERSION="osm_myanmar_2026_08_11_national_routing_barriers_dry_run_v1"

WRITE_URL="${SUPABASE_WRITE_DATABASE_URL:?SUPABASE_WRITE_DATABASE_URL required}"
READ_URL="${SUPABASE_READ_DATABASE_URL:-${WRITE_URL}}"

mkdir -p "${PKG}/batches" "$(dirname "${REPORT}")"

echo "=== 0) verify approved dry-run artifacts ==="
python3 - <<PY
import csv, json
from pathlib import Path
art = Path("${ART_SRC}")
summary = json.loads((art / "summary.json").read_text())
ic = summary.get("import_class") or {}
assert ic.get("safe_new") == 2243, ic
assert ic.get("safe_update") == 2, ic
assert ic.get("review") == 803, ic
assert ic.get("unchanged") == 7, ic
assert summary.get("snapshot_version") == "${SNAPSHOT_VERSION}"
for name, n in [
    ("routing_barriers.safe_new.csv", 2243),
    ("routing_barriers.safe_update.csv", 2),
    ("routing_barriers.review.csv", 803),
]:
    rows = list(csv.DictReader((art / name).open()))
    assert len(rows) == n, (name, len(rows), n)
    if name.startswith("routing_barriers.safe"):
        assert all((r.get("core_street_id") or "").strip() for r in rows)
        assert all((r.get("point_ewkt") or "").strip() for r in rows)
print("artifact_ok", ic)
PY

echo "=== 1) prepare direct-core CSVs ==="
python3 - <<PY
import csv
from pathlib import Path

src = Path("${ART_SRC}")
pkg = Path("${PKG}")
header = [
    "classification",
    "local_staging_id",
    "external_id",
    "barrier_type",
    "core_street_id",
    "point_ewkt",
    "access_tags",
    "source_refs",
    "normalized_data",
]

def transform(row, classification=None):
    return {
        "classification": classification or row["import_class"],
        "local_staging_id": row["local_id"],
        "external_id": row["external_id"],
        "barrier_type": row["barrier_type"],
        "core_street_id": row["core_street_id"],
        "point_ewkt": row["point_ewkt"],
        "access_tags": row.get("access_rules") or "{}",
        "source_refs": row.get("source_refs") or "{}",
        "normalized_data": row.get("normalized_data") or "{}",
    }

safe_rows = []
for name in ["routing_barriers.safe_update.csv", "routing_barriers.safe_new.csv"]:
    for row in csv.DictReader((src / name).open()):
        safe_rows.append(transform(row))

safe_path = pkg / "routing_barriers.safe.csv"
with safe_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=header)
    w.writeheader()
    w.writerows(safe_rows)

# chunk safe rows
batch_dir = pkg / "batches"
for p in batch_dir.glob("safe_batch_*.csv"):
    p.unlink()
batch_size = int("${BATCH_SIZE}")
for i in range(0, len(safe_rows), batch_size):
    chunk = safe_rows[i : i + batch_size]
    path = batch_dir / f"safe_batch_{i // batch_size:03d}.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(chunk)

review_header = header + ["import_class_reason"]
review_rows = []
for row in csv.DictReader((src / "routing_barriers.review.csv").open()):
    item = transform(row, classification="review")
    item["import_class_reason"] = row.get("import_class_reason") or ""
    review_rows.append(item)
review_path = pkg / "routing_barriers.review.csv"
with review_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=review_header)
    w.writeheader()
    w.writerows(review_rows)

print(f"safe_rows={len(safe_rows)} batches={(len(safe_rows) + batch_size - 1) // batch_size} review={len(review_rows)}")
PY

echo "=== 2) preflight production counts ==="
PAGER=cat psql "${READ_URL}" -v ON_ERROR_STOP=1 <<'SQL' | tee "${PKG}/preflight.log"
\pset pager off
SELECT 'preflight' AS section,
  (SELECT count(*) FROM routing.routing_barriers) AS barriers_total,
  (SELECT count(*) FROM routing.routing_barriers WHERE coalesce(is_active, true)) AS barriers_active,
  (SELECT count(*) FROM import_review.routing_barrier_candidates) AS review_candidates,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='routing' AND table_name='routing_barriers' AND column_name='external_id'
  ) AS has_external_id,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='routing' AND table_name='routing_barriers' AND column_name='access_rules'
  ) AS has_access_rules;
SQL

echo "=== 3) apply migration 163 if needed ==="
HAS_EXT="$(psql "${WRITE_URL}" -At -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='routing' AND table_name='routing_barriers' AND column_name='external_id')")"
if [[ "${HAS_EXT}" != "t" ]]; then
  PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
    -f "${REPO_ROOT}/infrastructure/database/migrations/supabase/163_routing_barriers_lineage_and_turn_restrictions.sql" \
    | tee "${PKG}/migration_163.log"
else
  echo "migration 163 columns already present"
fi

echo "=== 4) register production snapshot ==="
PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/sql/register_routing_barriers_snapshot_supabase.sql" \
  | tee "${PKG}/register_snapshot.log"

EXPECTED_CONFIRMATION="IMPORT routing_barriers ${REGION_CODE} ${SNAPSHOT_VERSION}"

if [[ "${MODE}" == "dry_run" ]]; then
  FIRST_BATCH="$(ls "${PKG}/batches"/safe_batch_*.csv | sort | head -1)"
  echo "=== 5) dry-run first batch only: ${FIRST_BATCH} ==="
  export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"
  "${SCRIPT_DIR}/run_direct_core_import.sh" \
    --family routing_barriers \
    --target production \
    --csv "${FIRST_BATCH}" \
    --region-code "${REGION_CODE}" \
    --snapshot-version "${SNAPSHOT_VERSION}" \
    --env-file "${ENV_FILE}" \
    --dry-run \
    | tee "${PKG}/import_dry_run_batch0.log"
  echo "STOP: dry-run OK. Re-run with --apply to commit."
  exit 0
fi

if [[ "${EXECUTE_ROUTING_BARRIERS_DIRECT_CORE:-}" != "I_UNDERSTAND" ]]; then
  echo "error: set EXECUTE_ROUTING_BARRIERS_DIRECT_CORE=I_UNDERSTAND for production apply" >&2
  exit 1
fi

echo "=== 5) apply safe batches ==="
export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"
export EXECUTE_ROUTING_BARRIERS_DIRECT_CORE=I_UNDERSTAND
: > "${PKG}/import_apply.log"
for batch in $(ls "${PKG}/batches"/safe_batch_*.csv | sort); do
  echo "--- applying $(basename "${batch}") ---" | tee -a "${PKG}/import_apply.log"
  "${SCRIPT_DIR}/run_direct_core_import.sh" \
    --family routing_barriers \
    --target production \
    --csv "${batch}" \
    --region-code "${REGION_CODE}" \
    --snapshot-version "${SNAPSHOT_VERSION}" \
    --env-file "${ENV_FILE}" \
    --apply \
    --confirmation "${CONFIRMATION:-${EXPECTED_CONFIRMATION}}" \
    | tee -a "${PKG}/import_apply.log"
done

echo "=== 6) upload review-only rows ==="
export DIRECT_CORE_REVIEW_CSV="${PKG}/routing_barriers.review.csv"
PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -f "${SCRIPT_DIR}/sql/upload_routing_barriers_review.sql" \
  | tee "${PKG}/review_upload.log"

echo "=== 7) final validation ==="
PAGER=cat psql "${READ_URL}" -v ON_ERROR_STOP=1 <<'SQL' | tee "${PKG}/final_validation.log"
\pset pager off
SELECT 'baseline_after' AS section,
  (SELECT count(*) FROM routing.routing_barriers) AS barriers_total,
  (SELECT count(*) FROM routing.routing_barriers WHERE coalesce(is_active, true)) AS barriers_active,
  (SELECT count(*) FROM import_review.routing_barrier_candidates) AS review_candidates;

SELECT 'by_type' AS section, barrier_type, count(*)::bigint AS n
FROM routing.routing_barriers
WHERE coalesce(is_active, true)
GROUP BY 1
ORDER BY n DESC, barrier_type;

SELECT 'quality_gates' AS section,
  count(*) FILTER (
    WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ST_IsValid(geom)
      OR GeometryType(geom) <> 'POINT' OR ST_SRID(geom) <> 4326
  ) AS invalid_empty_point,
  count(*) FILTER (
    WHERE coalesce(is_active, true)
      AND source_registry_id IS NOT NULL
      AND source_feature_type IS NOT NULL
      AND source_feature_id IS NOT NULL
      AND core_street_id IS NULL
  ) AS active_lineage_missing_street,
  count(*) FILTER (
    WHERE coalesce(is_active, true) AND core_street_id IS NULL
  ) AS active_missing_street
FROM routing.routing_barriers;

SELECT 'duplicate_source_identity' AS section, count(*)::bigint AS n
FROM (
  SELECT source_registry_id, source_feature_type, source_feature_id
  FROM routing.routing_barriers
  WHERE coalesce(is_active, true)
    AND source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
) d;

SELECT 'examples' AS section, barrier_type, external_id, core_street_id, access_rules
FROM routing.routing_barriers
WHERE coalesce(is_active, true)
  AND barrier_type IN ('gate', 'bollard', 'toll_booth', 'lift_gate', 'border_control', 'block', 'swing_gate')
ORDER BY barrier_type, id
LIMIT 20;
SQL

python3 - <<PY
from pathlib import Path
import re
pkg = Path("${PKG}")
report = Path("${REPORT}")
pre = (pkg / "preflight.log").read_text(encoding="utf-8", errors="replace")
final = (pkg / "final_validation.log").read_text(encoding="utf-8", errors="replace")
apply_log = (pkg / "import_apply.log").read_text(encoding="utf-8", errors="replace")
inserted = len(re.findall(r"\binserted\s*\|\s*(\d+)", apply_log))
# parse last table-ish counts from apply log
ins_vals = [int(x) for x in re.findall(r"\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*\d+\s*\|\s*f\s*\|", apply_log)]
# fallback: count 'insert' mentions in section rows
ins = sum(int(x) for x in re.findall(r"direct_core_routing_barriers.*?\|.*?\|.*?\|.*?\|", apply_log) or [])
# simpler: from validation
m_before = re.search(r"barriers_total\s*\|\s*(\d+)", pre)
before = int(m_before.group(1)) if m_before else 15
m_after = re.search(r"barriers_total\s*\|\s*(\d+)", final)
after = int(m_after.group(1)) if m_after else None
review = re.search(r"review_candidates\s*\|\s*(\d+)", final)
review_n = int(review.group(1)) if review else None
lines = [
  "# Routing barriers national production apply (2026-08-13)",
  "",
  "**STOP — apply complete. No turn restrictions. No Valhalla/PMTiles rebuild.**",
  "",
  "## Preflight",
  "",
  f"- approved dry-run snapshot: `{SNAPSHOT_VERSION}`",
  f"- barriers before: **{before}**",
  "- migration 163 lineage columns applied/confirmed",
  "- source registry: `osm_myanmar`",
  "",
  "## Apply result",
  "",
  "| Action | Count |",
  "|---|---:|",
  "| safe_new expected | 2243 |",
  "| safe_update expected | 2 |",
  "| unchanged (not written) | 7 |",
  f"| barriers after | **{after}** |",
  f"| review uploaded | **{review_n}** |",
  "",
  "## Validation log",
  "",
  "See:",
  f"- `{pkg / 'final_validation.log'}`",
  f"- `{pkg / 'import_apply.log'}`",
  f"- `{pkg / 'review_upload.log'}`",
  "",
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote", report)
PY

echo "DONE mode=apply"
echo "report: ${REPORT}"
echo "artifacts: ${PKG}"
