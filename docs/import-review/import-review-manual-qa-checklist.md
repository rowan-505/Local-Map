# Import Review — Manual QA Checklist

**Purpose:** Minimal hands-on verification of import-review API + dashboard before trusting production workflows.  
**Based on:** Static inspection in [`END_TO_END_INSPECTION.md`](./END_TO_END_INSPECTION.md) and [`import-review-current-status.md`](./import-review-current-status.md).  
**Does not replace:** automated tests, full family-by-family promotion matrix, or pipeline Stage J/K upload verification.

---

## Before you start

| Prerequisite | Notes |
|--------------|-------|
| API running | Default local port **3001** (`apps/api`) |
| Dashboard running | `NEXT_PUBLIC_API_BASE_URL` must point at API |
| Auth configured | Token tier: `IMPORT_REVIEW_ADMIN_TOKEN` on API + matching dashboard header/env **or** JWT admin (`roles: ["admin"]`) when token unset on API |
| DB migrated | Full Supabase chain (not `024` alone) — see status doc section 5 |
| Test data | At least one `import_review.review_batches` row with **approved**, validation-clean candidates (recommend **buildings** for promote path) |
| Record scope | Note `review_batch_id` and `source_snapshot_version` used for all tests |

**Legend:** ☐ PASS · ☐ FAIL · ☐ SKIP (no data) · ☐ N/A

---

## 1. API health

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **1.1** | `curl -sS "$API/health"` (no auth) | HTTP **200**; body indicates API is up | API not running, wrong host/port, or process crash |
| **1.2** | Open `$API/docs` or `GET $API/docs/json` | OpenAPI loads; paths include `/api/import-review/*` | Wrong service, import-review routes not registered |

---

## 2. Admin auth / header behavior

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **2.1** | `GET /api/import-review/summary?review_batch_id=<id>` **without** auth header | HTTP **401** (token tier) or **401** (JWT tier) | Auth guard missing or bypass misconfigured |
| **2.2** | Same request with wrong `x-import-review-admin-token` (token tier) | HTTP **403** | Token mismatch handling broken |
| **2.3** | Same request with correct admin token **or** `Authorization: Bearer <admin-jwt>` | HTTP **200** (or **404/409** scope business error — still authenticated) | Dashboard env out of sync with API auth mode |
| **2.4** | JWT with non-admin role | HTTP **403** “admin role” message | RBAC regression |
| **2.5** | Open `/dashboard/import-review` without credentials | Auth gate blocks or redirects; no silent empty app | `ImportReviewRouteAuthGate` or token env missing |

Run scripted examples: `npm run curl-examples:import-review-auth --prefix apps/api` (see [`import-review-auth.md`](../../apps/api/docs/import-review-auth.md)).

---

## 3. Import-review overview page

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **3.1** | Open `/dashboard/import-review?review_batch_id=<id>` | Page loads; family rollup counts visible; no infinite spinner | Summary API error, missing scope, or CORS/base URL wrong |
| **3.2** | Check loading then content | Brief loading state, then data or explicit empty state | Stuck loading = failed fetch; blank with no message = error UI gap |
| **3.3** | Click a family link in overview | Navigates to entity page with same batch in URL | Sub-nav or scope propagation broken |

---

## 4. Each entity list page

Spot-check **all 13** routes (can fail fast on first broken one, but record each).

| Slug | Route |
|------|-------|
| buildings | `/dashboard/import-review/buildings?review_batch_id=<id>` |
| places | `.../places?...` |
| roads | `.../roads?...` |
| landuse | `.../landuse?...` |
| water-lines | `.../water-lines?...` |
| water-polygons | `.../water-polygons?...` |
| bus-stops | `.../bus-stops?...` |
| bus-routes | `.../bus-routes?...` |
| bus-route-variants | `.../bus-route-variants?...` |
| bus-route-stops | `.../bus-route-stops?...` |
| addresses | `.../addresses?...` |
| admin-areas | `.../admin-areas?...` |
| routing-barriers | `.../routing-barriers?...` |

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **4.1** | Open each route above with `review_batch_id` | Page renders table shell; **200** list fetch (rows or empty state) | Missing entity config, wrong API family key, or scope required |
| **4.2** | Open entity page **without** `review_batch_id` | Explicit empty-scope message (not fake empty table) | `useEnvDefault=false` regression — silent failure |
| **4.3** | **Roads only:** compare `/import-review/roads` vs `/data-review/roads` | Data-review route has routing-validation UI; import-review route uses shared shell only | Known UX split — record if routing panel missing on import-review |

