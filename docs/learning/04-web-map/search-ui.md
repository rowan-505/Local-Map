---
status: current
last_reviewed: 2026-07-10
owner: CoreMap
scope: Public map search UI
---

# Search UI

Full system reference: [Search system](../08-search-address-routing/search-system.md).

## Components

| File | Role |
|------|------|
| `features/filters/components/SearchPanel.tsx` | Search input, type filter chips, results list, selected-result card |
| `features/filters/useCategoryFilter.ts` | `searchQuery` state |
| `features/filters/useDebouncedValue.ts` | Debounce helper |
| `features/poi/api/usePublicMapData.ts` | `usePublicSearch` React Query hook |
| `features/poi/api/publicMapApi.ts` | `fetchPublicSearch` → `GET /public/search` |
| `pages/HomePage.tsx` | Wires debounce, map center, selection, highlight |
| `features/map/lib/maplibre/searchHighlightOnMap.ts` | Highlight layers + flyTo |

Route planner uses `RouteEndpointSearchOverlay.tsx` (same API, no map-center bias).

There is **no** `packages/api-client` — web calls the API directly from `publicMapApi.ts`.

## Flow

1. User types in `SearchPanel` → `searchQuery` updates immediately; selection clears on new input.
2. **300 ms debounce** (`HomePage.tsx`) → `usePublicSearch(debouncedQuery, getSearchCenter)`.
3. `fetchPublicSearch` calls `GET /public/search?q=...&lat=...&lng=...` (limit not sent — API default 20).
4. Results render in `SearchResults` / `ResultRow` with type subtitle and optional distance label.
5. Client-side chips filter by entity type: All, Places, Areas, Roads, Bus, Addresses.
6. User selects a row → `onSelectSearchResult` → map highlight + flyTo.
7. Line/polygon results may fetch `GET /public/search/{type}/{id}/geometry` for full shape.

Plus codes and coordinate queries are handled **server-side** — always shown when returned even if type chips filter other rows.

## React Query / caching

```typescript
queryKey: ['public-search', trimmedQuery]
staleTime: 0 (default)
gcTime: 5 minutes (default)
```

| Behavior | Detail |
|----------|--------|
| Map center in query key? | **No** — read via `getSearchCenter()` when request starts |
| Language in query key? | **No** — `lang` not sent to API from `HomePage` |
| URL `?q=` sync? | **No** |
| Pagination? | **No** — single response |
| Request cancellation | `AbortSignal` from React Query |
| Min query length | 2 chars (`shouldRunPublicSearch`); Plus Code / coordinate exceptions |

Panning the map does **not** refetch search. Distance labels use viewport bbox center (`referenceCoordinates`) for display only — **not** ranking.

## Result display

- Title: localized display name from API
- Subtitle: `{type} · {admin/category} · {distance}` via `searchResultSubtitle()`
- Badges: verified, approximate admin boundary
- Distance: haversine from `referenceCoordinates` — **display only** (API ranking uses optional `lat`/`lng` at request time)

## Selection / map

- Point entities: pin + `flyTo` zoom 16
- Polygons/lines: `fitBounds` + optional geometry fetch
- Places: optional “View details” → `PlaceDetailPanel`
- Stale/ghost transport results may fly to index centroid but geometry/detail can **404** if canonical row is gone or unreviewed — see [Search system](../08-search-address-routing/search-system.md#transport-search-critical)

## Addresses chip

The UI exposes an **Addresses** filter chip, but unified search may return **zero** address rows if the index was not rebuilt or `search.address_index` is empty. The web does **not** call `GET /addresses/search` separately.

## Related docs

- [Search system](../08-search-address-routing/search-system.md)
- [Search API](../03-api/search-api.md)
- [Place detail UI](place-detail-ui.md)
