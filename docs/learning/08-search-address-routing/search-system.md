---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Unified search system design and operations
---

# Search system

## Architecture

Deterministic structured search in API — not LLM-based.

- PostgreSQL FTS + `pg_trgm` + PostGIS distance
- Materialized in `search` schema
- Rebuild via `apps/api` scripts

## Public API

[Search API](../03-api/search-api.md) — `GET /public/search`

## Index rebuild

```bash
cd apps/api && npm run rebuild:search-index
```

## Street grouping

Documents use `entity_type = 'street_group'` (~14.8k grouped roads), not per-segment.

## QA & performance (archive)

- [`search-system-qa.md`](../archive/old-docs/search-system-qa.md) — manual QA checklist
- [`search-performance-profiling.md`](../archive/old-docs/search-performance-profiling.md)
- [`address-search-index.md`](../archive/old-docs/address-search-index.md)

## Related docs

- [Search UI](../04-web-map/search-ui.md)
- [Address system](address-system.md)
