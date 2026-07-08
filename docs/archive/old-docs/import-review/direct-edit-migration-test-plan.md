---
status: archived
reason: replaced by docs/archive/old-docs/import-review/direct-edit-migration-test-plan.md
archived_at: 2026-07-01
---

# Import Review Direct-Edit Migration Test Plan

## Dashboard Route Consistency Regression Check

Run this lightweight check to ensure roads stays aligned with the reusable import-review entity route pattern:

```bash
node tools/import-review/check-import-review-dashboard-route-consistency.mjs
```

What it verifies:

- `roads` page imports `createImportReviewEntityRoutePage` (same helper as `landuse`)
- roads route uses `createImportReviewEntityRoutePage("roads")`
- roads page does **not** import old road override panel
- roads page does **not** import legacy data-review candidates client
- roads config is registered in `importReviewEntityConfigs`

## Typecheck

```bash
cd apps/dashboard && npx tsc --noEmit
```
