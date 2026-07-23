# Water lines Yangon safe loader — 2026-07-23

## Verdict

**PASS**

Production-safe loader for named water lines verified on the **1 Yangon downtown `safe_new`** row (ရန်ကုန်မြစ် / river).  
National / full-city water-line loading remains **disabled**.

---

## Scope

| Item | Value |
|---|---|
| Target | production `locghyuranqaqsnbxflc` |
| Contract | `docs/safe-loader-contract.md` |
| Sample | snapshot id **10** downtown CBD |
| Batch | `water_lines_yangon_downtown_safe_2026_07_23` (id **75**) |
| Work rows | 1 `safe_new` |
| Core before → after | **1 → 2** (+1) |
| Names written | **2** |

No `ref.ref_water_*` table — `class_code` is required free text (OSM waterway). Blank class refused by work-table CHECK.

---

## Artifacts

- Migration `142` → `import_work.water_line_rows`
- `water_lines_safe_loader.sql` / `_body.sql` / `run_water_lines_safe_loader.sh`
- `yangon_downtown_water_lines_preload.sh` + `.sql`
- `water_lines_safe_loader_tests.sql`

Allowlist: name, class_code, geom, normalized_data, source_refs, water_line_names.

Protection: source_refs dashboard/manual; verified skip.

Names: `core.core_map_water_line_names` (`en` / `mm` / `und` — live constraint).

---

## Pilot metrics

| Step | inserted | updated | skipped | failed | notes |
|---|---:|---:|---:|---:|---|
| Dry-run | 1 | 0 | 0 | 0 | ROLLBACK |
| Apply | 1 | 0 | 0 | 0 | committed; cleanup |
| Identical rerun | 0 | 0 | 1 | 0 | identity already in core |

Duration (apply): **3.43 ms**.

---

## Fixture tests

`water_lines_safe_loader_tests.sql` — **ALL CHECKS PASSED** (rolled back).

---

## Remaining risks

- Tiny downtown sample (1 row).
- No water type reference FK (class_code text only).

## PASS
