# Import Review Current Status

**Report date:** 2026-05-29  
**Source:** Static code inspection documented in [`END_TO_END_INSPECTION.md`](./END_TO_END_INSPECTION.md). No live browser E2E or Postgres integration tests were run unless noted below.  
**Runtime behavior with real data:** **UNKNOWN** unless a row below says otherwise.

---

## 1. Purpose of import-review

Import-review is the **admin workflow** between local pipeline staging uploads and production **core** / **routing** tables.

```text
Pipeline staging → import_review.*_candidates (+ review_batches)
  → Dashboard review (decisions, overrides, validation)
  → Promotion (system_publish_batches → core.* / routing.*)
  → Optional cleanup (hard DELETE of promoted candidates)
  → History (review + publish batch audit)
```

**Architecture (inspected):**

- **Database/PostGIS** = source of truth for candidate rows.
- **Fastify API** (`/api/import-review`) = business logic, validation, promotion, authorization.
- **Dashboard** = API consumer only (`apiFetch`); no Prisma or direct DB access under import-review code.
- **Auth:** dedicated guard (`authenticateImportReview` + `requireImportReviewAdmin`); symmetric admin token or JWT admin role.

---

## 2. Current implemented entity families

**13 API canonical families** (`IMPORT_REVIEW_ENTITY_FAMILIES` in `import-review-config.ts`):

| API family | Candidate table | Core / routing target | Static wiring status |
|------------|-----------------|----------------------|----------------------|
| `buildings` | `building_candidates` | `core.core_map_buildings` | **WORKING_LIKELY** |
| `places` | `place_candidates` | `core.core_places` | **WORKING_LIKELY** |
| `roads` | `road_candidates` | `core.core_streets` | **PARTIAL** (UX split; batch validation skips roads) |
| `bus_stops` | `bus_stop_candidates` | `core.core_bus_stops` | **WORKING_LIKELY** |
| `bus_routes` | `bus_route_candidates` | `core.core_bus_routes` | **PARTIAL** (no cleanup; pipeline Stage J/K often placeholder) |
| `bus_route_variants` | `bus_route_variant_candidates` | `core.core_bus_route_variants` | **PARTIAL** (no cleanup) |
| `bus_route_stops` | `bus_route_stop_candidates` | `core.core_bus_route_stops` | **PARTIAL** (no cleanup) |
| `landuse` | `landuse_candidates` | `core.core_map_landuse` | **WORKING_LIKELY** |
| `water_lines` | `water_line_candidates` | `core.core_map_water_lines` | **WORKING_LIKELY** |
| `water_polygons` | `water_polygon_candidates` | `core.core_map_water_polygons` | **WORKING_LIKELY** |
| `addresses` | `address_candidates` | `core.core_addresses` | **WORKING_LIKELY** (split promote only) |
| `admin_areas` | `admin_area_candidates` | `core.core_admin_areas` | **PARTIAL** (high-risk; hierarchy risk) |
| `routing_barriers` | `routing_barrier_candidates` | `routing.routing_barriers` | **BROKEN_RISK** (bulk UI vs API mismatch) |

**Batch promotion tiers (config):**

| Tier | Families |
|------|----------|
| Default batch create | buildings, places, landuse, water_lines, water_polygons, bus_routes, bus_route_variants, bus_stops |
| Validatable in batch runner | Same as default **except no `roads`** |
| Promotable in batch runner | Validatable + **roads**, **admin_areas**, **routing_barriers** — **not addresses** |
| High-risk (`allow_high_risk_families`) | roads, addresses, admin_areas, routing_barriers |

**Not in API families (schema only):** `routing_turn_restriction_candidates` (migration 024); child name tables (place names, road names, etc.) ride in parent `normalized_data`.

**Pipeline data availability:** Stage J/K upload status per family is **UNKNOWN** at runtime; inspection notes many families have placeholder pipeline upload.

---

## 3. Current API endpoints

**Prefix:** `/api/import-review` (registered in `apps/api/src/app.ts`).  
**Handler count (inspected):** 64 routes in `import-review.routes.ts`.  
**Auth:** all routes guarded except OPTIONS; see `apps/api/docs/import-review-auth.md`.

### Scope and options

| Method | Path |
|--------|------|
| GET | `/summary` |
| GET | `/batches` |
| GET | `/options` |
| GET | `/reference-options` |

### Generic per-family routes (`/:family/...`)

