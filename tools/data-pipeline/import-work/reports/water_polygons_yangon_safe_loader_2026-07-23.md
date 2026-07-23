# Water polygons safe loader — 2026-07-23

## Verdict

**PASS**

Yangon downtown sample had **0** eligible named water polygons (acceptable empty pilot).  
Loader proven on a **controlled Kyauktan real sample**: **3 `safe_new`** reservoirs from snapshot **4**.  
National / full-city water-polygon loading remains **disabled**.

---

## Scope

| Item | Value |
|---|---|
| Target | production `locghyuranqaqsnbxflc` |
| Contract | `docs/safe-loader-contract.md` |
| Yangon downtown (snap 10) | 0 eligible after named filter |
| Prove-out sample | Kyauktan snap **4** `osm_myanmar_2026_05_15_kyauktan_v2` |
| Batch | `water_polygons_kyauktan_safe_2026_07_23` |
| Work rows | 3 `safe_new` (Bantbwekone Dam, Thilawa Dam, ဇာမဏီအင်းရေလှောင်တမံ) |
| Core before → after | **9 → 12** (+3) |
| Names written | **4** |

---

## Artifacts

- Migration `142` → `import_work.water_polygon_rows`
- `water_polygons_safe_loader.sql` / `_body.sql` / `run_water_polygons_safe_loader.sh`
- `kyauktan_water_polygons_preload.sh` + `.sql`
- `water_polygons_safe_loader_tests.sql` (fixture also proves empty-batch-ready path)

Allowlist: name, class_code, geom, normalized_data, source_refs, water_polygon_names.

Protection: source_refs dashboard/manual; verified skip.

Names: `core.core_map_water_polygon_names` (`en` / `mm` / `und`).

---

## Pilot metrics (Kyauktan)

| Step | inserted | updated | skipped | failed | notes |
|---|---:|---:|---:|---:|---|
| Dry-run | 3 | 0 | 0 | 0 | ROLLBACK |
| Apply | 3 | 0 | 0 | 0 | committed; cleanup |
| Identical rerun | 0 | 0 | 3 | 0 | identity already in core |

Duration (apply): **4.82 ms**.

---

## Fixture tests

`water_polygons_safe_loader_tests.sql` — **ALL CHECKS PASSED** (rolled back).

---

## Remaining risks

- Yangon downtown still empty for this family until a larger named clip is classified.
- No water type reference FK.

## PASS
