# Road fast-core pipeline

Fast, **road-only** import path for routing lab work on Myanmar OSM data. It loads highway ways from a `.osm.pbf`, lightly validates them, and **promotes directly into `core.core_streets`** so you can build Valhalla or OpenTripPlanner routing tests without waiting on the full import-review workflow.

## Purpose

Use this pipeline when you need:

- Maximum **highway network coverage** from a Myanmar OSM extract
- A populated **`core.core_streets`** table for routing engine experiments
- A short, repeatable path: **PBF → raw → staging → core** in one command

This is **not** a production data-quality or dashboard review flow. All promoted streets are **`is_verified = false`** and **`verification_status = unverified`** by default.

## What this pipeline is not

| Topic | Behavior |
|-------|----------|
| **`tools/data-pipeline/local-osm`** | Separate all-entity pipeline with diff, review views, and optional Supabase `import_review` upload. **Do not run both for the same goal.** |
| **`import_review`** | Never written. No review batches, no remote review package. |
| **Other entities** | Does not import or promote places, buildings, admin areas, water, landuse, addresses, bus routes, or routing barriers. |
| **Deleting core data** | Does not delete or soft-delete existing `core.core_streets` rows that are missing from the new import. |
| **Supabase** | No upload. Local/lab Postgres only (unless you point `LOCAL_DATABASE_URL` elsewhere on purpose). |

## What it does

1. Imports **only OSM ways with `highway=*`** (see `lua/osm2pgsql_roads_only.lua`) from a nationwide or regional `.osm.pbf`.
2. Archives lines to **`raw.raw_osm_lines`** under a `system.system_source_snapshots` row.
3. Normalizes to **`staging.staging_road_candidates`** with light validation.
4. **Upserts** into **`core.core_streets`** by `external_id`.
5. Runs a **read-only verification report** on active OSM streets in core.

**Manual override protection:** If a core street already has `manual_override = true`, promotion **does not** overwrite `geom`, `canonical_name`, or road class. It only merges `source_refs` and `normalized_data` when that row is updated.

## Layer model

| Layer | Schema (default) | Table / role |
|-------|------------------|--------------|
| Scratch | `tmp_road_import` | `osm_road_lines` — rebuilt each run (osm2pgsql) |
| Raw | `raw` | `raw_osm_lines` — snapshot-scoped OSM archive |
| Staging | `staging` | `staging_road_candidates` — normalized candidates |
| Core | `core` | `core_streets` — routing source of truth |
| System | `system` | `system_import_batches`, `system_source_snapshots` |

Default snapshot scope is **whole-country Myanmar** (`region_code = MM`, no boundary clip unless you opt in).

## Prerequisites

- PostgreSQL + PostGIS
- `psql`, `shasum`, `osm2pgsql`
- Myanmar OSM PBF (e.g. Geofabrik `myanmar-latest.osm.pbf`)
- DB seeds/migrations applied:
  - `ref.ref_source_types` includes `osm`
  - `system.system_source_registry` includes your `SOURCE_CODE` (e.g. `osm_myanmar`)
  - `ref.ref_road_classes`
  - `core.core_streets` with routing/verification columns (V2 migrations)

Use a **lab database** unless you intentionally target a shared environment.

## Create an env file

Copy the committed template (never commit copies with passwords):

```bash
cd tools/data-pipeline/road-fast-core
cp imports/template.full.env imports/myanmar_roads_2026_06_03_v1.env
```

Edit your copy:

| Variable | Example / notes |
|----------|-----------------|
| `LOCAL_DATABASE_URL` | `postgresql://postgres:…@localhost:5433/geo_core` |
| `SOURCE_CODE` | `osm_myanmar` |
| `REGION_CODE` | `MM` |
| `PBF_PATH` | Absolute path to `.osm.pbf` |
| `SNAPSHOT_VERSION` | **Globally unique** per run, e.g. `osm_myanmar_2026_06_03_roads_fast_v1` |
| `BATCH_NAME` | e.g. `myanmar_roads_fast_core_2026_06_03_v1` |
| `OSM2PGSQL_FLEX_FILE` | `lua/osm2pgsql_roads_only.lua` (relative to this folder) |
| `LOG_DIR` | `logs` (relative to this folder) |
| `TMP_ROAD_SCHEMA` | Must stay `tmp_road_import` (fixed in Lua) |

Optional:

- `APPLY_BOUNDARY_FILTER=true` + `BOUNDARY_ID` — clip to a registered boundary (default: full PBF extent)
- `OSM2PGSQL`, `OSM2PGSQL_EXTRA_ARGS`, `PSQL_EXTRA_ARGS`

`CHECKSUM` is computed automatically from `PBF_PATH` by the runner.

## Run the full pipeline

```bash
cd tools/data-pipeline/road-fast-core
chmod +x run_road_fast_core_pipeline.sh 01_import_roads_to_tmp.sh

./run_road_fast_core_pipeline.sh imports/myanmar_roads_2026_06_03_v1.env
```

The runner:

- Sources **exactly one** env file
- Prints resolved config (database password redacted)
- Runs stages **00 → 08** in order (08 = idempotent core indexes after promote)
- Uses `set -euo pipefail` — stops on the first failure
- Appends all stdout/stderr to a timestamped log under `LOG_DIR`

### Stages

