#!/usr/bin/env bash
# Same-snapshot Stage 05 rerun verification (local DB only; no Supabase writes).
#
# Usage:
#   ./scripts/test_stage05_same_snapshot_rerun.sh [import-env-file]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${SCRIPT_DIR}"

IMPORT_ENV="${1:-imports/kyauktan_2026_05_15_v2.env}"
if [[ ! -f "${IMPORT_ENV}" ]]; then
  echo "error: import env not found: ${IMPORT_ENV}" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${IMPORT_ENV}"

: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL required}"
: "${SNAPSHOT_VERSION:?SNAPSHOT_VERSION required}"

ENTITY_FAMILIES="${ENTITY_FAMILIES:-admin_areas,roads,places,buildings,landuse,water_lines,water_polygons,routing_barriers}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
RAW_SCHEMA="${RAW_SCHEMA:-raw}"
REPORT_DIR="${SCRIPT_DIR}/reports"
mkdir -p "${REPORT_DIR}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN1="${REPORT_DIR}/stage05_rerun_${TS}_pass1.log"
RUN2="${REPORT_DIR}/stage05_rerun_${TS}_pass2.log"
M1="${REPORT_DIR}/stage05_rerun_${TS}_metrics1.txt"
M2="${REPORT_DIR}/stage05_rerun_${TS}_metrics2.txt"
COMPARE="${REPORT_DIR}/stage05_rerun_${TS}_compare.md"
PY_COMPARE="${REPORT_DIR}/stage05_rerun_${TS}_compare.py"

run_stage05() {
  local out="$1"
  echo "=== Stage 05 → ${out} ==="
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v raw_schema="${RAW_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -f "${SCRIPT_DIR}/05_raw_to_staging.sql" \
    >"${out}" 2>&1
}

capture_metrics() {
  local label="$1"
  local out="$2"
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v label="${label}" \
    -f "${SCRIPT_DIR}/scripts/stage05_capture_metrics.sql" \
    >"${out}"
}

echo "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
echo "ENTITY_FAMILIES=${ENTITY_FAMILIES}"

run_stage05 "${RUN1}"
capture_metrics "pass1" "${M1}"

run_stage05 "${RUN2}"
capture_metrics "pass2" "${M2}"

cat >"${PY_COMPARE}" <<'PY'
from pathlib import Path
import sys

m1_path, m2_path, compare_path, snapshot, families, run1, run2, ts = sys.argv[1:9]

def parse(path: Path, label: str):
    rows = {}
    for line in path.read_text().splitlines():
        if "|" not in line or label not in line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 7 or parts[0] != label:
            continue
        rows[parts[1]] = {
            "row_count": parts[2],
            "distinct_external_ids": parts[3],
            "null_external_ids": parts[4],
            "duplicate_external_id_groups": parts[5],
            "fingerprint": parts[6] if parts[6] != "" else None,
        }
    return rows

r1 = parse(Path(m1_path), "pass1")
r2 = parse(Path(m2_path), "pass2")
ok = True
lines = [
    f"# Stage 05 same-snapshot rerun — {ts}",
    "",
    f"- snapshot: `{snapshot}`",
    f"- families: `{families}`",
    "",
    "| family | rows | distinct external_ids | dups | fingerprint | result |",
    "|---|---:|---:|---:|---|---|",
]

for fam in sorted(set(r1) | set(r2)):
    a, b = r1.get(fam), r2.get(fam)
    if a is None or b is None:
        lines.append(f"| {fam} | - | - | - | - | FAIL missing |")
        ok = False
        continue
    same = a == b
    if fam == "other_snapshot_guard":
        same = a["row_count"] == b["row_count"]
    if a["duplicate_external_id_groups"] != "0" and fam != "other_snapshot_guard":
        ok = False
        same = False
    if not same:
        ok = False
    fp = "same" if a.get("fingerprint") == b.get("fingerprint") else "DIFF"
    if fam == "other_snapshot_guard":
        fp = "n/a"
    lines.append(
        f"| {fam} | {a['row_count']}→{b['row_count']} | {a['distinct_external_ids']}→{b['distinct_external_ids']} | {a['duplicate_external_id_groups']}→{b['duplicate_external_id_groups']} | {fp} | {'PASS' if same else 'FAIL'} |"
    )

lines += ["", f"**Overall: {'PASS' if ok else 'FAIL'}**", ""]
Path(compare_path).write_text("\n".join(lines) + "\n")
print("\n".join(lines))
print(f"Wrote {compare_path}")
print(f"PASS1 log: {run1}")
print(f"PASS2 log: {run2}")
sys.exit(0 if ok else 1)
PY

python3 "${PY_COMPARE}" \
  "${M1}" \
  "${M2}" \
  "${COMPARE}" \
  "${SNAPSHOT_VERSION}" \
  "${ENTITY_FAMILIES}" \
  "${RUN1}" \
  "${RUN2}" \
  "${TS}"
