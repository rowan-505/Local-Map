# Local OSM data pipeline

Automation for importing OpenStreetMap extracts into a **local** PostgreSQL/PostGIS database. This folder prepares extraction → raw → staging → diff → review; it does **not** write **`core`** from this pipeline. Optionally, after Stage 10, it can populate local **`system.system_remote_review_***` tables and upsert **`import_review` on Supabase** (never `core`), and optionally run lineage QA SQL (`14`).

## Contents

- [Layer model](#layer-model)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration-one-full-env-file-per-import)
- [Run the full pipeline](#run-the-full-pipeline)
- [Remote review package (Stages J / K / L + optional 14)](#remote-review-package-stages-j--k--l--optional-14)
- [Logs and debugging](#logs-and-debugging)
- [Pipeline stages](#pipeline-stages)
- [Workflow fields (`match_status`, `auto_action`, …)](#workflow-fields-match_status-auto_action-)
- [Review views](#review-views)
- [Scores (`confidence_score`)](#scores-confidence_score)
- [Optional scripts (`setup/`)](#optional-scripts-setup)
- [Re-running individual stages](#re-running-individual-stages)
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

Import boundaries live in `system.system_import_boundaries` and are linked from `system.system_source_snapshots.boundary_id`. The pipeline reuses an existing boundary when the same `boundary_ref` + checksum or `boundary_code` + `boundary_version` is already registered.

Promotion to `core` and sync to production are **out of scope** here.

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
| `REGION_CODE` | Scope (e.g. `MM-KYAUKTAN`) |
| `PBF_PATH` | Absolute path to `.osm.pbf` |
| `BOUNDARY_GEOJSON_PATH` | Absolute path to import boundary GeoJSON |
| `BOUNDARY_CODE` | Stable boundary key |
| `BOUNDARY_NAME` | Human-readable boundary name |
| `BOUNDARY_VERSION` | Boundary version (with `BOUNDARY_CODE`, for reuse) |
| `SNAPSHOT_REF` | File label stored on `system.system_source_snapshots` |
| `SNAPSHOT_VERSION` | **Globally unique** snapshot version (see `NAMINGENV.md`) |
| `BATCH_NAME` | `system.system_import_batches.batch_name` |
| `OSM2PGSQL_FLEX_FILE` | Path to flex Lua (e.g. `lua/osm2pgsql_tmp_import.lua`) |
| `LOG_DIR` | Directory for pipeline logs (runner creates it if missing) |

**Checksums:** `CHECKSUM` is **not** set in the env file. The runner hashes `PBF_PATH`; `00_register_boundary.sh` hashes the boundary GeoJSON (`shasum -a 256`).

**Optional overrides** (see `imports/template.full.env`):

- `TMP_IMPORT_SCHEMA`, `RAW_SCHEMA`, `STAGING_SCHEMA`, `SYSTEM_SCHEMA`
- `OSM2PGSQL` — osm2pgsql binary name/path
- `PSQL_EXTRA_ARGS` — extra flags passed to every pipeline `psql` invocation
- `ALLOW_BOUNDARY_UPDATE` — snapshot ↔ boundary linking behavior in `01_create_snapshot.sql`

Naming conventions: **`NAMINGENV.md`**.

**Do not commit** real `imports/*.env` files (passwords). Only `template.full.env` is tracked.

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
REMOTE_REVIEW_UPLOAD_ENABLED=true REMOTE_REVIEW_PACKAGE_NAME=my_pkg ./run_local_osm_pipeline.sh imports/your_import.env

REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true REMOTE_REVIEW_PACKAGE_NAME=my_pkg ./run_local_osm_pipeline.sh imports/your_import.env
```

---

## Remote review package (Stages J / K / L + optional 14)

After **Stage 10**, `run_local_osm_pipeline.sh` can run additional artifacts (**order is fixed**):

| Stage | File | Role |
|-------|------|------|
| **J (11)** | `11_prepare_remote_review_package.sql` | **Local DB only.** Builds/replaces rows in `system.system_remote_review_packages` and `_items` from staging + latest F2 slice. |
| **K (12)** | `12_upload_remote_review_package.ts` | **Supabase only (`import_review`).** Upserts `import_review.review_batches` and family candidate tables keyed by `(review_batch_id, local_staging_id)`. Needs Node + `tsx` (repo-root `npm` deps). **Does not** write `core` or local staging. |
| **L (13)** | `13_verify_remote_review_upload.sql` | **Local DB only.** Read-only-ish checks (`psql`) that local package linkage and counts look sane vs `REMOTE_REVIEW_PACKAGE_NAME`. |
| **`14` (optional)** | `14_verify_lineage_alignment.sql` | **Local DB only.** Staging ↔ package item lineage, payload mirrors, post-upload stamps. Runs when **`REMOTE_LINEAGE_ALIGNMENT_VERIFY=true`** immediately **after Stage L**. **FAIL rows stop the bash runner** (`ON_ERROR_STOP` + cast guard). |

**Note:** Stage J is **`.sql`**, not `.ts`.

**Lineage matrix + Supabase copy-paste SQL:** [`README_REMOTE_REVIEW.md`](README_REMOTE_REVIEW.md).

### When these run

| Env flag | Stages executed | Requires |
|----------|-----------------|----------|
| `REMOTE_REVIEW_UPLOAD_ENABLED=true` (or `1` / `yes`) | **J → K → L** (+ optional **`14`**) | `REMOTE_REVIEW_PACKAGE_NAME`, `SUPABASE_DATABASE_URL`, plus standard DB secrets in your env. |
| `REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true` (or `1` / `yes`) | **J → L** only (+ optional **`14`**) | `REMOTE_REVIEW_PACKAGE_NAME` **only** (no Supabase). |
| Neither flag true | **Skip 11–14** | — |

If **both** `REMOTE_REVIEW_UPLOAD_ENABLED` and `REMOTE_REVIEW_PREPARE_VERIFY_ONLY` are “true”, the runner uses the **full upload path** (J → K → L) and logs that choice.

Stage J is invoked as `-v package_name="${REMOTE_REVIEW_PACKAGE_NAME}"` — **the same string becomes** `import_review.review_batches.batch_name` on Supabase during Stage K. Naming guidance: **`NAMINGENV.md` § Remote review package name**.

Optional knobs:

- `REMOTE_LINEAGE_ALIGNMENT_VERIFY` — **`true`** / **`1`** / **`yes`** to run **`14_verify_lineage_alignment.sql`** after **`13`** whenever stages **11–13** run (otherwise skip **`14`**).
- `REMOTE_REVIEW_ENTITY_FAMILY` — `buildings` \| `places` \| `roads` (empty = all implemented families in Stage J).
- `REMOTE_REVIEW_MAX_ROWS_PER_FAMILY` — integer cap per family in J/K filtering.
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
| **00** | `00_register_boundary.sh` | Load boundary into temp storage; insert/reuse `system.system_import_boundaries`. |
| **01** | `01_create_snapshot.sql` | Create/import batch + snapshot row; link `boundary_id`. |
| **02** | `02_import_to_tmp.sh` | osm2pgsql flex → `tmp_import`. |
| **03** | `03_validate_tmp.sql` | Row counts, SRID, geometry sanity (fails fast on bad import). |
| **04** | `04_tmp_to_raw.sql` | Copy snapshot-scoped data into `raw.*`. |
| **05** | `05_raw_to_staging.sql` | Build **staging** candidates (places, roads, buildings, …). |
| **06** | `06_diff_current_vs_previous.sql` | **F1:** diff current vs previous snapshot → `system.system_diff_items`. |
| **07** | `07_compare_with_prod_mirror.sql` | **F2:** compare staging vs local **`prod_mirror`** → more `system.system_diff_items`. |
| **08** | `08_assign_statuses.sql` | Merge latest F1+F2 per candidate → update **`staging.match_status`**, **`staging.auto_action`**, and **`staging.review_status`** (and **`updated_at`** when the column exists). Summary **`SELECT`**s at end of the script show counts by status; merge rationale is computed in a temp table during the run but **not** written onto staging rows unless you extend the script. |
| **09** | `09_create_review_views.sql` | `CREATE OR REPLACE` convenience views (`v_no_conflict_*`, `v_review_*`, …). |
| **10** | `10_summary_report.sql` | Read-only snapshot summary (counts by entity family / views). |
| **11 (J)** | `11_prepare_remote_review_package.sql` | Optional (**see flags below**): local outbound package → `system.system_remote_review_packages` + `_items`. |
| **12 (K)** | `12_upload_remote_review_package.ts` | Optional: upload package to **Supabase `import_review` only** (requires `REMOTE_REVIEW_UPLOAD_ENABLED=true`). |
| **13 (L)** | `13_verify_remote_review_upload.sql` | Optional: local `psql` verification for the same `REMOTE_REVIEW_PACKAGE_NAME`. |
| **`14`** | `14_verify_lineage_alignment.sql` | Optional: lineage QA after **L** when `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true` (local staging ↔ package; **FAIL stops run**). |

Stages **11–13** (**+ optional `14`**) are orchestrated by `run_local_osm_pipeline.sh` after stage 10 when `REMOTE_REVIEW_UPLOAD_ENABLED` or `REMOTE_REVIEW_PREPARE_VERIFY_ONLY` is true. Details: [Remote review package](#remote-review-package-stages-j--k--l--optional-14).

Orchestration: `run_local_osm_pipeline.sh`.

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

### F1 `diff_type` (in `system.system_diff_items`, Stage 06)

Examples: `new`, `changed`, `unchanged`, `deleted_candidate` — snapshot-to-snapshot lineage, not identical to final `match_status`.

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

## Re-running individual stages

Environment: **`set -a && source imports/your.env && set +a`** from `tools/data-pipeline/local-osm`, then run the snippet you need.

Examples already in this file’s history:

- **Boundary only:** `./00_register_boundary.sh` (with env sourced).
- **Stage B only:** `bash 02_import_to_tmp.sh`.
- **Stage C only:** `psql … -f 03_validate_tmp.sql` (uses `TMP_IMPORT_SCHEMA`).
- **Stage A snapshot:** `psql … -f 01_create_snapshot.sql` with `-v source_code=… -v batch_name=… -v snapshot_ref=… -v snapshot_version=… -v region_code=… -v checksum=… -v boundary_id=…` (see older README section or `run_local_osm_pipeline.sh`).

Stages **05–07** need the same **`-v`** variables as **`run_sql`** in `run_local_osm_pipeline.sh` (`snapshot_version`, `region_code`, schema overrides).  
Stages **08–10** need at least **`-v snapshot_version=…`** (schemas default to `staging` / `system` inside the SQL).

**Stages J/K/L/`14`** are normally invoked via the runner; see [Remote review package](#remote-review-package-stages-j--k--l--optional-14). To re-run **J** alone, run `11_prepare_remote_review_package.sql` with the same `-v` flags as in `run_local_osm_pipeline.sh` (search for `11_prepare_remote_review_package`). Stage **L** needs `-v package_name='your_pkg'` (same as `REMOTE_REVIEW_PACKAGE_NAME`). Stage **`14`** also needs `-v staging_schema=` and `-v snapshot_version=` (see **`README_REMOTE_REVIEW.md`**).

---

## Related docs

- **`NAMINGENV.md`** — env filename, `SNAPSHOT_VERSION`, `BATCH_NAME`, optional `REMOTE_REVIEW_PACKAGE_NAME`, optional `REMOTE_LINEAGE_ALIGNMENT_VERIFY`.
- **[`README_REMOTE_REVIEW.md`](README_REMOTE_REVIEW.md)** — lineage field matrix (`staging` ↔ `import_review` ↔ future `core` targets) + Supabase QA snippets.
- **`infrastructure/database/docs/system_tracking_workflow.md`** — snapshots, diffs, workflow (local vs Supabase).
- **`infrastructure/database/migrations/local/`** — local schema DDL.
- **`infrastructure/database/seeds/local/`** — system source registry seeds.

---

## Safety boundaries

- **Do not** point `LOCAL_DATABASE_URL` at production unless you intend to.
- When **`REMOTE_REVIEW_UPLOAD_ENABLED=true`**, **`SUPABASE_DATABASE_URL`** drives **Stage K** inserts into **`import_review` only** (not `core`). Still use a credential-scoped DB user if possible.
- **Do not** INSERT/UPDATE/DELETE **`core`** from these scripts.
- Default pipeline touches **local** schemas (`tmp_import`, `raw`, `staging`, `system`) through stage 10, then **`system`** remote-review tables in Stage **J**, then optional Supabase **`import_review`** in Stage **K**, then optional local lineage QA **`14`** — **still no core promotion** from `run_local_osm_pipeline.sh`.
- **`14_verify_lineage_alignment.sql`** is **read-mostly local verification** (`staging` plus `system.*` linkage). Manual Supabase `import_review` parity checks live in **`README_REMOTE_REVIEW.md`** (nothing in **`14`** auto-connects to Supabase).