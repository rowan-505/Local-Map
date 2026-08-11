# Import Review and OSM pipeline inspection

**Date:** 2026-07-22  
**Scope:** Read-only inspection of code + live Supabase (`locghyuranqaqsnbxflc`). No code, migration, or data changes.  
**Sources:** `apps/dashboard`, `apps/api/src/modules/import-review`, `tools/data-pipeline/local-osm`, `tools/data-pipeline/import-review-bulk-promotion`, `infrastructure/database`, live `import_review` / `system` / `core` schemas.

Legend:

- **Confirmed** = observed in current code and/or live DB
- **Recommendation** = target design advice (not yet implemented)

---

# 1. Current system overview

## What Import Review currently does (confirmed)

Import Review is a **full remote-review and promotion workspace**, not only a conflict queue.

Today it:

1. Receives **all** uploaded OSM candidates for a snapshot/batch into `import_review.*_candidates`
2. Lets admins filter, edit columns, set review decisions, and bulk-approve “safe” rows
3. Creates **publish batches** (`system.system_publish_batches` + `system_publish_items`)
4. Runs validate → dry-run → promote → verify through the API
5. Writes accepted rows into `core.*` (and `routing.routing_barriers` for barriers)
6. Optionally deletes promoted candidate rows (cleanup)

Dashboard tabs (active): Overview, Buildings, Places, Roads, Landuse, Water lines, Water polygons, Addresses, Admin areas, Routing barriers, Promotion, History.

## How data reaches it (confirmed)

```text
PBF
→ local PostGIS (tmp_import → raw → staging)
→ F1 snapshot diff + F2 prod_mirror compare
→ Stage 08 status assignment on staging
→ Stage J package + Stage K upload → Supabase import_review.*
→ Dashboard/API review + promotion
→ core.*
```

Orchestrator: `tools/data-pipeline/local-osm/run_local_osm_pipeline.sh`  
Upload: `tools/data-pipeline/local-osm/12_upload_remote_review_package.ts`  
**local-osm never writes `core`.**

Separate fast path (admin + roads only):  
`tools/data-pipeline/import-review-bulk-promotion/*.sql` — set-based SQL into `core`, bypassing API row promotion.

## How promotion currently works (confirmed)

1. Reviewer sets `review_decision=approved` (and matching `review_status`)
2. `POST /api/import-review/promotion/batches` creates a publish batch and sets candidates `promotion_status=batched`
3. Validate → optional road/barrier dry-run → `POST .../promote` with `confirmation_text: "PROMOTE"`
4. Family-specific promote repos write `core.*`
5. Successful candidates become `promotion_status=promoted`
6. Optional `POST /cleanup/promoted/execute` deletes promoted review rows (env-gated)

Addresses/places also have **parallel** single-family promote APIs outside the multi-family publish-batch path.

## History and Promotion tabs (confirmed)

| Tab | Stores / shows | Temporary or permanent? |
|-----|----------------|-------------------------|
| **Promotion** | Active publish-batch workflow UI | Operational; backed by `system_publish_*` |
| **History** | Review-batch list + publish-batch list/items/logs | Intended permanent audit of publish runs |
| Candidate tables | Working copy of OSM candidates | Temporary (cleanup deletes promoted rows) |
| `review_candidate_edits` | Append-only field edit audit | Semi-permanent if rows kept |
| `review_comments` / `review_tasks` | Schema exists | Unused (0 rows, no app callers) |

## Live DB snapshot (confirmed, 2026-07-22)

| Object | Rows |
|--------|------|
| All `import_review.*_candidates` | **0** (cleaned) |
| `import_review.review_batches` | **0** |
| `system.system_publish_batches` | **33** (all `source_review_batch_id` NULL) |
| `system.system_publish_items` | **6015** (2309 still `pending`) |
| `system.system_publish_stage_logs` | **279** |
| `import_review.review_comments` / `review_tasks` | **0** |
| `core.core_streets` | **823013** |
| `core.core_admin_areas` | **2518** |
| `core.core_map_buildings` | **1083** |
| `core.core_places` | **282** |

Interpretation: promotion history outlived temporary candidates and review batches. History is the durable trail today; candidate tables are empty working space.

---

# 2. Current pages and features

