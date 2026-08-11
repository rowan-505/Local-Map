---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Reverse geocoding API
---

# Reverse address API

Reverse lookup returns nearest place, road, admin hierarchy, approximate address, coordinates, and plus code — with honest confidence scores.

## Implementation

`apps/api/src/modules/addresses/`:

- `reverse-address.resolver.ts` — core logic
- `reverse-address.repo.ts` — PostGIS queries
- Routes registered via `addresses.routes.ts`

## Design principles

- Do not pretend exact house-level accuracy when data is approximate
- Expose `confidence_score` and `match_type`
- Full address text is **derived cache**, not manually edited in dashboard

## Architecture reference

Merged from archived docs:

- [`address-architecture.md`](../archive/old-docs/address-architecture.md)
- [`reverse-address-resolver.md`](../archive/old-docs/reverse-address-resolver.md)
- [`minimal-address-system.md`](../archive/old-docs/minimal-address-system.md)
- [`admin-area-boundary-and-address-usage.md`](../archive/old-docs/admin-area-boundary-and-address-usage.md)

Canonical narrative: [Address system](../08-search-address-routing/address-system.md), [Reverse address](../08-search-address-routing/reverse-address.md)

## Related docs

- [Reverse click UI](../04-web-map/reverse-click-ui.md)
- [Address search index](../archive/old-docs/address-search-index.md) (archived detail)
