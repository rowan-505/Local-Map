# Streets `admin_area_id` backfill (township only)

Manual, chunked SQL pipeline for **`core.core_streets.admin_area_id` only**.

Does **not** modify places, buildings, import_review, or other entities. Not invoked by the API or app startup.

## Prerequisites

- PostgreSQL + PostGIS
- `psql` on `PATH`
- Admin assignment functions from `../admin-hierarchy-repair/03_create_admin_assignment_functions.sql`:

```bash
cd ../admin-hierarchy-repair
cp imports/template.env imports/local.env
# edit LOCAL_DATABASE_URL
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh --from-stage 03 imports/local.env
```

## Logic

1. Select active streets where `admin_area_id` is **NULL** or points to **missing/inactive/non-township** admin areas.
2. Skip protected rows (`manual_override`, verified) unless `FORCE_*` flags are set (same as admin-hierarchy-repair).
3. Infer township via `core.find_admin_area_for_line(geom, 'township')`:
   - largest line–township overlap length
   - representative-point township fallback when overlap finds nothing
4. Update `admin_area_id` + `updated_at` when a new township differs from the current value.
5. When no township matches:
   - **NULL existing** → counted as `no_match`, left NULL
   - **Invalid/non-township existing** → counted as `invalid_existing`; value left unchanged (dry run also reports `would_clear_invalid` for a future explicit clear step)

## Quick start

```bash
cd tools/data-pipeline/streets
cp imports/template.env imports/local.env
# edit LOCAL_DATABASE_URL

# Plan one or more chunks (default 5000 rows/chunk)
DRY_RUN=true ./run_backfill_streets_admin_area_id_loop.sh imports/local.env

# Verify before/after
psql "$LOCAL_DATABASE_URL" -f verify_streets_admin_area_id.sql

# Apply
CONFIRM_WRITE=true ./run_backfill_streets_admin_area_id_loop.sh imports/local.env
```

## Session variables (psql `-v`)

| Variable | Default | Description |
|----------|---------|-------------|
| `dry_run` | `false` | Log counts only; no `UPDATE` |
| `limit_rows` | `5000` | Chunk size (max 10000) |
| `last_id` | `0` | Resume cursor (`id > last_id`) |
| `force_recalculate_verified` | `false` | May change verified streets |
| `force_manual_override` | `false` | May change manual-override streets |

## Chunk result columns

| Column | Meaning |
|--------|---------|
| `scanned` | Rows evaluated in this chunk |
| `updated` | Rows assigned a new township |
| `unchanged` | No write needed |
| `no_match` | Still NULL; no township geometry match |
| `invalid_existing` | Invalid/non-township FK kept (no township match) |
| `would_clear_invalid` | Same as `invalid_existing` in dry run (future NULL-clear report) |

## Admin area audit (read-only)

Inspect `admin_area_id` quality without writes:

```bash
./run_audit_streets_admin_area_id.sh imports/local.env
# or: psql "$DATABASE_URL" -f audit_streets_admin_area_id.sql
```

Reports: counts by admin level, null/broken/non-township totals, sample 50 bad rows.

## Related

- `../admin-hierarchy-repair/05_backfill_roads_admin_area.sql` — faster point-only NULL backfill (legacy)
- `apps/api/src/modules/entity-admin-area/` — dashboard infer API (runtime, not bulk backfill)
- `infrastructure/database/checks/supabase/check_streets_admin_area_id.sql` — quick gate summary
