# CoreMap

Web-first Myanmar map platform. PostGIS is the source of truth. The Fastify API owns business logic. The public map and dashboard are API clients. PMTiles and MapLibre render the map.

**Live demo:** [local-map-orcin.vercel.app](https://local-map-orcin.vercel.app)

## Stack

| Layer | Path | Role |
|-------|------|------|
| PostgreSQL + PostGIS | `infrastructure/database/` | Source of truth |
| Fastify API | `apps/api` | Logic, auth, the only DB client |
| Public map | `apps/web` | Vite + MapLibre + PMTiles |
| Admin dashboard | `apps/dashboard` | Next.js, API only |
| Tiles | `infrastructure/tiles/` | Basemap build and delivery |
| Routing | `infrastructure/routing/valhalla/` | Valhalla road routing |

`apps/mobile` is experimental. It is not part of V2 production.

## Run locally

See [docs/getting-started.md](docs/getting-started.md).

Short version: copy [`.env.example`](.env.example) to `.env`, copy `apps/api/env.example` to `apps/api/.env`, then run API (`3001`), web (`5173`), and dashboard (`3000`).

## Docs

- [Overview and layer rules](docs/overview.md)
- [Full architecture rules](AGENTS.md)
- [Docs index](docs/README.md)
