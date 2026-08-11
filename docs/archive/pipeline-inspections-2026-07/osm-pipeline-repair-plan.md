# OSM pipeline repair plan

> Historical repair record. The work-schema loader steps recorded below are
> retired evidence, not active architecture or executable guidance.

**Date:** 2026-07-22  
**Scope:** Read-only inspection of the reusable local OSM pipeline and related promotion paths.  
**Status:** Inspection complete; **source-identity adapter implemented 2026-07-22** (no production core rewrite).  
**Live project:** Supabase `locghyuranqaqsnbxflc` (Map Project)  
**Baseline context:** [`tools/data-repair/current-production/PRODUCTION_BASELINE_V1.md`](../tools/data-repair/current-production/PRODUCTION_BASELINE_V1.md)  
**Related inspection:** [`docs/import-review-and-pipeline-inspection.md`](./import-review-and-pipeline-inspection.md)

Legend:

- **Confirmed** = observed in current code and/or live DB (MCP read-only, 2026-07-22)
- **Recommendation** = target repair design (not implemented)

---

## Live production verification (confirmed)

| Metric | Value |
|--------|------:|
| `import_review.*_candidates` (sum of main families) | **0** |
| `import_review.review_batches` | **0** |
| `system.system_source_snapshots` | **9** |
| `system.system_import_batches` | **9** |
| `system.system_source_registry` | **5** |
| `system.system_publish_batches` | **33** (archived **25**, promoted **8**) |
| `system.system_publish_items` | **6015** (pending **36**, success **1811**, failed **1895**, skipped **2273**) |

### Source registry (confirmed)

| `source_code` | Active |
|---------------|--------|
| `osm_myanmar` | yes |
| `manual_dashboard` | yes |
| `government_data` | yes |
| `partner_data` | yes |
| `gtfs_ybs` | yes |

### Snapshots / import batches (confirmed)

All 9 snapshots and batches are lineage registrations from the current-production repair program, not fresh OSM local-osm uploads:

1. `legacy_national_admin_fast_core` / `legacy_admin_fast_core_unknown` — checksum empty; review pipeline bypassed  
2. `legacy_national_road_fast_core` / `legacy_road_fast_core_unknown` — checksum empty; review pipeline bypassed  
3. `repair_*_20260722` waves (admin, links, road class, attrs, names, small core, review backlog)

### Candidate status CHECKs (confirmed)

On every main `import_review.*_candidates` table:

- `review_status`: `pending | approved | rejected | needs_review | ignored | merged | promoted | promotion_failed`
- `promotion_status`: `not_ready | ready | batched | promoting | promoted | failed | skipped`  
  (addresses also allow `duplicate_review_needed`)

There is **no** live CHECK constraint on `match_status` / `auto_action` in `import_review` (pipeline values are free text today).

### Candidate unique constraints (confirmed)

Per family candidate table:

- `UNIQUE (review_batch_id, local_staging_id)`
- `UNIQUE (source_snapshot_version, entity_family, local_staging_id)`
- `review_batches.batch_name` UNIQUE

### Core identity / protection fields (confirmed)

| Family | Core table | `external_id` | Unique on `external_id` | `manual_override` column | `is_verified` |
|--------|------------|---------------|-------------------------|--------------------------|---------------|
| roads | `core.core_streets` | yes | **yes** (partial unique) | **yes** (508 true) | yes (98) |
| admin | `core.core_admin_areas` | yes | **yes** (partial unique) | **no** | yes (421) |
| places | `core.core_places` | yes | index only, **not unique** | **no** | yes (122) |
| buildings | `core.core_map_buildings` | yes | index only, **not unique** | **no** | yes (6) |
| landuse | `core.core_map_landuse` | yes | index only, **not unique** | **yes** (3 true) | yes |
| water lines | `core.core_map_water_lines` | yes | index only, **not unique** | **no** | yes |
| water polygons | `core.core_map_water_polygons` | yes | index only, **not unique** | **no** | yes |
| addresses | `core.core_addresses` | via `source_refs` (no top-level `external_id` in column scan) | n/a | **yes** | yes |

