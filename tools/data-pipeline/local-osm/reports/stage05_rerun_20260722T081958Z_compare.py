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