| Stage | File | Description |
|-------|------|-------------|
| 00 | `00_create_road_snapshot.sql` | Registry + batch + snapshot (`MM`, no boundary) |
| 01 | `01_import_roads_to_tmp.sh` | Drop/recreate `tmp_road_import`, osm2pgsql flex import |
| 02 | `02_validate_tmp_roads.sql` | Light tmp checks (WARN on missing names/tags) |
| 03 | `03_tmp_roads_to_raw.sql` | → `raw.raw_osm_lines` |
| 04 | `04_raw_roads_to_staging.sql` | → `staging.staging_road_candidates` |
| 05 | `05_validate_staging_roads.sql` | Staging ERROR/WARN summary |
| 06 | `06_promote_roads_to_core.sql` | Upsert → `core.core_streets` |
| 08 | `08_indexes_core_roads.sql` | Idempotent indexes on `core.core_streets` (IF NOT EXISTS) |
| 07 | `07_verify_core_roads.sql` | Core health report + hard fail checks |

Stage 01 on a full-country PBF can take a long time and significant disk/RAM (osm2pgsql `--slim`).

## Inspect logs

Each run writes a log file:

```text
logs/road-fast-core_<SNAPSHOT_VERSION>_<UTC_TIMESTAMP>.log
```

Example:

```bash
ls -lt logs/road-fast-core_*.log | head
tail -f logs/road-fast-core_osm_myanmar_2026_06_03_roads_fast_v1_20260603T120000Z.log
```

Search for `ERROR`, `FAIL`, or `Stage 0` if a run stopped early. The terminal mirrors the same output via `tee`.

## Verify core roads

Stage **07** runs automatically at the end. You can also run it alone:

```bash
source imports/myanmar_roads_2026_06_03_v1.env
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -f 07_verify_core_roads.sql
```

Stage 07 reports (active OSM rows in `core.core_streets`):

- Total active OSM roads, counts by `road_class`
- Geometry issues, duplicate `external_id`, null `road_class_id`
- Unverified / verified / `manual_override` counts
- Total length (km) by road class, top 20 longest roads
- Sample of 50 rows

**Hard fail** (stage 07 only):

- Invalid geometry count > 0
- Duplicate `external_id` count > 0
- Null `road_class_id` count > 0

Missing names, surface, maxspeed, or `admin_area_id` do **not** fail the pipeline.

### Quick SQL checks

```sql
-- Active OSM streets
SELECT count(*) FROM core.core_streets cs
JOIN ref.ref_source_types st ON st.id = cs.source_type_id AND st.code = 'osm'
WHERE coalesce(cs.is_active, true) AND cs.deleted_at IS NULL;

-- By road class
SELECT road_class, count(*) FROM core.core_streets cs
JOIN ref.ref_source_types st ON st.id = cs.source_type_id AND st.code = 'osm'
WHERE coalesce(cs.is_active, true) AND cs.deleted_at IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Routing-ready flag from fast-core promotion
SELECT routing_status, count(*) FROM core.core_streets
WHERE routing_status IS NOT NULL
GROUP BY 1;
```

## Promotion details (stage 06)

- **Upsert key:** `core.core_streets.external_id` (staging format `osm:W:<osm_id>`)
- **Source type:** `ref.ref_source_types.code = 'osm'`
- **Verification:** always unverified on insert/update (non-manual rows)
- **`routing_status`:** `ready_for_test` for routing lab builds
- **Re-runs:** Same `external_id` updates geometry/attrs unless `manual_override = true`

## Re-run a single stage

Source the same env file, then run one stage with the same `psql -v` names as `run_road_fast_core_pipeline.sh`:

```bash
cd tools/data-pipeline/road-fast-core
source imports/myanmar_roads_2026_06_03_v1.env

psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v tmp_road_import_schema="$TMP_ROAD_SCHEMA" \
  -v raw_schema="$RAW_SCHEMA" \
  -v staging_schema="$STAGING_SCHEMA" \
  -f 04_raw_roads_to_staging.sql
```

Use a **new `SNAPSHOT_VERSION`** if you want a fresh snapshot row instead of reusing an existing one (stage 00).

## What to do next: Valhalla / OTP routing test

After a successful run and stage 07 pass:

1. **Confirm row counts** — hundreds of thousands+ line features for full Myanmar is expected; exact count depends on PBF and filters.
2. **Export or point your routing build** at `core.core_streets` (project routing workflow uses approved street geometry; these rows are explicitly unverified but geometry-complete for experiments).
3. **Build Valhalla** (or your OTP graph build) from the updated core street network:
   - Treat `routing_status = 'ready_for_test'` as the signal to include streets in a test build
   - Rebuild the routing graph after each fast-core import that changes geometry
4. **Smoke-test routes** in Yangon / Kyauktan / nationwide corridors relevant to your experiment.
5. **Do not** assume production map or search quality — this path skips import review and human verification.

For the full production path (review, verification, tiles, other entities), use `tools/data-pipeline/local-osm/` and the dashboard import-review flows instead.

## Directory layout

```text
tools/data-pipeline/road-fast-core/
├── imports/template.full.env    # committed template
├── imports/*.env                # gitignored per-run configs
├── lua/osm2pgsql_roads_only.lua
├── logs/                        # pipeline logs (.gitkeep only in git)
├── 00_create_road_snapshot.sql
├── 01_import_roads_to_tmp.sh
├── 02_validate_tmp_roads.sql
├── 03_tmp_roads_to_raw.sql
├── 04_raw_roads_to_staging.sql
├── 05_validate_staging_roads.sql
├── 06_promote_roads_to_core.sql
├── 08_indexes_core_roads.sql
├── 07_verify_core_roads.sql
└── run_road_fast_core_pipeline.sh
```

## Related docs

- Full multi-entity pipeline: [`../local-osm/README.md`](../local-osm/README.md)
- Staging → core mapping: `infrastructure/database/docs/staging_to_core_mapping.md`
- Project V2 direction: `AGENTS.md` (routing via Valhalla; core streets as source for graph builds)