Also present on core families: `verification_status`, `verified_at`, `verified_by`, `verification_note`, `source_refs`, `public_id`.

---

## 1. Current pipeline stages and actual file paths

### Primary reusable path: `tools/data-pipeline/local-osm/`

Orchestrator: `tools/data-pipeline/local-osm/run_local_osm_pipeline.sh`

| Stage | File | Role |
|------:|------|------|
| 00 | `00_preflight_schema_compatibility.sql` | Local score-scale / schema gate |
| 00 | `00_register_boundary.sh` + `00_register_boundary.sql` | Optional boundary registration (skipped for whole-region) |
| 01 | `01_create_snapshot.sql` | `system_import_batches` + `system_source_snapshots` |
| 02 | `02_import_to_tmp.sh` + `lua/osm2pgsql_*.lua` | osm2pgsql → `tmp_import` |
| 03 | `03_validate_tmp.sql` | Tmp validation |
| 04 | `04_tmp_to_raw.sql` | Tmp → `raw` (optional clip) |
| 05 | `05_raw_to_staging.sql` | Raw → `staging.*_candidates` |
| 06 | `06_diff_current_vs_previous.sql` | F1 previous-snapshot diff → `system.system_diff_items` |
| 07 | `07_compare_with_prod_mirror.sql` | F2 staging vs `prod_mirror` → `system.system_diff_items` |
| 08 | `08_assign_statuses.sql` | Merge F1+F2 → staging `match_status` / `auto_action` / `review_status` |
| 09 | `09_create_review_views.sql` | Local review convenience views |
| 10 | `10_summary_report.sql` | Read-only summary |
| 11 (J) | `11_prepare_remote_review_package.sql` | Local package → `system.system_remote_review_*` |
| 12 (K) | `12_upload_remote_review_package.ts` (+ `remote-review-upload-flush.ts`, `remote-review-entity-config.ts`) | Upload to Supabase `import_review.*` only |
| 13 (L) | `13_verify_remote_review_upload.sql` | Local upload verification |
| 14 | `14_verify_lineage_alignment.sql` | Optional lineage QA |
| 15 | `15_entity_coverage_report.sql` | Optional coverage / promotion-readiness report |

Supporting:

- `pipeline_entity_families.sql`, `pipeline_entity_families_functions.sql`, `pipeline_tmp_import_mode.sql`
- Resume helpers: `run_resume_from_stage08.sh`, `run_resume_from_stage12.sh`
- Docs: `README.md`, `README_REMOTE_REVIEW.md`, `NAMINGENV.md`, `imports/template.full.env`

**Confirmed:** local-osm never writes Supabase `core.*`.

### Prod mirror (required for F2)

`tools/data-pipeline/prod-mirror/`

- `refresh_prod_mirror.sh`
- `01_setup_fdw.sql` → `02_import_foreign_tables.sql` → `03_refresh_prod_mirror.sql` → `04_validate_prod_mirror.sql`

**Confirmed:** copies selected production tables into local `prod_mirror` for comparison only.

### Import Review app path (after Stage K)

| Layer | Path |
|-------|------|
| API | `apps/api/src/modules/import-review/` (`import-review.routes.ts`, promotion services/repos, schemas) |
| Dashboard | `apps/dashboard/src/app/(admin)/dashboard/import-review/` + `apps/dashboard/src/features/import-review/` |
| Active IR families | buildings, places, roads, landuse, water_lines, water_polygons, addresses, admin_areas, routing_barriers |

### Set-based promotion (current scale path for admin/roads only)

`tools/data-pipeline/import-review-bulk-promotion/`

- `00_shared_bulk_promotion_helpers.sql`
- `01_bulk_promote_admin_areas.sql` + verify/delete scripts
- `05_bulk_promote_roads.sql` + verify/delete scripts

**Confirmed:** writes `core` from `import_review` candidates by SQL; bypasses API row promotion.

### Legacy direct-to-core paths (must not be production path)

| Path | Files |
|------|-------|
| Admin fast-core | `tools/data-pipeline/admin-fast-core/` (`run_admin_fast_core_pipeline.sh`, `00`–`07`) |
| Road fast-core | `tools/data-pipeline/road-fast-core/` (`run_road_fast_core_pipeline.sh`, `00`–`08`) |

