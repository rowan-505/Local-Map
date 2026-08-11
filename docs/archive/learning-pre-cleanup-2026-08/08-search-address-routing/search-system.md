---
status: current
last_reviewed: 2026-07-10
owner: CoreMap
scope: Unified search system — architecture, operations, ranking, known issues
---

# Search system

Canonical reference for CoreMap public unified search. Last full technical inspection: **2026-07-10**.

**Related (layer-specific):**

- [Search API](../03-api/search-api.md) — HTTP endpoints and rebuild commands
- [Search UI](../04-web-map/search-ui.md) — web client behavior
- [Search quality golden queries](search-quality-golden-queries.md) — ranking regression scenarios
- [Address system](address-system.md) — address model (separate from unified index today)

---

## Executive summary

| Question | Current answer (2026-07-10) |
|----------|----------------------------|
| Is unified search implemented? | **Yes** — `GET /public/search` → `search.search_documents` |
| Does it auto-update when data changes? | **No** — manual/scripted rebuild only (except partial `search.address_index` hooks) |
| Can results be stale? | **Yes** — proven for transport stops (ghost rows, missing new stops) |
| Are synonyms / popular-query logs implemented? | **No** |
| Is address search working in production? | **Not verified** — both `search_documents` (address type) and `search.address_index` were **empty** at inspection |
| Biggest operational risk | Transport import/edit without `bus_stops` rebuild + unreviewed stops indexed while map layers filter them out |

**Repair before redesign.** The architecture (denormalized `search_documents` + batch rebuild) is sound; operations, transport visibility rules, and ranking weights need fixing.

---

## Architecture overview

Deterministic structured search in the API — **not** LLM-based.

```text
User types query (SearchPanel, 300ms debounce)
  → usePublicSearch(['public-search', trimmedQuery])
  → GET /public/search?q=...&lat=...&lng=...
  → PublicMapService.search()
       ├─ Plus Code? → decode pin (bypass index)
       ├─ Coordinate "lat,lng"? → pin (bypass index)
       └─ planPublicSearch(q)
            ├─ len ≤ 1 → blocked (unless plus/coord)
            ├─ len = 2  → prefix mode (no fuzzy FTS)
            └─ len ≥ 3  → full mode (FTS + pg_trgm + multi-token AND)
  → PublicMapRepository.searchUnifiedDocuments()
  → search.search_documents (+ lateral search.search_document_names)
  → ORDER BY score DESC, importance DESC, display_name ASC
  → LIMIT 20 default / 50 max
  → serializePublicSearchHit() → web ResultRow
  → on select → flyTo + optional GET /public/search/{type}/{id}/geometry
```

**There is no `apps/api/src/modules/search/` module.** Search lives in `public-map` (unified), `addresses` (separate address index + reverse), and `transport` (dashboard stop picker only).

**Martin / PMTiles / tile properties do not feed search.** Map bus-stop labels use separate SQL with stricter `review_status` filters than search.

---

## Public API

| Method | Path | Module | Purpose |
|--------|------|--------|---------|
| GET | `/public/search` | `public-map` | Unified search |
| GET | `/public/search/:entityType/:entityId/geometry` | `public-map` | Full geometry on result click |
| GET | `/addresses/search` | `addresses` | Separate address index (`search.address_index`) — **not used by web search box** |
| GET | `/public/admin-areas/search` | `public-map` | Region picker |
| GET | `/transport/stops/search` | `transport` | Dashboard stop picker (ILIKE + distance) |

See [Search API](../03-api/search-api.md) for parameters and rebuild scripts.

**No HTTP admin reindex endpoint exists.**

---

## Searchable entity inventory

