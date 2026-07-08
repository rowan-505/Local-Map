---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Road routing with Valhalla
---

# Routing

## Production engine

**Valhalla** for V2 road modes: walk, drive, motorcycle.

API adapter: `apps/api/src/modules/routing/`

## Not in V2 production

Custom routing graph from DB tables as the production engine. Core streets are correction/export sources.

## Configuration

| Variable | Purpose |
|----------|---------|
| `ROUTING_ENABLED` | Master gate |
| `VALHALLA_BASE_URL` | Engine HTTP base |
| `ROUTING_PUBLIC_PROFILES` | Exposed profiles |

Local Valhalla: [`infrastructure/routing/valhalla/README.md`](../../infrastructure/routing/valhalla/README.md)

## Build / export (validation)

- `apps/api` script: `npm run build:routing-graph`
- Archived: [`routing-graph-build.md`](../archive/old-docs/routing-graph-build.md)
- Tools: [`tools/routing/README.md`](../../tools/routing/README.md)

## Future transit

Archived plans (not V2 core):

- [`TRANSIT_OTP_FUTURE_PLAN.md`](../archive/old-docs/routing/TRANSIT_OTP_FUTURE_PLAN.md)
- [`CORRECTED_ROAD_EXPORT_PLAN.md`](../archive/old-docs/routing/CORRECTED_ROAD_EXPORT_PLAN.md)

## Related docs

- [API overview](../03-api/api-overview.md)
- [Web routing UI](../04-web-map/web-overview.md)
