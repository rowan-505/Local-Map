---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Technology choices per layer
---

# Tech stack

## Database

| Technology | Use |
|------------|-----|
| PostgreSQL | Primary datastore |
| PostGIS | Geometry, spatial queries (SRID 4326) |
| Supabase | Hosted production Postgres (`DATABASE_URL`) |
| Local Postgres | Raw OSM import, staging, experiments (`LOCAL_RAW_DATABASE_URL`) |

Schemas include `raw`, `staging`, `core`, `ref`, `system`, `tiles`, `search`, `app_auth`, `import_review`.

## API (`apps/api`)

| Technology | Use |
|------------|-----|
| Fastify 5 | HTTP server |
| TypeScript | Language |
| Zod | Request/response validation |
| Prisma | ORM where appropriate; raw SQL for geo/search |
| `@fastify/jwt`, `argon2` | Auth |
| `@fastify/swagger` | OpenAPI + Swagger UI at `/docs` |
| Resend | Transactional email |

**Pattern:** `route → schema → service → repo`

## Public web (`apps/web`)

| Technology | Use |
|------------|-----|
| React 19 | UI |
| Vite | Build/dev |
| MapLibre GL JS | Map rendering |
| Tailwind CSS 4 | Styling |
| TanStack Query | Server state |
| Zustand | Map UI state |
| React Router | Client routing |

## Dashboard (`apps/dashboard`)

| Technology | Use |
|------------|-----|
| Next.js 16 | App Router, SSR shell |
| React 19 | UI |
| MapLibre GL JS | Map previews / editors |
| Terra Draw | Geometry editing |
| React Hook Form + Zod | Forms |
| TanStack Query | API data |
| shadcn-style components | UI primitives |

## Tiles & map style

| Technology | Use |
|------------|-----|
| PMTiles | Static basemap archives |
| tippecanoe | Vector tile build (via scripts) |
| Cloudflare R2 + CDN | Production tile hosting |
| Martin | Optional dynamic tiles from PostGIS |
| `packages/map-style/` | Shared MapLibre style JSON + PMTiles protocol |

## Routing

| Technology | Use |
|------------|-----|
| Valhalla | Production road routing (walk, drive, motorcycle) |
| OpenTripPlanner | Future transit planning (not V2 core) |

## Data pipeline (`tools/`)

| Technology | Use |
|------------|-----|
| osm2pgsql | OSM → PostGIS import |
| Bash + SQL | Stage orchestration |
| Node/tsx | Regression and utility scripts |

## Deployment (current)

| Component | Platform |
|-----------|----------|
| API | Render |
| Web | Vercel |
| Dashboard | Vercel |
| Database | Supabase |
| PMTiles | Cloudflare R2 |
| Martin (optional) | Render (`render.yaml`) |

**Needs verification:** Exact production URLs and Render service names — check your deployment dashboards and env files.

## Mobile (`apps/mobile`)

Android Kotlin — **experimental**. Not a V2 production deliverable. See `apps/mobile/andriod-kotlin/docs/`.

## Shared packages (`packages/`)

| Package | Purpose |
|---------|---------|
| `map-style` | Basemap JSON, PMTiles protocol, regional zoom policy |
| `core-review-policy` | Shared review rules |
| `localized-name` | Myanmar/English name helpers |

## Related docs

- [Architecture](architecture.md)
- [Local setup](../01-getting-started/local-setup.md)
- [Database overview](../02-database/database-overview.md)
