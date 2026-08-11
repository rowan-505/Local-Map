---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Dashboard core review module
---

# Core review (dashboard)

Edit published `core` entities after import promotion.

## UI routes

`apps/dashboard/src/app/(admin)/dashboard/core-review/<entity>/`

Entities: places, roads, buildings, addresses, admin-areas, landuse, water-lines, water-polygons.

## API

`/core-review/*` — see [Core review API](../03-api/core-review-api.md)

## Patterns

- List pages with pagination and verification filters
- Edit forms with map preview where geometry matters
- Shared policy: `packages/core-review-policy/`

## Regression

`node tools/core-review-api-regression.mjs`

## Related docs

- [Geometry editor](geometry-editor.md)
- [Dashboard overview](dashboard-overview.md)
