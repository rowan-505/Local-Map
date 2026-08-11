# Web map

Public map app: React + Vite + MapLibre + PMTiles.

Path: `apps/web`. Uses **API + tiles only** — no database.

## Run

```bash
cd apps/web && npm install && npm run dev
```

http://localhost:5173

## Structure

```text
apps/web/src/
  pages/HomePage.tsx     main map
  features/              map, search, routing, auth, …
```

Shared style helpers live in `packages/map-style/`.

## Rules

- Load overview PMTiles at low zoom; add region packages only when needed.
- Do not load all regional PMTiles at once.
- Search, details, routing, and auth come from the API.
- Keep MapLibre style files free of business logic.