**Confirmed:** both go PBF → tmp → raw → staging → **local `core`**, with no Import Review.

---

## 2. Which stages are reusable

**Confirmed reusable foundation (keep and repair in place):**

| Stage / component | Why reusable |
|-------------------|--------------|
| 00–04 snapshot + raw archive | Correct two-DB local heavy-processing design |
| ENTITY_FAMILIES filter | One pipeline, many families |
| Whole-region vs clipped boundary modes | Already supported |
| 06 F1 previous-snapshot diff | Change detection already exists |
| 07 F2 prod_mirror compare | Manual/verified protection already exists |
| 08 status merge | Classification engine already exists |
| 09–10 local views/reports | Safe local diagnostics |
| prod-mirror FDW refresh | Required compare input |
| Stage J package tables | Local outbound packaging already exists |
| Stage K upload machinery | Remote IR upsert + reviewed-row preserve already exists |
| IR candidate tables + unique keys | Correct temporary conflict workspace shape |
| Bulk SQL promote pattern | Correct scale pattern for set-based core writes |
| API/dashboard conflict UI | Needed for non-safe rows |

**Recommendation:** do not invent a second national pipeline. Repair and extend local-osm + one shared core-load path.

---

## 3. Which stages must be repaired

| Area | Problem (confirmed) | Repair needed (recommendation) |
|------|---------------------|--------------------------------|
| Stage 05 identity format | Production legacy short vs new canonical long | Shared formatter emits long; Stage 07 adapter matches legacy |
| Stage 05 refresh | Prefer delete+regenerate for current snapshot | **Implemented 2026-07-22** via `pipeline_stage05_reset.sql` |
| Stage 08 → routing | All classified rows stay local; no split into safe-core vs IR | Add post-08 routing buckets |
| Stages J/K | Package/upload **all** statused candidates | Upload **conflict subset only** |
| Core load | local-osm never writes core; only IR API or admin/road bulk SQL | Shared set-based safe_new / safe_update loader per family |
| Core uniqueness | Unique `external_id` only on streets + admin | Add safe unique indexes for remaining OSM families before national load |
| Invalid path | No dedicated local invalid error report stage | Add local invalid report (no IR upload) |
| Idempotency / metrics | Package name non-idempotent unless replace; no dry-run bucket metrics gate | Dry-run metrics first; then idempotent family commits |

**Critical confirmed identity mismatch (addressed 2026-07-22):**

- Production streets: `osm:W:<id>` (legacy short)
- New local-osm Stage 05: `osm:way:<id>` (canonical long) via shared formatter
- Stage 07 now matches both through `pipeline_osm_identity_key()` — no bulk production rewrite

Earlier risk of “everything is new” remains if Stage 07 is run **without** the identity helpers loaded.

---

## 4. Which fast-core paths must be marked legacy

**Confirmed — mark legacy / do not resume as production path:**

| Path | Evidence |
|------|----------|
| `tools/data-pipeline/admin-fast-core/` | Used for national admin load; lineage registered as `legacy_national_admin_fast_core`; bypasses review |
| `tools/data-pipeline/road-fast-core/` | Used for national roads; lineage `legacy_national_road_fast_core`; bypasses review |
| Baseline blocker #6 | Production Baseline v1 explicitly: do not resume these as production path |

**Recommendation:**

- Keep folders for historical reruns / lab only.
- Add clear README banners: **LEGACY — not the V2 production import path**.
- Do not delete yet.
- New national imports must use repaired local-osm + classification + safe core load / IR conflict path.

`tools/data-pipeline/import-review-bulk-promotion/` is **not** the same as fast-core. It is a set-based promote from IR candidates. **Recommendation:** keep the SQL pattern; generalize it for safe direct-core loads after local classification (not as a second family pipeline).

---

## 5. Source identity format by family

### Decision (implemented 2026-07-22)

