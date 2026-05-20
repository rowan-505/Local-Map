# Import Review UI — Consistency Checklist

Internal checklist for verifying dashboard import-review entity pages after the shared entity UI framework rollout.

**Shared stack:** `ImportReviewEntityPageShell` → `useImportReviewEntityPage` → entity config in `apps/dashboard/src/features/import-review/config/`.

**Last updated:** 2026-05-20

---

## Route → implementation map

| Entity | `/import-review/{slug}` | `/data-review/{slug}` | Notes |
|--------|-------------------------|------------------------|-------|
| Buildings | Entity shell | Entity shell + `showMapPreview` | Safe-filter bulk actions (`showFilterBulkActions`) |
| Places | Entity shell | Entity shell + `showMapPreview` | |
| Roads | **Legacy** `ImportReviewCandidatesClient` | Legacy + map | Routing-validation drawer — TODO migrate |
| Bus stops | Entity shell | — | |
| Landuse | Entity shell | — | |
| Water lines | Entity shell | — | |
| Water polygons | Entity shell | — | |
| Addresses | Entity shell | — | |
| Admin areas | Entity shell | — | |
| Routing barriers | Entity shell | — | |

**Out of scope (unchanged):** `/import-review` overview, `/import-review/history/*`, `/import-review/promotion/*`.

---

## Per-page consistency (entity shell)

Use the same `review_batch_id=2` (or your test batch) on each route.

### Scope & batch context

- [ ] Scope bar: snapshot + review batch apply
- [ ] Batch context loading banner while resolving scope
- [ ] Ambiguous batch picker when multiple batches match snapshot
- [ ] URL sync: resolved `review_batch_id` written after list load

### Filters

- [ ] Standard filters: match_status, auto_action, review_status, review_decision, promotion_status
- [ ] Search (`q`), sort, page size, offset pagination
- [ ] `include_promoted` where config includes it
- [ ] **Buildings only:** `class_code` filter + filter-options load
- [ ] Applying filters: compact info banner + list refresh

### Table & selection

- [ ] Config-driven columns (status badges where applicable)
- [ ] Row click opens detail drawer
- [ ] Row actions menu (approve / reject / needs more review / ignore)
- [ ] Selection checkboxes when `supportsBulkActions: true`
- [ ] Selection cleared on page/filter/scope change (not on every refetch)
- [ ] Pagination when `total > limit`

### Bulk actions (`supportsBulkActions: true`)

- [ ] Bulk bar hidden when `selectedCount === 0`
- [ ] Preview approve, approve, reject, needs more review, ignore
- [ ] Danger force / manual_protected / duplicate_candidate handling
- [ ] **Buildings only:** safe-filter dry-run + apply bulk approve

### Loading & errors

- [ ] Initial load: loading banner + skeleton table (no empty table flash)
- [ ] Refresh with existing rows: inline “refreshing” spinner
- [ ] Filter-options loading spinner in filters panel
- [ ] API errors via `ImportReviewErrorState`

### Detail drawer

- [ ] Summary, validation section (when present on row)
- [ ] Map preview in drawer when `supportsMapPreview`
- [ ] Override editor when `supportsOverrideEditor`
- [ ] Decision + note save
- [ ] Promoted rows: override edit blocked with message

### Data-review sidebar map (`showMapPreview`)

- [ ] Sticky sidebar on xl breakpoint
- [ ] Preview when drawer open or exactly one row selected
- [ ] Hint when no row selected

---

## Roads legacy-only checks

`/import-review/roads?review_batch_id=2`

- [ ] Table + filters (no bulk bar — `supportsBulkActions: false`)
- [ ] Road routing validation banners in drawer
- [ ] `confirm_routing_warnings` on approve when required
- [ ] `ImportReviewRoadOverridesPanel` + street geometry map
- [ ] `matched_auto_update` approval flow

---

## Manual test URLs

Replace `2` with a valid batch in your environment.

```
/import-review/buildings?review_batch_id=2
/import-review/places?review_batch_id=2
/import-review/roads?review_batch_id=2
/import-review/bus-stops?review_batch_id=2
/import-review/landuse?review_batch_id=2
/import-review/water-lines?review_batch_id=2
/import-review/water-polygons?review_batch_id=2
/import-review/addresses?review_batch_id=2
/import-review/admin-areas?review_batch_id=2
/import-review/routing-barriers?review_batch_id=2
```

**Regression (non-entity):**

```
/import-review?review_batch_id=2
/import-review/history
/import-review/promotion
```

**Data-review (map sidebar):**

```
/data-review/buildings?review_batch_id=2
/data-review/places?review_batch_id=2
/data-review/roads?review_batch_id=2
```

---

## Code ownership (avoid re-duplicating)

| Concern | Location |
|---------|----------|
| Entity config | `features/import-review/config/entities/*.ts` |
| Route pages | `createImportReviewEntityRoutePage` in `features/import-review/routes/importReviewEntityRoutePage.ts` |
| Page UI | `features/import-review/components/ImportReviewEntityPage.tsx` |
| Page state | `features/import-review/hooks/useImportReviewEntityPage.ts` |
| API | `features/import-review/api/importReviewApiClient.ts` |
| Legacy roads | `app/(admin)/import-review/_components/ImportReviewCandidatesClient.tsx` |
| Deprecated buildings monolith | `ImportReviewBuildingsClient.tsx` (unused by routes) |

---

## Follow-ups

1. Port roads routing-validation UX into `ImportReviewDetailDrawer` (or `CandidateValidationSection` + road overrides module), then switch `/import-review/roads` to entity shell.
2. Delete `ImportReviewCandidatesClient.tsx` and `ImportReviewBuildingsClient.tsx` after roads migration and confirming no external imports.
3. Move `ImportReviewReviewActionsMenu` / `importReviewTableUi` under `features/import-review` when touching those files next.
