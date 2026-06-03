# Admin fast-core pipeline

Import **Myanmar OSM administrative boundaries only** into `core.core_admin_areas`.

Fast path: **PBF → tmp → raw → staging → core** — no `import_review`, no Supabase.

## Separate from other pipelines

- **`road-fast-core`** and **`local-osm`** are independent.
- Does **not** touch roads, places, buildings, **`import_review`**, or **Supabase**.
- Use a **lab** Postgres unless you intentionally point `LOCAL_DATABASE_URL` elsewhere.

## Warnings

- **Do not** `TRUNCATE` or delete `raw` / `staging` tables globally.
- **Do not** delete rows in `core.core_admin_areas`.
- **Safe re-run:** the same `SNAPSHOT_VERSION` re-runs cleanup for that snapshot only (drops/recreates `tmp_admin_import`, deletes matching `raw` / `staging` rows for the pipeline), then reloads. Other snapshots and core rows are untouched.

## Pipeline stages (00–07)

| Stage | File | Step |
|-------|------|------|
| 00 | `00_create_admin_snapshot.sql` | Create/reuse snapshot + batch |
| 00 | `00_cleanup_current_snapshot.sql` | Clean tmp + snapshot-scoped raw/staging (before osm2pgsql) |
| 01 | `01_import_admin_to_tmp.sh` | Import admin boundaries to tmp |
| 02 | `02_validate_tmp_admin.sql` | Validate tmp |
| 03 | `03_tmp_admin_to_raw.sql` | Tmp → raw |
| 04 | `04_raw_admin_to_staging.sql` | Raw → staging |
| 05 | `05_validate_staging_admin.sql` | Validate staging |
| 06 | `06_promote_admin_to_core.sql` | Promote to core (+ names) |
| 07 | `07_verify_core_admin.sql` | Verify core admin |

Logs: `logs/admin-fast-core_<SNAPSHOT_VERSION>_<UTC>.log`

---

## 1. Create env

```bash
cd tools/data-pipeline/admin-fast-core
cp imports/template.full.env imports/myanmar_admin_YYYY_MM_DD.env
```

Edit the copy (do not commit passwords):

- `LOCAL_DATABASE_URL`
- `PBF_PATH` (absolute path to Myanmar `.osm.pbf`)
- `SNAPSHOT_VERSION` (globally unique per run)
- `SNAPSHOT_REF` (unique per `osm_myanmar` registry row, or reuse same value only when re-running the **same** `SNAPSHOT_VERSION`; default: same as `SNAPSHOT_VERSION`)
- `BATCH_NAME`
- `FORCE_RECALCULATE_VERIFIED=false` (set `true` only to overwrite verified core admin rows on promote)

```bash
chmod +x run_admin_fast_core_pipeline.sh 01_import_admin_to_tmp.sh
```

---

## 2. Run admin-fast-core

**Lab DB prerequisites:** `core.core_admin_areas` must include `external_id`, `source_refs`, and `normalized_data` (added in `infrastructure/database/migrations/supabase/023_prepare_core_search_routing_address.sql`). Apply that migration (or equivalent `ALTER TABLE`) before stage **06**.

```bash
cd tools/data-pipeline/admin-fast-core
./run_admin_fast_core_pipeline.sh imports/myanmar_admin_YYYY_MM_DD.env
```

Wait for stage **07** to finish without errors. Inspect the log under `logs/` if a stage fails.

**Note:** osm2pgsql may not assemble multipolygon geometry for some broken OSM boundary relations; the flex Lua skips those (`geom:is_null()`). Stage **04** skips rows without a resolvable name or without an explicit OSM `admin_level` → `ref.ref_admin_levels` mapping (no fallback to country).

OSM `admin_level` → CoreMap ref (Myanmar extract):

| OSM | `ref.ref_admin_levels.code` |
|-----|-----------------------------|
| 2 | `country` |
| 4 | `state_region` |
| 5 | `district` |
| 6 | `township` |
| 7–10 | `ward_village_tract` |

Semicolon-separated tags use the **maximum** numeric level. Unknown OSM levels are skipped (warning tally `skipped_no_admin_level`).

**Semantic override** (from `canonical_name`, applied after OSM mapping): `ခရိုင်` / `District` → `district`; `မြို့နယ်` / `Township` → `township`; `ရပ်ကွက်`, `ကျေးရွာအုပ်စု`, `Ward`, `Village Tract` → `ward_village_tract`. District patterns win over township patterns.

**Country dedup (stage 06):** OSM country row merges into existing active `မြန်မာ` core row when `external_id` is blank; duplicate active country rows are deactivated.

---

## 3. Run admin-hierarchy-repair (after admin import succeeds)

Rebuild `parent_id`, install assignment functions, optionally backfill entity `admin_area_id`, then verify.

Use the **same** `LOCAL_DATABASE_URL` as admin-fast-core (export from your env file or `source` it).

### Required steps

```bash
cd tools/data-pipeline/admin-hierarchy-repair

# Optional: full runner with CONFIRM_WRITE (see ../admin-hierarchy-repair/README.md)
# CONFIRM_WRITE=true ./run_admin_hierarchy_repair.sh imports/local_repair.env

# Or run SQL directly:
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_repair_admin_area_hierarchy.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 02_verify_admin_area_hierarchy.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 03_create_admin_assignment_functions.sql
```

### Backfill entity `admin_area_id` (if places/roads/buildings already exist in core)

Run only when you need assignments on existing core rows:

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 04_backfill_places_admin_area.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 05_backfill_roads_admin_area.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 06_backfill_buildings_admin_area.sql
```

Use `DRY_RUN=true` / `CONFIRM_WRITE=true` and `FORCE_RECALCULATE_VERIFIED` as documented in [`../admin-hierarchy-repair/README.md`](../admin-hierarchy-repair/) when using the repair runner.

### Verify entity assignment

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 07_verify_entity_admin_assignment.sql
```

---

## 4. Then run road-fast-core (roads)

After admin areas and hierarchy repair are in place, import roads separately:

```bash
cd tools/data-pipeline/road-fast-core
# create env from imports/template.full.env, then:
./run_road_fast_core_pipeline.sh imports/myanmar_roads_YYYY_MM_DD.env
```

**Before relying on road `admin_area_id`:** update `road-fast-core` promotion so `core.core_streets.admin_area_id` is set from the admin assignment function created in step **03** (`03_create_admin_assignment_functions.sql`). Until that change is in place, roads may promote without `admin_area_id` even when admin polygons exist.

Order: **admin-fast-core → admin-hierarchy-repair (01–03, 07, 04–06 if needed) → road-fast-core (with assignment)**.

---

## Related docs

- [`../admin-hierarchy-repair/README.md`](../admin-hierarchy-repair/README.md)
- [`../road-fast-core/README.md`](../road-fast-core/README.md)
- [`../local-osm/README.md`](../local-osm/README.md) (full import-review path)