| Entity family | Canonical table | Search source view | `entity_type` | Searchable? | Index visibility filter |
|---------------|-----------------|-------------------|---------------|-------------|-------------------------|
| Places | `core.core_places` | `v_search_places_source` | `place` | Yes | `is_public`, not deleted, has point |
| Admin areas | `core.core_admin_areas` | `v_search_admin_areas_source` | `admin_area` | Yes | `is_active`, not deleted, `address_usage <> disabled` |
| Street groups | `core.core_streets` (grouped) | `v_search_street_groups_source` | `street_group` | Yes | active, named, has geom |
| Streets (per segment) | `core.core_streets` | ~~`v_search_streets_source`~~ | `street` | **No** (dropped migration 121) | — |
| Addresses (unified) | `core.core_addresses` | `v_search_addresses_source` | `address` | View exists; **0 rows in prod at inspection** | `is_public`, not deleted, has geom |
| Transport stops (all modes) | `transport.stops` | `v_search_bus_stops_source` | `bus_stop` | Yes | `is_active`, not deleted, has geom — **no `review_status` filter** |
| Transport routes | `transport.routes` | `v_search_bus_routes_source` | `bus_route` | Yes | active, not deleted — **no review filter** |
| Route variants | `transport.route_variants` | same view | `bus_route_variant` | Yes | active — **no review filter** |
| Buildings | `core.core_map_buildings` | `v_search_buildings_source` | `building` | Yes (named only) | active, named |
| Water lines / polygons | `core_map_water_*` | respective views | `water_line`, `water_polygon` | Yes (named only) | active, named |
| Landuse | `core.core_map_landuse` | `v_search_landuse_source` | `landuse` | Yes (named only) | active, named |
| Express terminals / routes | — | — | — | **Not implemented** | Planned in migration 115 comments only |
| Plus codes | computed runtime | — | `plus_code` | Yes (API branch) | Not stored in index |
| Coordinates | parsed runtime | — | `coordinate` | Yes (API branch) | Not stored |
| Aliases | `*_names` tables | `search_document_names` at rebuild | — | Yes | Follows parent entity |
| Synonyms | — | — | — | **Does not exist** | — |

Localized names are folded into `search_document_names` at rebuild from JSON `names` in source views. There is no `search_synonyms` table.

---

## Storage and indexing

### Active stores

| Object | Role | Migration |
|--------|------|-----------|
| `search.search_documents` | One denormalized row per entity; runtime query target | 115 |
| `search.search_document_names` | Multilingual names + aliases per document | 115 |
| `search.search_index_runs` | Rebuild bookkeeping | 115 |
| `search.failed_search_logs` | Zero-result telemetry | 115 |
| `search.search_request_events` | Aggregated search request analytics | 133 |
| `search.search_result_click_events` | Search result click analytics | 133 |
| `search.address_index` | Separate address search for `/addresses/search` | 048 |

### Legacy (unused by current API)

- `search.search_names`, `search.search_addresses` (migration 023)

### Technologies

| Mechanism | Where | Notes |
|-----------|-------|-------|
| `tsvector` (`simple` config) | `search_documents.search_vector` | Generated from `searchable_text`; no English stemming |
| `pg_trgm` `similarity()`, `%` | `trigram_text`, `search_document_names.normalized_name` | Fuzzy match |
| `ILIKE` prefix / substring | Candidate filter + multi-token AND | Myanmar multi-word via `splitSearchTokens()` |
| PostGIS `ST_Distance` | Ranking bonus when `lat`/`lng` provided | `20 * exp(-d/5000)` |
| GIN / GiST indexes | FTS, trigram, centroid, bbox | migration 115 |

**Not used:** materialized views, `unaccent`, custom Myanmar normalizer beyond `lower()`, `search_synonyms`.

### Rebuild function

`search.rebuild_search_documents(p_views text[])` (migration 121):

1. For each view key: `SELECT * FROM search.v_search_{view}_source` into temp table
2. **`DELETE FROM search.search_documents WHERE entity_type IN (distinct types from temp)`**
3. Insert documents + `search_document_names`
4. Record run in `search.search_index_runs`

Default view keys: `places`, `admin_areas`, `street_groups`, `addresses`, `bus_stops`, `bus_routes`, `buildings`, `water_lines`, `water_polygons`, `landuse`.

**No PostgreSQL triggers** sync canonical tables → search.

---

## Synchronization and freshness