| Method | Path |
|--------|------|
| GET | `/:family` |
| GET | `/:family/:id` |
| GET | `/:family/filter-options` |
| PATCH | `/:family/:id/decision` |
| PATCH | `/:family/:id/overrides` |
| POST | `/:family/bulk-decision` |

### Legacy dedicated (still registered)

| Method | Path |
|--------|------|
| GET/PATCH/POST | `/buildings`, `/buildings/:id`, `/buildings/bulk-decision`, `/buildings/filter-options` |
| GET/PATCH/POST | `/places`, `/places/:id`, `/places/bulk-decision` |
| GET/PATCH/POST | `/roads`, `/roads/:id`, `/roads/bulk-decision`, `/roads/dry-run-summary`, `/roads/:id/validate-routing` |

### Promotion

| Method | Path |
|--------|------|
| GET | `/promotion/ready`, `/promotion/ready-candidates`, `/promotion/batch-eligibility` |
| GET | `/promotion/batches`, `/promotion/batches/:id` |
| POST | `/promotion/batches` |
| POST | `/promotion/batches/:id/validate` |
| GET | `/promotion/batches/:id/progress`, `/logs`, `/verify` |
| POST | `/promotion/batches/:id/promote` |
| POST/GET | `/promotion/batches/:id/road-dry-run` |
| POST/GET | `/promotion/batches/:id/routing-barrier-dry-run` |
| POST | `/promotion/batches/repair-invalid-promoted` |

### Split promotion (addresses ecosystem)

| Method | Path |
|--------|------|
| POST | `/addresses/validate`, `/addresses/promote-dry-run`, `/addresses/promote` |
| POST | `/places/validate`, `/places/promote-dry-run`, `/places/promote` |
| POST | `/place-address-links/validate`, `.../promote-dry-run`, `.../promote` |
| POST | `/addresses/infer-admin-components` |
| GET/PATCH | `/addresses/:id/options`, `/components`, `/matches`, `/place-status` |
| POST | `/addresses/:id/create-place-candidate` |

### History

| Method | Path |
|--------|------|
| GET | `/history/review-batches`, `/history/review-batches/:id` |
| GET | `/history/publish-batches`, `.../:id`, `.../:id/items`, `.../:id/logs` |

### Cleanup

| Method | Path |
|--------|------|
| POST | `/cleanup/promoted/dry-run`, `/cleanup/promoted/execute` |

**Dashboard ↔ API path match:** **Yes** (static inspection). **Live reachability:** **UNKNOWN** (no curl smoke in inspection pass).

---

## 4. Current dashboard pages

**Base path:** `/dashboard/import-review`

| Route | Client / shell | Notes |
|-------|----------------|-------|
| `/dashboard/import-review` | Overview inline | Summary + batch picker |
| `/dashboard/import-review/buildings` | `ImportReviewEntityPageShell` | Shared entity queue |
| `/dashboard/import-review/places` | Entity shell | |
| `/dashboard/import-review/roads` | Entity shell | **No** routing-validation drawer here |
| `/dashboard/import-review/landuse` | Entity shell | |
| `/dashboard/import-review/water-lines` | Entity shell | |
| `/dashboard/import-review/water-polygons` | Entity shell | |
| `/dashboard/import-review/bus-stops` | Entity shell | |
| `/dashboard/import-review/bus-routes` | Entity shell | |
| `/dashboard/import-review/bus-route-variants` | Entity shell | |
| `/dashboard/import-review/bus-route-stops` | Entity shell | |
| `/dashboard/import-review/addresses` | Entity shell + `ImportReviewAddressDetailDrawer` | Split validate/promote workflow |
| `/dashboard/import-review/admin-areas` | Entity shell | |
| `/dashboard/import-review/routing-barriers` | Entity shell | Bulk UI exposed |
| `/dashboard/import-review/[family]` | Redirect / unknown-family message | Navigation only |
| `/dashboard/import-review/promotion` | `ImportReviewPromotionClient` | Create batch, ready list, cleanup panel |
| `/dashboard/import-review/promotion/[batchId]` | `ImportReviewPromotionBatchDetailClient` | Validate, promote, dry-runs |
| `/dashboard/import-review/history` | `ImportReviewHistoryClient` | |
| `/dashboard/import-review/history/review-batches/[id]` | Review batch detail | |
| `/dashboard/import-review/history/publish-batches/[id]` | Publish batch detail | Items + stage logs |

