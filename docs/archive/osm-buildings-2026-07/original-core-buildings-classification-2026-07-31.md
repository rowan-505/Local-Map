# Original Core buildings classification (pre batch 255)

**Date:** 2026-07-31  
**Mode:** classification only — **no database writes**  
**Scope:** the **1,133** `core.core_map_buildings` rows that existed before national direct-Core publish batch 255

## Verdict

| Classification | Count |
|----------------|------:|
| `KEEP_MANAGED` | **208** |
| `ORDINARY_FOOTPRINT_CANDIDATE` | **911** |
| `MANUAL_REVIEW` | **14** |
| **Total** | **1,133** |

**Cleanup readiness:** `GO_FOR_CLEANUP`  
**Recommended cleanup ceiling:** **911** (ordinary candidates only; do not touch KEEP or MANUAL_REVIEW)

Every ordinary candidate has: exact original-set membership, exact single basemap match, zero place/address deps, no managed/manual evidence, no official/local curated names, no Core-only meaningful unique metadata, and Core↔basemap geometry hash equality (`ST_Normalize` MD5). Recoverable from local `basemap_source.buildings`.

---

## Original-ID reconstruction (exact)

**Primary method (set subtraction):**

```text
original_ids =
  all current core.core_map_buildings.id
  minus
  distinct system.system_publish_items.target_id
    where publish_batch_id = 255
      and entity_family = 'buildings'
      and publish_action = 'insert'
      and publish_status = 'success'
```

| Check | Result |
|------:|-------:|
| Current Core total | 23,836 |
| Batch 255 insert/success targets | 22,703 |
| Subtraction count | **1,133** |
| Batch 255 update/success in original set | **29 / 29** |

**Cross-check:** identical to pre-apply backup  
`tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/backups_20260731T045326Z/core_map_buildings_before.csv`  
(1,133 IDs; set equality true; 0 only-in-backup; 0 only-in-subtraction).

Not used: guessed ID thresholds or `created_at` cutoffs.

---

## Outputs

| Artifact | Path |
|----------|------|
| Classification CSV | `tools/data-pipeline/buildings/reports/original-core-1133-classification.csv` |
| This report | `docs/original-core-buildings-classification-2026-07-31.md` |
| Summary JSON | `tools/data-pipeline/buildings/reports/original_1133_classification_summary.json` |
| Ordinary random sample (100) | `tools/data-pipeline/buildings/reports/ordinary-candidates-random-sample-100.csv` |
| Ordinary ID list | `tools/data-pipeline/buildings/reports/ordinary-candidates-all-ids.txt` |

CSV includes all required evidence columns (identity, flags, names, links, deps, type, admin, basemap match, geometry hashes, equality status, metadata summary, classification, reasons).

---

## Evidence sources inspected

| Source | Role |
|--------|------|
| `core.core_map_buildings` | row state, flags, identity, hashes |
| `core.core_map_building_names` | imported vs official/local |
| `core.core_place_buildings` | place links (FK) |
| `import_review.address_candidates.matched_building_id` | address deps (0 hits on original set) |
| `system.system_publish_items` | batch-255 insert/update lineage |
| FK catalog | only FKs to buildings: names + place_buildings |
| `tiles.tiles_buildings_v` / `search.v_search_buildings_source` | views only (no FK dependency) |
| Local `basemap_source.buildings` | source compare only (read-only) |

No other `building_id` FK columns found outside names / place_buildings / address_candidates.

---

## Geometry comparison

1. Compared `md5(ST_AsBinary(ST_Normalize(geom)))` on Core vs matching basemap row.
2. Typed identities with exactly one basemap match: **1,003 / 1,003 hash-equal**.
3. Hash-differing rows requiring `ST_Equals` / Hausdorff: **0**.
4. No national full-table spatial scan.

---

## KEEP_MANAGED (208) — reason distribution

Reasons can stack on one row.

| Reason (normalized) | Rows mentioning |
|---------------------|----------------:|
| `missing_typed_osm_identity` | 130 |
| `legacy_name_without_basemap_match` | 116 |
| `source_refs.source=dashboard` | 114 |
| `place_building_links` | 51 |
| `official_local_curated_names` | 50 |
| `legacy_name_unique_vs_basemap` | 25 |
| `has_admin_area_repair_metadata` | 22 |
| `soft_deleted_historical_row` | 8 |
| `verified_status=verified` | 6 |

### Linked candidates (place links > 0): 51

IDs in summary JSON `linked_candidate_ids`.

### Verified candidates: 6

IDs in summary JSON `verified_candidate_ids`.

### Soft-deleted historical: 8

Kept under KEEP_MANAGED.

### Ambiguous / missing typed identity: 130

All KEEP_MANAGED (`missing_typed_osm_identity`). No multi-basemap matches.

### Geometry-different vs basemap: 0

---

## MANUAL_REVIEW (14)

Imported/legacy **named** footprints that otherwise looked ordinary. Names appear facility-like (offices, monastery buildings, factories). Value if removed from Core is unclear even though basemap can recreate the footprint/name — classified MANUAL_REVIEW per “imported names quality/value unclear”.

IDs: `153, 204, 215, 232, 307, 502, 542, 544, 545, 557, 745, 753, 823, 1037`

---

## ORDINARY_FOOTPRINT_CANDIDATE (911)

All of:

- active, not deleted  
- complete typed OSM identity  
- exactly one `basemap_source.buildings` match  
- zero place links / address deps  
- not verified; not dashboard/manual source  
- no manual geometry/attribute flags  
- no official/local curated names  
- no Core-only repair/unique managed metadata  
- geometry hash equal to basemap  
- no Core-only legacy/imported display name retained in this class  

**Named ordinary candidates after final pass:** **0** (14 moved to MANUAL_REVIEW).

**Random sample (seed 20260731):** 100 IDs in `ordinary-candidates-random-sample-100.csv`.

**Batch-255 updates inside ordinary:** present (safe: still original-set members; post-update still hash-equal to basemap and unmanaged). KEEP absorbed 3 of the 29 updates that had managed signals.

---

## Recommended cleanup ceiling

| Bound | Value |
|------|------:|
| Hard max disposable under this classification | **911** |
| Do not delete | KEEP 208 + MANUAL 14 = **222** |
| Remaining Core after hypothetical ordinary removal | 23,836 − 911 = **22,925** |

Suggested next step (out of scope here): a separate guarded apply plan that soft-deletes or archives **only** the 911 ordinary IDs, with basemap recoverability checks — not executed in this task.

---

## Safety confirmation

- No UPDATE/DELETE/INSERT  
- No soft-delete  
- No schema change  
- No “name IS NULL ⇒ disposable” rule  
- No “all OSM ⇒ disposable” rule  
- Uncertain named rows → MANUAL_REVIEW  
- Local `basemap_source` read-only  

**Return code for cleanup planning:** `GO_FOR_CLEANUP`
