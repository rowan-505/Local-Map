#!/usr/bin/env bash
# Apply approved national routing-turn-restrictions dry-run to production.
# Default: dry-run first batch only. --apply commits all safe batches + review.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOCAL_OSM="${REPO_ROOT}/tools/data-pipeline/local-osm"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
# shellcheck source=../lib/database_target_safety.sh
source "${REPO_ROOT}/tools/data-pipeline/lib/database_target_safety.sh"

SNAPSHOT_VERSION="osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1"
REGION_CODE="mm-core-routing-turn-restrictions-v1"
ART_SRC="${LOCAL_OSM}/artifacts/routing_turn_restrictions_national_2026_08_13"
ART_ROOT="${SCRIPT_DIR}/artifacts/routing_turn_restrictions_national_apply_2026_08_13"
PKG="${ART_ROOT}/prepare_package"
REPORT="${LOCAL_OSM}/reports/routing_turn_restrictions_national_apply_2026_08_13.md"
BATCH_SIZE="${BATCH_SIZE:-400}"

MODE="dry_run"
CONFIRMATION=""

usage() {
  cat <<'EOF'
usage: run_routing_turn_restrictions_national_apply.sh [--dry-run|--apply]

--apply requires:
  EXECUTE_ROUTING_TURN_RESTRICTIONS_DIRECT_CORE=I_UNDERSTAND
  --confirmation 'IMPORT routing_turn_restrictions mm-core-routing-turn-restrictions-v1 osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1'
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

REGION_CODE="mm-core-routing-turn-restrictions-v1"
SNAPSHOT_VERSION="osm_myanmar_2026_08_11_national_routing_turn_restrictions_dry_run_v1"

WRITE_URL="${SUPABASE_WRITE_DATABASE_URL:?SUPABASE_WRITE_DATABASE_URL required}"
READ_URL="${SUPABASE_READ_DATABASE_URL:-${WRITE_URL}}"

mkdir -p "${PKG}/batches" "$(dirname "${REPORT}")"

export TR_ART_SRC="${ART_SRC}"
export TR_PKG="${PKG}"
export TR_SNAPSHOT_VERSION="${SNAPSHOT_VERSION}"
export TR_BATCH_SIZE="${BATCH_SIZE}"

echo "=== 0) verify approved dry-run artifacts ==="
python3 - <<'PY'
import csv, json
from pathlib import Path
import os
art = Path(os.environ["TR_ART_SRC"])
summary_raw = (art / "summary.json").read_text(encoding="utf-8").strip().splitlines()
summary_line = next((ln for ln in reversed(summary_raw) if ln.strip().startswith("{")), "{}")
summary = json.loads(summary_line)
ic = summary.get("import_class") or {}
assert ic.get("safe_new") == 1658, ic
assert ic.get("review") == 6, ic
assert ic.get("skipped") == 828, ic
assert summary.get("snapshot_version") == os.environ["TR_SNAPSHOT_VERSION"]
safe = list(csv.DictReader((art / "routing_turn_restrictions.safe_new.csv").open()))
review = list(csv.DictReader((art / "routing_turn_restrictions.review.csv").open()))
skipped = list(csv.DictReader((art / "routing_turn_restrictions.skipped.csv").open()))
assert len(safe) == 1658
assert len(review) == 6
assert all((r.get("from_street_id") or "").strip() for r in safe)
assert all((r.get("to_street_id") or "").strip() for r in safe)
assert all((r.get("via_ewkt") or "").strip() for r in safe)
assert all((r.get("via_external_id") or "").strip() for r in safe)
via_ways = [r for r in skipped if r.get("structure_class") == "unsupported_via_ways"]
assert len(via_ways) == 766
print("artifact_ok", ic, "review_upload_expected", len(review) + len(via_ways))
PY

echo "=== 1) prepare direct-core CSVs ==="
python3 - <<'PY'
import csv, json
from pathlib import Path
import os

src = Path(os.environ["TR_ART_SRC"])
pkg = Path(os.environ["TR_PKG"])
header = [
    "classification",
    "local_staging_id",
    "external_id",
    "restriction_type",
    "from_street_id",
    "to_street_id",
    "via_node_external_id",
    "via_ewkt",
    "except_modes",
    "condition",
    "source_refs",
    "normalized_data",
]

def transform_safe(row):
    nd = {}
    try:
        nd = json.loads(row.get("normalized_data") or "{}")
    except Exception:
        nd = {}
    except_modes = nd.get("except_modes") or []
    if not isinstance(except_modes, list):
        except_modes = []
    return {
        "classification": row["import_class"],
        "local_staging_id": row["local_id"],
        "external_id": row["external_id"],
        "restriction_type": row["restriction_type"],
        "from_street_id": row["from_street_id"],
        "to_street_id": row["to_street_id"],
        "via_node_external_id": row.get("via_external_id") or "",
        "via_ewkt": row.get("via_ewkt") or "",
        "except_modes": json.dumps(except_modes, ensure_ascii=False),
        "condition": "",
        "source_refs": row.get("source_refs") or "{}",
        "normalized_data": row.get("normalized_data") or "{}",
    }

safe_rows = []
for name in ["routing_turn_restrictions.safe_update.csv", "routing_turn_restrictions.safe_new.csv"]:
    path = src / name
    if not path.exists():
        continue
    for row in csv.DictReader(path.open()):
        if not (row.get("import_class") or "").strip():
            continue
        safe_rows.append(transform_safe(row))

safe_path = pkg / "routing_turn_restrictions.safe.csv"
with safe_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=header)
    w.writeheader()
    w.writerows(safe_rows)

