---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: High-level product and repository overview
---

# Project overview

CoreMap is a **web-first Myanmar map platform** built as a monorepo. V1 delivered a public web map, MapLibre rendering, POI markers, Myanmar labels, dashboard review flows, and core database entities. **V2** hardens and productionizes that system—without restarting the architecture.

## What CoreMap is

- A national map with OSM-level basemap coverage
- Stronger precision for **Yangon Region** and highest precision for **Kyauktan**
- Unified search across places, addresses, roads, admin areas, and transit entities
- Admin dashboard for data review, import promotion, and operations
- API-controlled auth, saved places, reports, and manual admin points

## What CoreMap is not (V2)

Per [`AGENTS.md`](../../AGENTS.md), do **not** build unless explicitly requested:

- Full Google Maps clone features
- Automatic point calculation
- Live bus GPS without a real data source
- Flight routing, social feeds, public reviews
- LLM-as-core-search
- Nationwide manual precision
- Native mobile production app
- Offline downloads

## Repository layout

```text
Core-Map/
├── apps/
│   ├── api/           Fastify backend — only DB access layer
│   ├── web/           Public map (React + Vite + MapLibre)
│   ├── dashboard/     Admin UI (Next.js) — API only
│   └── mobile/        Android Kotlin (experimental, not V2 production)
├── packages/          Shared map-style, review policy, localized names
├── infrastructure/    Migrations, tiles, routing, cloud config
├── tools/             OSM import, promotion, regression scripts
└── docs/              This documentation tree
```

## Data flow (one sentence)

**PostGIS** holds truth → **API** enforces business logic → **Web/Dashboard** consume API → **PMTiles/Martin** render basemap only.

## Local dev ports (default)

| Service | URL |
|---------|-----|
| API | `http://localhost:3001` |
| Dashboard | `http://localhost:3000` |
| Web | `http://localhost:5173` |

## Next reads

- [Architecture](architecture.md)
- [Tech stack](tech-stack.md)
- [Local setup](../01-getting-started/local-setup.md)