**Layout:** `ImportReviewRouteAuthGate` + `ImportReviewSubNav` on all import-review routes.

**Parallel legacy routes (not under `/import-review`):**

| Route | Client |
|-------|--------|
| `/data-review/roads` | `ImportReviewCandidatesClient` — full road routing validation + overrides |
| `/data-review/buildings`, `/data-review/places` | Legacy clients with map preview |

**Build status (inspected):** Dashboard `next build` **PASS** — 73 routes including all import-review pages.

---

## 5. Current database tables used

### `import_review` schema (API reads/writes)

| Table | Role |
|-------|------|
| `review_batches` | Upload package metadata |
| `building_candidates` | Building queue |
| `place_candidates` | Place queue |
| `road_candidates` | Road queue |
| `address_candidates` | Address queue |
| `admin_area_candidates` | Admin area queue |
| `bus_stop_candidates` | Bus stop queue |
| `bus_route_candidates` | Bus route queue |
| `bus_route_variant_candidates` | Variant queue |
| `bus_route_stop_candidates` | Route–stop junction queue |
| `landuse_candidates` | Landuse queue |
| `water_line_candidates` | Water line queue |
| `water_polygon_candidates` | Water polygon queue |
| `routing_barrier_candidates` | Barrier queue |
| `routing_turn_restriction_candidates` | **Not exposed in API** |
| `review_candidate_edits` | Override audit |
| `review_comments` | **No dashboard UI** |
| `review_tasks` | **No dashboard UI** |
| `address_components` | Structured address lines |
| `place_address_links` | Review-time place↔address links |

**Prisma:** no `import_review` models — raw SQL via `getImportReviewPrisma()`.

### `system` schema (publish / history)

| Table | Role |
|-------|------|
| `system_publish_batches` | Promotion batches |
| `system_publish_items` | Per-candidate publish items |
| `system_publish_stage_logs` | Validation/promotion stage audit |
| `system_source_snapshots` | Snapshot lineage |
| `system_review_logs` / `system_review_tasks` | General review tracking |

### Promotion targets

| Schema | Tables |
|--------|--------|
| `core.*` | `core_map_buildings`, `core_places`, `core_streets`, `core_map_landuse`, `core_map_water_*`, `core_bus_*`, `core_admin_areas`, `core_addresses`, … |
| `routing.*` | `routing_barriers` (migration 052 required) |
| `ref.*` | Joined for list/detail dropdowns |

### Migration requirement

Full Supabase chain required (not 024 alone). Minimum set documented in inspection:

```text
022, 024, 025, 026, 027, 032, 041, 042, 043–046, 044, 051, 052, 053–056, 059
```

**Whether target deployment DB has full chain applied:** **UNKNOWN**.

**Startup check:** API verifies `import_review` **schema namespace** only — not individual tables.

---

## 6. Validation status

**Architecture:** Five layers (review-time candidate validation → batch eligibility SQL → publish-batch validation runner → promotion guards → split address promote).

### Product rules vs implementation

| Rule | Status |
|------|--------|
| Validation **errors** block promotion | **Mostly enforced** (SQL eligibility, batch validation, promote preflight, split promote) |
| **Warnings** need confirm + note | **Partially enforced** — batch promote requires `confirm_warnings` + `warning_confirmation_note`; approve-time inconsistent |
| Each entity shows validation status in dashboard | **Not met** — only **addresses** list column + **roads** on legacy table |
| Validation before promotion | **Met** for batch path and split address/place/link; **roads** need `validate-routing` before approval guard |

### Per-family validation (summary)

| Family | Review-time validate API | Batch validation runner |
|--------|--------------------------|-------------------------|
| buildings, landuse, water_*, bus_*, admin_areas, routing_barriers | Batch / approve essentials only | **Yes** (11 families) |
| places | `POST /places/validate` (not on shared drawer) | Yes |
| roads | `POST /roads/:id/validate-routing` | **Skipped** in batch runner |
| addresses | `POST /addresses/validate` | **Not in batch** (split promote) |

### Dashboard display gaps

- List API **stubs** `validation_errors` / `validation_warnings` to `[]` — detail drawer required to see validation.
- No per-family validate button on shared drawer except addresses (+ roads on `/data-review/roads`).
- `POST /addresses/infer-admin-components` — API exists, **no dashboard UI**.

**Live validation with real candidates:** **UNKNOWN**.

---

## 7. Promotion-to-core status

### Batch promotion flow (standard families)