| Layer | Format |
|-------|--------|
| **Canonical NEW pipeline output** | `osm:node:<id>` \| `osm:way:<id>` \| `osm:relation:<id>` |
| **Legacy production (keep)** | `osm:N:<id>` \| `osm:W:<id>` \| `osm:R:<id>` |
| **Compare / match** | `system.pipeline_osm_identity_key()` equates both forms |

**No national rewrite** of ~823k street ids. Adapter matching only.

Shared code:

- SQL: `tools/data-pipeline/local-osm/pipeline_source_identity.sql`
- TS mirror + tests: `source-identity.ts`, `source-identity.test.ts`
- Stage 05 uses `system.pipeline_osm_external_id(...)`
- Stage 07 F2 joins on identity key (roads, admin, generic families)
- Audit: `16_source_identity_audit.sql` + `reports/source_identity_audit_2026-07-22.md`

### Production core (confirmed live audit 2026-07-22)

| Family | Dominant live format | Unique on `external_id` | Notes |
|--------|----------------------|-------------------------|-------|
| roads | legacy `osm:W:<id>` (822,520) | yes | 486 null; 0 canonical |
| admin | legacy `osm:R:` / rare `osm:W:` | yes | 14 null; 1 other |
| places | legacy when set (35) | index only | 230 null manual OK |
| buildings | legacy `osm:W:` (953) | index only | 106 null; 16 other (bare numeric) |
| landuse | legacy when set (30) | index only | 2 null; 6 other |
| water lines / polygons | other / non-canonical | index only | thin; not usable OSM ids today |
| routing barriers | empty table; no `external_id` column | n/a | identity would live in `source_refs` |

### local-osm Stage 05 (implemented)

```text
external_id = system.pipeline_osm_external_id(osm_feature_type, osm_id)
→ osm:node|way|relation:<id>
```

Accepts `node|way|relation` and short `N|W|R` inputs; always emits long form.

### Fast-core (confirmed legacy)

| Path | Format |
|------|--------|
| road-fast-core | hard-coded `osm:W:` + osm_id |
| admin-fast-core | `osm:R:` / `osm:W:` |

Leave as legacy. Do not use for new national production imports.

### Migration vs adapter

| Option | Status |
|--------|--------|
| Rewrite production `external_id` values | **Rejected** for this phase |
| Shared formatter + Stage 07 compatibility matching | **Implemented** |

---

## 6. Local staging refresh behavior by family

### Final Stage 05 policy (implemented 2026-07-22)

```text
raw (immutable for the snapshot)
  → DELETE enabled-family staging rows WHERE source_snapshot_id = current
    (children first, then parents — pipeline_stage05_reset.sql)
  → INSERT regenerated candidates from raw (family extract blocks in 05_raw_to_staging.sql)
  → write deterministic normalized_hash + per-family fingerprints
  → Stage 05b technical validation (valid|warning|invalid)
  → previous-snapshot staging untouched (F1 still works)
```

Manual review data stays in Supabase `import_review` only — not in local staging.

| Family | Staging tables | Refresh | Why not upsert-first |
|--------|----------------|---------|----------------------|
| admin | `staging_admin_area_candidates` (+ names) | delete+regenerate | Guarantees no stale level/name/geom |
| roads | `staging_road_candidates` (+ names) | delete+regenerate | Same; prior UPDATE upsert becomes no-op after reset |
| places | `staging_place_candidates` (+ names) | delete+regenerate | Fixes old insert-if-missing stale rows |
| buildings | `staging_building_candidates` | delete+regenerate | Same |
| landuse | `staging_landuse_candidates` | delete+regenerate | Same |
| water_lines | `staging_water_line_candidates` | delete+regenerate | Same |
| water_polygons | `staging_water_polygon_candidates` | delete+regenerate | Same |
| routing_barriers | `staging_routing_barrier_candidates` | delete+regenerate | Same |

Supporting files:

- `pipeline_stage05_reset.sql` — shared snapshot reset + `pipeline_staging_content_hash()`
- `pipeline_stage05_hash_metrics.sql` — hashes, fingerprints, before/after metrics
- `pipeline_candidate_validation.sql` — shared `valid|warning|invalid` helpers
- `pipeline_stage05b_validate.sql` — writes `validation_status` / notes / `geometry_hash`
- `scripts/test_stage05_same_snapshot_rerun.sh` — Kyauktan double-run gate
- `scripts/stage05_capture_metrics.sql` — metrics capture

