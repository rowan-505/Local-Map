# Remote review & lineage (Stages 11–15)

This document describes how **local staging**, the **local outbound package** (`system.system_remote_review_*`), **Supabase `import_review.*`**, and **future `core.*` promotion** stay aligned on lineage. It supplements `README.md` in this folder.

For **`ENTITY_FAMILIES`**, operating modes (dry-run, resume, overwrite), and the admin-before-roads promotion order, see **`README.md`** § [Operating modes](README.md#operating-modes), [Entity-specific pipeline runs](README.md#entity-specific-pipeline-runs), and [Classified place / address families](README.md#classified-place--address-families).

**Hard rules**

- **Do not** promote to `core` from these scripts.
- **Do not** modify `core.*` from the local OSM pipeline or from `import_review` migrations in this repo unless a separate approved workflow says otherwise.
- **Stage K** writes **`import_review.*` only** — never **`core.*`**. Core promotion is dashboard/API workflow after review.
- Verification SQL is meant to be **run deliberately** (operators or CI), not hidden side effects.

---

## Operating modes (remote review)

| Mode | Configuration | Stages |
|------|---------------|--------|
| **Full upload** | `REMOTE_REVIEW_UPLOAD_ENABLED=true` + `REMOTE_REVIEW_PACKAGE_NAME` + `SUPABASE_DATABASE_URL` | J → K → L |
| **Local dry path** | `REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true` + `REMOTE_REVIEW_PACKAGE_NAME` | J → L (no Supabase) |
| **Smoke / capped upload** | Above + `REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=N` | J and K process at most **N** rows per family |
| **Lineage QA** | + `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true` | + **14** after L |
| **Coverage report** | + `LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true` | + **15** after remote-review block |
| **Resume upload only** | `PIPELINE_FROM_STAGE=12` or `./run_resume_from_stage12.sh` | Skips **J**, runs K → L (+ 14/15) |

### Conflict-only packages (default)

Stage **J** defaults to **`conflict_only=true`** (`REMOTE_REVIEW_CONFLICT_ONLY`, default true).

Upload to Supabase `import_review` only human-decision classes:

| Upload | Skip |
|--------|------|
| `duplicate`, `conflict`, `manual_protected`, `verified_conflict`, `possible_delete` | `safe_new`, `safe_update`, `unchanged`, `invalid` |

Stable package name (recommended): `remote_review_conflicts_<SNAPSHOT_VERSION>`.

Same-name + same-snapshot rebuild **auto-replaces** the local package (idempotent Stage J refresh). Payload includes `import_class`, `imported_values`, compact `core_snapshot`, `difference_summary`, `matched_core_id` when available, `review_status=pending`, `review_decision=null`, and `promotion_status=not_ready`.

Before package commit, Stage J asserts:

`valid = direct-core + unchanged + import-review conflicts`

After Stage K, Stage L asserts package item count equals remote `import_review` count for that batch.

### Package replace (`replace_package`)

| Context | Behavior |
|---------|----------|
| **`run_local_osm_pipeline.sh`** | Always `-v replace_package=false`. For **conflict-only** packages, same name + same snapshot **auto-replaces** locally. Legacy full packages still fail if the name exists. |
| **Manual rebuild** | Re-run `11_prepare_remote_review_package.sql` with **`-v replace_package=true`** — deletes the existing package row (cascade items) and recreates. |
| **New name** | Pick a new `REMOTE_REVIEW_PACKAGE_NAME` (recommended for parallel experiments / legacy full packages). |

### Stage K re-upload (overwrite vs preserve)

Stage **K** is **idempotent** on `(review_batch_id, local_staging_id)`:

- **Pending** remote rows (`review_decision IS NULL`, `review_status IN ('pending','needs_review')`) — **refreshed** from the local package on re-upload.
- **Reviewed** remote rows — **preserved** (source fields not overwritten).

Upload runs in **transactions of 500 rows** per family with console progress (`[family roads] progress 500/822520 …`). Large national packages (800k+ roads) are expected; allow sufficient runtime.

Stage **K** CLI/env filters apply **after** loading the full local package into memory; family caps use a per-family loop (safe for large slices).

---

## Entity-specific pipeline runs

Set **`ENTITY_FAMILIES`** in the import env (and optionally **`REMOTE_REVIEW_ENTITY_FAMILY`** for Stage K) to scope the whole remote-review path to admin areas, roads, or both.

| Value | Local stages (05–11, 13–15) | Stage K upload target |
|-------|----------------------------|------------------------|
| `admin_areas` | Only `staging_admin_area_candidates` + package items | `import_review.admin_area_candidates` |
| `roads` | Only `staging_road_candidates` + package items | `import_review.road_candidates` |
| `admin_areas,roads` | Both families | Both candidate tables (families with zero package rows are skipped) |
| `places`, `addresses`, `address_components`, `place_address_links` | Classified POI/address workflow (Stage 08 classification pass) | Matching `import_review.*_candidates` tables |
| `all` | All configured families | All families present in the package |

**Stage J coupling:** selecting `addresses` also enables **`address_components`** export; selecting **both** `places` and `addresses` (or explicit `place_address_links`) enables **place–address link** export. See `system.pipeline_stage11_family_enabled` in `pipeline_entity_families_functions.sql`.

Example:

```bash
export ENTITY_FAMILIES=admin_areas
export REMOTE_REVIEW_ENTITY_FAMILY=admin_areas
export REMOTE_REVIEW_PACKAGE_NAME=remote_review_pkg_admin_v1
export REMOTE_REVIEW_UPLOAD_ENABLED=true

./run_local_osm_pipeline.sh imports/myanmar_admin_only_2026_06_03.env
```

Stage K CLI (same filter semantics):

```bash
npx tsx ./12_upload_remote_review_package.ts \
  --package-name="$REMOTE_REVIEW_PACKAGE_NAME" \
  --entity-family=admin_areas

npx tsx ./12_upload_remote_review_package.ts \
  --package-name="$REMOTE_REVIEW_PACKAGE_NAME" \
  --entity-family=roads

npx tsx ./12_upload_remote_review_package.ts \
  --package-name="$REMOTE_REVIEW_PACKAGE_NAME" \
  --entity-family=admin_areas,roads
```

Stage **L** reports **`family_upload_summary`**: local package count vs remote uploaded count **per selected family** (`-v entity_families=…`).

### Local vs Supabase vs core

```text
PBF → tmp_import → raw → staging → system (package)     [local PostgreSQL only]
                              ↓
                    Stage K → import_review.*             [Supabase review workspace]
                              ↓
                    Dashboard/API promotion → core.*      [later; not this pipeline]
```

- **Local-osm** never writes Supabase **`core`**. Local schemas are **`tmp_import`**, **`raw`**, **`staging`**, and **`system`** only.
- **`import_review`** is the handoff surface for remote reviewers. **`confidence_score`** stays on the **0–100** scale end-to-end.
- **Admin hierarchy** (parent/child admin levels, `parent_id`) must be finalized **after admin area candidates are promoted to `core.core_admin_areas`** in Supabase. Do not assume a full hierarchy pass on local staging replaces that step.
- **Road `admin_area_id`**: upload may carry null or staging-local hints. After **`core.core_admin_areas`** exists in Supabase, **recalculate `admin_area_id` on road candidates (or promoted streets) in Supabase** using core admin geometry — local staging IDs do not substitute for production core FKs.

Recommended sequence for a new region:

1. `ENTITY_FAMILIES=admin_areas` → J → K → review → **promote admin to core**
2. Run hierarchy / parent resolution against **Supabase core** admin rows
3. `ENTITY_FAMILIES=roads` (or `admin_areas,roads` for re-package) → J → K → review → promote roads
4. **Recalculate road `admin_area_id` in Supabase** against promoted core admin polygons

---

## Files

| Step | File | Database |
|------|------|----------|
| **J** | `11_prepare_remote_review_package.sql` | Local only — `system.system_remote_review_packages` + `_items` |
| **K** | `12_upload_remote_review_package.ts` | Supabase only — `import_review.review_batches` + `*_candidates` |
| **L** | `13_verify_remote_review_upload.sql` | Local or Supabase — Part A local package; Part B `import_review`; Part C coverage report |
| **14** (optional) | `14_verify_lineage_alignment.sql` | Local — staging ↔ package + payload mirrors; after L via `REMOTE_LINEAGE_ALIGNMENT_VERIFY` |
| **15** (optional) | `15_entity_coverage_report.sql` | Local — staging health + `stage15_promotion_readiness`; via `LOCAL_ENTITY_COVERAGE_REPORT_ENABLED` |

Orchestration: `run_local_osm_pipeline.sh`. Resume: `run_resume_from_stage12.sh` (`PIPELINE_FROM_STAGE=12`).

---

## Lineage field contract (candidates / package items)

Canonical names below match **Supabase `import_review` candidate columns** and the **local upload path** in `12_upload_remote_review_package.ts`.

| Field | Local `system_remote_review_package_items` | `import_review.*_candidates` | Notes |
|-------|--------------------------------------------|-------------------------------|-------|
| `source_snapshot_version` | On **package** (`snapshot_version`); duplicated on each Supabase row | `source_snapshot_version NOT NULL` | Stage K copies from package `snapshot_version`. |
| `source_snapshot_id_local` | On **package** (`source_snapshot_id` → `system.system_source_snapshots.id`) | `source_snapshot_id_local` (nullable DDL; **set by K**) | Local package row is the source of truth for the bigint id used in staging FKs. |
| `local_staging_id` | `local_staging_id` | `local_staging_id NOT NULL` | Join key to `staging_*_candidates.id`. |
| `entity_family` | `entity_family`, `source_table` | `entity_family NOT NULL` | Twelve upload families in `remote-review-entity-config.ts` (includes `address_components`, `place_address_links`). |
| `external_id` | `external_id` | `external_id` | OSM / natural id; may be null for edge cases (**WARN** in Stage 14, not FAIL). |
| `source_refs` | `source_refs` (jsonb, default `{}`) | `source_refs NOT NULL` default `{}` | |
| `normalized_data` | `normalized_data` (jsonb, default `{}`) | `normalized_data NOT NULL` default `{}` | |
| `review_batch_id` | Same as `remote_review_batch_id` on **package** after K | `review_batch_id NOT NULL` FK | Not a column on package **items**; join via package or remote row. |
| `matched_core_id` | `matched_core_id` | `matched_core_id` | Optional until a core match exists. |
| `matched_core_table` | `matched_core_table` | `matched_core_table` | Expected slugs from Stage J: **`core_buildings`**, **`core_places`**, **`core_streets`**. |
| `matched_core_data` | `matched_core_data` | `matched_core_data` | F2 / mirror payload; may be null. |
| `f2_comparison` | `f2_comparison` | `f2_comparison` | Often null when no diff row; counted as **WARN** in Stage 14. |

Stage J also writes **redundant mirrors** into each item **`payload`** JSON for cheap audits:

- `source_snapshot_version`
- `snapshot_version` (same string; historical key)
- `source_snapshot_id_local`
- `family` (entity family slug)

---

## Compatibility matrix (staging → package → import_review → core targets)

| Concept | Staging (local) | Local package | Supabase `import_review` | Intended `core.*` target(s) |
|---------|-----------------|---------------|--------------------------|-------------------------------|
| Buildings | `staging.staging_building_candidates` | `_items` (`buildings`) | `import_review.building_candidates` | `core.core_buildings` |
| Places | `staging.staging_place_candidates` | `_items` (`places`) | `import_review.place_candidates` | `core.core_places` (+ child names in `normalized_data`) |
| Roads | `staging.staging_road_candidates` | `_items` (`roads`) | `import_review.road_candidates` | `core.core_streets` |
| Landuse | `staging.staging_landuse_candidates` | `_items` (`landuse`) | `import_review.land_area_candidates` | `core.core_land_areas` |
| Water lines | `staging.staging_water_line_candidates` | `_items` (`water_lines`) | `import_review.water_line_candidates` | `core.core_water_lines` |
| Water polygons | `staging.staging_water_polygon_candidates` | `_items` (`water_polygons`) | `import_review.water_polygon_candidates` | `core.core_water_polygons` |
| Addresses | `staging.staging_address_candidates` | `_items` (`addresses`) | `import_review.address_candidates` | `core.core_addresses` (+ `address_components` in `normalized_data`) |
| Admin areas | `staging.staging_admin_area_candidates` | `_items` (`admin_areas`) | `import_review.admin_area_candidates` | `core.core_admin_areas` (+ `names` in `normalized_data`) |
| Routing barriers | `staging.staging_routing_barrier_candidates` | `_items` (`routing_barriers`) | `import_review.routing_barrier_candidates` | (no core DDL yet) |

**Not in this pipeline:** transport families (bus stops/routes). Transport data now lives in `transport.*` and is loaded by a separate direct-upsert path, not via OSM staging/import-review.

Stage K upload entity mapping: `remote-review-entity-config.ts`.

**Stage K filters (CLI or env):**

```bash
# all families in package (default)
REMOTE_REVIEW_ENTITY_FAMILY=all

# admin areas only → import_review.admin_area_candidates
npx tsx ./12_upload_remote_review_package.ts --entity-family=admin_areas

# roads only → import_review.road_candidates
npx tsx ./12_upload_remote_review_package.ts --entity-family=roads

# both (skips families with zero package_items)
npx tsx ./12_upload_remote_review_package.ts --entity-family=admin_areas,roads

# legacy subset example
npx tsx ./12_upload_remote_review_package.ts --entity-family=buildings,places

# safe test cap per family
npx tsx ./12_upload_remote_review_package.ts --entity-family=admin_areas --max-rows-per-family=10
```

Align **`REMOTE_REVIEW_ENTITY_FAMILY`** with **`ENTITY_FAMILIES`** in the import env when running entity-scoped pipeline imports. Stage **12** also reads **`ENTITY_FAMILIES`** if **`REMOTE_REVIEW_ENTITY_FAMILY`** is unset.

Promotion is **future work**; preserve at minimum:

- `review_candidate_id` (import-review workflow key; not durable Core lineage)
- `external_id`, `source_refs`, `normalized_data`
- `source_snapshot_version` as a column **or** embedded in `source_refs` / `normalized_data`
- **`confidence_score`** on **0–100** (matching `import_review` check constraints)

---

## Stage J eligibility (relaxed)

Stage J exports review-ready staging rows for the current `source_snapshot_id` when:

- `review_status` is null or in the allowed review set, and
- row is not `promotion_status = 'promoted'`, and
- either **`match_status` and `auto_action` are both set**, or the row has useful data (geometry, non-empty `normalized_data`/`source_refs`, or `external_id`).

Rows with null `match_status` / `auto_action` are packaged with defaults: `match_status = 'needs_review'`, `auto_action = 'needs_review'`, `review_status = 'pending'`.

**Classified families:** places/addresses/links carry `source_classification`, `address_strength`, `validation_status`, and `promotion_status` in `normalized_data` / dedicated columns — mirrored into package items and Supabase on upload.

Package `summary.staging_eligible_counts` compares staging eligibility vs `counts_by_entity_family` after each Stage J run.

### Custom family promotion (outside this pipeline)

This repo **prepares and uploads** candidates only. Per-family promotion to **`core.*`** is intentional separate work:

| Priority (Stage 15 comments) | Family | Notes |
|------------------------------|--------|-------|
| P0 | `buildings` | Full review + promotion path in dashboard |
| P1 | `places` | Review UI; Stage J/K + promotion |
| P2 | `landuse`, `water_*` | Map layers, lower risk |
| P3 | `bus_stops` | + names |
| P4 | `roads` | Review exists; defer bulk promotion (routing graph risk) |
| P5+ | `admin_areas`, `addresses`, routing | Highest complexity |

Stage **15** `stage15_promotion_readiness` reports blockers (missing geometry, unmapped component types, etc.) — it does **not** promote.

---

## Expected counts (Kyauktan v2 snapshot example)

After a full 10-family Stage J + K run for `osm_myanmar_2026_05_15_kyauktan_v2`:

| Entity family | Expected rows |
|---------------|---------------|
| buildings | 1402 |
| places | 232 |
| roads | 1400 |
| bus_stops | 52 |
| landuse | 68 |
| water_lines | 27 |
| water_polygons | 23 |
| addresses | 45 |
| admin_areas | 21 |
| routing_barriers | 15 |
| **Total** | **3285** |

Stage **13** Part C `coverage_report` compares `staging_eligible`, `package_items`, and `remote_uploaded` per family. Set `-v fail_on_coverage_gap=false` to report without raising.

---

## Commands (operators)

### 0. Resume from Stage K (package already prepared)

```bash
cd tools/data-pipeline/local-osm
source imports/your_import.env

./run_resume_from_stage12.sh imports/your_import.env
# equivalent:
PIPELINE_FROM_STAGE=12 ./run_local_osm_pipeline.sh imports/your_import.env
```

Requires the same `REMOTE_REVIEW_PACKAGE_NAME`, `SNAPSHOT_VERSION`, and `SUPABASE_DATABASE_URL` as the original run. Stage **J** is skipped.

### 1. Prepare package (Stage J — local)

```bash
cd tools/data-pipeline/local-osm
source imports/kyauktan_2026_05_15_v2.env   # or your import env

PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v region_code="$REGION_CODE" \
  -f ./11_prepare_remote_review_package.sql

# Capture package_name from output → export REMOTE_REVIEW_PACKAGE_NAME=...
```

Replace an existing package name safely (**overwrite enable**):

```bash
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v staging_schema="${STAGING_SCHEMA:-staging}" \
  -v entity_families="${ENTITY_FAMILIES:-all}" \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v replace_package=true \
  -f ./11_prepare_remote_review_package.sql
```

### 2. Upload (Stage K)

**Full upload:**

```bash
export REMOTE_REVIEW_UPLOAD_ENABLED=true
npx tsx ./12_upload_remote_review_package.ts --entity-family=all
```

**Dry-run / smoke test cap** (does not skip Supabase — limits row count):

```bash
export REMOTE_REVIEW_MAX_ROWS_PER_FAMILY=5
npx tsx ./12_upload_remote_review_package.ts \
  --package-name="$REMOTE_REVIEW_PACKAGE_NAME" \
  --entity-family=roads \
  --max-rows-per-family=5
```

**Local-only dry path** (no Supabase at all):

```bash
export REMOTE_REVIEW_PREPARE_VERIFY_ONLY=true
export REMOTE_REVIEW_PACKAGE_NAME=your_pkg
./run_local_osm_pipeline.sh imports/your_import.env
```

Upload only selected families:

```bash
npx tsx ./12_upload_remote_review_package.ts \
  --entity-family=bus_stops,landuse,water_lines,water_polygons,addresses,admin_areas,routing_barriers
```

### 3. Verify (Stage L)

Part A + coverage (local):

```bash
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v entity_families="${ENTITY_FAMILIES:-all}" \
  -f ./13_verify_remote_review_upload.sql
```

Part B + coverage (Supabase):

```bash
PAGER=cat psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v entity_families="${ENTITY_FAMILIES:-all}" \
  -f ./13_verify_remote_review_upload.sql
```

Inspect **`family_upload_summary`** for local vs remote counts per selected family. Run both connections and compare `coverage_report` sections for a full picture.

### Local — Stage 14 (lineage QA)

Requires a package row from Stage J and the same `REMOTE_REVIEW_PACKAGE_NAME` / `package_name`.

```bash
cd tools/data-pipeline/local-osm
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v staging_schema="${STAGING_SCHEMA:-staging}" \
  -v snapshot_version="$SNAPSHOT_VERSION" \
  -v package_name="$REMOTE_REVIEW_PACKAGE_NAME" \
  -v entity_families="${ENTITY_FAMILIES:-all}" \
  -f ./14_verify_lineage_alignment.sql
```

`-v snapshot_version=` ties the package row to your import env (**must match** `system.system_remote_review_packages.snapshot_version`).  
If you created the package **before** Stage J started writing `payload.source_snapshot_*` mirrors, **re-run Stage J** (or delete/recreate the package) before expecting **`14`** to pass the payload checks.

**Pipeline:** add to the same import `.env`:

```bash
export REMOTE_LINEAGE_ALIGNMENT_VERIFY='true'
```

Runs **automatically after Stage L** whenever Stages **11–13** run (`REMOTE_REVIEW_UPLOAD_ENABLED` **or** `REMOTE_REVIEW_PREPARE_VERIFY_ONLY`) and `REMOTE_LINEAGE_ALIGNMENT_VERIFY=true`.

### Stage 15 — promotion-readiness coverage (optional)

```bash
export LOCAL_ENTITY_COVERAGE_REPORT_ENABLED=true
./run_local_osm_pipeline.sh imports/your_import.env
```

Or run SQL directly after a successful import. Inspect **`stage15_promotion_readiness`** in the output.

Stage **13** Part B can also be run on Supabase for remote counts; see commands above.

### Supabase — manual **`import_review`** checks

Use **`SUPABASE_DATABASE_URL`** from your secrets store (never log the password). Tie batches with:

`review_batches.batch_name = <REMOTE_REVIEW_PACKAGE_NAME>`

Example — batch header:

```sql
SELECT id,
       batch_name,
       source_snapshot_version,
       source_snapshot_id_local,
       entity_families,
       total_candidate_count,
       uploaded_candidate_count,
       status,
       uploaded_at
  FROM import_review.review_batches
 WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
 ORDER BY uploaded_at DESC
 LIMIT 5;
```

Example — rollup lineage gaps on **all three** candidate tables:

```sql
WITH b AS (
    SELECT id
      FROM import_review.review_batches
     WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
     ORDER BY id DESC
     LIMIT 1
),
u AS (
    SELECT 'buildings'::text AS fam,
           c.source_snapshot_version,
           c.source_snapshot_id_local,
           c.entity_family,
           c.local_staging_id,
           c.normalized_data,
           c.source_refs,
           c.review_batch_id,
           c.external_id,
           c.confidence_score,
           c.f2_comparison
      FROM import_review.building_candidates c
     INNER JOIN b ON b.id = c.review_batch_id
    UNION ALL
    SELECT 'places'::text AS fam,
           p.source_snapshot_version,
           p.source_snapshot_id_local,
           p.entity_family,
           p.local_staging_id,
           p.normalized_data,
           p.source_refs,
           p.review_batch_id,
           p.external_id,
           p.confidence_score,
           p.f2_comparison
      FROM import_review.place_candidates p
     INNER JOIN b ON b.id = p.review_batch_id
    UNION ALL
    SELECT 'roads'::text AS fam,
           r.source_snapshot_version,
           r.source_snapshot_id_local,
           r.entity_family,
           r.local_staging_id,
           r.normalized_data,
           r.source_refs,
           r.review_batch_id,
           r.external_id,
           r.confidence_score,
           r.f2_comparison
      FROM import_review.road_candidates r
     INNER JOIN b ON b.id = r.review_batch_id
)
SELECT
    sum((trim(source_snapshot_version) = '') OR source_snapshot_version IS NULL)::int       AS missing_source_snapshot_version,
    sum(source_snapshot_id_local IS NULL)::int                                               AS missing_source_snapshot_id_local,
    sum((trim(entity_family) = '') OR entity_family IS NULL)::int                            AS missing_entity_family,
    sum(local_staging_id IS NULL)::int                                                       AS missing_local_staging_id,
    sum(normalized_data IS NULL)::int                                                        AS nd_null,
    sum(source_refs IS NULL)::int                                                             AS sr_null,
    sum(review_batch_id IS NULL)::int                                                        AS missing_review_batch_id,
    sum((confidence_score IS NOT NULL AND (confidence_score < 0 OR confidence_score > 100))::int)
                                                                                           AS bad_confidence
FROM u;
```

**WARN-style** aggregates (often sparse):

```sql
-- extend the SELECT list above:
-- sum((external_id IS NULL OR trim(external_id) = '')::int) AS blank_external_id,
-- sum((f2_comparison IS NULL)::int)                           AS blank_f2,
```

`core.*` parity checks intentionally live in promotion / publish-batch tooling—not here—to avoid stray writes.

---

## Defaults & env naming

See **`NAMINGENV.md`** checklist for **`REMOTE_LINEAGE_ALIGNMENT_VERIFY`** next to **`REMOTE_REVIEW_PACKAGE_NAME`** and **`imports/template.full.env`** for copy-paste examples.
