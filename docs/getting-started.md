# Getting started

## Need

- Node.js 20+
- PostgreSQL + PostGIS (local and/or Supabase)
- Optional: Valhalla, local PMTiles serve

## Env

1. Copy root `.env.example` → `.env` (never commit secrets).
2. Copy `apps/api/.env.example` → `apps/api/.env`.
3. Copy `apps/web/.env.example` → `apps/web/.env.local`.
4. Copy `apps/dashboard/.env.example` → `apps/dashboard/.env.local`.

## Run (3 terminals)

```bash
# API
cd apps/api && npm install && npm run prisma:generate && npm run dev

# Web
cd apps/web && npm install && npm run dev

# Dashboard
cd apps/dashboard && npm install && npm run dev
```

Check: `curl http://localhost:3001/health` · Swagger at `/docs`.

## Useful commands

| Task | Command |
|------|---------|
| API typecheck | `cd apps/api && npm run typecheck` |
| Regenerate API.md | `cd apps/api && npm run docs:api` |
| Serve local tiles | from root: `npm run tiles:serve` |
| Valhalla | see `infrastructure/routing/valhalla/README.md` |

Local CORS allows ports 3000 and 5173 automatically in non-production.
