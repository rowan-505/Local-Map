# Admin hierarchy repair and entity admin assignment

Repeatable **core-only** SQL pipeline to:

1. Inspect `core.core_admin_areas` hierarchy health
2. Repair `parent_id` from geometry (no deletes)
3. Install reusable lookup functions in `core`
4. Backfill `admin_area_id` on places, streets (roads), and buildings from geometry
5. Verify results

**Out of scope:** `import_review` (never read or written).

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

| Stage | File | Mutates? | `CONFIRM_WRITE` |
|-------|------|----------|-----------------|
| 00 | `00_inspect_admin_area_health.sql` | No | — |
| 01 | `01_repair_admin_area_hierarchy.sql` | Yes (`parent_id`) | Required |
| 02 | `02_verify_admin_area_hierarchy.sql` | No (hard-fail gate) | — |
| 03 | `03_create_admin_assignment_functions.sql` | Yes (functions) | Required |
| 04 | `04_backfill_places_admin_area.sql` | Yes | Required |
| 05 | `05_backfill_roads_admin_area.sql` | Yes (`core.core_streets`) | Required |
| 06 | `06_backfill_buildings_admin_area.sql` | Yes (`core.core_map_buildings`) | Required |
| 07 | `07_verify_entity_admin_assignment.sql` | No (hard-fail gate) | — |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_DATABASE_URL` | (required) | Postgres connection string |
| `DRY_RUN` | `false` | When `true`, mutating stages log counts only |
| `CONFIRM_WRITE` | `false` | When `true`, allows mutating stages (unless `DRY_RUN=true`) |
| `FORCE_RECALCULATE_VERIFIED` | `false` | When `true`, may change `admin_area_id` on verified rows |
| `LOG_DIR` | `./logs` | Timestamped run logs |
| `PSQL_EXTRA_ARGS` | empty | Extra args passed to `psql` |

## Assignment logic (summary)

Representative point per entity:

- **Places:** `point_geom` / `entry_geom` (fallback: `lng`/`lat`)
- **Streets:** line overlap → full containment → point on line (`core.find_admin_area_for_line`)
- **Buildings:** centroid or `ST_PointOnSurface(geom)`

Among **active** admin polygons, pick the **smallest containing** area (any level; township not required). Nullable `admin_area_id` only when no polygon matches.

## Hierarchy repair (summary)

For each active admin area, compute immediate broader parent from geometry:

- Parent must be broader (`hierarchy_order` smaller than child)
- Tie-break: `hierarchy_order DESC`, `ST_Area(parent.geom) ASC`, `parent.id ASC`
- Never self-parent; cycle check via ancestor walk
- Country-level areas keep `parent_id` null

## Verification gates

**Admin hierarchy (stage 02) — hard fail:** self-parent, parent not broader, orphan `parent_id`, invalid geometry.

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
