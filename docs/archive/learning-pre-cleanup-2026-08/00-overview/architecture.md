---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: System architecture boundaries and component responsibilities
---

# Architecture

CoreMap follows a strict layered architecture. **Do not bypass these boundaries.**

## Core diagram

```text
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL + PostGIS (Supabase prod / local raw DB)         │
│  Source of truth: places, roads, addresses, transit, auth…   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/api (Fastify)                                          │
│  Business logic, validation, auth, search, routing adapter   │
└────────────┬───────────────────────────────┬──────────────────┘
             │                               │
             ▼                               ▼
    apps/web (Vercel)              apps/dashboard (Vercel)
    MapLibre + PMTiles             Review / admin UI

┌─────────────────────────────────────────────────────────────┐
│  Tile delivery (rendering only)                              │
│  PMTiles → Cloudflare R2  |  Martin → optional dynamic MVT │
└─────────────────────────────────────────────────────────────┘
```

## Non-negotiable rules

From [`AGENTS.md`](../../AGENTS.md):

1. **Never** store important source data only in tiles.
2. **Never** put business logic in MapLibre style files.
3. **Never** let dashboard connect directly to PostgreSQL.
4. **Never** duplicate API business logic in frontend code.
5. **Never** let public clients write directly to the database.
6. All user, admin, search, routing, and publish actions go through the **API**.
7. Production-sensitive actions must be **audited**.
8. Database changes must be **migration SQL**, not hidden manual edits.
9. API modules stay **domain-based** (`route → schema → service → repo`).
10. Prefer simple, tested changes over clever rewrites.

## Component responsibilities

| Layer | Path | Responsibility |
|-------|------|----------------|
| Database | `infrastructure/database/` | Schema, migrations, seeds, checks |
| API | `apps/api/src/modules/` | All business logic and DB access |
| Web | `apps/web/src/features/` | Map UI, search, directions — API + tiles only |
| Dashboard | `apps/dashboard/src/features/` | Review UIs — API only |
| Static tiles | `infrastructure/tiles/pmtiles/` | Basemap PMTiles build → R2 |
| Dynamic tiles | `infrastructure/tiles/martin/` | Optional PostGIS vector overlays |
| Routing engine | `infrastructure/routing/valhalla/` | Valhalla (not custom DB graph in V2 prod) |
| Pipelines | `tools/data-pipeline/` | OSM import, staging, remote review upload |

## API module pattern

```text
apps/api/src/modules/<domain>/
├── <domain>.routes.ts
├── <domain>.schema.ts
├── <domain>.service.ts
├── <domain>.repo.ts
├── <domain>.openapi.ts
└── <domain>.types.ts
```

Entry: `apps/api/src/server.ts` → `apps/api/src/app.ts` (registers all route plugins).

## Web app structure

```text
apps/web/src/
├── main.tsx              Bootstrap
├── app/App.tsx           Providers + router
├── app/router.tsx        Routes
├── pages/HomePage.tsx    Main map experience
└── features/             map, filters, routing, auth, location…
```

## Dashboard structure

Next.js App Router under `apps/dashboard/src/app/(admin)/`. Large typed API client: `apps/dashboard/src/lib/api.ts`.

## Database pipeline layers

```text
raw → staging → core → tiles (views) → PMTiles export
         ↓
   import_review (Supabase) → promotion → core
```

See [Database overview](../02-database/database-overview.md) and [OSM import](../07-data-pipeline/osm-import.md).

## Search & routing (V2)

- **Search:** PostgreSQL FTS + pg_trgm + PostGIS distance in API (`public-map` module). Not LLM-based.
- **Routing:** Valhalla adapter in API. Core street tables are correction/export sources, not the production routing engine.

## Security summary

- Backend authorization on every protected action
- Zod validation on API inputs
- Rate limits on sensitive routes
- CORS locked in production via `CORS_ORIGIN`
- Dashboard hiding UI is **not** authorization

## Related docs

- [Tech stack](tech-stack.md)
- [API overview](../03-api/api-overview.md)
- [Tiles overview](../06-tiles/tiles-overview.md)
- [Deployment overview](../09-deployment/deployment-overview.md)
