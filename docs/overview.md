# Overview

CoreMap is a web-first Myanmar map platform. V1 shipped the public map and review tools. V2 hardens that system — do not restart the architecture.

## Layers

```text
PostGIS (truth) → Fastify API (logic + auth) → Web / Dashboard (clients)
PMTiles + MapLibre = rendering only
```

| Layer | Path | Role |
|-------|------|------|
| Database | `infrastructure/database/` | Schema, migrations |
| API | `apps/api` | Only app that talks to the DB |
| Web | `apps/web` | Public map |
| Dashboard | `apps/dashboard` | Admin UI (API only) |
| Tiles | `infrastructure/tiles/` | Basemap build → R2 |
| Routing | `infrastructure/routing/valhalla/` | Valhalla engine |
| Pipelines | `tools/data-pipeline/` | OSM import / promotion |

## Hard rules

1. No DB access from web or dashboard.
2. No business logic in MapLibre styles.
3. Important data is not tiles-only.
4. Sensitive actions go through the API and are audited.
5. DB changes use migration SQL.

Full agent rules: [`AGENTS.md`](../AGENTS.md).

## Repo layout

```text
apps/api | web | dashboard | mobile(experimental)
packages/          shared helpers
infrastructure/    DB, tiles, routing, cloud
tools/             pipelines and scripts
docs/              this guide set
```

## Local ports

| App | URL |
|-----|-----|
| API | http://localhost:3001 |
| Dashboard | http://localhost:3000 |
| Web | http://localhost:5173 |

## Glossary (short)

| Term | Meaning |
|------|---------|
| Core | Production tables (`core.*`) |
| Staging | Local cleaned import candidates |
| Import Review | Dashboard flow for conflict promotion |
| PMTiles | Static vector basemap files |
| `public_id` | Safe ID for public APIs |
| Scores | Use 0–100 (not 0–1) |