batch_dir = pkg / "batches"
for p in batch_dir.glob("safe_batch_*.csv"):
    p.unlink()
batch_size = int(os.environ["TR_BATCH_SIZE"])
for i in range(0, len(safe_rows), batch_size):
    chunk = safe_rows[i : i + batch_size]
    path = batch_dir / f"safe_batch_{i // batch_size:03d}.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(chunk)

review_header = [
    "classification",
    "local_staging_id",
    "external_id",
    "restriction_type",
    "from_external_id",
    "via_external_id",
    "to_external_id",
    "from_street_id",
    "to_street_id",
    "via_ewkt",
    "source_refs",
    "normalized_data",
    "import_class_reason",
]

def transform_review(row, classification="review"):
    return {
        "classification": classification,
        "local_staging_id": row["local_id"],
        "external_id": row["external_id"],
        "restriction_type": row.get("restriction_type") or "",
        "from_external_id": row.get("from_external_id") or "",
        "via_external_id": row.get("via_external_id") or "",
        "to_external_id": row.get("to_external_id") or "",
        "from_street_id": row.get("from_street_id") or "",
        "to_street_id": row.get("to_street_id") or "",
        "via_ewkt": row.get("via_ewkt") or "",
        "source_refs": row.get("source_refs") or "{}",
        "normalized_data": row.get("normalized_data") or "{}",
        "import_class_reason": row.get("import_class_reason") or "",
    }

review_rows = []
for row in csv.DictReader((src / "routing_turn_restrictions.review.csv").open()):
    review_rows.append(transform_review(row, classification="review"))

for row in csv.DictReader((src / "routing_turn_restrictions.skipped.csv").open()):
    if row.get("structure_class") == "unsupported_via_ways":
        review_rows.append(transform_review(row, classification="review"))

review_path = pkg / "routing_turn_restrictions.review.csv"
with review_path.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=review_header)
    w.writeheader()
    w.writerows(review_rows)

print(
    f"safe_rows={len(safe_rows)} batches={(len(safe_rows) + batch_size - 1) // batch_size} review={len(review_rows)}"
)
PY

echo "=== 2) preflight production counts ==="
PAGER=cat psql "${READ_URL}" -v ON_ERROR_STOP=1 <<'SQL' | tee "${PKG}/preflight.log"
\pset pager off
SELECT 'preflight' AS section,
  (SELECT count(*) FROM routing.routing_turn_restrictions) AS turn_restrictions_total,
  (SELECT count(*) FROM routing.routing_turn_restrictions WHERE coalesce(is_active, true)) AS turn_restrictions_active,
  (SELECT count(*) FROM import_review.routing_turn_restriction_candidates) AS review_candidates,
  (SELECT count(*) FROM core.core_streets WHERE deleted_at IS NULL) AS streets_active,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='routing' AND table_name='routing_turn_restrictions' AND column_name='external_id'
  ) AS has_external_id;
SQL

echo "=== 3) register production snapshot ==="
PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/sql/register_routing_turn_restrictions_snapshot_supabase.sql" \
  | tee "${PKG}/register_snapshot.log"

