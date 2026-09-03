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

`apps/mobile` is experimental (`apps/mobile/android-kotlin`). It is not part of V2 production.

## Run locally

See [docs/getting-started.md](docs/getting-started.md).

Short version: copy [`.env.example`](.env.example) to `.env`, copy `apps/api/.env.example` to `apps/api/.env`, copy `apps/web/.env.example` to `apps/web/.env.local`, copy `apps/dashboard/.env.example` to `apps/dashboard/.env.local`, then run API (`3001`), web (`5173`), and dashboard (`3000`).

## Docs

- [Overview and layer rules](docs/overview.md)
- [Getting started](docs/getting-started.md)
- [Docs index](docs/README.md)

To read the code, start at `apps/api/src/modules/places/` and `apps/web/src/features/map/`. See [docs/README.md](docs/README.md) for a short tour.
