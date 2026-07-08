---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Frequently used npm and repo-root commands
---

# Common commands

## Apps

```bash
# API
cd apps/api && npm run dev
cd apps/api && npm run typecheck
cd apps/api && npm run docs:api          # Regenerate apps/api/docs/API.md

# Web
cd apps/web && npm run dev
cd apps/web && npm run build
cd apps/web && npm run test:map

# Dashboard
cd apps/dashboard && npm run dev
cd apps/dashboard && npm run build
```

## Database introspection (repo root)

```bash
npm run db:schema:local      # Export local schema SQL
npm run db:erd:local         # Local ERD (mermaid)
npm run db:erd:supabase      # Supabase ERD
```

## Tiles (repo root)

```bash
npm run tiles:export -- yangon v2
npm run tiles:build -- yangon v2
npm run tiles:rebuild -- yangon v2
npm run tiles:upload:r2 -- <path> <region> <version>
npm run tiles:serve
npm run tiles:build:overview
```

See [PMTiles](../06-tiles/pmtiles.md).

## Search index rebuild (API)

```bash
cd apps/api
npm run rebuild:search-index
npm run rebuild:search-index:light
npm run rebuild:search-index:street-groups
```

## Regression

```bash
node tools/core-review-api-regression.mjs
```

## OSM pipeline

```bash
# See tools/data-pipeline/local-osm/README.md
tools/data-pipeline/local-osm/run_local_osm_pipeline.sh <env-file>
```

## Related docs

- [Local setup](local-setup.md)
- [OSM import](../07-data-pipeline/osm-import.md)