| Page or feature | Current purpose | Used by current pipeline? | Keep | Simplify | Remove | Reason |
|-----------------|-----------------|---------------------------|------|----------|--------|--------|
| Overview | Batch/snapshot rollups (`GET /summary`) | Yes (after Stage K) | ✓ | | | Needed for scope and queue health |
| Buildings queue | List/detail/decide/bulk approve | Yes | ✓ | ✓ | | Keep as conflict queue; stop loading all new_auto |
| Places queue | Same | Yes | ✓ | ✓ | | Same |
| Roads queue | List/detail; select → publish batch (no bulk approve) | Yes | ✓ | ✓ | | High-risk; keep conflict UI |
| Landuse / water lines / water polygons | Same as buildings | Yes | ✓ | ✓ | | Keep conflict-only |
| Addresses | Dedicated drawer + components/matches/validate/promote | Yes | ✓ | ✓ | | Complex; keep conflict path, simplify promote |
| Admin areas | List/detail/decide | Yes (+ SQL bulk promote) | ✓ | ✓ | | Prefer bulk SQL for safe inserts |
| Routing barriers | List/detail; dry-run gated | Partial | ✓ | ✓ | | Keep; still high-risk |
| Promotion page | Create/validate/promote publish batches | Yes (current core path for most families) | | ✓ | Target: shrink or replace | Too heavy for “conflict-only” future |
| Promotion batch detail | Stage progress, dry-run, verify, retry | Yes | | ✓ | | Keep thin apply UI only |
| History page | Review + publish batch archives | Partially (publish only durable now) | | ✓ | | Keep publish audit; drop unused review-batch UI if unused |
| Detail drawer + overrides | Edit columns, review actions, map | Yes | ✓ | ✓ | | Keep comparison + decision; drop unused sections |
| Filters / pagination / status | match/auto/review/promotion filters | Yes | ✓ | ✓ | | Collapse overlapping status filters |
| Bulk decision | Approve/reject/ignore/etc. | Yes | ✓ | ✓ | | Remap to target review actions |
| Assignments UI | — | No | | | ✓ | Columns exist; no dashboard/API usage |
| Locks UI | Soft lock via `promotion_status=batched` only | Promotion only | | ✓ | | No user lock UI; keep apply lock only if needed |
| Comments | Drawer says not wired | No | | | ✓ | Table unused |
| Tasks | — | No | | | ✓ | `import_review.review_tasks` unused |
| Candidate edit history | Written on PATCH | Lightly | | ✓ | | Keep append-only if cheap; hide UI until needed |
| Bus entity tabs | Deprecated types only | No (transport separate) | | | ✓ | Not in active nav/families |
| `/data-review/*` parallel hub | Legacy map-first entry | Partial | | | ✓ | Redirect/remove after IR is sole entry |
| Legacy `_components` clients | Old buildings/roads clients | No (shell replaced them) | | | ✓ | Dead UI code |
| Turn-restriction candidates | Table only | Stage 05 local; not Stage K / dashboard | | | ✓ | No IR upload or UI |

---

# 3. Current backend and database flow

## API routes (confirmed)

Prefix: `/api/import-review` — `apps/api/src/modules/import-review/import-review.routes.ts` (~2400 lines). Auth: import-review admin gate.

Main groups:

- **Family CRUD:** `GET/PATCH /:family`, decision, overrides shim, bulk-decision
- **Legacy shortcuts:** `/buildings`, `/places`, `/roads` (duplicates of `/:family`)
- **Summary/options/batches:** `/summary`, `/options`, `/reference-options`, `/batches`
- **Promotion:** eligibility, create batch, validate, dry-run, promote, cancel/reset/resume, retry, verify, release-stale-batched, road/barrier dry-runs
- **Cleanup:** `/cleanup/promoted/dry-run|execute`
- **History:** review-batches + publish-batches + items + logs
- **Address/place side flow:** components, matches, validate, promote (parallel to publish batches)

Module size: **~344 TypeScript files** under `apps/api/src/modules/import-review/`.

## Main services (confirmed)

| Area | Files |
|------|-------|
| Review list/detail/decision | `import-review.service.ts`, `import-review-generic-candidate.repo.ts`, `import-review-candidate-sql.ts` |
| Promotion orchestration | `import-review-promotion.service.ts`, create/validate/promote runners |
| Family promote | `import-review-promotion-promote-*.repo.ts` |
| History | `import-review-history.service.ts` / `.repo.ts` |
| Address/place | address/place validation + promote services |