### Verification (Kyauktan `osm_myanmar_2026_05_15_kyauktan_v2`, 2026-07-22)

Two Stage 05 passes with families  
`admin_areas,roads,places,buildings,landuse,water_lines,water_polygons,routing_barriers`:

| family | rows | distinct external_ids | dups | fingerprint | result |
|--------|-----:|----------------------:|-----:|---|---|
| admin_area | 14 | 14 | 0 | same | PASS |
| road | 1400 | 1400 | 0 | same | PASS |
| place | 117 | 117 | 0 | same | PASS |
| building | 1402 | 1402 | 0 | same | PASS |
| landuse | 59 | 59 | 0 | same | PASS |
| water_line | 26 | 26 | 0 | same | PASS |
| water_polygon | 14 | 14 | 0 | same | PASS |
| routing_barrier | 15 | 15 | 0 | same | PASS |
| other_snapshot_guard | 825599 → 825599 | — | — | — | PASS |

Report: `tools/data-pipeline/local-osm/reports/stage05_rerun_20260722T081958Z_compare.md`

Legacy INSERT / `ON CONFLICT` / UPDATE guards remain in Stage 05 as safety nets after reset; they are not the primary refresh mechanism.

---

## 6b. Validation + previous-snapshot status (implemented 2026-07-22)

Every normalized primary candidate gets:

| Field | Values | When |
|-------|--------|------|
| `validation_status` | `valid` \| `warning` \| `invalid` | Stage 05b (after hashes) |
| `source_status` | `source_new` \| `source_changed` \| `source_unchanged` | Stage 06 F1 writeback |
| `source_missing` | report-only (deleted vs previous) | Stage 06 `deleted_candidate` |

F1 compare uses `pipeline_osm_identity_key(external_id)` + `normalized_hash` (geometry already inside the content hash). Raw JSON field-by-field compare is no longer the primary detector.

Rules:

- **Invalid** stay local — Stage J excludes `validation_status = 'invalid'` from Import Review packages.
- **Warning** may continue for active families (optional name / optional class).
- Identical content → `source_unchanged` (zero false changes when hashes match).

Supporting files:

- `pipeline_stage06_hash_diff.sql` — hash F1 + `source_status` writeback
- `17_validation_source_report.sql` — per-family counts
- `candidate-validation.ts` + `.test.ts` — unit scenarios
- `scripts/test_validation_source_status.sql` — SQL scenarios
- `scripts/apply_validation_only.sql` — validate without full Stage 05 rebuild

Kyauktan report: `tools/data-pipeline/local-osm/reports/validation_source_kyauktan_2026-07-22.md`

---

## 6c. Slim prod_mirror (implemented 2026-07-22)

Local `prod_mirror` is a **read-only** slim copy of Supabase core for Stage 07 F2.

- Explicit family column lists (no full `SELECT *`, no `normalized_data`)
- Computed `core_id`, `geometry_hash`, `source_content_hash`
- `prod_mirror.mirror_meta` stores refresh time + Supabase project ref
- Refresh reconciles live FDW counts vs mirror counts
- Validation reports duplicate `external_id` groups and protection columns
- Pipeline Stage 07 runs `00b_preflight_prod_mirror.sql` freshness gate
- Env separation: `LOCAL_DATABASE_URL`, `SUPABASE_READ_DATABASE_URL`, `SUPABASE_WRITE_DATABASE_URL`

Verified Kyauktan lab refresh: `core_streets` live=mirror=823013; preflight PASS.

Docs: `tools/data-pipeline/prod-mirror/README.md`

---

## 7. Current classification / status behavior

### Flow (confirmed)

```text
Stage 05 seeds match_status='new_candidate', auto_action=NULL, review_status='pending'
→ Stage 05b sets validation_status (valid|warning|invalid)
→ Stage 06 F1 writes system_diff_items + staging.source_status (identity + normalized_hash)
→ Stage 07 F2 writes system_diff_items (staging vs prod_mirror)
→ Stage 08 merges latest F1+F2 onto staging rows
```

