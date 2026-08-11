---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Public web map application structure
---

# Web overview

`apps/web` — React + Vite + MapLibre public map for Myanmar.

## Entry flow

```text
index.html → src/main.tsx → src/app/App.tsx → src/app/router.tsx
```

| Route | Component |
|-------|-----------|
| `/` | `pages/HomePage.tsx` — main map experience |
| `/s/:code` | Share link resolver |

## Architecture rules

- **Tiles** for basemap rendering only
- **API** (`VITE_API_BASE_URL`) for search, details, routing, auth, saved places, reports
- **No** direct database access
- **No** business logic that belongs in API

## Feature folders (`src/features/`)

| Folder | Purpose |
|--------|---------|
| `map/` | MapLibre, basemap, layers, directions overlay |
| `filters/` | Search panel, category filters |
| `routing/` | Directions UI and route state |
| `auth/` | Login, account menu, saved places entry |
| `saved-places/` | Saved locations panel |
| `reports/` | User reports |
| `location/` | GPS, geolocation permissions |
| `poi/` | Public map API client |
| `share/` | Short link resolution |
| `regions/` | Regional PMTiles loading policy |

## State

- **TanStack Query** — server/API state
- **Zustand** — map UI store (`mapUiStore`)
- **React Router** — navigation

## Deploy

Vercel — [`apps/web/vercel.json`](../../apps/web/vercel.json) (SPA rewrites, geolocation Permissions-Policy)

## Run

```bash
cd apps/web && npm run dev    # :5173
cd apps/web && npm run test:map
```

## Related docs

- [MapLibre rendering](maplibre-rendering.md)
- [Search UI](search-ui.md)
- [Tiles overview](../06-tiles/tiles-overview.md)
- [API overview](../03-api/api-overview.md)
