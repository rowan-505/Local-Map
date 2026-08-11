---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Place and entity detail panels on the public map
---

# Place detail UI

## Components

Detail cards and side panels live under `features/map/components/` (e.g. `MapSidebar`, `AddressLocationPanel`) and POI-related features.

## Data source

All entity details from API — typically `public-map` and related public endpoints. No tile attributes for business data.

## Saved places & reports

When authenticated:

- `features/saved-places/` — save current place
- `features/reports/` — submit issue reports

## Related docs

- [Web overview](web-overview.md)
- [Auth](../03-api/auth.md)
