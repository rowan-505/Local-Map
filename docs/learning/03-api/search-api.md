---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Public unified search API and index rebuild
---

# Search API

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/search` | Unified search (places, streets, addresses, admin, transit…) |
| GET | `/public/search/:entityType/:entityId/geometry` | Highlight geometry for result |

Implemented in `apps/api/src/modules/public-map/`.

## Search technology (V2)

Deterministic structured search — **not** LLM-based:

- PostgreSQL full-text search
- `pg_trgm` fuzzy matching
- PostGIS distance ranking
- Aliases/synonyms, Myanmar/English fallback
- Confidence/importance ranking (0–100 scale)

## Index rebuild

After migrations, populate `search` schema:

```bash
cd apps/api
npm run rebuild:search-index              # full
npm run rebuild:search-index:light        # all except streets
npm run rebuild:search-index:street-groups # grouped streets only
```

Script: `apps/api/src/scripts/rebuild-search-index.ts`  
Uses direct Postgres connection (not Supabase SQL Editor) for long runs.

## Streets are grouped

Migration 121+ uses `street_group` documents (~14.8k rows), not per-segment (~823k).

## Manual QA

Full checklist archived: [`search-system-qa.md`](../archive/old-docs/search-system-qa.md)  
Performance notes: [`search-performance-profiling.md`](../archive/old-docs/search-performance-profiling.md)

## Related docs

- [Search system](../08-search-address-routing/search-system.md)
- [Search UI](../04-web-map/search-ui.md)
