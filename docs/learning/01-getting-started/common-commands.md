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

Rebuild is **manual** — search does not auto-sync when core/transport data changes. After transport imports or bulk stop edits, run at least the light preset (includes `bus_stops`).

```bash
cd apps/api
npm run rebuild:search-index
npm run rebuild:search-index:light
npm run rebuild:search-index:street-groups
npx tsx src/scripts/rebuild-search-index.ts --views bus_stops
```

Details: [Search system](../08-search-address-routing/search-system.md)

Verify index health (read-only, no rebuild):

```bash
cd apps/api
npm run search:health
# alias:
npm run verify:search-index
```

Reconcile unhealthy families (check by default; repair only with `--repair`):

```bash
cd apps/api
npm run search:reconcile
npm run search:reconcile -- --repair
```

**Nightly scheduler (recommended):** no in-repo cron exists yet. On the API host or CI runner with DB access, schedule check-only nightly and repair only when needed:

```bash
# crontab example — 02:30 UTC daily, check only (exit 1 alerts if unhealthy)
30 2 * * * cd /path/to/Core-Map/apps/api && npm run search:health >> /var/log/coremap-search-health.log 2>&1

# optional weekly repair (explicit flag required)
0 3 * * 0 cd /path/to/Core-Map/apps/api && npm run search:reconcile -- --repair >> /var/log/coremap-search-reconcile.log 2>&1
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
