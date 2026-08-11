---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Map geometry editing in dashboard
---

# Geometry editor

## Tools

- **Terra Draw** + MapLibre adapter for polygon/line editing
- MapLibre preview maps on core-review edit pages
- Street editor manual QA: archived [`manual-qa-street-editor.md`](../archive/old-docs/apps/dashboard/docs/manual-qa-street-editor.md)

## Key paths

- `apps/dashboard/src/components/map/`
- Entity-specific edit pages under `dashboard/core-review/*/edit/`

## Rules

- Geometry validated via API before persist
- SRID 4326
- Dashboard sends GeoJSON to API — no direct DB writes

## Related docs

- [Core review](core-review.md)
- [Map rendering debugging](../10-debugging/map-rendering-debugging.md)