## Candidate tables (confirmed)

| Family | Table | Core target |
|--------|-------|-------------|
| buildings | `import_review.building_candidates` | `core.core_map_buildings` |
| places | `import_review.place_candidates` | `core.core_places` |
| roads | `import_review.road_candidates` | `core.core_streets` |
| landuse | `import_review.landuse_candidates` | `core.core_map_landuse` |
| water_lines | `import_review.water_line_candidates` | `core.core_map_water_lines` |
| water_polygons | `import_review.water_polygon_candidates` | `core.core_map_water_polygons` |
| addresses | `import_review.address_candidates` (+ components, place links) | `core.core_addresses` |
| admin_areas | `import_review.admin_area_candidates` | `core.core_admin_areas` |
| routing_barriers | `import_review.routing_barrier_candidates` | `routing.routing_barriers` |

Also: `routing_turn_restriction_candidates` (no dashboard family), `review_batches`, `review_candidate_edits`, `review_comments`, `review_tasks`.

## Review / publish objects (confirmed)

| Object | Table | Role |
|--------|-------|------|
| Review batch | `import_review.review_batches` | Upload package metadata + counters |
| Publish batch | `system.system_publish_batches` | Promotion unit |
| Publish item | `system.system_publish_items` | Per-candidate publish row |
| Stage logs | `system.system_publish_stage_logs` | validate/dry-run/promote progress |

## Status fields (confirmed)

**On candidates (road CHECK constraints live):**

- `match_status` (pipeline): `new_auto`, `matched_auto_update`, `unchanged`, `needs_review`, `duplicate_candidate`, `manual_protected`, `delete_candidate`, …
- `auto_action` (pipeline): `insert_candidate`, `update_candidate`, `ignore_unchanged`, `needs_review`, `possible_duplicate`, `protect_manual`, `deleted_candidate`, …
- `review_decision` (API): `approved` \| `rejected` \| `needs_more_review` \| `ignored` \| `merged`
- `review_status` (DB CHECK overlaps promotion): `pending` \| `approved` \| `rejected` \| `needs_review` \| `ignored` \| `merged` \| **`promoted`** \| **`promotion_failed`**
- `promotion_status` (DB CHECK): `not_ready` \| `ready` \| `batched` \| `promoting` \| `promoted` \| `failed` \| `skipped`

**Publish batch status:** `draft` \| `validating` \| `ready` \| `partial` \| `promoting` \| `promoted` \| `failed` \| `blocked` \| `archived` \| `cancelled`

**Publish item:** `publish_action` insert/update/merge; `publish_status` pending/success/failed/skipped/rolled_back

## Foreign-key / dependency notes (confirmed)

- Candidates reference `review_batch_id`
- Publish batches optionally reference `source_review_batch_id` — **all 33 live batches have NULL** after cleanup
- Publish items keep `review_candidate_id` even after candidates deleted → **orphaned history pointers**
- Soft assignment/lock columns (`assigned_to`, `locked_by`, `locked_at`) exist on every candidate table; **no app usage**
- RLS: enabled on `import_review` tables, **0 policies** on `road_candidates` (and no policies found in `import_review`/`system` via `pg_policies`). Many `core`/`system` tables have RLS **disabled** (Supabase advisor critical — separate security issue)

## Current data-flow diagram

```text
OSM PBF
  → local-osm 00–05 (tmp/raw/staging)
  → 06 F1 + 07 F2 + 08 statuses
  → 11–13 package + upload ALL candidates
       ↓
  import_review.review_batches
  import_review.*_candidates   ← temporary workspace (currently empty)
       ↓
  Dashboard decisions (approved/rejected/…)
       ↓
  system_publish_batches / items / stage_logs   ← durable history
       ↓
  core.* / routing.*
       ↓
  optional cleanup deletes candidates (+ review_batches)
```

---

# 4. Problems and unnecessary complexity