### Final `match_status` values (confirmed README + Stage 08)

| Value | Meaning |
|-------|---------|
| `new_auto` | Safe-ish insert candidate |
| `matched_auto_update` | Safe-ish update candidate |
| `unchanged` | No substantive change |
| `needs_review` | Ambiguous / risky |
| `duplicate_candidate` | Likely duplicate |
| `manual_protected` | Manual/verified protection |
| `delete_candidate` | Missing vs previous snapshot |

### Final `auto_action` values (confirmed)

`insert_candidate`, `update_candidate`, `ignore_unchanged`, `needs_review`, `possible_duplicate`, `protect_manual`, `do_not_delete_manual`, …

### Protection logic (confirmed Stage 07)

F2 treats prod rows as protected when:

- `is_verified = true`, or
- `manual_override = true` (where column exists), or
- source markers look manual/dashboard

### Local review views (confirmed Stage 09)

| View | Filter |
|------|--------|
| `v_no_conflict_*` | `new_auto`, `matched_auto_update`, `unchanged` |
| `v_review_*` | `needs_review`, `conflict`, `duplicate_candidate`, `delete_candidate` |
| `v_manual_protected_*` | `manual_protected` |

### Gap (confirmed)

Classification already separates no-conflict vs review locally, but Stages J/K **do not use that split for upload**. Package includes essentially all statused candidates for the snapshot (optional row cap only).

---

## 8. Current upload behavior

**Confirmed:**

1. Stage J builds `system.system_remote_review_packages` + `_items` from staging for enabled families.
2. Default runner uses `replace_package=false` → same package name fails if already exists.
3. Stage K (`12_upload_remote_review_package.ts`):
   - Connects to `SUPABASE_DATABASE_URL`
   - Creates/updates `import_review.review_batches`
   - Chunked Node upserts via `jsonb_to_recordset` (not `COPY`)
   - Idempotent on `(review_batch_id, local_staging_id)`
   - Preserves remote rows that already have a review decision / non-pending review status
   - Writes **only** `import_review.*` (never `core`)
4. Upload set = package items = nearly full candidate inventory, not conflict-only.
5. Optional `REMOTE_REVIEW_MAX_ROWS_PER_FAMILY` for smoke tests.

**Recommendation:** keep Stage K transport, but select only conflict/manual/delete/invalid-excluded rows; prefer COPY/SQL staging for volume.

---

## 9. Current core-write behavior

| Path | Writes core? | How | Families |
|------|--------------|-----|----------|
| local-osm Stages 00–15 | **No** | — | — |
| Import Review API promote | **Yes** | validate → dry-run → promote publish batches | all IR families (row/chunk oriented) |
| `import-review-bulk-promotion` | **Yes** | set-based SQL from IR candidates | **admin + roads only** |
| admin-fast-core | **Yes** | direct local staging → core | admin only (legacy) |
| road-fast-core | **Yes** | direct local staging → core | roads only (legacy) |

**Confirmed production reality:** national roads/admin currently in core came from fast-core (then mechanical repairs), not from a completed conflict-only IR national loop. IR candidates are empty; publish history remains.

**Recommendation:** new production writes for safe rows should be set-based from **local classification results**, not API row promotion and not fast-core.

---

## 10. Exact minimal target architecture

Keep the **two-database** design. Heavy work stays in local PostgreSQL/PostGIS. One shared pipeline for all OSM families.

```text
OSM PBF
  → local raw
  → local normalized staging   (true upsert; canonical osm:N|W|R identity)
  → local validation
  → previous-snapshot comparison (F1)
  → local Supabase core-mirror comparison (F2 / prod_mirror)
  → final classification

Then route by class:

  safe_new / safe_update
      → direct set-based Supabase core load
        (COPY/SQL staging → ON CONFLICT external_id)
        → per-family metrics + lineage

  unchanged
      → skip (metrics only)

  duplicate / conflict / manual_protected / verified_conflict / possible_delete
      → import_review (temporary conflict package only)
      → dashboard decision → apply to core
      → delete/archive applied candidates

  invalid
      → local error report only (no IR, no core)
```

