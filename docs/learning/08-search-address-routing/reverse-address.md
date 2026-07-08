---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Reverse geocoding behavior and API contract
---

# Reverse address

## Resolver

`apps/api/src/modules/addresses/reverse-address.resolver.ts`

## Returns

- Nearest place
- Nearest road
- Admin hierarchy
- Approximate address string
- Coordinates
- Plus code
- Confidence and match type

## UI

[Reverse click UI](../04-web-map/reverse-click-ui.md)

## Admin areas

Boundary usage policy: archived [`admin-area-boundary-and-address-usage.md`](../archive/old-docs/admin-area-boundary-and-address-usage.md)

## Deep dive (archive)

[`reverse-address-resolver.md`](../archive/old-docs/reverse-address-resolver.md)

## Related docs

- [Address system](address-system.md)
- [Reverse address API](../03-api/reverse-address-api.md)
