# Local basemap_source buildings archive (one-time)

Local **geo_core** only. Does not write to Supabase.

## Purpose

Keep the full national building footprint set (`5,578,282` rows from staging snapshot 13) in a persistent table after Core-eligible rows are imported, then delete only the temporary staging building rows for that snapshot.

## Objects

| Object | Role |
|--------|------|
| `basemap_source` | Persistent local schema |
| `basemap_source.buildings` | Full building archive (all classes) |

Stage 05 reset deletes `staging.staging_building_candidates` for the **current** snapshot only. It must **never** touch `basemap_source`.

Later PMTiles building export should read `basemap_source.buildings` (not staging).

## Commands

From repo root (or this directory):

```bash
chmod +x tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh

# Create + copy + verify + backup + cleanup dry-run
./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --all
```

Individual steps:

```bash
./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --copy
./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --verify
./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --backup

# Dry-run cleanup (default)
./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --cleanup-dry-run

# Apply cleanup (staging snap 13 only)
EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND \
  ./tools/data-pipeline/basemap-source/run_basemap_buildings_preserve.sh --cleanup-apply
```

### Why verify is fast

Do **not** run `ST_IsValid()` on all 5.5M multipolygons — that alone can take hours of disk IO.
The verify script instead uses:

- row counts + `EXCEPT` on `external_id`
- UNIQUE indexes for duplicate checks
- geometry typmod `geometry(MultiPolygon,4326) NOT NULL`
- a small `TABLESAMPLE` probe + staging `validation_status`

SQL sources:

- DDL: `infrastructure/database/migrations/local/010_basemap_source_buildings.sql`
- Copy: `sql/copy_buildings_from_staging_snap13.sql`
- Verify: `sql/verify_buildings_snap13.sql`
- Cleanup: `sql/cleanup_staging_buildings_snap13.sql`

## Restore from backup

```bash
# custom-format dump produced by the runner
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$LOCAL_DATABASE_URL" \
  path/to/basemap_source_buildings.dump
```

Or with Docker:

```bash
docker exec -i geo-postgis pg_restore -U postgres -d geo_core \
  --clean --if-exists --no-owner --no-privileges \
  < path/to/basemap_source_buildings.dump
```

## Safety

- Does not delete `raw.raw_osm_polygons`
- Does not drop `staging`
- Does not touch `prod_mirror`, `raw`, or other entity candidate tables
- Cleanup requires `EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND`

---

## One-time Core → basemap merge

Merges Supabase `core.core_map_buildings` lineage into local `basemap_source.buildings`:

- update existing OSM matches with Core metadata (`MERGED_EXISTING_OSM`)
- insert Core-only managed rows without inventing OSM ids (`INSERTED_COREMAP_MANAGED`)
- leave ambiguous / geometry-hash conflicts as `MANUAL_REVIEW`
- **no Supabase writes**, no local deletes

### Prerequisites

- Local migration `011_basemap_buildings_core_lineage.sql` (runner applies it)
- `SUPABASE_READ_DATABASE_URL` via `tools/data-pipeline/prod-mirror/00_env.sh`
- `LOCAL_DATABASE_URL` or Docker `geo-postgis`

### Commands

```bash
chmod +x tools/data-pipeline/basemap-source/export_core_buildings_for_basemap.sh
chmod +x tools/data-pipeline/basemap-source/run_core_basemap_merge.sh

# Dry-run: export → load → classify → merge_report.csv
./tools/data-pipeline/basemap-source/run_core_basemap_merge.sh --dry-run

# Apply (gated)
EXECUTE_CORE_BASEMAP_MERGE=I_UNDERSTAND \
  ./tools/data-pipeline/basemap-source/run_core_basemap_merge.sh --apply
```

Reuse an existing export:

```bash
./tools/data-pipeline/basemap-source/run_core_basemap_merge.sh --dry-run --skip-export
```

Artifacts: `artifacts/core_basemap_merge_<stamp>/` (CSV export, report, before/after counts, logs).

SQL:

- DDL: `infrastructure/database/migrations/local/011_basemap_buildings_core_lineage.sql`
- Export: `sql/export_core_buildings_for_basemap.sql`
- Staging: `sql/create_core_buildings_export_staging.sql`
- Merge: `sql/merge_core_into_basemap_buildings.sql`
- Verify: `sql/verify_core_basemap_merge.sql`