### Hard constraints (must keep)

- Two databases: local processing DB + Supabase production
- No per-family full pipeline forks
- No queues, microservices, Airflow, Kafka, or workflow engines
- Do not delete old code in the first repair waves
- Mark fast-core legacy; do not resume it for production national imports
- Import Review becomes **conflict-only**, not full inventory

### Minimal new pieces (recommendation)

1. Identity normalizer in Stage 05  
2. Staging true upsert for all families  
3. Post-08 classification bucket report (dry-run metrics)  
4. Shared set-based core loader (extend bulk-promotion pattern; input = local safe rows, not only IR)  
5. Stage J/K conflict-subset filter  
6. Local invalid report SQL  
7. Unique `external_id` readiness for remaining core OSM families before national load

---

## 11. Exact implementation order

Do **not** start national re-import until gates below pass.

### Phase A — freeze and document (this doc)

1. Treat Production Baseline v1 as the compare baseline.  
2. Mark admin-fast-core / road-fast-core legacy in docs/README (no deletion).  
3. Stop using full-candidate IR upload as the intended production path.

### Phase B — identity + staging refresh (local only)

1. **Done:** Stage 05 canonical identity + Stage 07 legacy adapter.  
2. **Done:** delete+regenerate current-snapshot staging for enabled families + deterministic hashes.  
3. **Done:** Kyauktan same-snapshot rerun gate (`scripts/test_stage05_same_snapshot_rerun.sh`).

### Phase C — classification dry-run metrics (no core writes)

1. After Stage 08, emit per-family counts:

   - `safe_new`
   - `safe_update`
   - `unchanged`
   - `import_review_conflict` (duplicate/conflict/manual/verified/possible_delete)
   - `invalid`

2. Run on one **Kyauktan** snapshot against refreshed `prod_mirror`.  
3. Confirm identity join rates are sane (not “everything is new”).

### Phase D — safe direct-core loader (still gated)

1. Implement set-based loader for `safe_new` / `safe_update` only.  
2. Protect `manual_override` / `is_verified` rows (never clobber).  
3. Ensure/add unique `external_id` where missing and safe.  
4. Family-independent commits + metrics rows.  
5. Dry-run mode first on Kyauktan, then small apply.

### Phase E — conflict-only Import Review

1. Stage J/K upload only conflict bucket.  
2. Keep API/dashboard for conflict apply; do not use API for national safe inserts.  
3. Leave publish-history tables as audit; do not rebuild mega promotion for safe rows.

### Phase F — scale tests

1. Kyauktan full families.  
2. Yangon volume (especially roads).  
3. National import only after Yangon gates pass.

### Explicit non-goals for this repair

- No search rebuild yet  
- No PMTiles / Valhalla rebuild yet  
- No address-system redesign beyond OSM candidate routing  
- No deletion of legacy fast-core or unused IR columns yet

---

## 12. Risks and test gates

### Risks (confirmed / high)

| Risk | Why it matters |
|------|----------------|
| Identity format mismatch | local-osm vs production `osm:W` vs `osm:way` can force false inserts |
| Stale Stage 05 refresh | Mitigated by delete+regenerate (verified Kyauktan double-run) |
| Full IR upload | National candidate volume overwhelms review and promotion |
| API row promotion at national scale | Too slow / fragile for roads |
| Missing unique `external_id` on places/buildings/landuse/water | Duplicate core rows on safe load |
| Protection gaps | Admin/places/buildings lack `manual_override`; rely on `is_verified` / source markers |
| Credential mixups | Stage K / prod-mirror pointed at wrong DB |
| Fast-core relapse | Would bypass repaired classification again |

### Test gates (must pass before next phase)

**Gate 0 — inspection (this document)**  
Done. No code changes.

**Gate 1 — identity**

- [x] Stage 05 emits only `osm:(node|way|relation):` via shared formatter  
- [x] Identity key equates `osm:way:123` ↔ `osm:W:123`  
- [x] Node / way / relation same numeric id do not collide  
- [x] Unit tests pass (`source-identity.test.ts`)  
- [x] Read-only production audit recorded (`reports/source_identity_audit_2026-07-22.md`)  
- [ ] Spot-check Kyauktan F2 join rate after next local snapshot run (still pending)

