---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Map click reverse geocoding UI
---

# Reverse click UI

## Behavior

When user clicks the map (outside active tool modes), the web app calls the reverse address API and shows approximate address context in `AddressLocationPanel` and related UI.

## API

See [Reverse address API](../03-api/reverse-address-api.md).

## Honest accuracy

UI must reflect confidence — partial or locality-only matches are not shown as exact street addresses.

## Related docs

- [Reverse address](../08-search-address-routing/reverse-address.md)
- [Address system](../08-search-address-routing/address-system.md)