```text
Approved candidates (promotion_status ready)
  → POST /promotion/batches
  → POST …/validate (async)
  → poll progress / logs
  → road/barrier dry-run (when applicable)
  → POST …/promote (confirm_warnings optional)
  → GET …/verify
```

| Expectation | Status |
|-------------|--------|
| Create batch (transactional) | **Met** |
| Validate selected candidates | **Met** (11 families; roads **skipped**) |
| Block hard errors | **Met** |
| Warnings with confirmation | **Met** for batch promote |
| Correct core targets | **Met** per `CORE_TARGETS` |
| Preserve source_refs / normalized_data | **Met** (merge SQL) |
| Verification defaults | **Mostly met** (`unverified`; preserve if already verified on update) |
| 0–100 confidence scale | **Met** |
| Publish batch / item logging | **Met** |
| Soft-hide promoted rows | **Met** (`promotion_status=promoted`; lists exclude by default) |
| No DELETE on normal promote | **Met** |
| **Transactional per-item promote** | **Partial — NOT met** |

**P0 finding:** Per-item batch promote is **not one DB transaction** across core write + `publish_item` update + candidate mark — failure between steps can orphan core rows or desync state.

### Split promotion

- **Addresses / places / place-address-links:** dedicated POST promote endpoints from address drawer.
- Uses `prisma.$transaction` — **transactionally safer** than batch promote loop.
- **No** `system_publish_items` rows for split promote — history is response `items[]` only.

### Env gates (`import-review-config.ts`)

| Flag | Effect |
|------|--------|
| `ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP` | Allows cleanup execute |
| `ENABLE_IMPORT_REVIEW_ROAD_PROMOTION` | Road batch promote |
| `ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION` | Removes 3-item road cap |
| `ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION` | Admin-area bulk cap |
| `ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION` | Barrier live promote |
| `ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION` | Address split promote execute |

**Live promotion with real batches:** **UNKNOWN**.

---

## 8. History/cleanup status

### History

| Surface | Data source | Dashboard |
|---------|-------------|-----------|
| Review batches | `import_review.review_batches` | `/history`, `/history/review-batches/[id]` |
| Publish batches | `system.system_publish_batches` | `/history`, `/history/publish-batches/[id]` |
| Stage logs | `system.system_publish_stage_logs` | Publish batch detail |
| Live overview metrics | `GET /summary` | Overview page (not archive) |

**Split promote history in publish tables:** **No** — response-only.

**Admin audit table beyond publish tables:** **Not inspected** — **UNKNOWN**.

### Cleanup / hiding

| Mechanism | Behavior |
|-----------|----------|
| List hide | Default `include_promoted=false`; UI toggle on entity pages |
| Cleanup dry-run | `POST /cleanup/promoted/dry-run` — counts eligible deletions with reasons |
| Cleanup execute | Requires confirmation `"DELETE PROMOTED REVIEW DATA"` + `ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true` |
| Cleanup families (API) | buildings, places, landuse, water_*, bus_stops, roads, addresses, admin_areas, routing_barriers |
| **No cleanup** | bus_routes, bus_route_variants, bus_route_stops |

**Dashboard:** `ImportReviewPromotionCleanupPanel` on promotion page (dry-run always; execute when API reports `execute_enabled`).

**API-only (no dashboard UI):** `POST /promotion/batches/repair-invalid-promoted`.

---

## 9. Known working flows

Based on static wiring + green compile/tests (not live E2E):

| Flow | Evidence |
|------|----------|
| Dashboard → API layering | No Prisma/DB in dashboard import-review code |
| Route registration | `/api/import-review` matches dashboard client paths |
| Overview summary | `GET /summary` + batch picker |
| Entity list/detail/decision/overrides | Generic `/:family` routes + entity shell |
| Bulk decision (most families) | `POST /:family/bulk-decision` |
| Address drawer workflow | Validate, components, matches, split promote/dry-run |
| Promotion batch create → validate → promote UI | Panels wired to correct endpoints |
| History list + detail | History API consumed by history clients |
| Cleanup dry-run | Panel on promotion page |
| Hide promoted rows | `include_promoted` toggle |
| Auth guard pattern | Dedicated import-review guard; documented curl examples |
| Unit tests | API 107 tests PASS; dashboard 14 tests PASS |
| Typecheck / build | API + dashboard **PASS** (2026-05-29) |