| Problem | Evidence | Class |
|---------|----------|-------|
| **All OSM candidates enter Import Review**, including safe `new_auto` | Stage K uploads full package; Overview/queues designed for full inventory | **Critical** |
| **No production “direct to core” path for most families** | local-osm never writes core; bulk SQL only admin+roads | **Critical** |
| **Duplicate status systems** | `review_decision` ≈ `review_status`; `review_status` also holds `promoted`/`promotion_failed` while `promotion_status` exists | **Critical** |
| **Review and publish state overlap** | Approve → batched → validate → promote; eligibility buckets + promotion_status + publish_status | **Important** |
| **Promotion logic duplicates bulk import** | API promote vs `import-review-bulk-promotion` SQL; both insert into same core tables | **Important** |
| **Stage 05 stale refresh** | Most families insert-if-missing for `(snapshot, external_id)`; only roads true upsert | **Critical** |
| **Batch counters mismatch history** | Live failed batches: `total_item_count` sum 4192 vs `failed_count` sum 35; 2309 items still `pending` | **Important** |
| **History orphaned from review batches** | 33/33 publish batches have `source_review_batch_id` NULL; candidates 0 | **Important** |
| **Unused comments/tasks/assignments/locks columns** | Tables/columns exist; 0 rows; no matches in `apps/` | **Optional cleanup** |
| **Unused system queues** | `system_conflict_queue`, `system_review_tasks`, `system_review_logs` = 0 | **Optional cleanup** |
| **Legacy bus families in types/UI maps** | Deprecated in dashboard; Stage 05 still extracts bus staging locally | **Optional cleanup** |
| **Turn-restriction IR table unused by dashboard/upload** | Table live; not in `IMPORT_REVIEW_ENTITY_FAMILIES` | **Optional cleanup** |
| **Complex publish stages unused for target model** | validate/dry-run/resume/cancel/reset surface is large | **Important** |
| **API endpoints with narrow/no active caller** | e.g. `GET /promotion/ready-candidates` buildings-only; `/reference-options`; overrides PATCH shim | **Optional cleanup** |
| **API row-by-row / chunked promotion for national roads** | Env gates + SQL bulk recommended over API for >50 roads | **Critical** for national scale |
| **Stage K not COPY** | Chunked Node `jsonb_to_recordset` upserts (500/chunk) | **Important** |
| **Stage J non-idempotent package name** | Fails if package exists unless `replace_package=true` | **Important** |
| **Unsafe if credentials misaimed** | Prod mirror refresh / Stage K need careful URL separation (documented) | **Critical** (ops) |
| **Parallel address/place promote APIs** | Bypass unified publish-batch model | **Important** |
| **`merged` decision labeled “finalized”** | UI rename hides true semantics | **Optional cleanup** |
| **RLS gap on core/system** | Advisor: many production tables RLS disabled | **Critical** (security; outside IR simplify but must not ignore) |

---

# 5. Target simplified Import Review

## Target flow (recommendation)

```text
Normalized OSM candidate (local staging)
  → compare with repaired core (prod_mirror / live compare)
      → new + safe mechanical update
           → direct bulk insert/update to core (COPY / SQL staging)
           → record snapshot metrics
      → unchanged
           → skip
      → duplicate | conflict | uncertain | manual_protected | possible_delete
           → import_review (temporary)
           → reviewer action
           → apply decision to core
           → remove/archive temporary candidate
```

## Minimum pages to keep (recommendation)

| Page | Role |
|------|------|
| Overview | Conflict counts by family + snapshot/batch metrics |
| Conflict list by family | One queue per entity family (reuse current entity pages, filtered) |
| Candidate detail + comparison | Side-by-side imported vs existing core |
| Review decision | Apply one of the eight actions |
| Batch summary | Per-run metrics (uploaded conflicts, applied, failed) — **not** full publish-stage machine |

## Feature decisions (recommendation)

| Feature | Decision |
|---------|----------|
| Promotion (multi-stage publish batch UI) | **Simplify heavily** → single “Apply decisions” / batch apply summary |
| History | **Simplify** → keep apply/audit log; stop treating empty review_batches as primary history |
| Assignments | **Remove** |
| Locks (user) | **Remove**; optional short apply lock only |
| Comments | **Remove** (use `review_note`) |
| Tasks | **Remove** |
| Candidate edit history | **Simplify** — keep table if useful for audit; no dedicated UI in V1 target |
| Complex publish stages | **Remove/deprecate** for normal families; keep dry-run only for roads/barriers if still needed |

Do not keep a feature only because it exists.

---

# 6. Minimum review actions

Map from **target action** → **behavior** (recommendation). Reuse columns where noted.

