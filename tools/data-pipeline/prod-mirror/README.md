# Local Supabase Production Mirror

This workflow pulls selected Supabase production tables into local PostgreSQL as **slim, read-only** comparison copies under `prod_mirror`.

It is for Stage F2 comparison only. It does not modify Supabase core, does not promote OSM staging data, and does not write to local `core`, `raw`, or `staging`.

## What It Creates

- `supabase_fdw`: local foreign tables pointing at selected Supabase tables (read source).
- `prod_mirror`: local slim tables with comparison fields only.
- `prod_mirror.mirror_meta`: refresh timestamp, source project ref/host, row counts.

Each family table includes:

- native core fields needed for identity / protection / soft-delete
- `core_id` (alias of `id`)
- `geometry_hash` (local compute)
- `source_content_hash` (local compute)

Large unused JSON such as `normalized_data` is **not** mirrored.

Deleted rows are included (`deleted_at` preserved) so F2 can detect soft-deletes.

## Environment variables

| Variable | Role |
|----------|------|
| `LOCAL_DATABASE_URL` | Local lab DB (mirror target) |
| `SUPABASE_READ_DATABASE_URL` | Preferred read connection for FDW refresh |
| `SUPABASE_WRITE_DATABASE_URL` | Write/upload only — **never** used by this refresh |
| `SUPABASE_PROJECT_REF` | Optional; derived from `db.<ref>.supabase.co` when unset |
| `MIRROR_MAX_AGE_HOURS` | Validation / pipeline preflight max age (default `168`) |
| Legacy `SUPABASE_DB_*` | Used only when `SUPABASE_READ_DATABASE_URL` is unset |

Guards:

- Refresh refuses to use `SUPABASE_WRITE_DATABASE_URL` as the FDW source.
- Refresh refuses when `LOCAL_DATABASE_URL` host matches Supabase (or looks like `*.supabase.co`).
- Pipeline Stage K refuses to use `SUPABASE_READ_DATABASE_URL` as the write target.
- Pipeline write tools refuse bare `DATABASE_URL` as a silent production write target.

Full rules and examples: [`docs/database-target-safety.md`](../../../docs/database-target-safety.md)

## Setup

```bash
cp tools/data-pipeline/prod-mirror/00_env.example.sh tools/data-pipeline/prod-mirror/00_env.sh
```

Do not commit `00_env.sh`.

## Refresh

```bash
tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh tools/data-pipeline/prod-mirror/00_env.sh
```

Steps:

1. `01_setup_fdw.sql` — local `postgres_fdw` server + user mapping  
2. `02_import_foreign_tables.sql` — import selected foreign tables  
3. `03_refresh_prod_mirror.sql` — slim explicit-column copy + hashes + `mirror_meta`  
4. `04_validate_prod_mirror.sql` — counts, reconcile vs FDW, protection columns, duplicate `external_id` report, freshness  

Refresh is safely repeatable (drops/recreates `prod_mirror.*` copies only).

## Validate only

```bash
source tools/data-pipeline/prod-mirror/00_env.sh
PAGER=cat psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v mirror_max_age_hours="${MIRROR_MAX_AGE_HOURS:-168}" \
  -f tools/data-pipeline/prod-mirror/04_validate_prod_mirror.sql
```

## Pipeline preflight

Before Stage 07, `run_local_osm_pipeline.sh` runs `00b_preflight_prod_mirror.sql`:

- `mirror_meta` present and fresh
- required tables: `core_places`, `core_streets`, `core_buildings`

Override: `SKIP_PROD_MIRROR_PREFLIGHT=true` (emergency only).

## Mirrored families (slim)

Core: places (+ names/sources), streets (+ names), buildings, admin (+ names), landuse, water lines/polygons, addresses (+ components), settlements (optional until supabase migration 192 exists in production)  
Ref/system: source types, POI categories, settlement types, road classes, admin levels, address component types, building types, source registry/snapshots

## Required for F2

- `prod_mirror.core_places`
- `prod_mirror.core_streets`
- `prod_mirror.core_buildings`

`prod_mirror.core_settlements` is optional. If production does not yet have `core.core_settlements`, refresh records WARN and continues. Existing admin/road/place mirror behavior is unchanged.
