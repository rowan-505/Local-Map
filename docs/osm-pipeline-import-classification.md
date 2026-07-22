# OSM pipeline — final import classification

Local-only rules for Stage **08b** (`import_class`) and Stage **18** dry-run report.

No production / Supabase writes.

## Final classes

| Class | Meaning |
|-------|---------|
| `safe_new` | Technically valid; no exact source identity match; no strong duplicate |
| `safe_update` | Exact identity match; OSM-derived core; not protected; only auto-allowed fields changed |
| `unchanged` | Exact identity match; meaningful content same |
| `duplicate` | Different identity; strong likely match to an existing core entity |
| `conflict` | Match exists but important fields disagree beyond safe-update rules |
| `manual_protected` | Matched core has `manual_override=true` and import differs |
| `verified_conflict` | Meaningful change would modify a verified core row (`is_verified=true`) |
| `possible_delete` | OSM-derived entity in previous snapshot missing from current (F1 `deleted_candidate`) |
| `invalid` | Technical validation failed (`validation_status=invalid`) |

## Reconciliation

For each family (current staging):

```text
valid
  = safe_new + safe_update + unchanged + duplicate + conflict
    + manual_protected + verified_conflict
```

`valid` = staging rows with `validation_status` not in (`invalid`, `blocked`, `failed`).

`possible_delete` and `invalid` are reported separately. Stage 18 **fails** when the equality above fails or any valid row is unclassified.

## Family duplicate thresholds

Not one global spatial threshold.

| Family | Duplicate / likely-match rule | Threshold |
|--------|-------------------------------|-----------|
| places | non-identity spatial and/or name+spatial (via F2) | **30 m** |
| buildings | non-identity intersect / centroid match (via F2) | **10 m** (centroid); ~22 m expand for intersect |
| roads | **identity only** — no spatial duplicate class | n/a |
| admin_areas | F2 fallback: same level + exact name + intersect | ~**22.3 m** (0.0002°) |
| landuse | non-identity spatial (via F2) | **5 m** |
| water_polygons | non-identity spatial (via F2) | **5 m** |
| water_lines | non-identity spatial (via F2) | **10 m** |
| routing_barriers | non-identity spatial (via F2); changes never auto-update | **10 m** |

## Automatic-update fields (safe_update allow-list)

| Family | Allowed automatic fields |
|--------|--------------------------|
| places | name fields, category/class ids, `point_geom`, `admin_area_id` |
| buildings | name, `building_type_id` / class, `geom`, `centroid`, `admin_area_id` |
| roads | name, road class, `geom`, oneway, surface, access/vehicle/foot/bicycle/bus |
| admin_areas | **`canonical_name` only** (level/geom changes → conflict) |
| landuse | name, `class_code`, `geom`, `centroid`, `admin_area_id` |
| water_polygons | name, `class_code`, `geom` |
| water_lines | name, `class_code`, `geom` |
| routing_barriers | **none** (identity unchanged → `unchanged`; any change → `conflict`) |

`safe_update` also requires the matched core row to look **OSM-derived** (`external_id` / `source_refs` / source type).

## Decision priority (current staging row)

1. `invalid`
2. no prod match → `safe_new` (or `duplicate` if non-identity strong match)
3. matched + `manual_override` / `protect_manual` → `manual_protected` (or `unchanged` if content same)
4. matched + `is_verified` + change → `verified_conflict`
5. non-identity strong match → `duplicate`
6. unchanged content → `unchanged`
7. identity + OSM-derived + allow-listed change → `safe_update`
8. else → `conflict`

`possible_delete` is assigned from F1 deleted OSM-derived entities (not current staging). Stage 18 reports it beside the valid-row buckets and asserts:

```text
valid = safe_new + safe_update + unchanged + duplicate
      + conflict + manual_protected + verified_conflict
```

(`possible_delete` and `invalid` are reported separately; the job fails if valid-row equality fails.)

## How to run (Kyauktan)

```bash
cd tools/data-pipeline/local-osm
source imports/kyauktan_2026_05_15_v2.env

# After mirror refresh + Stage 05/06:
psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 07_compare_with_prod_mirror.sql

psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 08_assign_statuses.sql

psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 08b_assign_import_class.sql

psql "$LOCAL_DATABASE_URL" -v snapshot_version="$SNAPSHOT_VERSION" \
  -v entity_families="$ENTITY_FAMILIES" -f 18_classification_bucket_report.sql
```

Next test targets after Kyauktan: one rural township, then Yangon (same scripts; no production writes).
