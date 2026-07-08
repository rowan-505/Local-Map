---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Public map search UI
---

# Search UI

## Components

- `features/filters/components/SearchPanel.tsx` — search input and results
- `features/filters/useDebouncedValue.ts` — debounced API queries
- `features/poi/api/publicMapApi.ts` — `GET /public/search` client

## Flow

1. User types query (debounced)
2. Web calls API unified search
3. Results list with entity type badges
4. Selection fetches geometry for map highlight
5. Map flies to result / draws highlight layer

## Plus codes & coordinates

Handled server-side in `public-map` module — see [Search API](../03-api/search-api.md).

## Related docs

- [Search system](../08-search-address-routing/search-system.md)
- [Place detail UI](place-detail-ui.md)