| Action | Behavior |
|--------|----------|
| `keep_existing` | Leave core unchanged. Mark candidate applied/ignored. Close conflict. |
| `replace_existing` | Overwrite matched core row with imported effective values (respect identity/`external_id`). Soft-version core if existing pattern supports it (`core_street_versions` already used). |
| `merge_fields` | Reviewer picks **per field**: Imported \| Existing \| Custom. Persist field map (JSON on candidate or apply payload). Apply only selected fields to core. |
| `insert_separate` | Insert imported as **new** core row even if a match exists. Do not delete/update matched core. Link via source refs. |
| `ignore_import` | Discard import; no core write. Candidate archived/deleted. |
| `mark_duplicate` | Record as duplicate of `matched_core_id` (or chosen core id). No core insert. |
| `confirm_soft_delete` | For `delete_candidate` / OSM deletion: soft-delete matched core (`deleted_at` / existing soft-delete pattern). Never hard-delete without explicit separate tool. |
| `needs_more_review` | Leave pending; bump `review_note` / assignment-free queue flag. |

### `merge_fields` UI (recommendation)

1. Show table: Field \| Existing value \| Imported value \| Choice  
2. Default choice: safer side (prefer existing for manual/verified fields; imported for empty existing)  
3. Save choices into apply payload (`field_choices: { name_en: "imported", geometry: "existing", ... }`)  
4. Apply transaction: update core with chosen fields only; write audit row

**Current mapping hint:** today’s `approved` ≈ apply import (often insert); `rejected`/`ignored` ≈ ignore; `merged` ≈ unclear “finalized”; `needs_more_review` already exists. Target actions should replace this set rather than add beside it.

---

# 7. Minimum status model

## Recommended three-axis model

```text
comparison_status:   duplicate | conflict | manual_protected | verified_conflict | possible_delete
review_decision:     pending | keep_existing | replace_existing | merge_fields | insert_separate | ignore_import | mark_duplicate | confirm_soft_delete | needs_more_review
apply_status:        not_applied | ready | applying | applied | failed
```

Application mapping lives in `apps/api/src/modules/import-review/import-review-status-model.ts`.

Storage reuse (compatibility):

| Axis | Column | Notes |
|------|--------|-------|
| comparison | `match_status` | Target values preferred; legacy aliases still read |
| decision | `review_decision` | `NULL` = pending; migration 138 expands CHECK |
| apply | `promotion_status` | Readers map to apply_status; migration 138 allows both legacy + target |
| (legacy) | `auto_action`, `review_status` | Kept; not primary dashboard filters |

Publish batch/item status enums are unchanged.
## Reuse vs deprecate (recommendation)

| Current field | Recommendation |
|---------------|----------------|
| `match_status` | **Reuse** as `comparison_status` (rename gradually or map values) |
| `auto_action` | **Deprecate** as user-facing; keep internally as pipeline hint if useful |
| `review_decision` | **Reuse column**, replace enum values with target actions |
| `review_status` | **Deprecate** (derived duplicate of decision + apply) — stop using `promoted`/`promotion_failed` here |
| `promotion_status` | **Map → `apply_status`** (not_ready→not_applied, batched/promoting→applying, promoted→applied, failed→failed) |
| Publish batch `status` mega-machine | **Simplify** to apply-run lifecycle or drop for conflict-only applies |
| Publish item `publish_status` | Keep as apply-item result if batch apply remains |

Avoid adding new parallel status columns. Prefer remapping existing text columns + tighter CHECKs in a later migration phase.

---

# 8. Target pipeline repair

## Goals (recommendation)

- New valid data → **direct bulk insert to core**
- Unchanged → **skip**
- Safe mechanical updates → **auto update core**
- Duplicates/conflicts/uncertain/manual/verified/deletes → **import_review only**
- Same snapshot re-run → **idempotent** (no duplicate core rows)
- New snapshot → **process changed data only** (use F1 + F2)
- Load with **COPY / SQL staging**, not API row-by-row
- Every run records snapshot + **per-family metrics**; families **commit independently**

## Target pipeline diagram

```text
PBF → tmp → raw → staging (true upsert refresh per family)
  → F1 (prev snapshot) + F2 (core/prod_mirror)
  → classify:
        safe_new / safe_update ──COPY/SQL──► core.*
        unchanged ──skip──► metrics only
        conflict_set ──COPY/SQL──► import_review.*
  → dashboard conflict review → apply decision SQL/API → core
  → delete/archive applied conflict candidates
  → write system snapshot metrics (per family)
```

