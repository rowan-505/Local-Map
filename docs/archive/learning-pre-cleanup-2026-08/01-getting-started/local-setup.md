---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Local development setup for API, web, and dashboard
---

# Local setup

## Prerequisites

- Node.js 20+ (check each app's `package.json` for exact needs)
- PostgreSQL + PostGIS (local and/or Supabase credentials)
- Optional: Valhalla for routing, Wrangler for R2 tile upload tests

## Environment files

1. Copy repo-root [`.env.example`](../../.env.example) to `.env` (never commit).
2. Copy `apps/api/env.example` to `apps/api/.env` for API-specific vars.
3. Copy `apps/web/.env` template if present; set `VITE_API_BASE_URL`.
4. Set `NEXT_PUBLIC_API_BASE_URL` for dashboard.

See [Environment variables](environment-variables.md).

## Install and run (three terminals)

### Terminal 1 — API

```bash
cd apps/api
npm install
npm run prisma:generate
npm run dev
```

Default: `http://localhost:3001`  
Swagger: `http://localhost:3001/docs`

### Terminal 2 — Public web

```bash
cd apps/web
npm install
npm run dev
```

Default: `http://localhost:5173`

### Terminal 3 — Dashboard

```bash
cd apps/dashboard
npm install
npm run dev
```

Default: `http://localhost:3000`

## Optional: local tiles

```bash
# From repo root — serve built PMTiles locally
npm run tiles:serve
```

Configure web/dashboard basemap URLs to point at local tile server. See [PMTiles](../06-tiles/pmtiles.md).

## Optional: Valhalla routing

```bash
# See infrastructure/routing/valhalla/README.md
```

Set in `apps/api/.env`:

```text
ROUTING_ENABLED=true
VALHALLA_BASE_URL=http://localhost:8002
```

## CORS (local)

API automatically allows `http://localhost:3000` (dashboard) and `http://localhost:5173` (web) in non-production.

## Verify

1. API health: `curl http://localhost:3001/health`
2. Web map loads basemap
3. Dashboard login works against API

## Related docs

- [Common commands](common-commands.md)
- [Environment variables](environment-variables.md)
- [Debugging overview](../10-debugging/debugging-overview.md)
