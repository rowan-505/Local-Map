---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Core review API for dashboard CRUD
---

# Core review API

Prefix: `/core-review/*`

## Purpose

Dashboard CRUD on published `core` entities: places, roads, buildings, addresses, admin areas, landuse, water polygons/lines.

## Implementation

`apps/api/src/modules/core-review/`:

- Generic list/read/write patterns
- Per-entity handlers under `entities/`
- Entity registry: `core-review.entity-registry.ts`
- Lifecycle and verification status filters

## Dashboard pairing

UI: `apps/dashboard/src/features/core-review/`  
Routes: `apps/dashboard/src/app/(admin)/dashboard/core-review/`

## Regression

```bash
node tools/core-review-api-regression.mjs
```

## Related docs

- [Core review (dashboard)](../05-dashboard/core-review.md)
- [API overview](api-overview.md)