**Families with complete static wiring (WORKING_LIKELY):** buildings, places, bus_stops, landuse, water_lines, water_polygons, addresses (split promote path).

---

## 10. Known broken/unknown flows

### Broken or risky (code-level)

| Flow | Issue |
|------|-------|
| `/dashboard/import-review/roads` | Shared shell **without** routing validate/overrides; full UX only on `/data-review/roads` |
| Routing-barriers bulk approve | Dashboard `supportsBulkActions: true`; API `bulkApprovalAllowed: false` |
| Roads batch validation | Batch validate **skips** roads items — can show “validated” without road checks |
| Addresses in batch create UI | High-risk checkbox includes addresses; **not** batch-promotable |
| Per-item batch promote | Non-atomic orchestration — desync/orphan risk |
| Entity pages without scope | `useEnvDefault=false` — empty list without `?review_batch_id=` |
| 404 family error message | Empty family slug in error text (`import-review.routes.ts`) |
| Stale operator docs | `entity-coverage-matrix.md`, `import-review-ui-feature-matrix.md` outdated |

### API without dashboard UI

- `POST /addresses/infer-admin-components`
- `POST /promotion/batches/repair-invalid-promoted`

### Unknown (not tested in inspection)

| Area | Why unknown |
|------|-------------|
| End-to-end promote with real DB | No live API/Postgres integration run |
| Pipeline Stage J/K data in `import_review` | Pipeline upload status not verified |
| Production auth (JWT admin) | Inspection used static code; dev token path documented |
| List performance at scale | Only buildings/roads have composite list indexes (051, 059) |
| CORS / network in deployed env | Not smoke-tested |
| `review_comments` / `review_tasks` tables | No UI — usage **UNKNOWN** |
| Turn restrictions | Schema in 024; no API family |

---

## 11. Highest-risk problems

| Priority | Problem | Impact |
|----------|---------|--------|
| **P0** | Non-atomic per-item batch promote | Core row written but candidate/publish_item not updated (or reverse) |
| **P0** | Partial DB migrations (024-only) | Address/link/barrier SQL fails at runtime |
| **P0** | Stale operator docs (buildings-only promotion) | Wrong operational decisions |
| **P1** | Roads batch validate skip vs promote | “Validated” batches that did not exercise roads |
| **P1** | Roads UX split (`/import-review/roads` vs `/data-review/roads`) | Reviewers miss routing validation |
| **P1** | Auth/env misconfiguration | 401/403 on all import-review calls |
| **P1** | No cleanup for bus graph families | `import_review` grows after promote |
| **P1** | Routing-barriers bulk UI mismatch | Bulk approve fails at API |
| **P2** | Destructive cleanup if flag enabled | Hard DELETE of candidate rows |
| **P2** | List hides validation JSON | Approve without seeing warnings |

---

## 12. Minimal next implementation plan

Ordered by inspection recommendations (code changes deferred unless explicitly requested):

| Step | Action | Rationale |
|------|--------|-----------|
| 1 | Apply full migration chain on target DB; verify with read-only probes | Prevent runtime SQL failures |
| 2 | Live smoke: API health + `/summary` with correct auth | Confirm reachability before QA |
| 3 | Fix **P0** batch promote transaction (wrap core + publish_item + candidate per item) | Data integrity |
| 4 | Refresh `entity-coverage-matrix.md` and UI feature matrix | Align docs with multi-family reality |
| 5 | Roads UX parity: port routing drawer to `/import-review/roads` or redirect | Close highest UX gap |
| 6 | Align routing-barriers bulk UI with API (`supportsBulkActions: false`) | Stop false bulk affordance |
| 7 | Clarify/remove addresses from batch family picker | Split-only promote path |
| 8 | Add cleanup support for bus_routes / variants / route_stops | Prevent unbounded `import_review` |
| 9 | Add `validation_status` column to shared entity lists | Reviewer visibility |
| 10 | Strengthen API startup schema check (beyond namespace) | Fail fast on partial migrate |
| 11 | Dashboard for `repair-invalid-promoted` and/or `infer-admin-components` | Operational completeness |

---

## 13. Manual QA checklist

Use after API is running, DB migrated, and auth configured. Mark each **PASS / FAIL / SKIP / UNKNOWN**.

### Environment

- [ ] `NEXT_PUBLIC_API_BASE_URL` points to running API (default local port **3001** per auth docs)
- [ ] Auth works: JWT admin Bearer **or** dev `x-import-review-admin-token` / `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN`
- [ ] Target DB has full migration chain (section 5 minimum set)
- [ ] At least one `import_review.review_batches` row with candidate data exists

