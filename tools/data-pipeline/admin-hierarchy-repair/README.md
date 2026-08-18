# Admin hierarchy repair and entity admin assignment

Repeatable **core-only** SQL pipeline to:

1. Inspect `core.core_admin_areas` hierarchy health
2. Repair `parent_id` from geometry (no deletes)
3. Install reusable lookup functions in `core`
4. *(Optional)* Backfill `admin_area_id` on places, streets (roads), and buildings
5. *(Optional)* Verify entity assignment

**Out of scope:** `import_review` (never read or written). **No** `tmp_import`, `raw`, or `staging` schemas required.

### Supabase after import-review bulk admin promotion

Run hierarchy + functions only (stages **00–03**):

```bash
cd tools/data-pipeline/admin-hierarchy-repair
cp imports/template.env imports/supabase.env
# set LOCAL_DATABASE_URL or DATABASE_URL to Supabase

DRY_RUN=true ./run_admin_hierarchy_repair.sh --hierarchy-only imports/supabase.env
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh --hierarchy-only imports/supabase.env
./run_admin_hierarchy_repair.sh --inspect-only --hierarchy-only imports/supabase.env
```

Stages **04–06** (entity backfill) are optional and skipped by `--hierarchy-only`.

## Idempotency and safe re-runs

The pipeline is designed to be **safe to run multiple times**:

| Rule | Behavior |
|------|----------|
| No deletes | Admin areas and entities are never deleted; geometries are never changed |
| Updates only on change | `UPDATE` uses `IS DISTINCT FROM` (or equivalent) so unchanged rows are not touched |
| `updated_at` | Set only when a mutating `UPDATE` actually runs for that row |
| Hierarchy repair | Stable parent pick: `hierarchy_order DESC`, `ST_Area ASC`, `id ASC`; second run → `updated_count` ≈ 0 |
| Entity backfill | Smallest containing admin area; skips `manual_override` and verified rows unless forced |
| Repair metadata | Single `normalized_data.admin_area_repair` object (replaced, never nested): `previous_admin_area_id`, `calculated_admin_area_id`, `repair_run_at`, `repair_method` |
| Functions | `CREATE OR REPLACE` only; signatures stay stable |
| Verification | Stages 00, 02, 07 are read-only; null `admin_area_id` is a warning, not a hard fail |

### Second-run test (recommended)

```bash
# First apply (requires explicit write consent)
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env

# Second apply — should be nearly idle
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env
```

Expect on the second run:

- Stage **01**: `updated_count` = 0 (or very small if admin geometry/levels changed)
- Stages **04–06**: `updated_count` = 0, `unchanged_count` high
- Stage **07**: hard-fail gates pass; warnings may remain for null assignments or legacy geom mismatches

If the second run updates many rows without data changes, the pipeline is not idempotent — investigate before production use.

## Safety rules

| Rule | Behavior |
|------|----------|
| Protected rows | Skip when `manual_override = true`, or `is_verified = true`, or `verification_status = 'verified'` |
| Force verified | `FORCE_RECALCULATE_VERIFIED=true` may change verified rows (still respects `manual_override`) |
| Dry run | `DRY_RUN=true` — planned counts only, no row `UPDATE` (CLI value overrides env file) |
| Write consent | Mutating stages require `CONFIRM_WRITE=true` unless `DRY_RUN=true` |

## Prerequisites

- PostgreSQL with PostGIS
- `core.core_admin_areas` with valid `geom` / `centroid` and `ref.ref_admin_levels`
- `psql` on `PATH`
- Connection URL with rights to `CREATE OR REPLACE FUNCTION` in `core` and `UPDATE` on core tables

## Quick start

```bash
cd tools/data-pipeline/admin-hierarchy-repair
cp imports/template.env imports/local_repair.env
# edit LOCAL_DATABASE_URL in imports/local_repair.env

# Inspect only (stages 00, 02, 07)
./run_admin_hierarchy_repair.sh --inspect-only imports/local_repair.env

# Plan changes (no writes; CONFIRM_WRITE not required)
DRY_RUN=true ./run_admin_hierarchy_repair.sh imports/local_repair.env

# Apply hierarchy repair + backfill
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env

# Re-assign verified rows too (manual_override still protected)
CONFIRM_WRITE=true FORCE_RECALCULATE_VERIFIED=true ./run_admin_hierarchy_repair.sh imports/local_repair.env
```

The runner **requires exactly one env file** argument (see `imports/template.env`).

**Note:** Environment variables exported on the command line (`DRY_RUN`, `CONFIRM_WRITE`, `FORCE_RECALCULATE_VERIFIED`) override the same keys inside the env file.

## Pipeline stages

`run_admin_hierarchy_repair.sh` runs stages in numeric order and stops on the first hard error (`ON_ERROR_STOP`).

