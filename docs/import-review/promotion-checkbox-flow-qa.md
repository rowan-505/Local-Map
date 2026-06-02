# Import Review — Checkbox promotion flow (manual QA)

**Scope:** Checkbox-based publish batch creation (`/dashboard/import-review/promotion`) and batch detail validate/promote.  
**Out of scope:** Legacy bus import-review entity pages (redirect to Import Transport), automatic point rules, tile builds.

**Legend:** ☐ PASS · ☐ FAIL · ☐ SKIP (no data)

---

## Before you start

| Prerequisite | Notes |
|--------------|--------|
| API + dashboard running | `NEXT_PUBLIC_API_BASE_URL` points at API; admin auth configured |
| Review batch | At least one `import_review.review_batches` row with **approved** candidates in families you will test |
| Record IDs | Note `review_batch_id`, created `publish_batch_id`, and a sample `candidate_id` per family |
| Roads / barriers (tests 4–5) | API env flags and dry-run panels only apply when those families have ready items |

**Primary URLs**

- Create batch: `/dashboard/import-review/promotion?review_batch_id=<review_batch_id>`
- Batch detail: `/dashboard/import-review/promotion/<publish_batch_id>?review_batch_id=<review_batch_id>`
- Entity queue (promoted toggle): `/dashboard/import-review/<family>?review_batch_id=<review_batch_id>`

---

## 1. Single family — buildings

| | |
|--|--|
| **Setup** | Review batch with ≥1 **approved**, promotion-ready **building** candidate (`review_decision=approved`, not already `promotion_status=promoted`, validation clean or warnings per test 6). |
| **Action** | On promotion page: select only **Buildings** → confirm eligibility counts → **Create publish batch** → open batch detail → **Validate batch** → **Promote to core** (confirm `PROMOTE`). |
| **Expected UI** | Eligibility shows buildings row with Ready > 0; create redirects to batch detail; validation progress completes; promote completes without page reload; buildings import-review list drops promoted rows (toggle off). |
| **Expected API/DB** | `GET /promotion/eligibility?families=buildings` → 200, `can_create_batch: true`; `POST /promotion/batches` → draft batch with building items; validate → batch `ready`; promote → `system_publish_items` success, `import_review.building_candidates.promotion_status=promoted`, row in `core.core_map_buildings` (or update path if duplicate rules apply). |

---

## 2. Multi family — buildings + places + landuse

| | |
|--|--|
| **Setup** | Same review batch with approved ready candidates in **buildings**, **places**, and **landuse**. |
| **Action** | Check all three families → create batch → validate → promote on batch detail. |
| **Expected UI** | Eligibility table lists three families; batch detail **Selected families** shows all three; item counts by family match selection; post-promote, all three entity queues hide promoted rows by default. |
| **Expected API/DB** | Batch `entity_families` (or item counts) includes `buildings`, `places`, `landuse`; promote writes to `core.core_map_buildings`, `core.core_places`, `core.core_map_landuse`; corresponding import_review candidate tables marked promoted. |

---

## 3. All selected normal families

| | |
|--|--|
| **Setup** | Review batch with ready candidates in each **normal** family: buildings, places, landuse, water_lines, water_polygons (as data allows). |
| **Action** | Select every checkbox under **Normal** (none under High-risk) → eligibility → dry-run (optional) → create → validate → promote. |
| **Expected UI** | Five normal families in eligibility; high-risk warning banner absent; batch detail shows five active families; promote summary lists promoted families. |
| **Expected API/DB** | `POST /promotion/batches` includes all five families; promote targets match config (`core.core_map_*` tables); no `routing.routing_barriers` or `core.core_streets` items unless accidentally selected. |

---

## 4. High-risk — roads warning

| | |
|--|--|
| **Setup** | Review batch with approved **roads** candidates; road promotion env enabled on API if required for dry-run/promote. |
| **Action** | Select **Roads** only (or roads + normals) → observe warnings on create page → create batch → run **Road promotion dry-run** on detail → validate → promote. |
| **Expected UI** | High-risk warning on create page when roads selected; eligibility target `core.core_streets`; batch detail shows road dry-run panel; promote blocked until dry-run satisfied (per env/rules); after promote, roads queue reflects promoted rows hidden. |
| **Expected API/DB** | Eligibility `risk_level: high_risk` for roads; `GET .../road-dry-run` returns counts; promote stage `promote_roads_to_core` in logs; `import_review` road candidates promoted; `core.core_streets` receives rows. |

---

## 5. Routing barriers → `routing.routing_barriers`

| | |
|--|--|
| **Setup** | Review batch with approved **routing_barriers** candidates; routing-barrier promotion env flag enabled on API. |
| **Action** | Select **Routing barriers** → note info banner on create page → create → **Routing barrier dry-run** on detail → validate → promote. |
| **Expected UI** | Banner: promotes to **routing.routing_barriers**, not `core.*`; dry-run panel visible; promote disabled until dry-run/env satisfied; target column on detail shows `routing.routing_barriers`. |
| **Expected API/DB** | Publish items `entity_family=routing_barriers`; promote writes `routing.routing_barriers` (not core schema); import_review `routing_barrier` candidates marked promoted. |

---

## 6. Warning candidates — include / exclude