## Concrete repair points (recommendation)

| Area | Repair |
|------|--------|
| Stage 05 | Upsert all families like roads (`UPDATE` then `INSERT`), keyed by snapshot + `external_id` |
| Stage 08 / post-08 | Split routing: safe → core loader; conflict → IR upload only |
| Stage K | Upload **conflict subset only**; prefer `COPY` into staging tables then set-based merge |
| Bulk promote SQL | Generalize beyond admin/roads for safe_new families |
| API promotion | Remain for **conflict apply**, not national bulk insert |
| Idempotency | `ON CONFLICT (external_id)` on core; IR unique `(review_batch_id, local_staging_id)` already |
| Family commits | One transaction (or one script invocation) per family with metrics row |

---

# 9. Keep, simplify and remove list

## Keep

| Item | Path / object | Current usage | Action | Risk if removed |
|------|---------------|---------------|--------|-----------------|
| Entity family configs | `apps/dashboard/.../config/entities/*`, `import-review-config.ts` | Active queues | Keep | High |
| Detail drawer + map | `ImportReviewDetailDrawer.tsx` | Comparison/edit | Keep | High |
| Decision + bulk decision API | `import-review.service.ts`, routes | Live | Keep (remap enums) | High |
| Candidate tables + indexes | `import_review.*_candidates` | Workspace | Keep | High |
| `review_batches` | upload lineage | Keep for conflict packages | Medium |
| Pipeline 00–10 compare | `tools/data-pipeline/local-osm/06–09` | Classification | Keep | High |
| Prod mirror | `tools/data-pipeline/prod-mirror/` | F2 compare | Keep | High |
| Bulk SQL promote pattern | `import-review-bulk-promotion/` | Admin/roads scale | Keep & extend | Medium |
| Publish audit tables | `system_publish_*` | History | Keep as apply audit | Medium |
| `review_note`, `reviewed_by/at` | candidate columns | Live | Keep | Low |
| Manual/verified protection in F2 | Stage 07/08 | Protect core | Keep | High |
| `external_id` / snapshot lineage fields | candidates + core | Identity | Keep | High |

## Simplify

| Item | Path / object | Current usage | Action | Risk |
|------|---------------|---------------|--------|------|
| Promotion UI | `apps/dashboard/.../promotion/*`, `ImportReviewPromotionClient.tsx` | Multi-step | Collapse to apply summary | Medium |
| Promotion API surface | many `import-review-promotion-*` files | Large | Keep apply + eligibility; drop unused stage controls gradually | Medium–High |
| History UI | `ImportReviewHistoryPage.tsx` | Dual tabs | Publish/apply log only | Low |
| Status filters | Filters panel | 5 status axes | 3 axes | Low |
| Address side APIs | address/place promote routes | Parallel path | Fold into one apply model | Medium |
| Stage K uploader | `12_upload_remote_review_package.ts` | Full upload | Conflict-only + COPY | Medium |
| `auto_action` user filters | dashboard/API | Redundant with match_status | Hide from UI | Low |
| Candidate edits | `review_candidate_edits` | Audit on PATCH | Keep write; no UI | Low |
| Env promotion gates | `import-review-config.ts` | Safety | Keep for high-risk apply | — |

## Remove or deprecate

| Item | Path / object | Current usage | Action | Risk |
|------|---------------|---------------|--------|------|
| Assignments | `assigned_to` columns; no API | Unused | Deprecate columns later | Low |
| User locks | `locked_by`/`locked_at` | Unused | Deprecate | Low |
| Comments | `import_review.review_comments` | 0 rows, no callers | Deprecate/drop later | Low |
| Tasks | `import_review.review_tasks` | 0 rows | Deprecate/drop later | Low |
| System conflict/task queues | `system_conflict_queue`, `system_review_tasks` | 0 rows | Deprecate | Low |
| Bus IR types / labels | dashboard deprecated helpers; Stage 05 bus extract | Legacy | Remove from IR surface; keep transport pipeline separate | Low |
| Turn-restriction IR table | `routing_turn_restriction_candidates` | No UI/upload | Stop maintaining in IR | Low |
| Legacy overrides PATCH | routes marked deprecated | Shim | Remove after clients gone | Low |
| Legacy `/buildings` duplicate routes | `import-review.routes.ts` | Parallel to `/:family` | Collapse | Low |
| `/data-review` hub | `apps/dashboard/.../data-review` | Legacy | Redirect/remove | Low |
| Dead `_components` clients | `ImportReviewCandidatesClient`, `ImportReviewBuildingsClient` | Unused by routes | Delete when safe | Low |
| `review_status` promotion values | CHECK includes `promoted`/`promotion_failed` | Overlap | Deprecate | Medium (migration) |
| Full-candidate Stage K upload | Stage 11–12 | Current default | Replace with conflict subset | High if done wrong — gate with metrics |
| Complex validation stage machine for safe bulk | promotion validation runners | Heavy | Not needed for direct-core path | Medium |