| Event | Unified `search_documents` | `search.address_index` |
|-------|---------------------------|------------------------|
| Entity created/edited/deleted | **No auto-update** | Refresh on address write/promote via API |
| Transport import/promotion | **No hook** | N/A |
| Dashboard core-review edit | **No hook** | Address writes only |
| Manual rebuild | **Yes** — npm scripts | `refresh_address_index()` |

### Answers operators need

1. **Search is not guaranteed consistent** with canonical DB between rebuilds.
2. **Partial rebuild** (`--views bus_stops`) deletes all rows of that `entity_type` then reinserts from source view — fixes ghosts for that type.
3. **No incremental row-level** unified indexer.
4. **No scheduled reindex** (no cron, no GitHub Action).
5. **After transport bulk work**, run at minimum: `npm --prefix apps/api run rebuild:search-index:light` (includes `bus_stops`).

---

## Ranking

Defined in `PublicMapRepository.searchUnifiedDocuments()` (`public-map.repo.ts`).

### Query modes (`planPublicSearch`)

| Length | Mode | Matching |
|--------|------|----------|
| 0–1 | blocked | unless Plus Code or coordinate |
| 2 | `prefix` | exact code, `display_name LIKE q%`, `trigram_text LIKE q%` only |
| 3+ | `full` | code exact, substring, trigram `%`, FTS; multi-token = AND of `ILIKE %token%` |

### Score formula (summed)

```text
+ 100  if lower(code) = q
+  80  if exact display_name or primary_name (my/en/und)
+  40  if display_name or trigram_text prefix match
+  30  if FTS match (full mode)
+ similarity(trigram_text, q) * 25  (full mode)
+  60  if all multi-tokens match (full mode, ≥2 tokens)
+ 20 * exp(-distance_m / 5000)  when lat/lng provided
+ importance_score * 0.15
+ confidence_score * 0.05
+   8  if is_verified
```

**ORDER BY:** `score DESC`, `importance_score DESC`, `display_name ASC`

### Known ranking limitations

- **No entity-type priority** — exact `bus_stop` can outrank verified `admin_area`.
- **No minimum similarity threshold** — weak fuzzy matches appear for short queries.
- **No `review_status` in score** — unreviewed transport ranks like reviewed data.
- **`lang` query param** is implemented in SQL but **not** in `publicSearchQuerySchema` / route — web does not send it.
- **Distance in UI subtitle** is display-only (`SearchPanel`); not used for sort.

Statement timeout: **2000 ms** → empty results (not 500).

---

## Transport search (critical)

### Canonical model

- Stops: `transport.stops` + `transport.stop_names`
- Routes / variants: `transport.routes`, `transport.route_variants`, `transport.route_names`
- Train / ferry / airport stops use the same `bus_stop` entity type in search (view name is legacy).

### Visibility inconsistency (2026-07-10)

| Layer | `review_status` filter |
|-------|------------------------|
| `v_search_bus_stops_source` | **None** — only `is_active`, not deleted, has geom |
| Map bus-stop labels (`listBusStopGeoLabels`) | `reviewed` or `verified` only |
| Search geometry endpoint (`GEOMETRY_SOURCES.bus_stop`) | `reviewed` or `verified` only |
| Public route map layers | strict on routes/variants/paths |

At inspection, **~99.6%** of active stops were `needs_review` or `imported_unreviewed` but searchable. Users can find stops in search that do not appear on the map and may **404** on geometry/detail.

### Production drift (2026-07-10, Supabase `locghyuranqaqsnbxflc`)

| Metric | Value |
|--------|-------|
| Last rebuild | 2026-06-26 |
| Indexed `bus_stop` rows | 7,806 |
| Active canonical stops | 15,398 |
| Stale index rows (canonical missing/inactive) | 3,556 (~46% of indexed) |
| Active stops missing from index | 11,148 |
| Stops updated after last index | 11,732 |

### Example: `kyaukse` / `KYAUKSE`

- Two top results: `bus_stop` **KYAUKSE** (entity ids 3655, 3656) — **ghost rows** in `search.search_documents`; rows **do not exist** in `transport.stops`.
- No canonical stop named KYAUKSE at inspection.
- Kyaukse District (`admin_area`) ranks below ghost stops due to exact-name scoring on stops.
- Distant `Kyauk *` stops appear via prefix/fuzzy on `kyau` / `kyauk` in `trigram_text` (includes admin hierarchy text).

