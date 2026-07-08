---
status: archived
reason: replaced by docs/archive/old-docs/search-performance-profiling.md
archived_at: 2026-07-01
---

# `/public/search` Performance Profiling

Profiling of the legacy public text search and the minimal DB fix. Numbers below
were captured with `EXPLAIN (ANALYZE, BUFFERS)` against the live database
(Postgres 17, project `locghyuranqaqsnbxflc`) on 2026-06-26.

> Scope guard: this is OSM/PostGIS data only — no PMTiles search, no external
> search engine. The API `route → service → repo` structure is unchanged.

---

## 1. Where the SQL lives

- Route: `apps/api/src/modules/public-map/public-map.routes.ts` → `GET /public/search`
- Service: `apps/api/src/modules/public-map/public-map.service.ts` → `PublicMapService.search()`
- Repo / SQL: `apps/api/src/modules/public-map/public-map.repo.ts`
  - `PublicMapRepository.search()` → `buildSearchWithStreetNamesQuery()` /
    `buildSearchWithoutStreetNamesQuery()` → `buildSearchQuery()`

`buildSearchQuery()` builds a 3-CTE `UNION ALL` (`place_results`,
`admin_area_results`, `street_results`), ranks, and applies `LIMIT` **last**. The
match predicates use `partialSearchTerm()` = `%q%` (`ILIKE`) in `full` mode.

## 2. Temporary debug logging (added)

`PublicMapService.search()` now emits a per-query timing log at **debug** level
(quiet in production), plus the existing **warn** for slow/timed-out queries:

```jsonc
// debug — every query
{ "event": "public_search_timing", "query": "...", "mode": "prefix|full",
  "duration_ms": 0, "result_count": 0, "timed_out": false }
// warn — duration >= 1000ms OR timeout
{ "event": "public_search_slow", ... }
```

Enable with API log level `debug`. Remove the `public_search_timing` line once the
index fix is verified (it is intentionally marked `TEMP`).

## 3. Dataset shape (why it matters)

| Table | Live rows |
| --- | --- |
| `core.core_streets` | **824,857** (≈823k active) |
| `core.core_street_names` | 27,302 |
| `core.core_admin_area_names` | 3,360 |
| `core.core_admin_areas` | 2,517 |
| `core.core_place_names` | 353 |
| `core.core_places` | 282 |

`pg_trgm` is installed, **but there are no `gin_trgm_ops` (or prefix-btree) indexes
on any name column** (`canonical_name`, `core_*_names.name`, `display_name`,
`primary_name`). All existing indexes are btree/gist/jsonb-gin — none serve `ILIKE`.

Match magnitude for the street CTE (`canonical_name ILIKE '%q%'`, active only):

| Query | Matching streets | of ~823,006 |
| --- | --- | --- |
| `a` | **801,539** | ~97% |
| `ak` | 119 | — |
| `kyauktan` | 5 | — |

So `q='a'` matches almost the entire street table, and the query then runs the
per-row PostGIS projection (`ST_Transform` → `ST_PointOnSurface` / `Box2D`) on all
~801k rows **before** the final `LIMIT`.

## 4. EXPLAIN ANALYZE

Representative street-CTE projection (the dominant cost). Run each against the DB:

```sql
-- q = 'kyauktan'  (only 5 matches, but still a full scan)
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.public_id,
       ST_Y(ST_PointOnSurface(ST_Transform(s.geom,4326))) AS lat,
       ST_X(ST_PointOnSurface(ST_Transform(s.geom,4326))) AS lng,
       ST_XMin(Box2D(ST_Transform(s.geom,4326)))         AS min_lng
FROM core.core_streets s
WHERE s.geom IS NOT NULL AND s.is_active = true
  AND s.canonical_name ILIKE '%kyauktan%';

-- q = 'ak'  (prefix in code's 2-char mode; full-contains shown here)
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.public_id
FROM core.core_streets s
WHERE s.is_active = true AND s.canonical_name ILIKE '%ak%';

-- q = 'a'  (broad — DO NOT run casually; ~801k rows + per-row PostGIS = 20s+)
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.public_id,
       ST_Y(ST_PointOnSurface(ST_Transform(s.geom,4326))) AS lat
FROM core.core_streets s
WHERE s.geom IS NOT NULL AND s.is_active = true
  AND s.canonical_name ILIKE '%a%';

-- q = 'ကျောက်တန်း'  (Myanmar; matches street_names, not canonical_name)
EXPLAIN (ANALYZE, BUFFERS)
SELECT n.street_id
FROM core.core_street_names n
WHERE n.name ILIKE '%ကျောက်တန်း%';
```

### Measured result — `q='kyauktan'`

```
Gather  (actual time=3804.031..12671.269 rows=5 loops=1)
  Workers Launched: 1
  Buffers: shared hit=21230 read=208722
  ->  Parallel Seq Scan on core_streets s  (actual time=1936.798..12629.756 rows=2 loops=2)
        Filter: (is_active AND (canonical_name ~~* '%kyauktan%'::text))
        Rows Removed by Filter: 411504
Planning Time: 22.583 ms
Execution Time: 12875.728 ms
```

