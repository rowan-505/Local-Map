# Local OSM data pipeline

Automation for importing OpenStreetMap extracts into a **local** PostgreSQL/PostGIS database. This folder prepares extraction → raw → staging → diff → review; it does **not** write **`core`** from this pipeline. Optionally, after Stage 10, it can populate local **`system.system_remote_review_***` tables and upsert **`import_review` on Supabase** (never `core`), and optionally run lineage QA SQL (`14`).

## Contents

- [Layer model](#layer-model)
- [Pipeline flow (stages 00–15)](#pipeline-flow-stages-0015)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration-one-full-env-file-per-import)
- [Operating modes](#operating-modes)
- [Entity-specific pipeline runs](#entity-specific-pipeline-runs)
- [Classified place / address families](#classified-place--address-families)
- [Run the full pipeline](#run-the-full-pipeline)
- [Remote review package (Stages J / K / L + optional 14–15)](#remote-review-package-stages-j--k--l--optional-1415)
- [Logs and debugging](#logs-and-debugging)
- [Pipeline stages](#pipeline-stages)
- [Workflow fields (`match_status`, `auto_action`, …)](#workflow-fields-match_status-auto_action-)
- [Review views](#review-views)
- [Scores (`confidence_score`)](#scores-confidence_score)
- [Optional scripts (`setup/`)](#optional-scripts-setup)
- [Re-running and resuming stages](#re-running-and-resuming-stages)
- [Related docs](#related-docs)
- [Safety boundaries](#safety-boundaries)

---

## Layer model

| Layer | Schema (default) | Role |
|-------|------------------|------|
| **tmp_import** | `tmp_import` | Disposable scratch for osm2pgsql (or similar). Rebuilt per run. |
| **raw** | `raw` | Archived OSM geometries/tags keyed by `system.system_source_snapshots.id` → `source_snapshot_id`. |
| **staging** | `staging` | Normalized **candidates** for review and diffing—not production truth. |
| **system** | `system` | Import batches, snapshots, diff runs/items, boundaries—lineage and workflow metadata. |

**Permanent DB memory:** `system.system_import_batches` and `system.system_source_snapshots` record each import’s identity, lineage, and checksum. Env files are run configuration only; the database rows are what later stages reference.

Import boundaries live in `system.system_import_boundaries` and are linked from `system.system_source_snapshots.boundary_id` when **`BOUNDARY_GEOJSON_PATH`** is set. The pipeline reuses an existing boundary when the same `boundary_ref` + checksum or `boundary_code` + `boundary_version` is already registered.

**Whole-region imports:** leave **`BOUNDARY_GEOJSON_PATH`** empty or unset. Stage **00** is skipped, snapshot **`boundary_id`** stays **NULL**, and Stage **04** copies the full PBF into `raw` without spatial clipping (`WHOLE_REGION` mode). **`REGION_CODE`** is still required (e.g. `MM` for country-wide runs).

Promotion to `core` and sync to production are **out of scope** here.

---

## Pipeline flow (stages 00–15)

Orchestration: **`run_local_osm_pipeline.sh`** (one import env file per run).

```text
00 preflight schema check (local)
00 register boundary (optional — skipped when WHOLE_REGION)
01 create snapshot + import batch
02 osm2pgsql → tmp_import  (osmium pre-filter when admin_areas or roads only)
03 validate tmp
04 tmp → raw  (clip to boundary when set)
05 raw → staging candidates  (ENTITY_FAMILIES filter)
06 F1 diff: snapshot vs previous → system.system_diff_items
07 F2 diff: staging vs prod_mirror → system.system_diff_items
08 merge F1+F2 → staging.match_status / auto_action / review_status
   (+ classification defaults for places / addresses / place_address_links)
09 review views (v_no_conflict_*, v_review_*, …)
10 read-only summary report
── optional remote review (never promotes core) ──
11 (J) prepare local package → system.system_remote_review_*
12 (K) upload package → Supabase import_review.* only  (Node/tsx)
13 (L) verify local package linkage + coverage
14 (optional) lineage QA — staging ↔ package payload mirrors
15 (optional) entity coverage + promotion-readiness report
```

**Resume:** set **`PIPELINE_FROM_STAGE=N`** to skip earlier stages (see [Re-running and resuming stages](#re-running-and-resuming-stages)). Stages **11–14** are gated individually when remote review is enabled.

---

## Prerequisites

- **PostgreSQL + PostGIS** (local URL in `LOCAL_DATABASE_URL`).
- **`psql`** on `PATH`.
- **`shasum`** (macOS: usually present) — PBF and boundary checksums.
- **`osm2pgsql`** — Stage B (`02_import_to_tmp.sh`); optional binary override via `OSM2PGSQL`.
- **Node.js + repo dependencies** — only when **`REMOTE_REVIEW_UPLOAD_ENABLED=true`**: Stage **K** runs `npx tsx ./12_upload_remote_review_package.ts` from the repo root (`pg`, `tsx`, `dotenv`; see root `package.json`).
- **Registry row** — `SOURCE_CODE` must exist in `system.system_source_registry` (see seeds under `infrastructure/database/seeds/local/`).

---

## Configuration: one full env file per import

There is **no** shared `00_env.sh`. Each import uses one env file under `imports/`:

```text
tools/data-pipeline/local-osm/imports/
  template.full.env          ← committed template (no secrets)
  kyauktan_2026_07_v4.env    ← your copy (gitignored; may contain passwords)
```

### Create a new import env

```bash
cd tools/data-pipeline/local-osm
cp imports/template.full.env imports/kyauktan_2026_07_v4.env
```

Edit the copy. Required variables:

| Variable | Purpose |
|----------|---------|
| `LOCAL_DATABASE_URL` | Local Postgres connection string |
| `SOURCE_CODE` | Registry key (e.g. `osm_myanmar`) |
| `REGION_CODE` | Scope (e.g. `MM` whole-country, `MM-KYAUKTAN` clipped regional) |
| `PBF_PATH` | Absolute path to `.osm.pbf` |
| `BOUNDARY_GEOJSON_PATH` | **Optional.** Absolute path to import boundary GeoJSON for **clipped** regional imports. Leave empty/unset for whole-country / whole-PBF imports (no Stage 04 clip). |
| `BOUNDARY_CODE` | Stable boundary key (**required when `BOUNDARY_GEOJSON_PATH` is set**) |
| `BOUNDARY_NAME` | Human-readable boundary name (**required when boundary file is set**) |
| `BOUNDARY_VERSION` | Boundary version (**required when boundary file is set**) |
| `SNAPSHOT_REF` | File label stored on `system.system_source_snapshots` |
| `SNAPSHOT_VERSION` | **Globally unique** snapshot version (see `NAMINGENV.md`) |
| `BATCH_NAME` | `system.system_import_batches.batch_name` |
| `OSM2PGSQL_FLEX_FILE` | Path to flex Lua (e.g. `lua/osm2pgsql_tmp_import.lua`) |
| `LOG_DIR` | Directory for pipeline logs (runner creates it if missing) |

**Checksums:** `CHECKSUM` is **not** set in the env file. The runner hashes `PBF_PATH`; when a boundary file is provided, `00_register_boundary.sh` hashes the boundary GeoJSON (`shasum -a 256`).

**Optional overrides** (see `imports/template.full.env`):

| Variable | Purpose |
|----------|---------|
| `TMP_IMPORT_SCHEMA`, `RAW_SCHEMA`, `STAGING_SCHEMA`, `SYSTEM_SCHEMA`, `IMPORT_REVIEW_SCHEMA` | Schema names (defaults shown in template) |
| `OSM2PGSQL`, `OSMIUM` | Binary paths for Stage 02 |
| `OSM2PGSQL_FLEX_FILE` | Override flex Lua; when unset, Stage 02 auto-picks Lua from `ENTITY_FAMILIES` |
| `PSQL_EXTRA_ARGS` | Extra flags on every pipeline `psql` call |
| `ALLOW_BOUNDARY_UPDATE` | When `true`, Stage **01** may overwrite an existing snapshot’s `boundary_id` (default `false`) |
| `ENTITY_FAMILIES` | Comma-separated subset or `all` — see [Entity-specific pipeline runs](#entity-specific-pipeline-runs) |
| `PIPELINE_FROM_STAGE` | Resume from stage number (e.g. `08`, `12`); empty = full run |
| `PIPELINE_PSQL_WORK_MEM`, `PIPELINE_PSQL_MAINTENANCE_WORK_MEM` | Session memory for all pipeline `psql` calls (defaults `512MB` / `1GB`) |

Naming conventions: **`NAMINGENV.md`**.

**Do not commit** real `imports/*.env` files (passwords). Only `template.full.env` is tracked.

---

## Operating modes

| Mode | Env | What runs |
|------|-----|-----------|
| **Full import** | (default) | Stages **00 → 10**; remote review only if flags below are set |
| **Entity-scoped import** | `ENTITY_FAMILIES=admin_areas` (etc.) | Same stages; extraction, diff, status, package, and upload limited to selected families |
| **Whole-region import** | `BOUNDARY_GEOJSON_PATH` empty | No boundary clip; Stage **00** boundary registration skipped |
| **Remote review upload** | `REMOTE_REVIEW_UPLOAD_ENABLED=true` + `REMOTE_REVIEW_PACKAGE_NAME` + `SUPABASE_DATABASE_URL` | After stage 10: **J → K → L** (+ optional **14**, **15**) |
| **Prepare + verify only (local dry path)** | `REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true` + `REMOTE_REVIEW_PACKAGE_NAME` | **J → L** only — builds local package, **no Supabase upload** |
| **Upload row cap / smoke test** | `REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=N` | Stages **J** and **K** export/upload at most **N** rows per family (sorted by `local_staging_id`) |
| **Lineage QA** | `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true` | Stage **14** after **L** when stages 11–13 run |
| **Coverage report** | `LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true` | Stage **15** after remote-review block (promotion-readiness metrics) |
| **Resume mid-pipeline** | `PIPELINE_FROM_STAGE=08` (etc.) | Skips earlier stages; use helper scripts below |

If **both** `REMOTE_REVIEW_UPLOAD_ENABLED` and `REMOTE_REVIEW_PREPARE_VERIFY_ONLY` are true, the runner uses the **full upload path** (J → K → L).

**Overwrite / replace rules (not core promotion):**

| Action | Default | Enable overwrite |
|--------|---------|------------------|
| Re-run Stage **J** with same `REMOTE_REVIEW_PACKAGE_NAME` | **Fails** — package name already exists | Manual SQL: `-v replace_package=true` (deletes old package row + items, recreates) |
| Re-upload Stage **K** to Supabase | **Idempotent** on `(review_batch_id, local_staging_id)` | Pending rows refresh; rows with **`review_decision` set** or non-pending review status are **preserved** (not overwritten) |
| Change snapshot `boundary_id` on existing version | **Blocked** | `ALLOW_BOUNDARY_UPDATE=true` on Stage **01** |

The bash runner always passes **`replace_package=false`** to Stage J. See **`README_REMOTE_REVIEW.md`** for manual replace and Stage K behavior.

---

## Entity-specific pipeline runs

Use `ENTITY_FAMILIES` in your import env to limit extraction, diff, review packaging, and verification to one or more entity families. The runner passes this into stages **05–11**, **13–15** as `-v entity_families=…`. Stage **K** uses the same scope via `REMOTE_REVIEW_ENTITY_FAMILY` (falls back to `ENTITY_FAMILIES` when unset).

### Supported `ENTITY_FAMILIES` slugs (pipeline registry)

| Slug | Staging table (typical) | Stage K upload |
|------|-------------------------|----------------|
| `places` | `staging_place_candidates` | `import_review.place_candidates` (+ child names) |
| `addresses` | `staging_address_candidates` | `import_review.address_candidates` |
| `address_components` | `staging_address_component_candidates` | `import_review.address_component_candidates` |
| `place_address_links` | `staging_place_address_link_candidates` | `import_review.place_address_link_candidates` |
| `buildings` | `staging_building_candidates` | `import_review.building_candidates` |
| `roads` | `staging_road_candidates` | `import_review.road_candidates` |
| `admin_areas` | `staging_admin_area_candidates` | `import_review.admin_area_candidates` |
| `landuse` | `staging_landuse_candidates` | `import_review.landuse_candidates` |
| `water_lines` | `staging_water_line_candidates` | `import_review.water_line_candidates` |
| `water_polygons` | `staging_water_polygon_candidates` | `import_review.water_polygon_candidates` |
| `routing_barriers` | `staging_routing_barrier_candidates` | `import_review.routing_barrier_candidates` |
| `routing_roads`, `routing_turn_restrictions` | staging / export helpers | not in Stage K yet |

> Transport families (bus stops/routes) are no longer part of this OSM pipeline. Transport data now lives in `transport.*` and is loaded by a separate direct-upsert path.

Use `all` (default) for every configured family. Comma-separate for subsets, e.g. `admin_areas,roads`.

### Common scoped runs

| `ENTITY_FAMILIES` | Typical use |
|-------------------|-------------|
| `admin_areas` | National or regional admin boundary import only. Stage **02** uses osmium pre-filter + `osm2pgsql_admin_areas_only.lua`. |
| `roads` | Road network extract only. Stage **02** uses osmium pre-filter + `osm2pgsql_roads_only.lua`. |
| `admin_areas,roads` | Both in one snapshot (roads may have null `admin_area_id` until post-promotion recalc). |
| `places,addresses,address_components,place_address_links` | Classified POI + address workflow (see below). |
| `all` | Full multi-family pipeline. |

**Stage 02 note:** For `admin_areas` or `roads` only, the runner **pre-filters the PBF with osmium** before osm2pgsql. Lua-only filtering on a whole-country PBF is too slow (osm2pgsql `--slim` reads every node). Requires **`osmium-tool`** on `PATH` (`brew install osmium-tool`).

Example env (Myanmar admin-only):

```bash
export ENTITY_FAMILIES=admin_areas
export REMOTE_REVIEW_ENTITY_FAMILY=admin_areas   # Stage K upload filter (optional; falls back to ENTITY_FAMILIES)
export REMOTE_REVIEW_PACKAGE_NAME=remote_review_pkg_admin_areas_v1
```

Run:

```bash
./run_local_osm_pipeline.sh imports/myanmar_admin_only_2026_06_03.env
```

### What runs where

| Layer | Where | Written by this pipeline? |
|-------|--------|---------------------------|
| `tmp_import`, `raw`, `staging`, `system` | **Local** PostgreSQL only | Yes (stages 00–11, 13–14) |
| `import_review.*` | **Supabase** | Yes — **Stage K only** (`12_upload_remote_review_package.ts`) |
| `core.*` | **Supabase** (production) | **No** — never written by local-osm |

- **Local-osm** prepares candidates and outbound packages on your machine. It does **not** promote data into Supabase **`core`**.
- **Stage 12 (K)** upserts **`import_review.review_batches`** and family candidate tables (e.g. `import_review.admin_area_candidates`, `import_review.road_candidates`) only. It never touches **`core.*`**.
- **Supabase `core` promotion** happens later through **dashboard / API promotion logic** after human or workflow review of `import_review` rows.

### Admin areas before hierarchy and roads

Operational order matters when admin and roads share a region:

1. **Import and upload admin areas first** — `ENTITY_FAMILIES=admin_areas`, run through Stage K so reviewers see `import_review.admin_area_candidates`.
2. **Promote admin areas to Supabase `core`** via the normal review/promotion path (dashboard/API). Until `core.core_admin_areas` exists in Supabase, downstream hierarchy steps have nothing to attach to.
3. **Run hierarchy / parent resolution only after admin areas are in core** — township → district → state nesting and `parent_id` fixes belong in promotion or post-promotion tooling, not in a blind local-osm re-import.
4. **Import and upload roads** — `ENTITY_FAMILIES=roads` or `admin_areas,roads` after admin core is stable.
5. **Recalculate road `admin_area_id` in Supabase** after admin areas exist in **`core.core_admin_areas`**. Staging may carry a local candidate FK or null; production roads need spatial/admin lookup against **Supabase core**, not local staging alone. Run that recalculation as a separate Supabase-side step (promotion script or admin job) once core admin geometry is live.

Combined run (`ENTITY_FAMILIES=admin_areas,roads`) is supported for packaging and upload, but **road `admin_area_id` in `import_review` may still be incomplete** until step 5 runs against promoted core admin polygons.

Details for Stages J–L filters and upload tables: **[`README_REMOTE_REVIEW.md`](README_REMOTE_REVIEW.md)** § Entity-specific pipeline runs.

---

## Classified place / address families

Stages **05** and **08** treat **places**, **addresses**, **address_components**, and **place_address_links** as a classified workflow (not plain geometry diff only).

**Stage 05** sets (among others):

- `source_classification` — e.g. `place_only`, `place_with_address`, `address_only`, `weak_address`
- `address_strength` — `none`, `weak`, `partial`, `strong`, `full`
- `promotion_status` — starts as `not_ready` (never auto-promoted by this pipeline)

**Stage 08** applies a second pass (`stage08_apply_classification_statuses`) when those families are enabled:

| Family | Behavior (high level) |
|--------|------------------------|
| **places** | `place_only` / `place_with_address` → review-ready `new_candidate`; **`promotion_status` stays `not_ready`** until dashboard promotion |
| **addresses** | Strong address evidence → `new_candidate` + validation tier; weak / place-only → `needs_review` or **`validation_status = blocked`** |
| **place_address_links** | Links with `place_with_address` classification get aligned statuses; promoted rows are never downgraded |

**Stage J** exports rows with `promotion_status <> 'promoted'` and packages child names/components/links per family config.

**Promotion to `core`** (places, addresses, buildings, etc.) is **dashboard/API only** after `import_review` review. Stage **15** (`LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true`) reports **`stage15_promotion_readiness`** heuristics per family — it does not promote.

Stage **11** family filter coupling:

- `address_components` in `ENTITY_FAMILIES` also enables component export when `addresses` is selected.
- `place_address_links` enables when explicitly selected **or** when **both** `places` and `addresses` are selected.

---

## Run the full pipeline

```bash
cd tools/data-pipeline/local-osm
chmod +x run_local_osm_pipeline.sh
./run_local_osm_pipeline.sh imports/kyauktan_2026_07_v4.env
```

The runner:

- Takes **exactly one** argument: path to the import env file (relative to cwd or to this directory).
- Sources **only** that file and validates required variables.
- Prints resolved config (**database password redacted**).
- Uses **`set -euo pipefail`** — first failing command stops the run (including **`tee` + `pipefail`** across pipeline stages).
- Registers or reuses the boundary, then runs stages **00 → 10**, then optionally **Stages 11–13** when enabled (see [Remote review package](#remote-review-package-stages-j--k--l--optional-14)).
- Optionally runs **`14_verify_lineage_alignment.sql`** after Stage **L** when **`REMOTE_LINEAGE_ALIGNMENT_VERIFY=true`** (same gate as stages 11–13).
- Appends **all** stage output (stdout + stderr) to the log file below, and mirrors it to your terminal via `tee`.

One-liner examples after editing your env:

```bash
# Full path including Supabase upload
REMOTE_REVIEW_UPLOAD_ENABLED=true REMOTE_REVIEW_PACKAGE_NAME=my_pkg ./run_local_osm_pipeline.sh imports/your_import.env

# Local package only — no Supabase (dry path)
REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true REMOTE_REVIEW_PACKAGE_NAME=my_pkg ./run_local_osm_pipeline.sh imports/your_import.env

# Smoke test upload (5 rows per family)
REMOTE_REVIEW_UPLOAD_ENABLED=true REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=5 REMOTE_REVIEW_PACKAGE_NAME=my_pkg ./run_local_osm_pipeline.sh imports/your_import.env

# Resume after stages 01–07 already done
PIPELINE_FROM_STAGE=08 ./run_local_osm_pipeline.sh imports/your_import.env
# or: ./run_resume_from_stage08.sh imports/your_import.env

# Resume Supabase upload after Stage J succeeded
PIPELINE_FROM_STAGE=12 ./run_local_osm_pipeline.sh imports/your_import.env
# or: ./run_resume_from_stage12.sh imports/your_import.env
```

---

## Remote review package (Stages J / K / L + optional 14–15)

After **Stage 10**, `run_local_osm_pipeline.sh` can run additional artifacts (**order is fixed**):

| Stage | File | Role |
|-------|------|------|
| **J (11)** | `11_prepare_remote_review_package.sql` | **Local DB only.** Builds/replaces rows in `system.system_remote_review_packages` and `_items` from staging + latest F2 slice. |
| **K (12)** | `12_upload_remote_review_package.ts` | **Supabase only (`import_review`).** Upserts `import_review.review_batches` and family candidate tables keyed by `(review_batch_id, local_staging_id)`. Needs Node + `tsx` (repo-root `npm` deps). **Does not** write `core` or local staging. |
| **L (13)** | `13_verify_remote_review_upload.sql` | **Local DB only.** Read-only-ish checks (`psql`) that local package linkage and counts look sane vs `REMOTE_REVIEW_PACKAGE_NAME`. |
| **`14` (optional)** | `14_verify_lineage_alignment.sql` | **Local DB only.** Staging ↔ package item lineage, payload mirrors, post-upload stamps. Runs when **`REMOTE_LINEAGE_ALIGNMENT_VERIFY=true`** immediately **after Stage L**. **FAIL rows stop the bash runner** (`ON_ERROR_STOP` + cast guard). |
| **`15` (optional)** | `15_entity_coverage_report.sql` | **Local DB only.** Read-only staging health, optional `import_review` batch counts, **`stage15_promotion_readiness`**. Runs when **`LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true`**. |

**Note:** Stage J is **`.sql`**, not `.ts`. Stage **K** uploads in **chunks of 500** rows per family with progress logs (large national road packages ~800k+ rows are supported).

**Lineage matrix + Supabase copy-paste SQL:** [`README_REMOTE_REVIEW.md`](README_REMOTE_REVIEW.md).

### When these run

| Env flag | Stages executed | Requires |
|----------|-----------------|----------|
| `REMOTE_REVIEW_UPLOAD_ENABLED=true` (or `1` / `yes`) | **J → K → L** (+ optional **`14`**, **`15`**) | `REMOTE_REVIEW_PACKAGE_NAME`, `SUPABASE_DATABASE_URL`, plus standard DB secrets in your env. |
| `REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true` (or `1` / `yes`) | **J → L** only (+ optional **`14`**, **`15`**) | `REMOTE_REVIEW_PACKAGE_NAME` **only** (no Supabase). |
| Neither flag true | **Skip 11–15** remote-review block | — |

If **both** `REMOTE_REVIEW_UPLOAD_ENABLED` and `REMOTE_REVIEW_PREPARE_VERIFY_ONLY` are “true”, the runner uses the **full upload path** (J → K → L) and logs that choice.

**`PIPELINE_FROM_STAGE`** skips individual remote-review stages: e.g. `12` skips **J**, runs **K → L** (and **14**/**15** when enabled).

Stage J is invoked as `-v package_name="${REMOTE_REVIEW_PACKAGE_NAME}"` with **`replace_package=false`**. Naming guidance: **`NAMINGENV.md` § Remote review package name**.

Optional knobs:

- `REMOTE_LINEAGE_ALIGNMENT_VERIFY` — **`true`** / **`1`** / **`yes`** to run **`14_verify_lineage_alignment.sql`** after **`13`** whenever stages **11–13** run (otherwise skip **`14`**).
- `LOCAL_ENTITY_COVERAGE_REPORT_ENABLED` — run **`15_entity_coverage_report.sql`** after the remote-review block.
- `REMOTE_REVIEW_ENTITY_FAMILY` — upload filter for Stage K (e.g. `admin_areas`, `roads`, `admin_areas,roads`; empty = all families with package items). Align with `ENTITY_FAMILIES` when running entity-scoped imports.
- `REMOTE_REVIEW_MAX_ROWS_PER_FAMILY` — integer cap per family in **J** and **K** (smoke test / dry-run upload volume).
- `REMOTE_REVIEW_BATCH_ID` — optional; Stage **15** uses it for batch-scoped Supabase counts when set.
- `SUPABASE_DB_SSL_VERIFY_SERVER_CERT` — set to literal `true` only if you need strict Node TLS verification against Supabase (default for this tool is **not** strict).

---

## Logs and debugging

### Main pipeline log

Each run writes:

```text
${LOG_DIR}/local-osm-pipeline_<SNAPSHOT_VERSION>_<UTC-timestamp>.log
```

Example: `LOG_DIR=/path/to/logs` and `SNAPSHOT_VERSION=osm_myanmar_2026_07_kyauktan_v4` →

`local-osm-pipeline_osm_myanmar_2026_07_kyauktan_v4_20260518T120000Z.log`

(Slashes in `SNAPSHOT_VERSION` are replaced with `_` in the filename.)

The path is printed at **start** as `log file: …`.

### What appears in the log

- Resolved configuration (except DB password).
- Every **`psql`** invocation uses **`-v ON_ERROR_STOP=1`**: on SQL error, `psql` exits non-zero and the bash runner stops.
- **Stage banners**: lines like `=== 05_raw_to_staging ===`.
- **Full SQL and shell output** for stages 02–10 (and boundary registration), **plus Stages J/K/L (and optional `14`) when enabled**, duplicated from the terminal.

### If something fails

1. Open the **latest** `local-osm-pipeline_*.log` under `LOG_DIR`.
2. Search backward from the bottom for `ERROR`, `FATAL`, or `psql:` lines.
3. Note **which stage** header (`=== … ===`) was last completed; the failure is in the next stage or in the same block.
4. Fix DB/schema/env and **re-run** from an appropriate stage (see [Re-running individual stages](#re-running-individual-stages)).

### Other artifacts

- **`02_import_to_tmp`**: osm2pgsql writes its own progress to stdout (captured in the same pipeline log).
- **Prod mirror tooling** (outside this runner): separate logs under `logs/` if you use `prod-mirror/refresh_prod_mirror.sh` — not mixed into `local-osm-pipeline_*.log` unless you redirect manually.

---

## Pipeline stages

| # | Stage | What it does |
|---|--------|----------------|
| **00** | `00_preflight_schema_compatibility.sql` | Read-only check: staging/system score columns on **0–100** scale; fails before import if legacy 0–1 DDL remains. |
| **00** | `00_register_boundary.sh` | Load boundary into temp storage; insert/reuse `system.system_import_boundaries`. **Skipped** when `BOUNDARY_GEOJSON_PATH` is empty (whole-region import). |
| **01** | `01_create_snapshot.sql` | Create/import batch + snapshot row; link `boundary_id` when a boundary was registered (NULL for whole-region). Respects **`ALLOW_BOUNDARY_UPDATE`**. |
| **02** | `02_import_to_tmp.sh` | osm2pgsql flex → `tmp_import`. Auto Lua + **osmium** pre-filter for `admin_areas` / `roads` only. |
| **03** | `03_validate_tmp.sql` | Row counts, SRID, geometry sanity (fails fast on bad import). |
| **04** | `04_tmp_to_raw.sql` | Copy tmp → raw; **clips to boundary** when `boundary_id` is set, otherwise copies all geometries (`WHOLE_REGION`). |
| **05** | `05_raw_to_staging.sql` | Build **staging** candidates for enabled **`ENTITY_FAMILIES`**. **Delete+regenerate** current snapshot first (`pipeline_stage05_reset.sql`), then insert from raw; write `normalized_hash` fingerprints; **05b** sets `validation_status` (`valid`\|`warning`\|`invalid`). |
| **06** | `06_diff_current_vs_previous.sql` | F1 previous-snapshot compare via **identity key + `normalized_hash`**; writes `system_diff_items` and staging `source_status` (`source_new`\|`source_changed`\|`source_unchanged`). |
| **07** | `07_compare_with_prod_mirror.sql` | **F2:** compare staging vs local **`prod_mirror`** → more `system.system_diff_items`. |
| **08** | `08_assign_statuses.sql` | Merge latest F1+F2 per candidate → update **`staging.match_status`**, **`staging.auto_action`**, **`staging.review_status`**. **Bulk fast path** when all F2 items are `insert_candidate` (skips heavy F1 combine). **`RAISE NOTICE`** progress per step. Classification pass for places/addresses/links. Uses **`work_mem` 512MB** locally; apply migration **`007_system_diff_items_diff_run_local_entity_idx.sql`** once for large diffs. |
| **08b** | `08b_assign_import_class.sql` | Final local **`import_class`** / **`import_class_reason`** from latest F2 + validation (family thresholds; no core writes). |
| **09** | `09_create_review_views.sql` | `CREATE OR REPLACE` convenience views (`v_no_conflict_*`, `v_review_*`, …). |
| **10** | `10_summary_report.sql` | Read-only snapshot summary (counts by entity family / views). |
| **11 (J)** | `11_prepare_remote_review_package.sql` | Optional: local outbound package → `system.system_remote_review_packages` + `_items`. Runner uses **`replace_package=false`**. |
| **12 (K)** | `12_upload_remote_review_package.ts` | Optional: upload package to **Supabase `import_review` only** (requires `REMOTE_REVIEW_UPLOAD_ENABLED=true`). Chunked upload; preserves reviewed remote rows. |
| **13 (L)** | `13_verify_remote_review_upload.sql` | Optional: local `psql` verification for the same `REMOTE_REVIEW_PACKAGE_NAME`. |
| **`14`** | `14_verify_lineage_alignment.sql` | Optional: lineage QA after **L** when `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true` (local staging ↔ package; **FAIL stops run**). |
| **`15`** | `15_entity_coverage_report.sql` | Optional: read-only coverage + **promotion-readiness** report when `LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true`. |
| **`16`** | `16_source_identity_audit.sql` | Optional read-only identity audit (canonical vs legacy vs null). Uses `ROLLBACK`. |
| **`18`** | `18_classification_bucket_report.sql` | Dry-run `import_class` counts + hard reconciliation assertion (see `docs/osm-pipeline-import-classification.md`). |

Supporting shared helpers:

- `pipeline_entity_families.sql` / `pipeline_entity_families_functions.sql`
- `pipeline_source_identity.sql` — canonical `osm:node|way|relation:<id>` formatter + legacy match keys
- `pipeline_import_classification.sql` — final `import_class` decision helpers + family thresholds
- `source-identity.ts` / `source-identity.test.ts` — TS mirror of the SQL helpers

Stages **11–15** are orchestrated by `run_local_osm_pipeline.sh` after stage 10 when remote-review or coverage flags are set. Details: [Remote review package](#remote-review-package-stages-j--k--l--optional-1415).

### Source identity

New staging rows use:

```text
osm:node:<id> | osm:way:<id> | osm:relation:<id>
```

Production mostly stores legacy `osm:N|W|R:<id>`. Stage **07** matches both via `system.pipeline_osm_identity_key()`. Do not bulk-rewrite production ids.

```bash
# audit (read-only)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/local-osm/16_source_identity_audit.sql

# unit tests
npm run test:osm-source-identity
```

Orchestration: `run_local_osm_pipeline.sh`. Helper scripts: `run_resume_from_stage08.sh`, `run_resume_from_stage12.sh`, `scripts/test_stage08_quick.sh`.

---

## Workflow fields (`match_status`, `auto_action`, …)

After **Stage 05**, staging rows are seeded with:

| Column | Typical initial value |
|--------|------------------------|
| `match_status` | `new_candidate` |
| `auto_action` | `NULL` |
| `review_status` | `pending` |

**Stages 06–07** write **`system.system_diff_items`** (`diff_type`, `auto_action`, `confidence_score`, `before_data` / `after_data`, …).  
**Stage 08** reads the **latest** F1 and F2 diff items for the current `snapshot_version` and **updates staging** with merged outcomes.

### `match_status` (on staging, after Stage 08)

These values drive review queues and exports:

| Value | Meaning (high level) |
|-------|----------------------|
| `manual_protected` | Prod mirror indicates manual / verified protection — do not auto-clobber. |
| `duplicate_candidate` | Likely duplicate of something already in prod (spatial/source mismatch). |
| `needs_review` | Ambiguous or risky — human decision. |
| `matched_auto_update` | Safe path: candidate aligns with an update vs previous snapshot / prod logic. |
| `unchanged` | No substantive change vs baseline comparisons. |
| `new_auto` | New feature candidate (insert path). |
| `delete_candidate` | Gone from extract vs previous snapshot (delete semantics — may special-case `do_not_delete_manual`). |

There is also a pipeline-internal merge key `fallback` when no rule hits (Stage 08 maps that to **`needs_review`** / cautious defaults).

### `auto_action` (on staging, after Stage 08)

Mirrors the **recommended automation** (promotion scripts would consume this; this repo stops short of core writes):

| Value | Typical meaning |
|-------|------------------|
| `insert_candidate` | Propose insert into core (after review). |
| `update_candidate` | Propose update of existing core row. |
| `ignore_unchanged` | No promotion action. |
| `needs_review` | Block auto-promotion. |
| `possible_duplicate` | Investigate duplicate / merge. |
| `protect_manual` | Respect manual prod state. |
| `do_not_delete_manual` | Delete signal overridden by manual policy. |

Exact precedence is implemented in **`08_assign_statuses.sql`** (`merged` / `sig_*` flags and `CASE` ordering: protect → duplicate → needs_review → update → ignore → insert → delete).

### `review_status` (after Stage 08)

| Value | When |
|-------|------|
| `ignored` | Unchanged / ignore path (`sig_ign`). |
| `pending` | Everything else — still in review queue unless you clear it elsewhere. |

### `promotion_status` (places / addresses / links — not set on all families)

Lifecycle for dashboard promotion (local staging + mirrored on `import_review` after Stage K):

| Value | Meaning |
|-------|---------|
| `not_ready` | Default after Stage 08 — eligible for review, **not** for auto-promotion |
| `ready` | Reviewer/tooling marked ready (downstream) |
| `batched` / `promoting` / `promoted` / `failed` / `skipped` | Promotion workflow states (set outside this pipeline) |

Stage **08** never sets `promoted`. Rows already **`promoted`** are left unchanged on re-run. Stage **J** skips **`promotion_status = 'promoted'`** staging rows.

### F1 `diff_type` (in `system.system_diff_items`, Stage 06)

Legacy item types (kept for Stage 08): `new`, `changed`, `unchanged`, `deleted_candidate`.

Staging writeback `source_status`: `source_new`, `source_changed`, `source_unchanged`  
(`deleted_candidate` → report as `source_missing`).

Compare mode: `pipeline_osm_identity_key(external_id)` + `normalized_hash`.

---

## Review views

**Stage 09** builds views over **`staging.*_candidates`** (when tables exist). Filters use **`match_status`**:

| View pattern | Rows included |
|--------------|----------------|
| **`staging.v_no_conflict_*`** | `match_status IN ('new_auto', 'matched_auto_update', 'unchanged')` |
| **`staging.v_review_*`** | `match_status IN ('needs_review', 'conflict', 'duplicate_candidate', 'delete_candidate')` |
| **`staging.v_manual_protected_*`** | `match_status = 'manual_protected'` |

Entity coverage is defined in **`09_create_review_views.sql`** / **`10_summary_report.sql`** manifests (places, roads, buildings, …).

---

## Scores (`confidence_score`)

- Staging **`confidence_score`** is on a **0–100** scale (aligned with production core), **not** 0–1 fractions.
- Pipeline defaults and fallbacks in **`05_*`**, **`06_*`**, **`07_*`** use that scale.
- Read-only check: **`setup/check_score_scale_0_100.sql`**.

---

## Optional scripts (`setup/`)

| Script | Purpose |
|--------|---------|
| `setup/normalize_existing_staging_scores_0_100.sql` | One-off migration of legacy fractional scores + widen columns (local staging). |
| `setup/force_fix_remaining_scores_0_100.sql` | Narrow focused fix for specific candidate tables. |
| `setup/check_score_scale_0_100.sql` | Validation only (no DDL/DML). |

After dropping views for `ALTER` safety, recreate review views:

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 09_create_review_views.sql
```

Local DDL alignment (constraints / `numeric(6,2)`): **`infrastructure/database/migrations/local/`** (e.g. `005_local_confidence_score_scale_0_100.sql`).

---

## Re-running and resuming stages

Environment: **`set -a && source imports/your.env && set +a`** from `tools/data-pipeline/local-osm`, then run the snippet you need.

### Resume helpers (`PIPELINE_FROM_STAGE`)

| Script / env | Use when |
|--------------|----------|
| `./run_resume_from_stage08.sh imports/your.env` | Stages **01–07** already completed; rerun **08 → end** |
| `./run_resume_from_stage12.sh imports/your.env` | Stage **J** package already prepared; rerun **K → L** (+ **14**/**15** if enabled) |
| `PIPELINE_FROM_STAGE=05 ./run_local_osm_pipeline.sh imports/your.env` | Any stage number **00–15** (remote-review sub-stages **11–14** gated individually) |
| `./scripts/test_stage08_quick.sh imports/your.env` | **Stage 08 only** (~1 min timing check for large road runs) |

Optional performance for heavy SQL stages:

```bash
PIPELINE_PSQL_WORK_MEM=1GB PIPELINE_PSQL_MAINTENANCE_WORK_MEM=2GB PIPELINE_FROM_STAGE=08 ./run_local_osm_pipeline.sh imports/your.env
```

### Manual single-stage examples

- **Boundary only:** `./00_register_boundary.sh` (with env sourced).
- **Stage B only:** `bash 02_import_to_tmp.sh`.
- **Stage C only:** `psql … -f 03_validate_tmp.sql` (uses `TMP_IMPORT_SCHEMA`).
- **Stage A snapshot:** `psql … -f 01_create_snapshot.sql` with `-v source_code=… -v batch_name=… -v snapshot_ref=… -v snapshot_version=… -v region_code=… -v checksum=… -v boundary_id=… -v allow_boundary_update=…` (see `run_local_osm_pipeline.sh`).

Stages **05–07** need the same **`-v`** variables as **`run_sql`** in `run_local_osm_pipeline.sh` (`snapshot_version`, `region_code`, schema overrides, **`entity_families`**).  
Stages **08–11**, **13–15** need at least **`-v snapshot_version=…`** and **`entity_families=…`** when not using `all`.

**Stage J replace (overwrite package):** runner always uses `replace_package=false`. To rebuild the same package name:

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema="${STAGING_SCHEMA:-staging}" \
  -v entity_families="${ENTITY_FAMILIES:-all}" \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v replace_package=true \
  -f 11_prepare_remote_review_package.sql
```

**Stages J/K/L/`14`/`15`:** normally via the runner; see [Remote review package](#remote-review-package-stages-j--k--l--optional-1415). Stage **K** alone: `npx tsx ./12_upload_remote_review_package.ts` from repo root with env sourced. Stage **L** needs `-v package_name='your_pkg'`. Details: **`README_REMOTE_REVIEW.md`**.

---

## Related docs

- **`NAMINGENV.md`** — env filename, `SNAPSHOT_VERSION`, `BATCH_NAME`, `REMOTE_REVIEW_PACKAGE_NAME`, `PIPELINE_FROM_STAGE`, optional flags for stages **14**/**15**.
- **[`README_REMOTE_REVIEW.md`](README_REMOTE_REVIEW.md)** — lineage field matrix, dry-run/capped upload, `replace_package`, Stage K idempotency, Supabase QA snippets.
- **`infrastructure/database/docs/system_tracking_workflow.md`** — snapshots, diffs, workflow (local vs Supabase).
- **`infrastructure/database/migrations/local/`** — local schema DDL.
- **`infrastructure/database/seeds/local/`** — system source registry seeds.

---

## Safety boundaries

- **Do not** point `LOCAL_DATABASE_URL` at production unless you intend to.
- When **`REMOTE_REVIEW_UPLOAD_ENABLED=true`**, **`SUPABASE_DATABASE_URL`** drives **Stage K** inserts into **`import_review` only** (not `core`). Still use a credential-scoped DB user if possible.
- **Do not** INSERT/UPDATE/DELETE **`core`** from these scripts.
- Default pipeline touches **local** schemas (`tmp_import`, `raw`, `staging`, `system`) through stage 10, then **`system`** remote-review tables in Stage **J**, then optional Supabase **`import_review`** in Stage **K**, then optional local verification **L** / lineage **14** / coverage **15** — **still no core promotion** from `run_local_osm_pipeline.sh`.
- **`14_verify_lineage_alignment.sql`** is **read-mostly local verification** (`staging` plus `system.*` linkage). Manual Supabase `import_review` parity checks live in **`README_REMOTE_REVIEW.md`** (nothing in **`14`** auto-connects to Supabase).