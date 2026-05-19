# Local Supabase Production Mirror

This workflow pulls selected Supabase production tables into local PostgreSQL as read-only comparison copies under `prod_mirror`.

It is for Stage F2 comparison only. It does not modify Supabase, does not promote OSM staging data to core, and does not write to local `core`, `raw`, or `staging`.

## What It Creates

- `supabase_fdw`: local foreign tables pointing at selected Supabase tables.
- `prod_mirror`: real local tables copied from those foreign tables.

`prod_mirror` is disposable and refreshable. The refresh drops/recreates only copied tables under `prod_mirror`.

## Setup

Copy the env template and fill it with credentials:

```bash
cp tools/data-pipeline/prod-mirror/00_env.example.sh tools/data-pipeline/prod-mirror/00_env.sh
```

Required values:

- `LOCAL_DATABASE_URL`: local PostgreSQL/PostGIS database.
- `SUPABASE_DB_HOST`: Supabase database host.
- `SUPABASE_DB_PORT`: usually `5432`.
- `SUPABASE_DB_NAME`: usually `postgres`.
- `SUPABASE_DB_USER`: database user. Prefer read-only if available.
- `SUPABASE_DB_PASSWORD`: database password.
- `SUPABASE_DB_SSLMODE`: usually `require`.
- `LOG_DIR`: optional log directory. Defaults to `logs/data-pipeline`.

Do not commit `00_env.sh` or any file containing real credentials.

## Refresh

Run:

```bash
tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh tools/data-pipeline/prod-mirror/00_env.sh
```

This runs:

1. `01_setup_fdw.sql`: creates local `postgres_fdw` setup.
2. `02_import_foreign_tables.sql`: imports selected foreign table definitions into `supabase_fdw`.
3. `03_refresh_prod_mirror.sql`: copies foreign tables into local `prod_mirror` tables and adds local indexes.
4. `04_validate_prod_mirror.sql`: validates required and recommended mirror tables.

Logs are written to `logs/data-pipeline/prod-mirror-refresh_<timestamp>.log`.

## Validate Only

After sourcing the env file:

```bash
source tools/data-pipeline/prod-mirror/00_env.sh
PAGER=cat psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/prod-mirror/04_validate_prod_mirror.sql
```

## Mirrored Tables

Core tables:

- `core.core_places`
- `core.core_place_names`
- `core.core_place_sources`
- `core.core_streets`
- `core.core_street_names`
- `core.core_map_buildings`
- `core.core_admin_areas`
- `core.core_admin_area_names`
- `core.core_bus_stops`
- `core.core_bus_stop_names`
- `core.core_bus_routes`
- `core.core_bus_route_names`
- `core.core_bus_route_variants`
- `core.core_bus_route_stops`
- `core.core_map_landuse`
- `core.core_map_water_lines`
- `core.core_map_water_polygons`
- `core.core_addresses`
- `core.core_address_components`

Reference/system tables:

- `ref.ref_source_types`
- `ref.ref_poi_categories`
- `ref.ref_road_classes`
- `ref.ref_admin_levels`
- `ref.ref_address_component_types`
- `ref.ref_building_types`
- `system.system_source_registry`
- `system.system_source_snapshots`

## Required For F2

The minimum local mirror tables for Stage F2 are:

- `prod_mirror.core_places`
- `prod_mirror.core_streets`
- `prod_mirror.core_map_buildings`

If any of these are missing from Supabase or fail to copy, refresh/validation fails. Other missing tables are reported as `WARN` and the workflow continues where safe.

## Safety Notes

- Supabase is accessed through `postgres_fdw` as a remote read source.
- The workflow only creates local schemas, foreign tables, local copied tables, and local indexes.
- Refresh drops/recreates only `prod_mirror.*` copied tables.
- No Supabase writes, no local core promotion, and no OSM staging upload are performed.
