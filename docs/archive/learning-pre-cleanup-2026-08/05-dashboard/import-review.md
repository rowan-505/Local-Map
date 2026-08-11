---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Dashboard import review module
---

# Import review (dashboard)

Review OSM staging uploads in Supabase `import_review` schema before promotion to `core`.

## UI routes

`apps/dashboard/src/app/(admin)/dashboard/import-review/`

## API

`/api/import-review/*` — see [Import review API](../03-api/import-review-api.md)

## Dev auth

When API has `IMPORT_REVIEW_ADMIN_TOKEN` set, dashboard sends `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` as `x-import-review-admin-token`.

## Historical docs (archive)

Detailed QA, promotion contracts, and status snapshots:

- [`docs/archive/old-docs/import-review/`](../archive/old-docs/import-review/)
- Address promotion: [`import-review-address-*.md`](../archive/old-docs/)
- Road promotion: [`import-review-road-promotion.md`](../archive/old-docs/import-review-road-promotion.md)

## Pipeline context

[Review and promotion](../07-data-pipeline/review-and-promotion.md)

## Related docs

- [Dashboard overview](dashboard-overview.md)
