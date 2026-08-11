# Myanmar national OSM safety dry-run — runbook

**Date:** 2026-07-23  
**Goal:** Whole-country extract → staging → compare → classify estimates.  
**Hard guards:** no Supabase `core` writes, no Import Review upload, no
direct-Core apply.

Related: [`tools/data-pipeline/local-osm/README.md`](../tools/data-pipeline/local-osm/README.md), [`docs/osm-pipeline-import-classification.md`](osm-pipeline-import-classification.md), [`docs/database-target-safety.md`](database-target-safety.md).

---

## What this dry-run is

```text
National PBF (Geofabrik myanmar-260721)
  → local tmp/raw (snapshot osm_myanmar_2026_07_21_national_dry_run_v1, id 13)
  → staging candidates (ENTITY_FAMILIES)
  → F1/F2 compare vs local prod_mirror
  → import_class buckets (Stage 08b)
  → Stage 08c prod_mirror township admin_area_id (importable rows only)
  → Stage 08d settlement reclass
  → Stage 18 classification reports
  → reports only
```

Promotion / COPY / Import Review upload are **out of scope**.

For entity-by-entity **apply** after gates clear, see [`docs/myanmar-national-osm-entity-import-runbook.md`](myanmar-national-osm-entity-import-runbook.md).

---

## Inputs

| Item | Value |
|------|--------|
| Env | `tools/data-pipeline/local-osm/imports/myanmar_national_dry_run_2026_07_23.env` |
| PBF | `tools/data-pipeline/local-osm/data/osm/myanmar-260721.osm.pbf` (~262 MB) |
| Snapshot | `osm_myanmar_2026_07_21_national_dry_run_v1` (local id **13**) |
| Compare | local `prod_mirror.*` (refresh via `tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh`) |
| Boundary | none (`WHOLE_REGION`) |
| Intended families | `places,roads,admin_areas,landuse,water_lines,water_polygons,routing_barriers` |
| Buildings | **not** full Stage 05 — `NATIONAL_DRY_RUN_BUILDINGS_MODE=core_eligible_only` (~22.7k core-eligible / ~5.56M PMTiles-only) |

Raw counts already loaded for snap 13 (approx): points **384 668**, lines **918 584**, polygons **5 765 899**.

---

## Speed rules (required)

National Stage 05 is heavy. Use these:

1. **Batch by family** — do not extract all families in one Stage 05.
2. **Settlements-only admin assign deferred to Stage 08c** (production `prod_mirror` township ids). Stage 05 does **not** call `pipeline_assign_admin_area_for_point`.
3. **Fast place-name insert** — no per-row `NOT EXISTS` after Stage 05 reset.
4. **Planar `ST_Area(geom)`** in `pipeline_assign_admin_area_for_point` (not geography).
5. Keep `REMOTE_REVIEW_UPLOAD_ENABLED=false`.

Orchestrator: `tools/data-pipeline/local-osm/run_myanmar_national_dry_run_batched.sh`  
(builds per-batch env under `imports/_batch/` so `ENTITY_FAMILIES` is not overwritten by the base env).

---

## Commands

### 0) Refresh prod mirror (read-only vs Supabase)

```bash
cd /Users/nyihtet/Documents/Projects/Core-Map
./tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh \
  ./tools/data-pipeline/prod-mirror/00_env.sh
```

### 1) Preferred: batched dry-run (stages 05–10 per family group)

Raw for snap 13 must already exist (stages 00–04 done once).

```bash
cd tools/data-pipeline/local-osm
./run_myanmar_national_dry_run_batched.sh
```

Batches:

| Batch | Families | Stages |
|-------|----------|--------|
| A | `places,roads` | 05–10 |
| B | `admin_areas,routing_barriers` | 05–10 |
| C | `landuse,water_lines,water_polygons` | 05–10 |
| D | buildings core-eligible SQL + classify | stage SQL + 06–10 |
| Final | all staged families | 08–10 + 15 |