**SKIP** families with zero candidates in batch (mark SKIP, do not count as PASS).

---

## 5. Batch selector

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **5.1** | On overview, open batch picker | Lists review batches from API | `GET /batches` failure |
| **5.2** | Select a different batch | URL updates `review_batch_id`; summary + lists refetch | Scope state not synced to URL/query client |
| **5.3** | With ambiguous snapshot (multiple batches), trigger 409 | Picker or error prompts explicit batch selection | Ambiguity handling broken — wrong data scope |

---

## 6. Filters / search / pagination

Use **buildings** (or any family with ≥2 rows).

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **6.1** | Apply a filter (e.g. review status) | URL query updates; table refetches; row count changes appropriately | Filter param not sent to `GET /:family` |
| **6.2** | Type search text (if enabled for family) | Debounced refetch; matching rows only | Search param mismatch with API |
| **6.3** | Change sort column/direction | URL updates; order changes | Sort key not mapped to API |
| **6.4** | Go to page 2 (or change page size) | Pagination controls work; total count stable | Count query (`include_total=true`) broken |

---

## 7. Detail drawer

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **7.1** | Click a row | Drawer opens; loading then detail content | `GET /:family/:id` failure |
| **7.2** | Compare list vs drawer fields | Drawer shows fuller payload (names, geometry summary, match info) | Detail mapping wrong in config |
| **7.3** | Close drawer | Selection clears; list unchanged | UI state bug only |

---

## 8. Validation panel

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **8.1** | **Addresses:** open drawer → run Validate | Status/blockers update; `POST /addresses/validate` succeeds | Address validation pipeline broken |
| **8.2** | **Roads:** on `/data-review/roads`, run validate-routing | Structured routing errors/warnings appear | `POST /roads/:id/validate-routing` failure |
| **8.3** | **Promotion batch:** open batch detail → Validate | Validation panel runs; progress/logs poll; summary shows blocked/warning counts | Batch validation runner or async job broken |
| **8.4** | **Buildings (shared drawer):** open detail | Errors/warnings shown **if present** in detail JSON (list may hide them) | Expected gap if list approved without opening detail |

**Note:** Most families have no per-row Validate button on shared drawer — batch validation (8.3) is the primary path for buildings/places/etc.

---

## 9. Override editing

Use **buildings** (has overrides editor on shared drawer).

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **9.1** | Open drawer → edit an allowed override field → save | Success toast/message; drawer reflects new effective value | `PATCH /:family/:id/overrides` rejected or wrong allowlist |
| **9.2** | Reload drawer | Override persists | DB write or refetch bug |
| **9.3** | **Roads:** try overrides on `/data-review/roads` only | Road overrides save via road-specific patch | Overrides not wired on `/import-review/roads` (known gap) |

---

## 10. Single review action

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **10.1** | Approve one **pending** candidate (note required if warnings) | HTTP **200**; row shows approved; `review_decision` updated | Essential fields, validation guard, or PATCH decision error |
| **10.2** | Reject one candidate with note | Row shows rejected | Decision API or UI refresh failure |
| **10.3** | Retry approve on duplicate/manual-protected (if applicable) | Clear error or force path with explicit confirmation | Server guard bypass or unclear UX |

---

## 11. Bulk review action

