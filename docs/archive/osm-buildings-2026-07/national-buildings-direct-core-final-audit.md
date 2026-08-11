# National buildings direct-Core — final audit

**Date:** 2026-07-31  
**Mode:** read-only  
**Publish batch:** **255**  
**Apply report:** [`docs/national-buildings-direct-core-apply-2026-07-31.md`](national-buildings-direct-core-apply-2026-07-31.md)

## Final result

**PASS_WITH_KNOWN_ISSUES**

The one-time import reconciles to the approved artifact. No compact/verbose identity duplicates, no `duplicate`/`pmtiles_only` imports, geometry/FK/name/link checks pass. Known issues are the pre-approved **2,708** null `admin_area_id` inserts and a small set of OSM-derived area/levels outliers (not import defects).

---

## Inputs re-checked

| Item | Value | OK |
|------|-------|----|
| Artifact | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/buildings.safe.csv` | |
| SHA-256 | `d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6` | yes |
| Manifest SHA-256 | `83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be` | yes |
| Artifact scope | safe_new 22,703 + safe_update 82 | yes |
| duplicate / pmtiles_only in artifact | 0 | yes |
| CSV ↔ manifest identity sets | equal | yes |

---

## Before / after Core counts

| Table | Before (apply report) | After (live) | Delta |
|-------|----------------------:|-------------:|------:|
| `core.core_map_buildings` | 1,133 | **23,836** | +22,703 |
| active buildings | — | 23,828 | — |
| `core.core_map_building_names` | 259 | **18,093** | +17,834 |
| `core.core_place_buildings` | 51 | **51** | 0 |
| `system.system_publish_batches` | 16 | 17 | +1 |
| `system.system_publish_items` | 2,538 | 25,270 | +22,732 |

Core total increased only by successful inserts (**+22,703**).

---

## Publish batch 255 reconciliation

| Metric | Value | OK |
|--------|------:|----|
| status | promoted | yes |
| total_item_count | 22,785 | yes |
| success_count | 22,732 | yes |
| failed_count | 0 | yes |
| skipped_count | 53 (unchanged ready updates) | yes |
| summary.inserted | 22,703 | yes |
| summary.updated | 29 | yes |
| summary.unchanged_ready | 53 | yes |
| summary.skipped_protected | 0 | yes |
| publish_items insert/success | 22,703 | yes |
| publish_items update/success | 29 | yes |
| distinct insert targets | 22,703 | yes |
| distinct update targets | 29 | yes |

`success_count` 22,732 = 22,703 inserts + 29 updates.  
`skipped_count` 53 + updates 29 = **82** safe_update artifact rows.

Protected/skipped hard blocks: **0** (documented in apply report). Unchanged-ready updates are recorded as batch skipped_count, not force-updated.

---

## Artifact ↔ Core identity reconcile

Matching uses typed OSM identity (`source_registry_id` = `osm_myanmar` + `source_feature_type` + `source_feature_id`), not raw `external_id` equality.

| Class | Artifact | Active Core match | Missing | Soft-deleted match |
|-------|---------:|------------------:|--------:|-------------------:|
| safe_new | 22,703 | **22,703** | 0 | 0 |
| safe_update | 82 | **82** | 0 | 0 |

| Check | Result |
|-------|--------|
| Exactly one active Core row per approved identity | **PASS** (multi-active = 0) |
| Global typed-identity collisions | **PASS** (0) |
| `import_class=duplicate` in Core | **0** |
| `import_class=pmtiles_only` in Core | **0** |
| `import_class=safe_new` markers | 22,703 |
| `import_class=safe_update` markers | 29 (rows actually updated) |
| `source_refs.loader=direct_core.buildings` | 22,732 |

---

## Geometry (inserted rows from batch 255)

| Check | Result |
|-------|--------|
| Typmod | `geometry(MultiPolygon,4326)` |
| null geom | 0 |
| empty geom | 0 |
| non-4326 | 0 |
| non-MultiPolygon | 0 |
| null centroid | 0 |
| null / non-positive `area_m2` | 0 |
| Sample `ST_IsValid` (`id % 40 = 3`) | **0** invalid |
| Full-table `ST_IsValid` | **not run** (by design) |

### Outliers (source data, not structural failures)

| Metric | Value |
|--------|------:|
| area p50 | ~183 m² |
| area p99 | ~11,433 m² |
| area > 100,000 m² | **11** |
| area > 1,000,000 m² | 0 |
| area max | ~409,070 m² |
| levels > 100 | **1** (levels=199) |
| height_m > 500 | 0 (max observed 500) |
| negative levels/height | 0 |

Legacy `core_map_buildings.name` on inserts: **0** (names live in `core_map_building_names`).

---

## Names

On batch-255 touched buildings:

| Check | Result |
|-------|--------|
| Name rows | 17,788 |
| Language codes | `und` 9,785 / `en` 5,265 / `my` 2,738 |
| Invalid / unexpected language | **0** |
| `name_type` | all **`imported`** |
| Unexpected name_type | **0** |
| Exact duplicate (building, lang, type, lower(name)) | **0** |
| Insert name_type mix | imported only (17,758 on insert targets) |
| Official/local curated rows on updated targets | **0** (no curated replacement observed) |

---

## References

| Check | Result |
|-------|--------|
| Inserted `building_type_id` missing/invalid | **0** |
| Inserted non-null `admin_area_id` missing/invalid | **0** |
| Inserted null `admin_area_id` | **2,708** (matches approved artifact) |
| Artifact admin present / null | 20,077 / 2,708 |

---

## Protection / links

| Check | Result |
|-------|--------|
| Dashboard-sourced buildings | 114 |
| Dashboard rows in batch 255 targets | **0** |
| Updated rows verified | 0 |
| Updated rows with manual-edit flags | 0 |
| Updated rows dashboard/manual source | 0 |
| Place-building links | **51** (unchanged) |
| Broken place-building FKs | **0** |

safe_update coverage: artifact 82 = published updates 29 + not in publish items 53 (unchanged).

---

## Integration smoke

| Surface | Result |
|---------|--------|
| `tiles.tiles_buildings_v` | OK (23,828 rows) |
| `search.v_search_buildings_source` | OK (10,176 rows) |
| API `GET /buildings?limit=2` | **200** |
| API `GET /buildings/:public_id` (inserted) | **200** |
| API `GET /core-review/buildings` | **200** |
| API `GET /core-review/buildings/:public_id` | **200** |
| Dashboard `/dashboard/core-review/buildings` | **200** |
| Dashboard building edit route | **200** |

---

## Known issues (accepted)

1. **2,708** inserted buildings have null `admin_area_id` — approved in artifact; Core schema and importer allow null.
2. **11** very large footprints (`area_m2` > 100,000) and **1** extreme `levels=199` — OSM source outliers; geometry remains valid MultiPolygon 4326 with centroid/area populated.
3. Apply used one regional transaction with internal 1,000-row insert batches (not separate commits per batch) — matches the existing direct-Core design and the apply report.

---

## Checklist → result

| Required check | Status |
|----------------|--------|
| Artifact identities reconcile to Core | PASS |
| Each successful safe_new → exactly one Core row | PASS |
| Each safe_update → exactly one Core row | PASS |
| Protected skipped documented (0 hard-blocked; 53 unchanged) | PASS |
| No compact/verbose typed duplicate | PASS |
| No duplicate/pmtiles imported | PASS |
| Geometry typmod/SRID/non-empty | PASS |
| Bounded ST_IsValid sample | PASS |
| Centroid + area_m2 on inserts | PASS |
| Area/levels/height outliers reported | PASS (known) |
| Names language/type/dupes/curated | PASS |
| Building-type refs | PASS |
| Non-null admin refs | PASS |
| Null admin population reported | PASS (known 2,708) |
| API / dashboard / tiles / search | PASS |
| Before/after counts | PASS |
| Publish batch/item reconcile | PASS |

## Final result

**PASS_WITH_KNOWN_ISSUES**

No data was changed by this audit. Existing mixed Core buildings were not cleaned.