**Root causes:** stale index + no review filter + aggressive exact-match scoring + duplicate canonical entities + broad 2-char prefix mode.

---

## Web client

See [Search UI](../04-web-map/search-ui.md).

| Item | Value |
|------|-------|
| Debounce | 300 ms |
| Query key | `['public-search', trimmedQuery]` only |
| Map center | Passed as `lat`/`lng` at fetch time; **not** in query key |
| React Query `staleTime` | 0 (default) |
| URL search params | None |
| Pagination | None (single response) |
| Address chip | Client-side filter — **addresses may be empty server-side** |
| API client | `apps/web/src/features/poi/api/publicMapApi.ts` (no `packages/api-client`) |

Frontend cache is **not** the main cause of transport ghost results; server index staleness is.

---

## Index rebuild commands

From repo root:

```bash
# Full = light views + street_groups
npm --prefix apps/api run rebuild:search-index

# All entity types except grouped streets
npm --prefix apps/api run rebuild:search-index:light

# Grouped streets only (~14.8k rows)
npm --prefix apps/api run rebuild:search-index:street-groups

# Specific views
npx tsx apps/api/src/scripts/rebuild-search-index.ts --views bus_stops,places
```

Script: `apps/api/src/scripts/rebuild-search-index.ts` — uses Prisma/direct Postgres (not Supabase SQL Editor). Sets `statement_timeout = 0` for duration of rebuild.

**Deprecated:** per-segment `streets` view (~823k rows) — removed migration 121. Streets are **`street_group`** only.

---

## Verification SQL (read-only)

Canonical health check (all searchable families, missing/ghost/stale counts):

```bash
npm --prefix apps/api run search:health
# alias:
npm --prefix apps/api run verify:search-index
```

Targeted repair for unhealthy families only (no mutation unless `--repair` is passed):

```bash
npm --prefix apps/api run search:reconcile
npm --prefix apps/api run search:reconcile -- --repair
```

SQL file: `infrastructure/database/verification/verify_search_index_health.sql`

**Nightly reconciliation:** use `search:health` on a schedule (cron, systemd timer, or hosted job runner). Run `search:reconcile -- --repair` only when you want automatic repair — not on every check. See [Common commands](../01-getting-started/common-commands.md).

Or with psql (read-only):

```bash
PAGER=cat psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infrastructure/database/verification/verify_search_index_health.sql
```

---

## Implemented vs planned (V2)

| Feature | Status |
|---------|--------|
| Unified `GET /public/search` | **Active** |
| `search.search_documents` + names | **Active** (ops must rebuild) |
| FTS + pg_trgm + geo bias | **Active** |
| Street groups | **Active** |
| Failed search logs | **Active** |
| Address unified index | **Partial** — view exists; empty at inspection |
| `/addresses/search` + `address_index` | **Implemented**; empty at inspection; web unused |
| Express routes / terminals in search | **Planned only** |
| Synonyms table | **Not implemented** |
| Popular query logs | **Not implemented** |
| Admin HTTP reindex | **Not implemented** |
| Auto-sync triggers / scheduled rebuild | **Partial** — incremental sync on writes + nightly `search:health` / `search:reconcile -- --repair` CLI (external cron) |
| `review_status` aligned with map | **Not implemented** in search views |
| LLM search | **Explicitly out of scope for V2** |

---

## Priority fix list (from 2026-07-10 inspection)

### P0

1. **Rebuild transport search** after imports: `rebuild:search-index:light` or `--views bus_stops`.
2. **Add `review_status IN ('reviewed','verified')`** to `v_search_bus_stops_source` and bus route source views to match map/geometry layers (requires migration + rebuild).

### P1

3. Hook transport promotion/write paths to trigger `rebuild_search_documents(ARRAY['bus_stops'])` or scheduled nightly light rebuild.
4. Ranking: entity-type weights, minimum trigram threshold, stronger distance decay for non-exact matches.
5. Populate address search (unified or `address_index`) and wire web or remove misleading Addresses chip.

