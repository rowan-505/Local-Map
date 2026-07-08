# CoreMap Documentation

Central documentation for the CoreMap Myanmar map platform. Start here instead of hunting scattered README files across the repo.

**Last reorganized:** 2026-07-01 — see [reorganization audit](DOCS-REORG-AUDIT.md).

---

## Quick start

| I want to… | Go to |
|------------|-------|
| Understand the system | [Project overview](00-overview/project-overview.md) → [Architecture](00-overview/architecture.md) |
| Run locally | [Local setup](01-getting-started/local-setup.md) → [Environment variables](01-getting-started/environment-variables.md) |
| Work on the API | [API overview](03-api/api-overview.md) |
| Work on the public map | [Web overview](04-web-map/web-overview.md) |
| Work on the dashboard | [Dashboard overview](05-dashboard/dashboard-overview.md) |
| Build or publish tiles | [Tiles overview](06-tiles/tiles-overview.md) |
| Run OSM import | [OSM import](07-data-pipeline/osm-import.md) |
| Deploy to production | [Deployment overview](09-deployment/deployment-overview.md) → [Production checklist](09-deployment/production-checklist.md) |
| Debug something | [Debugging overview](10-debugging/debugging-overview.md) |

---

## Architecture & overview

- [Project overview](00-overview/project-overview.md)
- [Architecture](00-overview/architecture.md)
- [Tech stack](00-overview/tech-stack.md)
- [Glossary](00-overview/glossary.md)

**Agent / AI operating rules** remain at repo root: [`AGENTS.md`](../AGENTS.md) (not duplicated here).

---

## Getting started

- [Local setup](01-getting-started/local-setup.md)
- [Environment variables](01-getting-started/environment-variables.md)
- [Common commands](01-getting-started/common-commands.md)

---

## Database

- [Database overview](02-database/database-overview.md)
- [Schemas and tables](02-database/schemas-and-tables.md)
- [PostGIS patterns](02-database/postgis-patterns.md)
- [Migrations](02-database/migrations.md)
- [ERD](02-database/erd.md)

**Live SQL and migrations:** [`infrastructure/database/`](../infrastructure/database/)

---

## API

- [API overview](03-api/api-overview.md)
- [Module pattern](03-api/module-pattern.md)
- [Auth](03-api/auth.md)
- [Search API](03-api/search-api.md)
- [Reverse address API](03-api/reverse-address-api.md)
- [Core review API](03-api/core-review-api.md)
- [Import review API](03-api/import-review-api.md)

**Generated route reference:** [`apps/api/docs/API.md`](../apps/api/docs/API.md)  
**Interactive OpenAPI:** `http://localhost:3001/docs` when API is running

---

## Public web map

- [Web overview](04-web-map/web-overview.md)
- [MapLibre rendering](04-web-map/maplibre-rendering.md)
- [Search UI](04-web-map/search-ui.md)
- [Place detail UI](04-web-map/place-detail-ui.md)
- [Reverse click UI](04-web-map/reverse-click-ui.md)

---

## Dashboard

- [Dashboard overview](05-dashboard/dashboard-overview.md)
- [Core review](05-dashboard/core-review.md)
- [Import review](05-dashboard/import-review.md)
- [Geometry editor](05-dashboard/geometry-editor.md)
- [Reference pages](05-dashboard/reference-pages.md)

---

## Tiles & rendering

- [Tiles overview](06-tiles/tiles-overview.md)
- [PMTiles](06-tiles/pmtiles.md)
- [Martin](06-tiles/martin.md)
- [Map style](06-tiles/map-style.md)
- [Layer order](06-tiles/layer-order.md)
- [R2 / CDN](06-tiles/r2-cdn.md)

**Build scripts:** [`infrastructure/tiles/`](../infrastructure/tiles/)

---

## Data pipeline

- [OSM import](07-data-pipeline/osm-import.md)
- [Raw to staging](07-data-pipeline/raw-to-staging.md)
- [Review and promotion](07-data-pipeline/review-and-promotion.md)
- [Snapshots and lineage](07-data-pipeline/snapshots-and-lineage.md)
- [Data quality](07-data-pipeline/data-quality.md)

**Pipeline scripts:** [`tools/data-pipeline/`](../tools/data-pipeline/)

---

## Search, address & routing

- [Search system](08-search-address-routing/search-system.md)
- [Address system](08-search-address-routing/address-system.md)
- [Reverse address](08-search-address-routing/reverse-address.md)
- [Routing](08-search-address-routing/routing.md)

---

## Deployment

- [Deployment overview](09-deployment/deployment-overview.md)
- [Vercel (web + dashboard)](09-deployment/vercel.md)
- [Render (API + Martin)](09-deployment/render-api.md)
- [Supabase](09-deployment/supabase.md)
- [Cloudflare R2](09-deployment/cloudflare-r2.md)
- [Domains & DNS](09-deployment/domains-dns.md)
- [Production checklist](09-deployment/production-checklist.md)

---

## Debugging & QA

- [Debugging overview](10-debugging/debugging-overview.md)
- [API debugging](10-debugging/api-debugging.md)
- [Database debugging](10-debugging/database-debugging.md)
- [Map rendering debugging](10-debugging/map-rendering-debugging.md)
- [Dashboard debugging](10-debugging/dashboard-debugging.md)
- [Deployment debugging](10-debugging/deployment-debugging.md)

---

## Roadmap & decisions

- [V1 status](11-roadmap/v1-status.md)
- [V2 plan](11-roadmap/v2-plan.md)
- [Future ideas](11-roadmap/future-ideas.md)
- [ADR index](12-decisions/adr-index.md)

---

## Archive

Older, superseded, or QA-only documents are preserved in [`archive/`](archive/README.md). Nothing is deleted permanently.

- [Archive index](archive/README.md)
- [Old docs folder](archive/old-docs/)

---

## Docs outside this folder (kept in place)

These stay next to the code they describe. This index links to them:

| Path | Purpose |
|------|---------|
| [`AGENTS.md`](../AGENTS.md) | AI/agent operating guide |
| [`apps/api/docs/API.md`](../apps/api/docs/API.md) | Generated API reference |
| [`apps/api/README.md`](../apps/api/README.md) | API quick start (points here) |
| [`infrastructure/database/README.md`](../infrastructure/database/README.md) | DB folder guide (points here) |
| [`infrastructure/tiles/`](../infrastructure/tiles/) | Tile build READMEs |
| [`tools/data-pipeline/*/README.md`](../tools/data-pipeline/) | Per-pipeline runbooks |
| [`apps/mobile/andriod-kotlin/docs/`](../apps/mobile/andriod-kotlin/docs/) | Mobile (experimental) |
