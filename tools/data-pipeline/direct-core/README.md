# Direct-Core regional bulk imports

This is the production regional path for validated `safe_new` / `safe_update`
candidates. It does not replace local extraction, staging, validation,
comparison, Import Review, or PMTiles selection.

The production write path is deliberately narrow:

1. Stage and classify OSM data in the local database.
2. Route `duplicate`, `conflict`, `manual_protected`, `verified_conflict`, and
   `possible_delete` through the existing Stage 11/12 Import Review upload.
3. Keep `unchanged` and `pmtiles_only` out of the direct-Core CSV.
4. Write `invalid` rows to the local rejection CSV.
5. Export only `safe_new` and `safe_update`.
6. Run one family-specific SQL file through one trusted `psql` session.

No SQL in this directory creates a permanent staging table. Each import:

- refuses Supavisor/PgBouncer transaction-mode URLs (port 6543);
- refuses nationwide region aliases;
- opens one transaction for one region;
- uses a session TEMP table and client-side `\copy`;
- validates classification, stable OSM identity, duplicate identities,
  references, score ranges, and geometry;
- serializes the same family/region with a transaction advisory lock;
- preserves Core IDs, verification fields, manual rows, and relationships;
- upserts only the existing family companion tables;
- records `system.system_import_batches`, `system.system_publish_batches`, and
  `system.system_publish_items`;
- verifies identity and mutation counts before commit.

Dry-run is the default and rolls the complete transaction back.

## Local lab note (Mode B)

Local PostgreSQL no longer keeps a `core` or `tiles` schema (avoids mixing
local IDs with Supabase production IDs). Classification uses `prod_mirror`.

- Prefer `--target production` for direct-Core applies.
- `--target local` requires a local `core` schema and is not supported on a
  Mode B lab database unless you recreate `core` from migrations on purpose.

## Runner

```bash
bash tools/data-pipeline/direct-core/run_direct_core_import.sh \
  --family places \
  --target local \
  --csv /absolute/path/places.safe.csv \
  --region-code yangon \
  --snapshot-version osm_myanmar_2026_07_29_yangon_v1 \
  --dry-run
```

Production apply requires the exact confirmation printed by the runner:

```text
IMPORT <family> <region_code> <snapshot_version>
```

Supported family slugs:

```text
places
roads
buildings
landuse
water_lines
water_polygons
routing_barriers
```

The source snapshot must already exist in
`system.system_source_snapshots` for active source `osm_myanmar`.

Database prerequisites, in order:

1. Existing live migrations through `146`.
2. `147_import_review_landuse_admin_area_id.sql`.
3. `148_cleanup_core_water_legacy_names_classes.sql`.
4. `149_core_buildings_source_identity.sql` (required by the building
   loader's typed `(source_registry_id, source_feature_type,
   source_feature_id)` identity and manual-edit protection).
5. `150_kyauktan_building_pilot_views.sql`.
6. `151_standardize_building_name_language_code.sql` (required before writing
   building names with canonical language code `my`).

The direct-Core runner does not apply migrations.

## Local exports and rejection reports

Run the family-specific exporter against the local pipeline database after
Stages 08b/08c/08d:

```bash
PAGER=cat psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema="$STAGING_SCHEMA" \
  -v output_path="/absolute/path/places.safe.csv" \
  -v rejection_path="/absolute/path/places.invalid.csv" \
  -f tools/data-pipeline/direct-core/export/export_places.sql
```

Each exporter fails if a supposedly direct candidate is not locally valid.
Review classes, unchanged rows, and PMTiles-only rows are counted but never
written to the direct-Core CSV. `possible_delete` continues to be produced by
the existing F1/Stage 11 review package, not by these exporters.

## Tests

Static family checks do not need a database:

```bash
bash tools/data-pipeline/direct-core/tests/run_family_tests.sh --static
```

The rollback-only SQL contract tests require a schema-compatible local
database:

```bash
bash tools/data-pipeline/direct-core/tests/run_family_tests.sh --target local
```

They never apply a nationwide import. Every family suite covers a safe insert,
safe update, unchanged/no-write routing, conflict/review routing, invalid/local
rejection routing, identical rerun, and transaction rollback.
