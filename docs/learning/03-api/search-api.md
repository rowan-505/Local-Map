---
status: current
last_reviewed: 2026-07-10
owner: CoreMap
scope: Public unified search API and index rebuild
---

# Search API

Full system reference: [Search system](../08-search-address-routing/search-system.md).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/search` | Unified search (places, street groups, admin areas, bus stops/routes, buildings, …) |
| GET | `/public/search/:entityType/:entityId/geometry` | Full geometry for map highlight |
| GET | `/addresses/search` | Separate address index — **not called by public web search box** |
| GET | `/public/admin-areas/search` | Admin region picker |
| GET | `/transport/stops/search` | Dashboard stop picker (ILIKE + optional distance) |

Implemented in:

- `apps/api/src/modules/public-map/` — unified search
- `apps/api/src/modules/addresses/` — `search.address_index`
- `apps/api/src/modules/transport/` — dashboard transport search

**There is no HTTP admin reindex endpoint.**

## `GET /public/search`

### Query parameters (`publicSearchQuerySchema`)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `q` | string | required | Trimmed; min length 2 for text (Plus Code / coordinate bypass) |
| `limit` | int | 20 | Max 50 |
| `lat`, `lng` | number | optional | Map center — Plus Code expansion + weak distance ranking bonus |
| `types` | comma-separated | optional | Subset of `PUBLIC_SEARCH_ENTITY_TYPES` |

**Not exposed in schema today:** `lang` (ranking SQL supports it but route does not pass it).

### Special branches (before index)

- **Plus Code** — decoded to a single pin result
- **Coordinate** `lat,lng` — single pin result

### Entity types returned

`place`, `address`, `bus_stop`, `admin_area`, `street_group`, `street` (legacy allowlist only), `bus_route`, `bus_route_variant`, `building`, `water_line`, `water_polygon`, `landuse`, plus runtime `plus_code` / `coordinate`.

Express terminals and dedicated terminal search are **not** in the unified index.

### Response shape

Serialized by `serializePublicSearchHit()` — see [Search system](../08-search-address-routing/search-system.md#architecture-overview) for fields (`entityType`, `entityId`, `display_name`, `score`, `center`, `cameraTarget`, etc.).

### Timeout

SQL `statement_timeout = 2000ms` — slow queries return **empty array**, not 500.

## Search technology

Deterministic — **not** LLM-based:

- PostgreSQL FTS (`simple` config on `search_vector`)
- `pg_trgm` fuzzy matching on `trigram_text`
- PostGIS distance decay when `lat`/`lng` sent
- Aliases from canonical `*_names` → `search_document_names` at rebuild
- **No `search_synonyms` table**
- Confidence / importance on 0–100 scale

Runtime store: `search.search_documents` only (no heavy joins to core at query time).

## Index rebuild

After schema changes or bulk data imports (especially **transport stops**):

```bash
npm --prefix apps/api run rebuild:search-index              # full (light + street_groups)
npm --prefix apps/api run rebuild:search-index:light        # all except street_groups
npm --prefix apps/api run rebuild:search-index:street-groups
npx tsx apps/api/src/scripts/rebuild-search-index.ts --views bus_stops,places
```

Script: `apps/api/src/scripts/rebuild-search-index.ts`  
SQL: `SELECT search.rebuild_search_documents($1::text[])`

Uses direct Postgres via Prisma — **not** Supabase SQL Editor (long runs need `statement_timeout = 0`).

**Search does not auto-update** when dashboard or transport data changes. Only `search.address_index` refreshes on address write/promote.

## Streets are grouped

Migration 121+: `entity_type = 'street_group'` (~14.8k rows). Per-segment `street` index (~823k) is **deprecated/removed**.

## Transport vs map consistency

Search indexes active transport stops **without** `review_status` filter. Map labels and search geometry endpoint require `review_status IN ('reviewed','verified')`. See [Search system — Transport search](../08-search-address-routing/search-system.md#transport-search-critical).

## Tests

Unit tests (no DB): `apps/api/src/modules/public-map/unified-search.test.ts`

## Related docs

- [Search system](../08-search-address-routing/search-system.md)
- [Search UI](../04-web-map/search-ui.md)