| | |
|--|--|
| **Setup** | Review batch with at least one **approved** candidate that has **validation warnings** but no blocking errors (family with Warnings > 0 in eligibility when `include_warnings` is false). |
| **Action** | A) Leave **Include validation warnings** unchecked → note Ready count. B) Check **Include validation warnings** → note Ready increases → create batch with warnings included → validate → promote (add warning note if promote modal requires it). |
| **Expected UI** | Ready count rises when include warnings is on; eligibility messages mention warnings; promote confirmation may require warning note when batch has warning-level validation results. |
| **Expected API/DB** | `GET /promotion/eligibility?include_warnings=false` excludes warning-only rows from ready; `include_warnings=true` includes them in batch creation; promoted rows stored with warning metadata in publish/validation result as designed. |

---

## 7. Bus family rejected

| | |
|--|--|
| **Setup** | None required in UI (bus families are not in checkbox list). Optional: `curl` or devtools to hit API with `families=bus_routes`. Legacy batch with bus publish items if testing read-only path. |
| **Action** | A) Confirm promotion page has **no** bus checkboxes. B) `GET /api/import-review/promotion/eligibility?review_batch_id=<id>&families=bus_routes`. C) Open an **old** publish batch that still contains bus items (if available). |
| **Expected UI** | No `bus_routes`, `bus_stops`, etc. in family checkboxes; API error not shown in normal flow; legacy batch shows **Deprecated transport families (read-only)** and message **Transport promotion moved to Import Transport.**; Validate/Promote disabled. |
| **Expected API/DB** | Eligibility/create with `bus_routes` → **409** `TRANSPORT_PROMOTION_DEPRECATED`, message *Transport promotion moved to Import Transport.*; validate/promote on legacy bus batch → same class of rejection; no new core.bus promotions. |

---

## 8. Promoted rows hidden by default

| | |
|--|--|
| **Setup** | Entity family with at least one candidate already `promotion_status=promoted` in the review batch (from test 1 or prior run). |
| **Action** | Open that family queue, e.g. `/dashboard/import-review/buildings?review_batch_id=<id>` — **Show promoted** unchecked (default). |
| **Expected UI** | Promoted candidates **not** in table; total count excludes them; no manual browser refresh needed after promotion from another tab if caches invalidated. |
| **Expected API/DB** | `GET /api/import-review/buildings?review_batch_id=<id>&include_promoted=false` (or family route) omits `promotion_status=promoted`; list `total` matches filtered count. |

---

## 9. Show promoted toggle

| | |
|--|--|
| **Setup** | Same as test 8 — batch with promoted rows. |
| **Action** | On entity filters panel, check **Show promoted** → apply filters if needed. |
| **Expected UI** | Promoted rows appear; **Promoted** badge on row (first column) and promotion column shows promoted status; unchecking hides them again. URL may include `include_promoted=true`. |
| **Expected API/DB** | `include_promoted=true` returns promoted rows; count query uses same filter; detail by ID still loads promoted candidate when opened directly. |

---

## 10. Core Review data after promotion

| | |
|--|--|
| **Setup** | Complete promote for at least one family (e.g. buildings or places) with known candidate names/IDs. |
| **Action** | Without full page reload, open **Core review** overview → open promoted family module list (e.g. Buildings / Places). |
| **Expected UI** | Overview totals refresh; module list shows newly promoted core rows (search or sort to find); import-review promoted rows remain hidden with toggle off. |
| **Expected API/DB** | `GET /core-review/<module>` returns new/updated rows; import_review candidate has `promoted_core_id` (or equivalent) populated; core target table row exists and matches promotion batch verify counts where run. |

---

## 11. Batch detail — validation logs

| | |
|--|--|
| **Setup** | Draft or validated publish batch on detail page. |
| **Action** | Click **Validate batch**; watch progress bar and expand **operation / stage logs** (validation section). |
| **Expected UI** | Status moves to validating then ready/failed; percent advances; log lines show stages (load batch, per-family validation, summary); per-family valid/warning/blocked counts in log details when present; no full page reload. |
| **Expected API/DB** | `POST .../batches/:id/validate` → 202 or async completion; `GET .../progress` `workflow=validation`; `GET .../logs` contains `validate_*` stage keys; `validation_result` on batch with `by_entity` counts; candidates may have `validation_errors` / `validation_warnings` updated. |

---

## 12. Batch detail — promotion logs

| | |
|--|--|
| **Setup** | Batch in **ready** status after successful validation; road/barrier dry-runs done if applicable. |
| **Action** | **Promote to core** → confirm → watch promotion progress and logs panel. |
| **Expected UI** | Promoting state; progress percent; logs list stages (`promote_*_to_core`, `mark_import_review_promoted`, etc.); success/failed counts on summary cards; entity lists and core-review refresh without manual reload (tests 8–10). |
| **Expected API/DB** | `POST .../batches/:id/promote` → promoting then `promoted` / `partially_promoted` / `failed`; `GET .../logs` promotion stages; `system_publish_items` terminal statuses; import_review candidates `promotion_status=promoted`; core/routing target rows inserted/updated; batch `promotion_result` populated. |

---

## Quick smoke (5 min)

1. Open promotion with `review_batch_id` → select **Buildings** → eligibility loads.  
2. Create batch → validate → promote one building.  
3. Buildings list: promoted row hidden; toggle on → row visible.  
4. Core review → buildings: new row visible.  
5. Confirm no bus checkboxes; bus API call returns 409 if tried.

---

## Related docs

- [`import-review-manual-qa-checklist.md`](./import-review-manual-qa-checklist.md) — broader import-review QA  
- [`import-review-current-status.md`](./import-review-current-status.md) — feature status  
- API auth examples: `apps/api/docs/import-review-auth.md`