---

# 10. Implementation order

## Phase 1: remove dead and legacy behavior

- Hide/delete unused dashboard: assignments/comments/tasks references, bus labels, `/data-review` redirects, dead `_components`
- Document unused DB objects (do **not** drop yet): `review_comments`, `review_tasks`, `assigned_to`/`locked_*`, `system_conflict_queue`
- Likely files: `apps/dashboard/src/features/import-review/**`, `ImportReviewDetailDrawer.tsx`, `deprecatedCoreBusPromotion.ts`, `data-review/**`

## Phase 2: simplify database status model

- Spec mapping tables for comparison / decision / apply
- Migration plan (later execution): tighten CHECKs; stop writing `review_status=promoted`
- Objects: candidate CHECKs (`irr_*_review_status_chk`, `irr_*_promotion_status_chk`), `import-review.schema.ts`

## Phase 3: simplify API

- Collapse legacy family routes; deprecate unused promotion stage endpoints after UI no longer calls them
- Remap decision enums to target actions
- Files: `import-review.routes.ts`, `import-review.schema.ts`, `import-review.service.ts`, promotion create/promote entrypoints

## Phase 4: simplify dashboard

- Overview = conflict metrics
- Entity pages default filter = conflict set
- Replace Promotion mega-wizard with Apply decisions + batch summary
- Slim History to apply/publish audit
- Files: `importReviewEntityConfigs.ts`, `ImportReviewPromotionClient.tsx`, `ImportReviewHistoryPage.tsx`, filters panel

## Phase 5: repair comparison and bulk loading

- Fix Stage 05 upsert for all families
- Add post-compare **direct-core** SQL loaders (extend `import-review-bulk-promotion` pattern)
- Stage K uploads **conflicts only**; prefer COPY/staging
- Files: `05_raw_to_staging.sql`, `08_assign_statuses.sql`, new core-load SQL, `12_upload_remote_review_package.ts`, `remote-review-upload-flush.ts`

## Phase 6: test Kyauktan

- One snapshot, all families: metrics for direct-core vs IR counts; idempotent re-run; conflict apply actions

## Phase 7: test Yangon

- Volume + road/admin performance; confirm no API bulk for large safe inserts

## Phase 8: national import

- Per-family independent commits; snapshot metrics dashboard; monitor Stage K/COPY and core `ON CONFLICT`

---

# Confirmed vs recommendation

| Statement | Type |
|-----------|------|
| Import Review currently holds full candidate sets and promotes via publish batches | Confirmed |
| Live IR candidates/review_batches are empty; publish history remains | Confirmed |
| Pipeline does not write core; Stage K is chunked SQL upsert not COPY | Confirmed |
| Comments/tasks/assignments unused | Confirmed |
| Status model overlaps review + promotion | Confirmed |
| Target = conflict-only IR + direct-core for safe rows | Recommendation |
| Eight review actions + three status axes | Recommendation |

---

# Final recommended architecture

```text
Local OSM normalize + compare
  ├─ safe new/update  → SQL/COPY → core (per family, idempotent)
  ├─ unchanged        → skip
  └─ conflict/uncertain/protected/delete → import_review
         → Overview + family conflict queues
         → eight review actions
         → apply to core
         → delete temporary candidate
Publish/apply logs stay in system.* for audit only.
```

**First implementation task:**  
Define and document the **conflict-subset selection rule** (exact `match_status` / `auto_action` predicate per family) and add a **dry-run metrics report** in local-osm (no core writes) that counts, for one Kyauktan snapshot:

`safe_direct_core` vs `unchanged_skip` vs `import_review_conflict`

Ship that report before changing upload or promotion code. That gives a safe baseline for Phases 5–6 without touching production data.
`)