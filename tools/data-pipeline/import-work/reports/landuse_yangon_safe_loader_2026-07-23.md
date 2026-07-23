# Landuse Yangon safe loader — 2026-07-23

## Verdict

**PASS**

Production-safe loader for important/named landuse verified on the **19 Yangon downtown `safe_new`** sample only.  
Full Yangon / national landuse loading remains **disabled**. `pmtiles_only` never entered work/core.

---

## Scope

| Item | Value |
|---|---|
| Target | production `locghyuranqaqsnbxflc` |
| Contract | `docs/safe-loader-contract.md` |
| Sample | snapshot id **10** downtown CBD |
| Batch | `landuse_yangon_downtown_safe_2026_07_23` (id **73**) |
| Work rows | 19 `safe_new`, all `landuse_class_id` mapped |
| Core before → after | **38 → 57** (+19) |
| Names written | **30** |

Eligibility: named parks, markets/retail zones, industrial named zones, cemetery, religious, healthcare, etc. Ordinary farmland/forest/residential stay PMTiles-only.

---

## Artifacts

- Migration `142_import_work_landuse_water.sql` → `import_work.landuse_rows`
- `landuse_safe_loader.sql` / `_body.sql` / `run_landuse_safe_loader.sh`
- `yangon_downtown_landuse_preload.sh` + `.sql`
- `landuse_safe_loader_tests.sql`

Allowlist: name, geom, centroid, area_m2, landuse_class_id, class_code, admin_area_id, confidence_score, normalized_data, source_refs, source_tags, detail_level, crop_code, landuse_names.

Protection: `manual_override` + source_refs dashboard/manual; verified skip.

Names: `core.core_map_landuse_names` (`en` / `my` / `und`).

---

## Pilot metrics

| Step | inserted | updated | skipped | failed | notes |
|---|---:|---:|---:|---:|---|
| Dry-run | 19 | 0 | 0 | 0 | ROLLBACK |
| Apply | 19 | 0 | 0 | 0 | committed; cleanup |
| Identical rerun | 0 | 0 | 19 | 0 | identity already in core |

Duration (apply): **7.81 ms** (set-based).

---

## Fixture tests

`landuse_safe_loader_tests.sql` — **ALL CHECKS PASSED** (rolled back): new, update, identical rerun, manual, verified, duplicate ID, missing type, invalid geometry, rollback, names.

---

## Remaining risks

- Downtown sample only.
- `traffic_island` mapped to ref `transport`.
- Env file `SNAPSHOT_VERSION` can override pilot identity unless `SNAPSHOT_ID_OVERRIDE` / `SNAPSHOT_VERSION_OVERRIDE` used (preload fixed).

## PASS