### P2

6. Transport deduplication at import/review (same name / nearby coords).
7. Expose `lang` on `/public/search` schema and web client.

---

## Key files

### Web

- `apps/web/src/features/filters/components/SearchPanel.tsx`
- `apps/web/src/features/poi/api/usePublicMapData.ts`
- `apps/web/src/features/poi/api/publicMapApi.ts`
- `apps/web/src/pages/HomePage.tsx`

### API

- `apps/api/src/modules/public-map/public-map.routes.ts`
- `apps/api/src/modules/public-map/public-map.service.ts`
- `apps/api/src/modules/public-map/public-map.repo.ts`
- `apps/api/src/modules/public-map/public-map.schema.ts`
- `apps/api/src/modules/public-map/unified-search.test.ts`
- `apps/api/src/modules/addresses/address-index.repo.ts`
- `apps/api/src/scripts/rebuild-search-index.ts`

### Database

- `infrastructure/database/migrations/supabase/115_search_documents_unified_search.sql`
- `infrastructure/database/migrations/supabase/116_search_source_views.sql`
- `infrastructure/database/migrations/supabase/121_search_street_groups.sql`
- `infrastructure/database/migrations/supabase/048_search_address_index.sql`

### DB objects

`search.search_documents`, `search.search_document_names`, `search.search_index_runs`, `search.failed_search_logs`, `search.search_request_events`, `search.search_result_click_events`, `search.address_index`, `search.rebuild_search_documents()`, `search.refresh_address_index()`, all `search.v_search_*_source` views.

---

## Search analytics (V2)

Lightweight Postgres telemetry for product and search-quality review. Not an event bus.

### Tables (migration 133)

| Table | Purpose |
|-------|---------|
| `search.search_request_events` | Completed first-page text searches |
| `search.search_result_click_events` | Optional result selections |

### API

| Endpoint | Behavior |
|----------|----------|
| `GET /public/search` | Returns optional `analytics.eventId` (UUID correlation id) |
| `POST /public/search/analytics/clicks` | Records click (`event_id`, `entity_type`, `entity_id`, `clicked_rank`, optional `time_to_click_ms`) → `204` |

**Recorded on search:** `normalized_query`, `lang`, category/transport filters, `result_count`, `latency_ms`, optional `session_key` from `x-anonymous-id`.

**Not recorded:** precise lat/lng, keystrokes, pagination continuations, Plus Code / coordinate shortcuts, queries shorter than 2 characters.

**Insertion pattern:** fire-and-forget single-row `INSERT` after the search response is built. Analytics failure never fails search.

### Retention guidance

| Dataset | Recommended retention | Notes |
|---------|----------------------|-------|
| `search_request_events` | **90 days** raw | Enough for weekly quality review and trend charts |
| `search_result_click_events` | **90 days** raw | Join to requests by `search_correlation_id` before purge |
| `failed_search_logs` | **180 days** (or until resolved + 90d) | Action queue for alias/data fixes; separate from analytics |

**Purge example (run via scheduled job, not in app code):**

```sql
DELETE FROM search.search_result_click_events
 WHERE created_at < now() - interval '90 days';

DELETE FROM search.search_request_events
 WHERE created_at < now() - interval '90 days';
```

**Do not:** store long-term location trails, build user profiles from `session_key`, or retain raw events indefinitely without aggregation.

**Future (optional):** nightly rollups into daily aggregates (`normalized_query`, filter context, request count, click-through rate) then drop raw rows older than 90 days.

### Performance impact

- Search path: **0 ms awaited** on analytics insert (async `void …catch`).
- Typical insert cost: **~1–3 ms** on a separate connection, off the critical path.
- Indexes support time-range and `normalized_query` reporting without full scans.

---

## Archive (older QA / profiling)

- [`search-system-qa.md`](../../archive/old-docs/search-system-qa.md) — manual QA checklist (may be outdated)
- [`search-performance-profiling.md`](../../archive/old-docs/search-performance-profiling.md)
- [`address-search-index.md`](../../archive/old-docs/address-search-index.md) — legacy vs `address_index` notes