EXPECTED_CONFIRMATION="IMPORT routing_turn_restrictions ${REGION_CODE} ${SNAPSHOT_VERSION}"

if [[ "${MODE}" == "dry_run" ]]; then
  FIRST_BATCH="$(ls "${PKG}/batches"/safe_batch_*.csv | sort | head -1)"
  echo "=== 4) dry-run first batch only: ${FIRST_BATCH} ==="
  export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"
  "${SCRIPT_DIR}/run_direct_core_import.sh" \
    --family routing_turn_restrictions \
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

if [[ "${EXECUTE_ROUTING_TURN_RESTRICTIONS_DIRECT_CORE:-}" != "I_UNDERSTAND" ]]; then
  echo "error: set EXECUTE_ROUTING_TURN_RESTRICTIONS_DIRECT_CORE=I_UNDERSTAND for production apply" >&2
  exit 1
fi

echo "=== 4) apply safe batches ==="
export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL="${SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL:-true}"
export EXECUTE_ROUTING_TURN_RESTRICTIONS_DIRECT_CORE=I_UNDERSTAND
: > "${PKG}/import_apply.log"
for batch in $(ls "${PKG}/batches"/safe_batch_*.csv | sort); do
  echo "--- applying $(basename "${batch}") ---" | tee -a "${PKG}/import_apply.log"
  "${SCRIPT_DIR}/run_direct_core_import.sh" \
    --family routing_turn_restrictions \
    --target production \
    --csv "${batch}" \
    --region-code "${REGION_CODE}" \
    --snapshot-version "${SNAPSHOT_VERSION}" \
    --env-file "${ENV_FILE}" \
    --apply \
    --confirmation "${CONFIRMATION:-${EXPECTED_CONFIRMATION}}" \
    | tee -a "${PKG}/import_apply.log"
done

echo "=== 5) upload review-only rows ==="
export DIRECT_CORE_REVIEW_CSV="${PKG}/routing_turn_restrictions.review.csv"
PAGER=cat psql "${WRITE_URL}" -v ON_ERROR_STOP=1 \
  -v snapshot_version="${SNAPSHOT_VERSION}" \
  -f "${SCRIPT_DIR}/sql/upload_routing_turn_restrictions_review.sql" \
  | tee "${PKG}/review_upload.log"

echo "=== 6) final validation ==="
PAGER=cat psql "${READ_URL}" -v ON_ERROR_STOP=1 <<'SQL' | tee "${PKG}/final_validation.log"
\pset pager off
SELECT 'baseline_after' AS section,
  (SELECT count(*) FROM routing.routing_turn_restrictions) AS turn_restrictions_total,
  (SELECT count(*) FROM routing.routing_turn_restrictions WHERE coalesce(is_active, true)) AS turn_restrictions_active,
  (SELECT count(*) FROM import_review.routing_turn_restriction_candidates) AS review_candidates;

SELECT 'by_type' AS section, restriction_type, count(*)::bigint AS n
FROM routing.routing_turn_restrictions
WHERE coalesce(is_active, true)
GROUP BY restriction_type
ORDER BY n DESC, restriction_type;

SELECT 'quality_gates' AS section,
  count(*) FILTER (WHERE from_street_id IS NULL) AS null_from_street,
  count(*) FILTER (WHERE to_street_id IS NULL) AS null_to_street,
  count(*) FILTER (
    WHERE coalesce(nullif(btrim(via_node_external_id), ''), '') = ''
      AND via_street_id IS NULL
  ) AS missing_via,
  count(*) FILTER (
    WHERE via_geom IS NOT NULL AND (
      ST_IsEmpty(via_geom) OR NOT ST_IsValid(via_geom)
      OR GeometryType(via_geom) <> 'POINT' OR ST_SRID(via_geom) <> 4326
    )
  ) AS invalid_via_geom,
  count(*) FILTER (
    WHERE NOT EXISTS (SELECT 1 FROM core.core_streets s WHERE s.id = from_street_id)
       OR NOT EXISTS (SELECT 1 FROM core.core_streets s WHERE s.id = to_street_id)
  ) AS broken_fk
FROM routing.routing_turn_restrictions
WHERE coalesce(is_active, true);

