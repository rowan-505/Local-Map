# Production Baseline v1 — 2026-07-22

**Project:** Supabase `locghyuranqaqsnbxflc` (Map Project)  
**Program:** `tools/data-repair/current-production/` (Prompts 1–12)  
**Status:** Baseline v1 ready for the **next** phase (reusable OSM import pipeline cleanup).  
**Not started here:** new OSM imports, pipeline redesign, search rebuild, addresses, PMTiles/Valhalla rebuilds.

---

## Summary

Current-production foundation repair completed. Clear mechanical errors in admin hierarchy, entity township links, road class/attributes, generated street-name flags, small-core fields, and publish backlog labeling are fixed. Uncertain cases remain documented below. Lineage is registered honestly (unknown checksums where not known).

---

## Admin

| Metric | Value |
| --- | ---: |
| Active areas | 2,518 |
| Verified | 421 |
| Null external_id | 14 |
| Invalid geometry | 0 |
| Parent rank not higher | **0** |

### By level

| Level | Count |
| --- | ---: |
| country | 1 |
| state_region | 17 |
| district | 116 |
| township | 377 |
| town | 12 |
| ward_village_tract | 1,995 |

### By type

| Type | Count |
| --- | ---: |
| ward | 1,956 |
| township | 377 |
| district | 116 |
| special_area | 31 |
| town | 12 |
| state | 9 |
| region | 7 |
| island | 6 |
| village_tract | 2 |
| country | 1 |
| union_territory | 1 |

### Remaining uncertain

- Wards / tracts under non-township parents left for manual review (not auto-fixed).
- `village_tract` count still low vs wards (semantic naming debt).
- Null external_id admin rows (14) preserved.

---

## Admin links

| Family | Missing admin |
| --- | ---: |
| places | 0 |
| buildings | 0 |
| landuse | 0 |
| streets | **23,042** (outside township polygons / ambiguous) |
| transport.stops | 364 |
| transport.terminals | 305 |
| transport.infrastructure_lines | 735 |

Water tables have no `admin_area_id` column.

---

## Roads

| Metric | Value |
| --- | ---: |
| Active streets | 823,006 |
| Verified | 98 |
| Manual override | 508 |
| Null external_id | 486 |
| Text/FK class mismatch | **1** (manual) |
| `name_is_generated` | 796,342 |
| OSM name tag present | 25,215 |
| `is_oneway` true | 8,847 |
| `bridge` true | 22,937 |
| `tunnel` true | 256 |

### Top road classes (FK)

| Class | Count |
| --- | ---: |
| residential | 342,440 |
| track | 183,254 |
| unclassified | 157,559 |
| service | 53,147 |
| path | 50,648 |
| tertiary | 19,512 |
| trunk | 5,792 |
| secondary | 5,702 |
| primary | 3,923 |
| motorway | 1,022 |
| unknown | 7 |

Attribute tag↔column mismatches for oneway/bridge/tunnel/layer/surface (repair rules): **0** remaining.

Search rebuild **not** run. Later rebuild should honor `name_is_generated` / exclude `road-N` placeholders (view already excludes `road-N`).

---

## Small core

| Family | Active | Notes |
| --- | ---: | --- |
| places | 265 | 230 null external (manual OK); langs normalized |
| buildings | 1,075 | 16 null building_type left |
| landuse | 38 | class text/FK aligned |
| water_lines | 1 | includes regression-test row |
| water_polygons | 9 | thin dataset; national water later |

---

## Review backlog

| Item | Value |
| --- | ---: |
| import_review candidates / batches | **0** / **0** |
| publish batches archived | 25 |
| publish batches promoted (preserved) | 8 |
| publish items skipped (already in core) | 2,273 |
| publish items pending remaining | 36 |
| publish items success / failed | 1,811 / 1,895 |

No candidates deleted. No promotions in this program.

---

## Lineage

| Table | Count |
| --- | ---: |
| system_source_registry | 5 (OSM Myanmar present) |
| system_import_batches | 9 |
| system_source_snapshots | 9 |

Registered waves:

1. `legacy_national_admin_fast_core` — checksum **unknown**; review pipeline bypassed  
2. `legacy_national_road_fast_core` — checksum **unknown**; review pipeline bypassed  
3. Repair waves `repair_*_20260722` (admin, links, road class, attrs, names, small core, review backlog)

No per-street lineage rows.

---

## Repair artifacts

Slim backups under `system.repair_*_before_202607` / `repair_small_core_*` / `repair_review_backlog_*`.  
SQL + reports: `tools/data-repair/current-production/`.

---

## Blockers for next phase

1. Reusable OSM import pipeline still needs cleanup/simplification before national re-import.  
2. ~23k streets + transport points still outside township polygons.  
3. Search index still pre-repair; rebuild later with generated-name policy.  
4. National water/landuse/places coverage still thin (by design for this repair).  
5. Uncertain admin parent cases need human review.  
6. Do **not** resume `admin-fast-core` / `road-fast-core` as the production path.

---

## Readiness declaration

**Production Baseline v1 is ready.**  
Recommended next project phase: repair and simplify the reusable OSM import pipeline — not more national imports until that work lands.
