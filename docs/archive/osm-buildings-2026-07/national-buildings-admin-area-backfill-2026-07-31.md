# National buildings — admin_area_id backfill (batch 255)

**Date:** 2026-07-31  
**Mode:** Phase A complete (inspect + dry-run). Phase B apply **not required** today.  
**Publish batch:** `system.system_publish_batches.id = 255`  
**Scope:** inserted `safe_new` buildings only (`entity_family=buildings`, `publish_action=insert`, `publish_status=success`) with `admin_area_id IS NULL`.

## Verdict

**No trustworthy exact township match exists for any of the 2,708 null-admin buildings.**

| Classification | Count |
|----------------|------:|
| `EXACT_ONE_TOWNSHIP` | **0** |
| `MULTIPLE_TOWNSHIPS` | **0** |
| `NO_TOWNSHIP` | **2,708** |
| `INVALID_TARGET_STATE` | **0** |

**Expected durable update count: 0.**  
Leaving these rows null is safer than forcing nearest-township, town, district, or state/region IDs.

Dry-run `UPDATE ... ROLLBACK` executed successfully and updated **0** rows.

---

## Artifact paths

| Item | Path |
|------|------|
| This report | `docs/national-buildings-admin-area-backfill-2026-07-31.md` |
| Package dir | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/admin_area_backfill_2026_07_31/` |
| Dry-run CSV | `.../dry_run_classification.csv` (2,708 rows) |
| Unresolved CSV | `.../unresolved_rows.csv` (2,708 rows) |
| Classification counts | `.../classification_counts.csv` |
| Inspect + dry-run SQL | `.../01_inspect_and_dry_run.sql` |
| Apply SQL (guarded) | `.../02_apply_exact_one_township.sql` |
| Rollback SQL | `.../03_rollback_backfill.sql` |
| Post-check SQL | `.../04_post_check.sql` |

---

## Phase A — inspection summary

### Target set

| Check | Result |
|------:|-------:|
| Batch 255 insert/success items | 22,703 |
| Distinct insert targets | 22,703 |
| Inserts with null `admin_area_id` | **2,708** |
| Inserts with non-null `admin_area_id` | 19,995 |
| Core buildings total | 23,836 |

Target count matches the approved known-null set from the direct-Core apply/final audit.

### Schema / helpers used

Production already has migration **146** township uniqueness helpers:

| Function | Role |
|----------|------|
| `core.entity_rep_point_for_admin_lookup` | `ST_PointOnSurface` for polygons |
| `core.admin_area_is_operational_township` | true-township set (364), excludes denylisted IDs |
| `core.find_admin_area_for_point(geom, 'township')` | `ST_Covers` + exact-one or NULL (no silent `LIMIT 1`) |

Township admin level: `ref.ref_admin_levels.code = 'township'`  
Operational active townships with geometry: **364**.

This repair follows that same exact-one `ST_Covers` policy. It does **not** use the older generic “smallest containing polygon” path from `admin-hierarchy-repair/06_backfill_buildings_admin_area.sql` for assignment (that path can pick non-township levels when target is null).

Representative point for this repair: **`ST_PointOnSurface(building.geom)`** only (no centroid fallback).

### Evidence in JSON

For all 2,708 targets:

- `normalized_data.admin_area_id` absent
- `source_refs.admin_area_id` absent

No supporting preserved admin ID to reconcile against.

### `NO_TOWNSHIP` reason breakdown

| Reason | Count | Meaning |
|--------|------:|---------|
| `outside_admin_polygons_near_township_boundary_gap` | 1,609 | Outside operational township polygons, but ≤1 km from nearest township |
| `outside_myanmar_country_polygon_or_offshore_border_gap` | 1,039 | Outside country polygon (and >1 km from nearest township under the reason rule) |
| `inside_myanmar_covered_by_town_not_operational_township` | 59 | Covered by town-level `လားရှိုးမြို့` (id 6497), which is intentionally non-operational / not township target |
| `inside_myanmar_country_but_no_township_cover` | 1 | Inside country, no township/town cover |

Higher-level cover among the 2,708:

| Level | Buildings covered |
|-------|------------------:|
| country | 60 |
| state_region | 59 |
| district | 0 |
| operational township | **0** |
| any township-level (incl. non-ops) | **0** |
| town | 59 (all Lashio town id 6497) |

`core.find_admin_area_for_point(..., 'township')` returned NULL for all 2,708 (agrees with exact-one policy).

### Geographic pattern (nearest operational township)

Most unresolved rows cluster near border / coverage-gap townships:

| Nearest township | Count | Approx avg distance |
|------------------|-----:|--------------------:|
| လှိုင်းဘွဲမြို့နယ် (5880) | 2,315 | ~1.2 km |
| တာချီလိတ် (6390) | 107 | ~1.3 km |
| မြဝတီမြို့နယ် (5033) | 78 | ~1.1 km |
| လျင်ဟိုမြို့နယ် (6468) | 59 | ~2.0 km (Lashio town cluster) |

Distance buckets to nearest operational township:

| Bucket | Count |
|--------|------:|
| ≤10 m | 0 |
| ≤100 m | 85 |
| ≤500 m | 1,185 |
| ≤1 km | 1,614 |
| ≤5 km | 2,702 |
| >5 km | 6 |

Many points are close to a township boundary but still **not covered**. Per repair rules, nearest-township was **not** auto-assigned.

### Why not assign state/town?

- Product / migration 146 policy: entity `admin_area_id` for buildings expects **operational township**.
- Assigning state/region or town would violate that contract and confuse core-review / search filters.
- Town id **6497** is on the non-operational denylist (`admin_area_is_non_operational_township_id`).

---

## Before / after counts

No durable write was applied. Snapshot after Phase A dry-run rollback:

| Metric | Before | After Phase A |
|--------|-------:|-------------:|
| Batch 255 null `admin_area_id` | 2,708 | **2,708** |
| Batch 255 non-null `admin_area_id` | 19,995 | **19,995** |
| `EXACT_ONE` updates | — | **0** |
| Geometry changes | — | **0** |
| Non-target building changes | — | **0** |

---

## Phase B — apply status

**Not executed.** There is nothing safe to apply under `EXACT_ONE_TOWNSHIP`.

If township polygons are later repaired and a re-run yields exact-one matches:

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v execute_building_admin_backfill=I_UNDERSTAND \
  -f tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/admin_area_backfill_2026_07_31/02_apply_exact_one_township.sql
```

