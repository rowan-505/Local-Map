---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Schema layers and main table families
---

# Schemas and tables

## Layer model

```text
raw → staging → core → tiles (views)
         ↓
   import_review (remote review on Supabase)
```

## Schemas

### `raw` — source layer

Untouched imported records. **Do not modify or normalize here.**

Example tables: `raw_osm_points`, `raw_osm_lines`, `raw_osm_polygons`

Key columns: `osm_id`, `tags` (jsonb), `geom`, `source_snapshot_id`

### `staging` — candidate layer

Normalized candidates for review. Always traceable to `source_snapshot_id`.

Entity families: places, roads, buildings, admin areas, addresses, landuse, water, etc.

### `core` — production layer

Published entities: `core_places`, `core_streets`, `core_buildings`, `core_addresses`, `core_admin_areas`, transit tables, etc.

Use `public_id` for external references. Scores use **0–100** scale.

### `ref` — reference data

Controlled lookup tables (road classes, POI categories, publish statuses, languages…) — not enums.

### `system` — workflow metadata

Import batches, source snapshots, diff items, review tasks, publish batches.

### `tiles` — render views

PostGIS views (`tiles.*_v`) for PMTiles export. **Rendering only** — not business truth.

### `search` — search index

Denormalized runtime store rebuilt from source views (not live triggers):

- `search_documents`, `search_document_names` — unified public search
- `address_index` — separate `/addresses/search` path
- `search_index_runs`, `failed_search_logs` — ops telemetry
- `search.rebuild_search_documents()`, `search.refresh_address_index()`

See [Search system](../08-search-address-routing/search-system.md). Legacy tables `search_names` / `search_addresses` (migration 023) are unused.

### `app_auth` — users

Users, sessions, roles, permissions (production Supabase).

### `import_review` — remote review

`address_candidates`, `address_components`, entity family review tables on Supabase.

## Design rules (summary)

From archived [`database_rules.md`](../archive/old-docs/infrastructure/database/docs/database_rules.md):

- `snake_case`, plural table names
- `bigint` surrogate PKs
- Explicit FKs with named constraints
- `timestamptz`, `jsonb`, geometry with explicit type, **SRID 4326**
- `staging` rows must carry `source_snapshot_id`

## Staging → core promotion

Promotion happens only after review approval. Staging must not leave permanent FKs from core back to staging.

Full mapping tables: archived [`staging_to_core_mapping.md`](../archive/old-docs/infrastructure/database/docs/staging_to_core_mapping.md) and [Review and promotion](../07-data-pipeline/review-and-promotion.md).

## Related docs

- [Database overview](database-overview.md)
- [PostGIS patterns](postgis-patterns.md)
- [Glossary](../00-overview/glossary.md)