Use **buildings** or **places** (bulk allowed). **Do not** use routing-barriers for bulk approve (API blocks bulk).

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **11.1** | Select multiple rows → bulk approve | `POST /:family/bulk-decision` succeeds; rows update | Bulk endpoint or selection payload wrong |
| **11.2** | Bulk reject with shared note | All selected rows rejected | Partial update without error message |
| **11.3** | **Routing-barriers:** attempt bulk approve | API error or blocked — UI should not silently succeed | Dashboard/API policy mismatch (known risk) |

---

## 12. Create promotion batch

Use **buildings** (reference path). Candidate must be **approved** and promotion-eligible.

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **12.1** | Open `/dashboard/import-review/promotion?review_batch_id=<id>` | Ready candidates + existing publish batches load | Promotion list APIs failure |
| **12.2** | Check batch eligibility (UI or `GET /promotion/batch-eligibility`) | Counts match approved ready rows | Eligibility SQL wrong |
| **12.3** | Create batch (families: buildings; scope: current review batch) | HTTP **201/200**; redirects or links to new publish batch id; candidates marked `batched` | Batch create transaction or scope error |
| **12.4** | **Dry-run create** (if UI offers dry_run on create) | Response shows would-create counts; no publish batch persisted | Dry-run flag ignored |

**SKIP** if no approved eligible candidates.

---

## 13. Validate promotion batch

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **13.1** | On batch detail, click Validate | HTTP **202** or async start; status moves to validating | Validation runner not starting |
| **13.2** | Poll progress / logs | Stage logs appear; items get validation_result | Progress endpoint or stage log write failure |
| **13.3** | Wait for completion | Batch summary: `can_promote` true when no blocked items; blocked count accurate | Validation rules or summary aggregation bug |
| **13.4** | Batch including **roads** | Road items show **skipped** in batch validation (not full road routing check) | Unexpected if roads fully validated here — batch runner excludes roads by design |

---

## 14. Dry-run promotion (where available)

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **14.1** | **Batch create dry-run** (12.4) | No commit; eligibility preview only | Create endpoint ignores dry_run |
| **14.2** | **Road batch:** run road dry-run panel (`GET/POST .../road-dry-run`) | Dry-run summary stored on batch; errors block promote | Road dry-run module or env flag |
| **14.3** | **Routing-barriers batch:** run barrier dry-run panel | Same pattern for barriers | Barrier dry-run or `ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION` |
| **14.4** | **Addresses (split):** promote dry-run from address drawer | Preview response; no core write | Split promote dry-run endpoint failure |

**SKIP** families/panels not in your test batch.

---

## 15. Promote to core

Use the publish batch from §12–13. Ensure env allows promote (buildings usually unrestricted; roads/barriers/addresses need flags).

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **15.1** | On batch detail, click Promote (confirmation text if required) | Async promote starts; progress updates | Guard failure: blocked items, missing dry-run, env flag off |
| **15.2** | If warnings require confirmation | UI prompts `confirm_warnings` + note; promote succeeds only after both | Warning policy not enforced |
| **15.3** | Wait for completion | Batch status promoted (or partial with item-level failures logged); verify endpoint available | Promote runner crash or non-atomic item failure |
| **15.4** | **Addresses:** use drawer split promote (not batch runner) | `POST /addresses/promote` succeeds when validated + env `ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION=true` | Wrong path — addresses not batch-promotable |

---

## 16. Confirm core row exists

Requires DB read access (SQL) or trusted admin core-review API if available.

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **16.1** | From promote response / publish batch item, note `target_id` (core row id) | Non-null target_id on successful publish_item | Promote wrote candidate status but not core row |
| **16.2** | Query core table for test family (e.g. `core.core_map_buildings` where `id = <target_id>`) | Row exists with expected geometry/name fields | Wrong target table, insert failed, or orphan from non-atomic promote |
| **16.3** | **Split address promote** | Row in `core.core_addresses` (and components if applicable) | Split transaction rolled back or partial write |

Example (adjust table/id):

```sql
SELECT id, external_id, source_refs, normalized_data, verification_status
FROM core.core_map_buildings
WHERE id = <target_id>;
```