### Scope and navigation

- [ ] `/dashboard/import-review?review_batch_id=<id>` loads summary counts
- [ ] Batch picker resolves 409 ambiguity when multiple batches match snapshot
- [ ] Sub-nav links reach all 13 entity pages without 404
- [ ] Unknown `[family]` slug shows help or redirects

### Entity review (pick buildings + one other family)

- [ ] Entity page with `?review_batch_id=` loads list (not empty scope message)
- [ ] Filters, search, sort, pagination update URL and refetch
- [ ] Detail drawer loads full candidate (validation JSON visible when present)
- [ ] PATCH decision (approve/reject) succeeds and list refreshes
- [ ] PATCH overrides saves and reflects in detail
- [ ] Bulk approve/reject works (non-roads, non-routing-barriers)
- [ ] `include_promoted` toggle shows/hides promoted rows

### Addresses (split path)

- [ ] Address drawer: validate → status/blockers update
- [ ] Promote dry-run → promote (if `ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION=true`)
- [ ] Place/link validate and promote from drawer when applicable

### Roads

- [ ] `/data-review/roads?review_batch_id=` — validate-routing + overrides work
- [ ] `/dashboard/import-review/roads?review_batch_id=` — confirm routing panel **missing** (expected gap until fixed)

### Promotion

- [ ] Promotion page: ready candidates + batch list load
- [ ] Create batch (buildings or default families) → batch detail opens
- [ ] Validate batch → progress/logs poll → validation summary shows blocked/warning counts
- [ ] Road dry-run (if batch includes roads) before promote
- [ ] Promote with `confirm_warnings` + note when warnings present
- [ ] Verify endpoint / history publish batch shows items + stage logs

### History and cleanup

- [ ] History lists review and publish batches
- [ ] Publish batch detail shows items and stage logs
- [ ] Cleanup dry-run returns counts; execute **only** if intentionally enabled

### Error states

- [ ] Wrong/missing auth → clear 401/403 (not silent empty data)
- [ ] Missing `review_batch_id` on entity page → empty scope message
- [ ] API down → dashboard error state (not infinite loading)

---

## 14. Commands used for inspection

**Inspection date:** 2026-05-29  
**Mode:** Static code read + compile/test (no `npm install`, no live curl, no DB mutations).

### Local build and test

```bash
# From repo root — verify node_modules present (install skipped)
test -d apps/api/node_modules && test -d apps/dashboard/node_modules

# API
cd apps/api
npm run typecheck          # tsc --noEmit
npm run build              # tsc -p tsconfig.json
node --import tsx --test src/modules/import-review/**/*.test.ts

# Dashboard
cd apps/dashboard
npx tsc --noEmit
npm run build              # next build
node --import tsx --test src/features/import-review/**/*.test.ts
```

### Static analysis

```bash
# TODO/FIXME scan (import-review scope)
rg 'TODO|FIXME' apps/api/src/modules/import-review apps/dashboard/src/features/import-review
```

### Recommended smoke (documented in inspection, **not run**)

```bash
API="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:3001}"

# Health (no auth)
curl -sS "$API/health"

# Import-review auth probe
curl -sS -w "\nHTTP %{http_code}\n" \
  "$API/api/import-review/summary?review_batch_id=1" \
  -H "x-import-review-admin-token: $IMPORT_REVIEW_ADMIN_TOKEN"

# OpenAPI import-review paths
curl -sS "$API/docs/json" | jq '.paths | keys[] | select(startswith("/api/import-review"))' | head
```

See also: `apps/api/scripts/import-review-admin-curl-examples.sh`, `apps/api/docs/import-review-auth.md`.

### Results (2026-05-29)

| Check | Result |
|-------|--------|
| API typecheck | **PASS** |
| API build | **PASS** |
| API import-review tests | **PASS** — 107 tests, 0 fail |
| Dashboard typecheck | **PASS** |
| Dashboard build | **PASS** — 73 routes |
| Dashboard import-review tests | **PASS** — 14 tests, 0 fail |
| Live API smoke / browser E2E | **NOT RUN** |

---

**Related documents:** [`END_TO_END_INSPECTION.md`](./END_TO_END_INSPECTION.md) (full audit), [`entity-coverage-matrix.md`](./entity-coverage-matrix.md) (partially outdated).