| Stage | File | Mutates? | `CONFIRM_WRITE` | `--hierarchy-only` |
|-------|------|----------|-----------------|-------------------|
| 00 | `00_inspect_admin_area_health.sql` | No | — | Yes (core + ref only) |
| 01 | `01_repair_admin_area_hierarchy.sql` | Yes (`parent_id`) | Required | Yes |
| 02 | `02_verify_admin_area_hierarchy.sql` | No (hard-fail gate) | — | Yes |
| 03 | `03_create_admin_assignment_functions.sql` | Yes (functions + indexes) | Required | Yes |
| 04 | `04_backfill_places_admin_area.sql` | Yes | Required | Skipped |
| 05 | `05_backfill_roads_admin_area.sql` | Yes (`core.core_streets`) | Required | Skipped |
| 06 | `06_backfill_buildings_admin_area.sql` | Yes (`core.core_buildings`) | Required | Skipped |
| 07 | `07_verify_entity_admin_assignment.sql` | No (hard-fail gate) | — | Skipped |

**Stage 00** skips places/streets/buildings checks unless `inspect_entity_assignment=true` (default on full runs only).

**Stage 02 hard fail:** self-parent, orphan parent, parent not broader, invalid geometry, duplicate `external_id`.

**Stage 03 functions:** `core.find_admin_area_for_point/line/polygon(geometry, text default null)` plus indexes `core_admin_areas_geom_gix`, `core_admin_areas_parent_idx`, `core_admin_areas_level_idx`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_DATABASE_URL` | (required) | Postgres connection string (`DATABASE_URL` accepted as alias) |
| `DRY_RUN` | `false` | When `true`, mutating stages log counts only |
| `CONFIRM_WRITE` | `false` | When `true`, allows mutating stages (unless `DRY_RUN=true`) |
| `FORCE_RECALCULATE_VERIFIED` | `false` | When `true`, may change `admin_area_id` on verified rows |
| `LOG_DIR` | `./logs` | Timestamped run logs |
| `PSQL_EXTRA_ARGS` | empty | Extra args passed to `psql` |

## Assignment logic (summary)

Representative point per entity:

- **Places:** `point_geom` / `entry_geom` (fallback: `lng`/`lat`)
- **Streets:** largest line–polygon overlap (smallest area tie-break); multi-ward roads fall back to township → district → state_region (`core.find_admin_area_for_line`)
- **Buildings:** centroid or `ST_PointOnSurface(geom)`

Among **active** admin polygons, pick the **smallest containing** area (any level; township not required). Nullable `admin_area_id` only when no polygon matches.

## Roads admin_area_id backfill (stage 05)

Stage **05** assigns township-level `core.core_streets.admin_area_id` via `core.find_admin_area_for_line(geom, 'township')` (largest line–township overlap, then representative-point fallback). It processes **one chunk per psql call** (resumable via `last_id`) to avoid Supabase `statement_timeout`.

Candidates include rows where `admin_area_id` is **NULL or points to a missing / inactive / non-township admin area** — so it both fills gaps and repairs stale FKs. Protected rows (`manual_override`, verified) are skipped unless forced.

A full run via `run_admin_hierarchy_repair.sh` executes only the **first** chunk of stage 05. To backfill the whole table, loop it:

```bash
# plan
DRY_RUN=true ./run_05_roads_loop.sh imports/admin_hierarchy_roads_2026_06_05.env
# apply
CONFIRM_WRITE=true ./run_05_roads_loop.sh imports/admin_hierarchy_roads_2026_06_05.env
```

Read-only verification (counts + overlap spot-check):

```bash
psql "$LOCAL_DATABASE_URL" -f verify_roads_admin_area_id.sql
```

Chunk result columns: `last_id, scanned, updated, unchanged, no_match, invalid_existing, would_clear_invalid, elapsed_ms, done`. Re-run until `done = t`.

## Hierarchy repair (summary)

For each active admin area, compute immediate broader parent from geometry:

- Child point = `centroid` or `ST_PointOnSurface(geom)`; parent must **contain** that point (`ST_Contains`)
- Parent must be broader (`ref.ref_admin_levels.rank` / `hierarchy_order` smaller than child)
- Tie-break: broadest immediate parent (`hierarchy_order DESC`), then smallest area, then lowest `id`
- Country-level areas keep `parent_id` null; other levels get a parent when a valid container exists
- Never self-parent; cycle check via ancestor walk

## Verification gates

**Admin hierarchy (stage 02) — hard fail:** self-parent, parent not broader, orphan `parent_id`, invalid geometry, duplicate `external_id`.

**Entity assignment (stage 07) — hard fail:** `admin_area_id` pointing to missing/inactive admin area only.

**Warnings:** null `admin_area_id`, geometry mismatch with assigned admin, no matching best admin area, protected rows still needing repair.

## Logs

Each run appends to:

```text
logs/admin-hierarchy-repair_<UTC-timestamp>.log
```

Every stage logs start and finish timestamps.

## Related code

- `infrastructure/database/migrations/supabase/044_infer_address_admin_components.sql` — polygon ranking for addresses
- `apps/api/src/modules/entity-admin-area/` — dashboard/API township inference (separate from this repair pipeline)

## Suggested validation

```bash
DRY_RUN=true ./run_admin_hierarchy_repair.sh imports/local_repair.env
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env
CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env   # second run → updated≈0
./run_admin_hierarchy_repair.sh --inspect-only imports/local_repair.env
```