Guard equivalent: `EXECUTE_BUILDING_ADMIN_BACKFILL=I_UNDERSTAND` (pass through as the psql `-v` value above).

Apply behavior:

1. Rebuild exact-one operational township hits for the same batch-255 null set.
2. Recheck batch membership, null admin, active township, and `ST_Covers`.
3. Update only those rows in one transaction.
4. Optionally write `normalized_data.admin_area_repair` via existing helpers (`merge_admin_area_repair_normalized_data` / `build_admin_area_repair_metadata`) — already present in production.
5. Does not create a new audit subsystem.

Rollback (only if a future apply wrote the repair method marker):

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" -f .../03_rollback_backfill.sql
# review, then change ROLLBACK → COMMIT
```

---

## Post-check (read-only)

| Check | Result |
|-------|--------|
| `tiles.tiles_buildings_v` | exists; **23,828** rows |
| `search.v_search_buildings_source` | exists; **10,176** rows |
| Non-null batch-255 admin refs remain valid operational townships | previously verified in final audit; unchanged by this dry-run |
| Local `basemap_source` | **not touched** |
| New API / dashboard / table / trigger | **none** |

API / core-review building detail paths were not exercised end-to-end in a browser in this pass. Schema and view presence checks passed; no Core rows changed, so detail endpoints should behave as after the batch-255 import.

---

## Recommendation

1. **Keep the 2,708 nulls** until admin polygon coverage improves (especially Hlaingbwe / Myawaddy / Tachileik border zones and Lashio town vs township topology).
2. Do **not** force nearest-township assignment for boundary-gap rows.
3. Treat Lashio town (6497) separately if product later allows town-level building admin (currently forbidden by operational township policy).
4. Re-run `01_inspect_and_dry_run.sql` after any township geometry repair; only then consider Phase B.

---

## Out of scope / not done

- No production durable `UPDATE` (expected count was 0).
- No local basemap_source changes.
- No admin polygon edits.
- No nearest-township auto-fill.
- Browser smoke test of API/dashboard detail pages not run in this session.