---

## 17. Confirm source_refs / normalized_data preserved

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **17.1** | Before promote: note candidate `source_refs` / `normalized_data` (detail drawer or SQL) | Baseline recorded | — |
| **17.2** | After promote: query core row (same id) | Lineage merged: import-review keys present in `source_refs`; `normalized_data` retains staging fields + promotion stamp | Merge SQL regression — data loss |
| **17.3** | Check publish batch item `before_data` / `after_data` (history UI or SQL) | Audit trail shows transition | Logging gap — harder to debug lineage |

---

## 18. Confirm promoted row hidden / marked (not hard deleted)

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **18.1** | Entity list with default filters (`include_promoted=false`) | Promoted candidate **not** in list | List filter ignores `promotion_status` |
| **18.2** | Toggle **include promoted** | Row reappears with promoted status | Toggle not sent to API |
| **18.3** | SQL: `SELECT id, promotion_status, promoted_core_id FROM import_review.building_candidates WHERE id = <candidate_id>` | Row **still exists**; `promotion_status = 'promoted'`; `promoted_core_id` set | Normal promote incorrectly DELETE'd row |
| **18.4** | Confirm you did **not** run cleanup execute | Candidate row still present after §18.3 | Confused cleanup with promote |

Hard delete only happens via **`POST /cleanup/promoted/execute`** with env flag — not normal promote.

---

## 19. History page shows batch

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **19.1** | Open `/dashboard/import-review/history` | Review batches and publish batches lists load | History API failure |
| **19.2** | Open publish batch detail for batch from §12 | Shows items, statuses, timestamps | Detail route or id mismatch |
| **19.3** | Open linked review batch (if shown) | Review batch metadata matches scope used in test | Cross-link broken in history service |
| **19.4** | Stage logs visible on publish batch detail | Validation + promotion stages listed | Missing migration `025` or log write failure |
| **19.5** | **Split address promote only** | May **not** appear as publish batch — expected gap | Do not fail unless batch path was used |

---

## 20. Cleanup panel behavior

On `/dashboard/import-review/promotion` (cleanup panel).

| ID | Steps | Expected result | If it fails |
|----|-------|-----------------|-------------|
| **20.1** | Run cleanup **dry-run** with scope | Returns per-family counts and reasons (`not_promoted`, `core_row_missing`, etc.) | Dry-run endpoint or scope error |
| **20.2** | With `ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=false` (default) | Execute button disabled or API returns execute not enabled | Unsafe delete accidentally enabled |
| **20.3** | Execute **only in disposable env** with flag true + confirmation text | Candidate rows hard-deleted per eligibility rules | Wrong rows deleted — **stop and treat as incident** |
| **20.4** | Bus graph families after batch promote | Dry-run may show **0** cleanup — no API support for bus_routes/variants/route_stops | Expected gap; rows linger in import_review |

---

## Minimal happy-path smoke (recommended order)

One session, **buildings** only, with DB access for §16–18:

```text
1.1 → 2.3 → 3.1 → 4.1 (buildings) → 5.2 → 6.1 → 7.1 → 9.1 → 10.1
→ 11.1 → 12.3 → 13.1–13.3 → 15.1–15.3 → 16.2 → 17.2 → 18.1–18.3 → 19.2 → 20.1
```

Optional second session: **addresses** drawer path (§8.1, §14.4, §15.4) and **roads** on `/data-review/roads` (§8.2).

---

## Sign-off

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| API URL | |
| Dashboard URL | |
| `cd `review_batch_id` | |
| Auth mode | Token / JWT |
| Families tested | |
| Promote tested | Yes / No / SKIP |
| Cleanup execute tested | Yes / No (default: **No**) |
| Overall | PASS / FAIL / PARTIAL |

**Related:** [`import-review-current-status.md`](./import-review-current-status.md) · [`END_TO_END_INSPECTION.md`](./END_TO_END_INSPECTION.md) · [`import-review-auth.md`](../../apps/api/docs/import-review-auth.md)