**Gate 2 — staging refresh**

- [x] Re-run Stage 05 same Kyauktan snapshot: identical counts, external IDs, fingerprints  
- [x] No duplicate external_id groups on primary candidate tables  
- [x] Previous-snapshot staging row counts unchanged  
- [x] Current-snapshot rows regenerated (delete+insert), not insert-if-missing stale keep

**Gate 3 — dry-run classification metrics**

Docs: [`docs/osm-pipeline-import-classification.md`](osm-pipeline-import-classification.md)  
SQL: Stage **08b** + **18** (`import_class`, family thresholds, auto-update fields).

- [x] Kyauktan report exists for every enabled family (`reports/classification_kyauktan_2026-07-22.md`)  
- [x] Reconciliation: `valid = safe_new + safe_update + unchanged + duplicate + conflict + manual_protected + verified_conflict` (Stage 18 PASS)  
- [x] `unchanged` + matched updates are non-trivial (proves identity works) — Kyauktan roads: 1400 identity `safe_update`; `unchanged=0` pending F2 hash-based change detection  
- [x] Conflict bucket size is explainable (admin: 1 conflict, 11 manual_protected, 2 duplicate)  
- [x] Invalid rows listed locally only  
- [x] No production / Supabase writes  
- [ ] Rural township dry-run (env/snapshot not ready in repo yet)  
- [ ] Yangon dry-run (env/snapshot not ready in repo yet)

**Gate 4 — safe core load (Kyauktan)**

- [x] Temporary private `import_work` schema + places pilot table (migration `136`; empty; no core writes yet)  
- [x] Places set-based safe loader + rollback tests PASS (`tools/data-pipeline/import-work/`; migration `137` identity helpers)  
- [ ] COPY classified Kyauktan `safe_new`/`safe_update` places into `import_work`  
- [ ] Dry-run row counts match Gate 3 safe buckets  
- [ ] Apply does not modify `manual_override=true` or verified-protected rows unexpectedly  
- [ ] Idempotent second apply: 0 duplicate inserts  
- [ ] Per-family metrics recorded

**Gate 5 — conflict-only IR**

- [ ] Stage K uploaded count == conflict bucket count (± intentional caps)  
- [ ] Safe rows not present in `import_review`  
- [ ] Conflict apply still works for one row per family

**Gate 6 — Yangon / national readiness**

- [ ] Roads safe load performance acceptable via SQL/COPY, not API  
- [ ] No full-table spatial scans in new loader SQL  
- [ ] Lineage snapshot checksums recorded (not unknown)  
- [ ] Explicit sign-off before national run

---

## Confirmed vs recommendation summary

| Statement | Type |
|-----------|------|
| local-osm is the reusable multi-family pipeline; it does not write core | Confirmed |
| Fast-core admin/roads were the national load path and are legacy | Confirmed |
| IR candidates/review_batches are empty; publish history remains | Confirmed |
| Stage 05 identity uses full `node/way/relation` words; production uses `N/W/R` | Confirmed |
| Shared formatter + Stage 07 identity-key adapter; no production rewrite | Implemented 2026-07-22 |
| Only roads + admin staging true-upsert today | Confirmed (pre-repair) |
| Stage 05 delete+regenerate current snapshot + hashes; Kyauktan rerun PASS | Implemented 2026-07-22 |
| Stages J/K upload full packages, not conflict-only | Confirmed |
| Unique core `external_id` exists for streets + admin only | Confirmed |
| Target = classify locally; safe → set-based core; conflict → IR; invalid → local report | Recommendation |
| Implementation order starts with identity + dry-run metrics before any core writes | Recommendation |

---

## Stop condition

This document defines the **exact repair boundary**.  

**In progress:** Phase C — Stage 08b/18 final `import_class` dry-run (Kyauktan first). Still no production core writes.

Identity Gate 1 and Stage 05 refresh Gate 2 are done.
**)
