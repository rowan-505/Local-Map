# Core coastlines

`core.core_coastlines` stores processed/versioned Myanmar **coastline MultiLineString** geometry (land/sea boundary).

## Why this table exists

OSM `natural=coastline` is line geometry. CoreMap keeps one (or few scoped) processed coastline dataset(s) in Core — not every tiny OSM way as an application entity.

Derived land/ocean polygons belong in the **tile-processing / render pipeline**, not separate Core business tables.

## What we intentionally do not create

- `ref.ref_coastline_classes`
- coastline names table
- `core.core_ocean_polygons`
- `core.core_landmask_polygons`
- wetland linkage tables

## Columns

| Column | Role |
|--------|------|
| `id` | Internal bigint PK |
| `public_id` | Stable UUID for public/API references |
| `geom` | `geometry(MultiLineString,4326)` — required |
| `region_code` | Scope for replacement; `NULL` = national |
| `source_registry_id` | FK → `system.system_source_registry` |
| `source_snapshot_id` | FK → `system.system_source_snapshots` |
| `source_refs` | Opaque lineage JSON |
| `is_active` | Only active rows export to tiles |
| `created_at` / `updated_at` | Timestamps |

No category FK — the table itself is the type.

## Replacement semantics

A new coastline snapshot must **supersede** the previous active dataset for the same region scope, not accumulate duplicates.

Use:

```sql
SELECT * FROM core.replace_active_coastline(
  p_geom := ST_GeomFromEWKT('...'),
  p_region_code := NULL,              -- national
  p_source_registry_id := ...,
  p_source_snapshot_id := ...,
  p_source_refs := '{"loader":"..."}'::jsonb
);
```

This deactivates prior active rows for that scope, then inserts the new active row. History is retained (`is_active = false`).

Unique index: one active row per `COALESCE(lower(region_code), 'national')`.

## Tile export

View: `tiles.tiles_coastlines_v` (active rows only).

Martin auto-publishes the `tiles` schema. Explicit registration notes live in `infrastructure/tiles/martin/martin_config.yaml`.

**Current overview PMTiles** still use Natural Earth `ne_10m_coastline`. Do not rebuild production tiles until a Core-backed coastline import is ready and scheduled.

## Migration

- `infrastructure/database/migrations/supabase/157_core_coastlines.sql`
- Verify: `infrastructure/database/verification/verify_157_core_coastlines.sql`