Even a 5-row result takes **~12.9s**: a Parallel Seq Scan reads **208,722 disk
buffers (~1.6 GB)** to apply `ILIKE` across all ~823k streets. The PostGIS
projection is cheap here (only 5 rows survive) — the cost is the unindexed scan.

## 5. Exact bottleneck

1. **Primary: no trigram/prefix index on name columns → full (parallel) seq scan
   of `core.core_streets` (~823k rows, ~1.6 GB) on every query.** This alone is
   ~12–13s regardless of how specific the query is (`kyauktan` = 5 matches still
   scans everything).
2. **Secondary (broad queries only): per-row PostGIS projection before `LIMIT`.**
   For `q='a'` (~801k matches), `ST_Transform`/`ST_PointOnSurface`/`Box2D` run on
   ~801k rows → 20s+ / occasional 500s. The `LIMIT` cannot help because it is
   applied after the projection in the `UNION`.

Place/admin CTEs are not the problem (282 / 2,517 / 3,360 rows scan in ms).

This validates the two guards already shipped (length guard + 2s
`statement_timeout`): they stop `q='a'` from melting a connection. But they do
**not** fix specific queries like `kyauktan`, which still seq-scan for ~13s. The
index is required.

## 6. Recommended minimal indexes (the fix)

`pg_trgm` is already enabled. Add GIN trigram indexes on the searched name columns
(serves `ILIKE '%q%'` for 3+ char queries). Ship as a migration using
`CONCURRENTLY` to avoid write locks:

```sql
-- Biggest win: streets (823k rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_streets_canonical_name_trgm_idx
  ON core.core_streets USING gin (canonical_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS core_street_names_name_trgm_idx
  ON core.core_street_names USING gin (name gin_trgm_ops);

-- Places + admin names (small, but keeps every CTE index-driven)
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_places_display_name_trgm_idx
  ON core.core_places USING gin (display_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_places_primary_name_trgm_idx
  ON core.core_places USING gin (primary_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_place_names_name_trgm_idx
  ON core.core_place_names USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_admin_areas_canonical_name_trgm_idx
  ON core.core_admin_areas USING gin (canonical_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_admin_area_names_name_trgm_idx
  ON core.core_admin_area_names USING gin (name gin_trgm_ops);
```

Notes / caveats:
- `CONCURRENTLY` cannot run inside a transaction block — run it outside the
  migration runner's wrapping transaction (or as a standalone step).
- Trigram indexes need **3-character** trigrams. They accelerate 3+ char `ILIKE`
  (the common case). 2-char queries (already forced to `prefix` mode) and 1-char
  queries (blocked) are out of trigram range; they remain bounded by the 2s
  `statement_timeout`. If 2-char latency matters later, add a prefix btree:
  `... USING btree (lower(canonical_name) text_pattern_ops)`.
- These indexes are read-only optimizations (no behavior change), but they add
  write/maintenance cost and ~tens of MB. Apply off-peak and `ANALYZE` after.

## 7. Before / after expectation

| Query | Now (no index) | After GIN trgm | Why |
| --- | --- | --- | --- |
| `kyauktan` | ~12,900 ms | **< ~50 ms** | trigram index scan → ~5 candidate rows, then PostGIS on 5 rows |
| `ak` (2-char) | seq scan, bounded by 2s timeout | similar (prefix mode, sub-trigram) | not the hot path; rare |
| `a` (1-char) | blocked by length guard (no DB call) | unchanged | guard returns `[]` |
| `ကျောက်တန်း` | seq scan of `core_street_names` (27k, ~ms) → fast already; full join still scans `core_streets` | **< ~50 ms** | trigram on `canonical_name` + `name` removes the street seq scan |

Estimated improvement for specific multi-char queries: **~12,900 ms → < 50 ms
(≈250×)**. (The "after" figure is a pg_trgm estimate; not benchmarked on prod
because no index was created there — see §8.)

## 8. Should runtime search move to `search.search_documents`? — Yes (strategic)

Recommended path:

- **Short term (minimal, low risk):** keep `route → service → repo`, add the GIN
  trigram indexes above. Combined with the shipped length guard + 2s
  `statement_timeout`, this removes the seq-scan bottleneck and the 20s tail.
- **Strategic (preferred end state):** switch `GET /public/search` to
  `PublicMapService.searchUnified()` over `search.search_documents` (migrations
  115–117). That table stores **precomputed centroid + bbox** (no per-row
  `ST_Transform`/`ST_PointOnSurface` at query time — eliminating bottleneck #2
  entirely for broad queries) and ships proper `tsvector` GIN + `pg_trgm` indexes
  (eliminating bottleneck #1). It also unifies bus/address/water/building/landuse
  into one ranked query.

The legacy query's per-row PostGIS projection is inherently expensive for broad
matches and cannot be fully fixed by indexes alone; `search.search_documents` is
the durable fix. Cut over only after the index is populated
(`SELECT search.rebuild_search_documents();`) and validated against
`docs/search-system-qa.md`.

## 9. What was NOT changed

- No production indexes were created/dropped (no blind production changes).
- No query behavior changed; only a temporary debug timing log was added in the
  service.
- No PMTiles search, no external search engine.
