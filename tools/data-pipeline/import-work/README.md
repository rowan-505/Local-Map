# import_work — temporary Supabase load workspace

Private schema for **set-based** core loads after local classification.

- Schema: `import_work`
- Pilot table: `import_work.place_rows` (places/settlements only)
- Batch header: `import_work.import_batches`
- Migration: `infrastructure/database/migrations/supabase/136_import_work_places_pilot.sql`

**Not** raw OSM. **Not** `import_review`. **No** public client access.

## Security posture (live)

Matches `import_review` / `core`:

| Control | Setting |
|---------|---------|
| Schema USAGE | revoked from `anon`, `authenticated`, `authenticator`, `service_role`, `PUBLIC` |
| Table grants | none for those roles |
| RLS | enabled, **zero** policies |
| Data API | schema must stay off the exposed schema list |

Load only with the **postgres** (or equivalent direct DB) role — never PostgREST anon keys.

### Advisor note (after migration 136)

Security advisors report `rls_enabled_no_policy` (INFO) for `import_work.import_batches` and `import_work.place_rows`. That matches `import_review`: RLS on, zero policies, plus no schema USAGE for API roles. Do **not** add anon/authenticated policies or grants to “fix” that INFO.

## Retry without duplicates

Work rows are unique on `(import_batch_id, external_id)`.

Before every reload of the same batch:

```sql
BEGIN;
UPDATE import_work.import_batches
SET status = 'loading', updated_at = now()
WHERE batch_code = :'batch_code';

DELETE FROM import_work.place_rows r
USING import_work.import_batches b
WHERE r.import_batch_id = b.id
  AND b.batch_code = :'batch_code';
COMMIT;
```

Then COPY again. Do not INSERT without the delete step.

## COPY / set-based load (documented method)

1. Create or reuse a batch header (postgres role):

```sql
INSERT INTO import_work.import_batches (
  batch_code, entity_family, source_snapshot_id, source_snapshot_version,
  status, expected_row_count
) VALUES (
  'places_kyauktan_pilot_001', 'places', 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
  'loading', 0
)
ON CONFLICT (batch_code) DO UPDATE
SET status = 'loading', updated_at = now()
RETURNING id;
```

2. Delete prior `place_rows` for that batch (retry rule above).

3. Export from **local** classified staging (example — adjust columns to match export):

```bash
psql "$LOCAL_DATABASE_URL" -c "\copy (
  SELECT
    <batch_id>,
    source_snapshot_id,
    '<snapshot_version>',
    external_id,
    import_class,
    NULL::bigint AS target_core_id,
    primary_name,
    display_name,
    category_id,
    admin_area_id,
    point_geom,
    ST_Y(point_geom::geometry),
    ST_X(point_geom::geometry),
    NULL::text,
    confidence_score,
    confidence_score,
    confidence_score,
    coalesce(source_refs, '{}'::jsonb),
    normalized_hash,
    coalesce(validation_status, 'pending'),
    '{}'::jsonb
  FROM staging.staging_place_candidates
  WHERE source_snapshot_id = <id>
    AND import_class IN ('safe_new', 'safe_update')
) TO '/tmp/place_rows.csv' WITH (FORMAT csv, HEADER false)"
```

4. Load into Supabase with **COPY** (set-based; prefer this over row APIs):

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" -c "\copy import_work.place_rows (
  import_batch_id, source_snapshot_id, source_snapshot_version, external_id,
  classification, target_core_id, primary_name, display_name, category_id,
  admin_area_id, point_geom, lat, lng, plus_code, importance_score,
  popularity_score, confidence_score, source_refs, source_hash,
  validation_status, validation_result
) FROM '/tmp/place_rows.csv' WITH (FORMAT csv, HEADER false)"
```

5. Update batch counts and validate:

```sql
UPDATE import_work.import_batches b
SET
  loaded_row_count = (SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id),
  expected_row_count = coalesce(expected_row_count, (
    SELECT count(*) FROM import_work.place_rows r WHERE r.import_batch_id = b.id
  )),
  status = 'loaded',
  loaded_at = now(),
  updated_at = now()
WHERE batch_code = :'batch_code';
```

```bash
psql "$SUPABASE_WRITE_DATABASE_URL" -v batch_code='places_kyauktan_pilot_001' \
  -f tools/data-pipeline/import-work/validate_place_work_counts.sql
```

**Do not load production core from this workspace until Gate 4 is approved.**

## Cleanup

```bash
# One batch
psql "$SUPABASE_WRITE_DATABASE_URL" -v batch_code='places_kyauktan_pilot_001' \
  -f tools/data-pipeline/import-work/cleanup_import_work_batches.sql

# Applied/failed batches older than 7 days
psql "$SUPABASE_WRITE_DATABASE_URL" -v older_than_days=7 \
  -f tools/data-pipeline/import-work/cleanup_import_work_batches.sql
```

Deletes family work rows and marks the batch `cleaned`. Does not modify `core.*`.

## Places safe loader (set-based)

Files:

- `places_safe_loader.sql` — wrapper (`-v batch_code=... -v dry_run=true|false`)
- `places_safe_loader_body.sql` — one-family transaction body
- `places_safe_loader_tests.sql` — fixture + rollback suite

Loads only `classification IN ('safe_new','safe_update')`. Conflict rows are ignored.

### Update allowlist (explicit)

`primary_name`, `display_name`, `category_id`, `admin_area_id`, `point_geom`, `lat`, `lng`

Does **not** use `ON CONFLICT DO UPDATE` for all columns.

### Protection

- Skip `is_verified = true` (no meaningful overwrite)
- Skip dashboard/manual `source_refs` markers (`manual_override` / `source=dashboard|manual`)
- Places have no `manual_override` column on `core.core_places`

### Identity upsert

Match via `system.pipeline_osm_identity_key()` (migration **137**) so `osm:node:1` and `osm:N:1` equate. Stable `core.id` / `public_id` preserved on update.

### Metrics

Writes one `system.system_publish_batches` summary row (counts + allowlist + skip reasons). Does not create new per-object lineage tables.

### Commands

```bash
# Rollback tests (no durable core writes)
psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/import-work/places_safe_loader_tests.sql

# Dry-run a real import_work batch (rolls back)
psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v batch_code='places_kyauktan_pilot_001' -v dry_run=true \
  -f tools/data-pipeline/import-work/places_safe_loader.sql

# Apply only after dry-run counts reconcile
psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v batch_code='places_kyauktan_pilot_001' -v dry_run=false \
  -f tools/data-pipeline/import-work/places_safe_loader.sql
```