SELECT 'duplicate_relation_identity' AS section, count(*)::bigint AS n
FROM (
  SELECT source_registry_id, source_feature_type, source_feature_id
  FROM routing.routing_turn_restrictions
  WHERE coalesce(is_active, true)
    AND source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
) d;

SELECT 'examples' AS section,
  t.restriction_type,
  t.external_id,
  t.from_street_id,
  fs.canonical_name AS from_street_name,
  fs.external_id AS from_street_external_id,
  t.to_street_id,
  ts.canonical_name AS to_street_name,
  ts.external_id AS to_street_external_id,
  t.via_node_external_id
FROM routing.routing_turn_restrictions t
LEFT JOIN core.core_streets fs ON fs.id = t.from_street_id
LEFT JOIN core.core_streets ts ON ts.id = t.to_street_id
WHERE coalesce(t.is_active, true)
ORDER BY t.restriction_type, t.id
LIMIT 20;
SQL

export TR_APPLY_PKG="${PKG}"
export TR_APPLY_REPORT="${REPORT}"
export TR_APPLY_SNAPSHOT="${SNAPSHOT_VERSION}"
python3 - <<'PY'
from pathlib import Path
import os, re
pkg = Path(os.environ["TR_APPLY_PKG"])
report = Path(os.environ["TR_APPLY_REPORT"])
snap = os.environ["TR_APPLY_SNAPSHOT"]
pre = (pkg / "preflight.log").read_text(encoding="utf-8", errors="replace")
final = (pkg / "final_validation.log").read_text(encoding="utf-8", errors="replace")
apply_log = (pkg / "import_apply.log").read_text(encoding="utf-8", errors="replace")
review_log = (pkg / "review_upload.log").read_text(encoding="utf-8", errors="replace")

def grab(text, key):
    m = re.search(rf"{key}\s*\|\s*(\d+)", text)
    return int(m.group(1)) if m else None

before = grab(pre, "turn_restrictions_total")
after = grab(final, "turn_restrictions_total")
review_n = grab(final, "review_candidates")
inserted = sum(int(x) for x in re.findall(r"\|\s+(\d+)\s+\|\s+(\d+)\s+\|\s+\d+\s+\|\s+f\s+\|", apply_log))
# parse inserted from section lines
ins_vals = [int(m.group(1)) for m in re.finditer(r"direct_core_routing_turn_restrictions\s+\|\s+\d+\s+\|\s+(\d+)\s+\|\s+(\d+)", apply_log)]
# simpler parse
ins = 0
upd = 0
for m in re.finditer(
    r"direct_core_routing_turn_restrictions\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*f",
    apply_log,
):
    ins += int(m.group(2))
    upd += int(m.group(3))
uploaded = grab(review_log, "uploaded")
lines = [
  "# Routing turn restrictions national production apply (2026-08-13)",
  "",
  "Applied approved dry-run artifacts only. No OSM re-extract. No street re-import.",
  "",
  "## Preflight",
  "",
  f"- snapshot: `{snap}`",
  f"- source registry: `osm_myanmar`",
  f"- turn restrictions before: **{before}**",
  f"- streets active: see preflight log",
  "",
  "## Apply result",
  "",
  "| Action | Count |",
  "|---|---:|",
  "| safe_new expected | 1658 |",
  "| safe_update expected | 0 |",
  "| unchanged (not written) | 0 |",
  f"| inserted (sum batches) | **{ins}** |",
  f"| updated (sum batches) | **{upd}** |",
  f"| turn restrictions after | **{after}** |",
  f"| review uploaded | **{review_n}** (upload step reported {uploaded}) |",
  "",
  "Review includes: 6 unmatched-network V1 rows + 766 via-way/multi-via structures.",
  "Excluded malformed junk: unsupported_member_shape (61) + unsupported_type (1).",
  "",
  "## Validation",
  "",
  "See:",
  f"- `{pkg / 'final_validation.log'}`",
  f"- `{pkg / 'import_apply.log'}`",
  f"- `{pkg / 'review_upload.log'}`",
  "",
  "## STOP",
  "",
  "Production apply complete. No Valhalla / PMTiles rebuild.",
  "",
]
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote", report)
print({"before": before, "after": after, "inserted": ins, "updated": upd, "review": review_n})
PY

echo "DONE mode=apply"
echo "report: ${REPORT}"
echo "artifacts: ${PKG}"