Logs: `logs/myanmar_national_dry_run_batched_*.log`

### 2) Single family / resume

```bash
cd tools/data-pipeline/local-osm

# Example: places+roads only, resume from Stage 05
{
  cat imports/myanmar_national_dry_run_2026_07_23.env
  echo "export ENTITY_FAMILIES='places,roads'"
  echo "export REMOTE_REVIEW_UPLOAD_ENABLED=false"
} > imports/_batch/myanmar_national_A_places_roads.env

export PIPELINE_FROM_STAGE=05
export PIPELINE_TO_STAGE=10
./run_local_osm_pipeline.sh imports/_batch/myanmar_national_A_places_roads.env
```

### 3) Buildings eligibility census (no full footprint staging)

```bash
cd tools/data-pipeline/local-osm
set -a && source imports/myanmar_national_dry_run_2026_07_23.env && set +a
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -f national_buildings_core_eligible_stage.sql
```

Prior census (approx): normalized **5 578 282**, core-eligible **22 667**, PMTiles-only **5 555 615**.

### 4) Classification report only (after staging exists)

```bash
export PIPELINE_FROM_STAGE=08
export PIPELINE_TO_STAGE=10
export CLASSIFICATION_REPORT_ENABLED=true
./run_local_osm_pipeline.sh imports/_batch/myanmar_national_FINAL.env
```

Or run Stage 18 SQL directly with `-v entity_families=...`.

### 5) Durable wrapper (single family list, stages 05–10)

```bash
export PIPELINE_FROM_STAGE=05
export PIPELINE_TO_STAGE=10
./run_myanmar_national_dry_run_durable.sh
```

Prefer the **batched** script for national scale.

---

## How the pipeline works (short)

| Stage | Role |
|------:|------|
| 00–04 | Boundary (optional), snapshot, osm2pgsql → tmp → raw |
| 05 | Raw → staging candidates (`ENTITY_FAMILIES`) |
| 06 | F1 diff vs previous snapshot |
| 07 | F2 diff vs `prod_mirror` |
| 08 / 08b | Status + `import_class` |
| 09–10 | Review views + summary |
| 11–13 | Remote review package / upload (**disabled** here) |
| 15 / 18 | Coverage + classification bucket report |

Flow detail: [`tools/data-pipeline/local-osm/README.md`](../tools/data-pipeline/local-osm/README.md).

---

## Status snapshot (2026-07-23 evening)

| Check | Status |
|-------|--------|
| Raw snap 13 | Loaded |
| Prod mirror | Present (places ~11k, streets ~823k, admin ~2.5k) |
| Batch A `places,roads` Stage 05 | **In progress / long-running** (`stage05_point_extraction`; place-name path after speed fixes) |
| Batches B–D + Stage 18 totals | **Not finished** — wait for A, then continue batched script |
| Supabase core / IR upload | **Not executed** (by design) |

Do **not** start national import/apply until Stage 18 family READY/BLOCKED is filled and suspicion flags are reviewed.

---

## Expected report metrics (Stage 18)

Per family: normalized, core eligible, PMTiles only, valid, invalid, `safe_new`, `safe_update`, `unchanged`, `duplicate`, `conflict`, `manual_protected`, `verified_conflict`, `possible_delete`, plus transfer/load/review estimates.

Suspicion flags to check: nearly-all roads `safe_update`, zero road `unchanged`, excess building core eligibility, zero dense duplicates, all admin changed, review volume too large, missing township assignments, null `external_id`.

---

## Admin assignment (country)

See: [`tools/data-pipeline/local-osm/reports/myanmar_national_admin_assignment_2026-07-23.md`](../tools/data-pipeline/local-osm/reports/myanmar_national_admin_assignment_2026-07-23.md).

---

## Do not run

```bash
# No production apply / no IR upload for this dry-run
# REMOTE_REVIEW_UPLOAD_ENABLED=true
# run_direct_core_import.sh --apply
# promotion / COPY into Supabase core
```
