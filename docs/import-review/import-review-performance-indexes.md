# Import-review performance: index recommendations

Apply only after validating with `EXPLAIN (ANALYZE, BUFFERS)` on production-like data. Prefer `CREATE INDEX CONCURRENTLY` outside transactions in production.

## Common list query shape

All `import_review.*_candidates` tables share this pattern:

```sql
WHERE review_batch_id = $1
  AND entity_family = $family
  AND promotion_status IS DISTINCT FROM 'promoted'  -- unless include_promoted
  -- optional: match_status, auto_action, review_status, review_decision, class_code
ORDER BY updated_at DESC  -- or family default sort
LIMIT $n OFFSET $m
```

## Per-family B-tree composites

Replace `{table}` and `{prefix}` with the family table/abbreviation (e.g. `building_candidates` / `irb`).

| Index | Columns | Partial WHERE (optional) |
|-------|---------|--------------------------|
| List scope | `(review_batch_id, entity_family)` | — |
| Default sort | `(review_batch_id, entity_family, updated_at DESC)` | — |
| Not promoted | `(review_batch_id, entity_family)` | `promotion_status <> 'promoted'` |
| Match filter | `(review_batch_id, match_status)` | — |
| Auto action | `(review_batch_id, auto_action)` | — |
| Review status | `(review_batch_id, review_status)` | — |

### Index name prefix by family

| Family | Table | Suggested index prefix |
|--------|-------|------------------------|
| roads | `road_candidates` | `irr_road_` |
| buildings | `building_candidates` | `irr_bld_` |
| places | `place_candidates` | `irr_place_` |
| addresses | `address_candidates` | `irr_addr_` |
| admin_areas | `admin_area_candidates` | `irr_aa_` |
| landuse | `landuse_candidates` | `irr_lu_` |
| water_lines | `water_line_candidates` | `irr_wl_` |
| water_polygons | `water_polygon_candidates` | `irr_wp_` |
| routing_barriers | `routing_barrier_candidates` | `irr_rb_` |
| bus_stops | `bus_stop_candidates` | `irr_bs_` |
| bus_routes | `bus_route_candidates` | `irr_br_` |
| bus_route_variants | `bus_route_variant_candidates` | `irr_brv_` |
| bus_route_stops | `bus_route_stop_candidates` | `irr_brs_` |

### Families and tables

| Family | Table (`import_review.`) | Notes |
|--------|--------------------------|-------|
| roads | `road_candidates` | **051** + **059** migrations |
| buildings | `building_candidates` | **059** migration |
| places | `place_candidates` | |
| addresses | `address_candidates` | Text search may need `pg_trgm` on `canonical_name`, `external_id` |
| admin_areas | `admin_area_candidates` | |
| landuse | `landuse_candidates` | `landuse_class_id` filter index |
| water_lines | `water_line_candidates` | |
| water_polygons | `water_polygon_candidates` | |
| routing_barriers | `routing_barrier_candidates` | |
| bus_stops | `bus_stop_candidates` | |
| bus_routes | `bus_route_candidates` | |
| bus_route_variants | `bus_route_variant_candidates` | |
| bus_route_stops | `bus_route_stop_candidates` | Heavy joins avoided in list SQL |

### Example (buildings — not yet migrated)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS irb_rbid_entity_family_updated_desc_idx
  ON import_review.building_candidates (review_batch_id, entity_family, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS irb_rbid_entity_family_not_promoted_idx
  ON import_review.building_candidates (review_batch_id, entity_family)
  WHERE promotion_status <> 'promoted';

CREATE INDEX CONCURRENTLY IF NOT EXISTS irb_rbid_match_status_idx
  ON import_review.building_candidates (review_batch_id, match_status);
```

Repeat with family-specific filter columns (`road_class_id`, `landuse_class_id`, `class_code`, etc.).

## GiST (map / bbox only)

Do **not** add GiST for table list endpoints. Use only for:

- Detail `include_geometry=true`
- Dedicated map-preview / bbox endpoints

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS irr_road_geom_gist_idx
  ON import_review.road_candidates USING gist (geom)
  WHERE geom IS NOT NULL;
```

Use the actual geometry column name per family (`geom`, `geometry`, etc.).

## Text search (`q` parameter)

When `pg_trgm` is enabled, GIN indexes on high-cardinality text columns help `ILIKE` / similarity filters:

- `canonical_name`
- `external_id`
- Family-specific display fields (e.g. `road_class`)

Roads: see migration **051**.

## Summary endpoint

Summary scans are scoped to `review_batch_id` (+ optional `entity_family` filter). The same `(review_batch_id, entity_family)` composites above benefit summary COUNT/GROUP BY paths.

If summary remains slow after code changes (single combined scan per family), consider:

- Materialized view per `review_batch_id` refreshed on import completion
- Cached summary row in `import_review.review_batches` updated by trigger

## Rollback

Drop indexes in reverse order of creation; verify no query plan regressions on detail/map queries.
