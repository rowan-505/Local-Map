# Transport dashboard + API performance audit — 2026-07-24

**Audit type:** read-only (code inspection + safe Supabase `EXPLAIN ANALYZE` / `SELECT count`)  
**Scope:** Transport review dashboard (`apps/dashboard`) + transport API (`apps/api`) + Prisma pool + hosting  
**Production data modified:** **No** (no DML, no deploys, no index creation, no optimization implementation)  
**Supabase project:** `Map Project` (`locghyuranqaqsnbxflc`), region **`ap-northeast-1` (Tokyo)**

---

## 1. Executive summary

Transport review is functionally correct after recent merge/P2024 fixes, but perceived slowness is dominated by a **stacking of pool starvation + one proven SQL hotspot + frontend request waterfalls**, not by “the database is too big.”

**Confirmed top bottlenecks (ranked):**

1. **Prisma `connection_limit` defaults to `1`** (`apps/api/src/db/prisma.ts`). Concurrent dashboard reads and any interactive transaction serialize on one client connection → queue waits, P2024 under load, merges blocking unrelated reads.
2. **Route review-readiness duplicate check** uses bare `ST_DWithin(...::geography...)` with **no geometry bbox prefilter** → seq-scan join over ~12k active stops (~**911 ms** alone on production DB). Same pattern exists on stop **list filter** `duplicateStatus=nearby`. Stop-quality and nearby-candidates already use the safe `&& ST_Expand` + GiST pattern (~**20–40 ms**).
3. **Dashboard route review page request waterfall** (manual `useEffect`, not React Query): detail+variants → then readiness → (after map open) stops → quality → usage/nearby. Parallel `Promise.all` at the API still **serializes on a 1-connection pool**.
4. **Merge holds an interactive transaction** after a full preview round-trip; with pool=1 the held connection blocks all other transport traffic for the whole TX (maxWait 10s / timeout 30s).
5. **Cold starts / Render free tier** (inferred from prior prod evidence + architecture docs) amplify first-open latency; not yet separated with timed keep-alive probes in this pass.

**Database size is modest:** ~12.5k stops, 215 routes, 361 variants, ~18k route_stops, ~3.8k terminals. Most indexed lookups are fast. The slow paths are **algorithmic / pooling / orchestration**, not raw table size.

**Do not** raise instance size first. Fix pool + SQL rewrite + request waterfall first.

---

## 2. Production architecture and regions

| Layer | Technology | Region / notes |
|---|---|---|
| Dashboard | Next.js (Vercel or similar) | Not confirmed in this pass |
| API | Fastify + Prisma on **Render** | Region **not** in `render.yaml` / docs; needs Render dashboard confirmation |
| Database | Supabase PostgreSQL 17 + PostGIS | **`ap-northeast-1` (Tokyo)** |
| Pooler | Supabase (transaction `:6543` vs session `:5432`) | Exact prod URL type not readable from secrets; code assumes pooler-safe `connection_limit` |
| `DIRECT_URL` | **Not** in Prisma schema | Schema only has `DATABASE_URL` |
| Second Prisma pool | Optional `IMPORT_REVIEW_DATABASE_URL` | Also passes through `applyPrismaConnectionLimit` (default 1) |

**Implication:** If Render API is **not** in Tokyo, every sequential Prisma round-trip pays extra RTT. With `connection_limit=1`, a readiness handler that issues ~8 queries pays **~8 × RTT** of wait even when each SQL is cheap.

---

## 3. Baseline latency table

### 3.1 Measurement status

| Source | Status |
|---|---|
| Production HTTP p50/p95 for all 20 workflows | **Not collected this pass** (no live authenticated dashboard timing harness against Render) |
| Prior production evidence | Reads **1–5 s**; failed merges **~13–14 s**; Prisma **P2024**; `connection_limit=1`; `pool_timeout≈10s` |
| Production SQL `EXPLAIN ANALYZE` (read-only) | **Collected** (below) |
| Local/staging HTTP timings | **Not run** this pass |

Treat HTTP cells marked *inferred* as order-of-magnitude from prior evidence + SQL + waterfall shape. Re-measure after instrumentation (Phase 2 / §18).

### 3.2 Workflow baselines (best available)

| # | Workflow | Endpoint (typical) | Method | Status | DB evidence / estimate | Cold/warm | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Open route review page | waterfall (detail+variants → readiness) | GET×3+ | 200 | readiness duplicate SQL **~911 ms** alone | cold worse | Frontend waits on readiness after detail |
| 2 | Load routes list | `GET /transport/routes` | GET | 200 | COUNT+list with correlated EXISTS; list filters OK at current size | warm | Exact COUNT every page |
| 3 | Load route detail | `GET /transport/routes/:id` | GET | 200 | `routes.public_id` **seq scan** (~0.1 ms @ 215 rows) | warm | Missing unique index (scale risk) |
| 4 | Load ordered stops | `GET .../ordered-stops` | GET | 200 | Lite query; gated until Review Map opens | warm | Good pattern |
| 5 | Load stop quality | `GET .../stop-quality` | GET | 200 | ~**42 ms** on largest variant (~150 stops) with bbox | warm | After stops load |
| 6 | Load review readiness | `GET .../review-readiness` | GET | 200 | **~0.9–1.5 s DB** (duplicate EXISTS dominates) | warm | 8 queries; pool=1 serializes |
| 7 | Nearby stop candidates | `GET /transport/stops/nearby-candidates` | GET | 200 | ~**23 ms** with bbox+GiST | warm | Debounce flag unused (`immediate: true`) |
| 8 | Route usage detail | `GET .../route-usage-detail` | GET | 200 | Batched by stop ids (merge path) | warm | Fired when stop/candidate selected |
| 9 | Stop delete eligibility | `GET .../delete-eligibility` | GET | 200 | Separate from usage | warm | Stop detail page |
| 10 | Merge preview | `GET/POST merge-preview` | — | 200 | Multi-query + ~18-count SELECT | warm | Outside TX (good) |
| 11 | Safe merge (staging) | `POST /transport/stops/merge` | POST | — | Preview + long interactive TX | — | **Not executed** this audit |
| 12 | Remove stop from route | mutation | POST/DELETE | — | `ROUTE_STOP_TX_OPTIONS` 10s/30s | — | Not timed |
| 13 | Archive/delete stop | mutation | — | — | Eligibility gated | — | Not timed |
| 14–16 | Mark reviewed | review actions | POST | — | May re-call readiness | — | Not timed |
| 17 | Edit stop timing | mutation | — | — | — | — | Not timed |
| 18–19 | Path generate/save | — | — | — | External routing may dominate | — | Exclude from SLO if engine-bound |
| 20 | Overview / quality / queues | `GET /transport/overview` etc. | GET | 200 | Simple counts ~**13 ms**; regex name scans ~**18 ms** | warm | Many COUNTs; freshness can be relaxed |

### 3.3 Percentiles (HTTP)

| Metric | Value |
|---|---|
| p50 / p95 (full workflow set) | **Not measured this pass** — block on instrumentation + warm Render sample |
| Slowest observed (prior) | Failed merge **~13–14 s** (pool wait + TX / P2024 path) |
| Slowest measured SQL | Review-readiness duplicate EXISTS **910.9 ms** |

---

## 4. Cold-start versus warm performance

| Factor | Evidence | Effect |
|---|---|---|
| Render free / sleep | Architecture docs; prior prod “first request slow” | Multi-second wake before handler runs |
| Node + Prisma init | Single global PrismaClient | Pays once per process |
| Import-review bootstrap | Runs **after** listen (non-blocking) | Should not block first HTTP accept |
| Warm instance | Same process + open pool | Removes wake; pool=1 still serializes traffic |

**Rule for all SLOs:** label cold-start samples separately. Do not mix into warm p95.

---

## 5. Connection-pool analysis

### 5.1 Code defaults

```48:64:apps/api/src/db/prisma.ts
export function applyPrismaConnectionLimit(databaseUrl: string | undefined): string | undefined {
    // ...
    const limit = process.env.PRISMA_CONNECTION_LIMIT?.trim() ?? "1";
    return appendConnectionLimit(trimmed, limit);
}
```

- If `DATABASE_URL` lacks `connection_limit`, Prisma gets **`connection_limit=1`**.
- Interactive TX options: `ROUTE_STOP_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 }`.
- Prisma schema: **no `DIRECT_URL`**.

### 5.2 Capacity formula

```text
max Prisma connections ≈ API_instances × processes_per_instance × connection_limit
                       (+ dedicated import-review client if IMPORT_REVIEW_DATABASE_URL set)
```

Example (likely prod):

| Config | Connections |
|---|---|
| 1 Render instance × 1 process × limit 1 | **1** |
| Same + dedicated import-review Prisma | **2** (still tiny) |

### 5.3 What `connection_limit=1` causes

| Symptom | Mechanism |
|---|---|
| Sequential request handling | Only one query/TX at a time per process |
| Reads blocked behind merges | Interactive TX holds the only connection until commit/rollback |
| P2024 under concurrent dashboard load | `maxWait` / pool_timeout exhausted while TX or other queries hold the slot |
| `Promise.all` does not parallelize DB | Queues N queries on one connection → latency ≈ sum |
| Poor throughput despite OK SQL | Nearby (~23 ms) and list (~ms) still wait behind readiness (~1 s) or merge |

### 5.4 Transaction-client correctness (post-P2024)

| Check | Result |
|---|---|
| `this.prisma` inside `$transaction` callbacks in `transport.repo.ts` | **0 matches** (scan 2026-07-24) |
| Nested `$transaction` in merge | Not used for nested pool acquire on merge path |
| Merge preview | Outside TX (correct) |
| Remaining risk | Raising pool **without** keeping `tx` discipline can hide regressions; tests in `transport.merge-p2024.repo.test.ts` must stay |

### 5.5 Recommended safe pool configuration (do not apply in this audit)

**Assumptions to confirm before change:** Supabase plan connection budget; whether URL is transaction pooler (`:6543` + `pgbouncer=true`) or session; Render instance count.

| Setting | Recommendation | Reasoning |
|---|---|---|
| `PRISMA_CONNECTION_LIMIT` / URL `connection_limit` | **3–5** per API process for 1 Render instance | Allows overlap of 1 interactive TX + a few reads without exhausting small Supabase pools |
| Upper bound | Keep `instances × limit × processes` **well under** Supabase max (leave headroom for Studio, Martin, pipelines) | Avoid “fix pool by raising until OOM” |
| Transaction pooler | Prefer for app traffic; avoid long session features that break PgBouncer transaction mode | Prisma interactive TX needs session or careful pooler mode — **verify** current URL |
| `pool_timeout` | Keep ~10s until TX duration drops; then lower | Long timeout hides starvation |
| Do **not** | Use pool increase alone to “fix” TX bugs | P2024 root cause was `this.prisma` inside TX; already fixed |

---

## 6. Request waterfall

### Route review page (`TransportRouteDetailContent.tsx`)

```text
T0  GET route detail ─────────┐
    GET route variants ───────┼─ Promise.all (API)  → setRoute / setVariants
                              │
T1  (after route set)         │
    GET review-readiness ─────┘  ← depends on `route` object (re-runs if route identity churns)

T2  User opens Review Map
    GET ordered-stops
      └─ optional GET variant stops?includePath=1 (path overlay)

T3  After stops signature stable
    GET stop-quality

T4  On selected stop / nearby candidate
    GET route-usage-detail
    GET nearby-candidates (AbortController yes; debounce unused — always immediate)
```

### Classification

| Request | First paint? | Later OK? | Combine? | Duplicate risk | Cache? | Remove? |
|---|---|---|---|---|---|---|
| Detail + variants | **Required** | — | Could be one DTO | Low | staleTime short | No |
| Review readiness | Needed for review panel | Can skeleton | — | Re-fetch after mark-reviewed | Cache until mutation | Soften duplicate SQL first |
| Ordered stops | Not until map | **Lazy** (already) | — | Variant change | Keep previous | No |
| Stop quality | Secondary | **Lazy** | — | Stops signature | Invalidate on membership | No |
| Nearby | Interaction | Debounce | — | Map click storms | Abort stale | Debounce on move |
| Usage detail | Interaction | Lazy | — | Selection churn | Per stop id | No |
| Overview/queues | Other pages | — | Optional BFF | — | TTL 30s–5m | Don’t block review |

---

## 7. Duplicate / N+1 requests

| Finding | Layer | Severity |
|---|---|---|
| Readiness `Promise.all` of ~6 queries + prior route/variants queries | API | High with pool=1 (serializes) |
| Readiness duplicate EXISTS: nested loop × ~12k stops | SQL | **P1** |
| Stop list `duplicateStatus` filter: same bare geography `ST_DWithin` | SQL | P1 when filter used |
| Stop-quality uses bbox (good); readiness does not | SQL inconsistency | P1 |
| Correlated per-row `variant_count` / `stop_count` / `path_count` on route list | API | P2 at 215 routes |
| Exact `COUNT(*)` alongside every list page | API | P2 |
| Dashboard: no React Query — no shared cache / dedupe across components | UI | P1 |
| `useEffect` readiness depends on whole `route` object | UI | P2 (extra refetches) |
| Nearby always `immediate: true` (300 ms debounce unused) | UI | P2 |
| Map `onCandidateSearchRequest` uses `immediate: true` | UI | P2 |
| Strict Mode double-mount | Dev only | Do not treat as prod |
| Parallel browser requests overload pool=1 | Hosting+pool | **P0** |

---

## 8. Slow-query inventory

Thresholds measured on production DB via Supabase MCP (`EXPLAIN ANALYZE`, read-only).

| Query / pattern | Source | Avg/worst (this pass) | Rows / buffers | Class |
|---|---|---|---|---|
| Readiness duplicate warning `EXISTS (... ST_DWithin geography ...)` no bbox | `transport-review.repo.ts` ~141–156 | **910.9 ms** | 372k join-filter removals; seq scan 12 448 stops | **>500 ms / ~1 s** |
| Same pattern proposed with `geom && ST_Expand` | rewrite proof | **20.1 ms** | GiST index used | Fix target |
| Nearby candidates (bbox + DWithin) | `transport.repo.ts` nearby | **23.3 ms** | GiST + mode bitmap | OK |
| Stop-quality (largest variant ~150 stops) | `getVariantStopQuality` | **~42 ms** | GiST per stop, bbox | OK |
| Overview-style multi COUNT | `getOverview` counts | **13.3 ms** | index-mostly | OK |
| Regex generated-name scan on stops | queues/overview quality | **17.7 ms** seq scan 12k | P2 if repeated often |
| Route by `public_id` | detail/readiness | **0.13 ms** seq scan 215 | OK now; index for scale |
| Route list EXISTS has_stops style | list filters | **~2 ms** | OK at current size | — |

No production destructive `EXPLAIN ANALYZE` was run. Merge DML was **not** executed.

---

## 9. Query plans

### 9.1 Current — readiness duplicate EXISTS (hot)

```text
Aggregate ... actual time=910.385..910.390
  Nested Loop Semi Join
    Join Filter: ST_DWithin(s.geom::geography, s2.geom::geography, 50)
    Rows Removed by Join Filter: 372381
    → route stops for one route: 39 rows
    → Materialize + Seq Scan on stops s2: 12448 active rows
Execution Time: 910.923 ms
```

**Root cause:** geography cast prevents use of `transport_stops_geom_gix`; planner chooses nest-loop over full active stop set.

### 9.2 Proposed — add geometry bbox before geography DWithin

```text
Nested Loop Semi Join
  → Index Scan using transport_stops_geom_gix on s2
      Index Cond: geom && ST_Expand(s.geom, 0.001)
      Filter: ... ST_DWithin(geography, 50)
Execution Time: 20.114 ms
```

**Expected benefit:** ~**45×** on this subquery; readiness endpoint DB time drops from ~1 s toward tens of ms (plus remaining cheap queries).

**Index:** **No new index required** — uses existing GiST. This is a **query rewrite**, not an index migration.

### 9.3 Nearby candidates (healthy reference)

BitmapAnd of `transport_stops_geom_gix` + `transport_stops_mode_idx`, then geography filter; **23 ms**.

---

## 10. Missing / ineffective indexes

| Table | Column / pattern | Present? | Verdict |
|---|---|---|---|
| `stops.geom` | GiST | Yes (`transport_stops_geom_gix`) | Effective when query uses `&&` |
| `stops.public_id` | UNIQUE | Yes | OK |
| `terminals.public_id` / `linked_stop_id` | Yes | OK |
| `route_stops (variant_id, sequence)` | Yes (multiple overlapping names) | OK; some redundancy |
| `routes.public_id` | **No index / no unique constraint** | Seq scan; **propose UNIQUE** for correctness + scale (benefit tiny at 215 rows) |
| `route_variants.public_id` | **No index** | Same |
| `routes.updated_at` | No dedicated index | List ORDER BY may sort in memory; OK at 215 |
| Partial indexes on `deleted_at IS NULL` | Several | Useful |

### Proposed indexes (only where plan-backed or integrity-backed)

| Proposal | Fixes | Current plan | Proposed plan | Benefit | Write cost | Partial? | Overlap |
|---|---|---|---|---|---|---|---|
| **None for duplicate readiness** | readiness / list duplicate filter | Nest-loop seq | GiST via rewrite | ~45× | 0 | — | Use existing GiST |
| `UNIQUE (public_id)` on `transport.routes` | detail/readiness lookups + integrity | Seq scan | Index scan | Latency ≈0 today; correctness | Low | No | None |
| `UNIQUE (public_id)` on `transport.route_variants` | variant endpoints | Likely seq | Index scan | Scale | Low | No | None |
| New GiST on geography column | — | — | — | **Not needed** if bbox rewrite lands | High | — | Prefer rewrite |

**Do not add indexes “because the list is slow” without repeating EXPLAIN after the rewrite + pool fix.**

---

## 11. Transaction-duration analysis

### Merge (`mergeStopsKeepCanonical`)

Preview is **outside** TX (good). TX stages (names from prior audit + code): lock stops/terminals → validate → apply fields → update memberships/terminals/names/links → verify → delete → audit → response.

| Stage | Current time | Target | Optimization |
|---|---|---|---|
| preview_validation | Multi-query (outside TX) | &lt;300 ms warm | Keep outside; cache nothing unsafe |
| acquire_connection | Up to **10 s** maxWait when pool busy | &lt;50 ms | Raise pool modestly; shorten TX |
| begin + lock_rows | Unknown | Short | Lock late; only needed rows |
| load_entities / snapshots | Sequential (post-P2024) | Minimal | Avoid large JSON while locked |
| apply_field_sources | Was P2024 when using root client | &lt;100 ms | Keep `tx` client (done) |
| update_route_stops / variants / terminals / children / names / links | Sequential statements | Batch where safe | Still atomic |
| verify_references | Extra reads | Keep | Correctness &gt; micro-opt |
| delete_or_archive + audit | — | Minimal snapshot | Keep audit |
| commit | — | — | — |
| **Total warm merge** | Prior fail path **13–14 s** (queue+error) | **p95 &lt; 2.5 s** | Pool + shorter TX + fewer pre-lock reads |

### Route-stop remove / review mutations

Same `ROUTE_STOP_TX_OPTIONS`. Prefer: validate outside → short TX → return lite ordered list (already a pattern via `listOrderedStopsLite`).

**Preserve:** full atomic rollback; no fake optimistic success on merge.

---

## 12. Payload / serialization analysis

| Topic | Finding | Recommendation |
|---|---|---|
| Ordered stops lite | Separated from path geometry | Keep |
| Path overlay | Separate fetch with `limit: 1` | Keep |
| Route list | Many flags per row; no full geom | OK; defer exact counts |
| Merge preview | Rich comparison + usage | Acceptable; measure bytes later |
| BigInt | Casts/`jsonSafeNumber` after prior 500s | Keep |
| Compression | Not verified on Render | Enable gzip if not already |
| Exact total count on lists | Extra query every page | Optional approximate / omit |

Instrumentation for `serializationDurationMs` / `responseSizeBytes` is **not** fully wired for all transport routes (partial `TRANSPORT_PERF_LOG=1` only).

---

## 13. Dashboard rendering analysis

| Topic | Finding |
|---|---|
| Data library | Manual fetch + `useEffect` (not React Query/SWR on review surfaces) |
| Cache / staleTime / refetchOnFocus | Absent → easy duplicate work; no focus refetch storm either |
| Ordered stop list | Virtualized only if length **&gt; 150** |
| Map | Memoized feature collections in places; candidate search immediate |
| After mutations | Prefer local `applyMutationResult`; refetch on invalid response |
| Loading UX | Readiness can block review confidence; map content lazy — good |

Recommendations (implement later): short `staleTime` for detail/variants; debounce nearby; keepPreviousData on variant switch; skeleton readiness; virtualize earlier if needed.

---

## 14. Hosting limitations

| Item | Assessment |
|---|---|
| Free Render sleep | Likely major cold-start contributor; measure separately |
| Always-on paid instance | Helps cold start only; **does not** fix pool=1 or 911 ms SQL |
| Keep-alive | Only if policy allows; does not replace pool/SQL fixes |
| Martin on Render | Separate service; share DB budget |

Cost comparison: upgrade Render **after** pool + SQL + waterfall; otherwise paying for idle CPU while one connection still queues dashboard tabs.

---

## 15. Confirmed root causes

| Rank | Root cause | Evidence | Affected features | Current cost | Recommended fix | Expected gain | Risk | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | `connection_limit=1` default | `prisma.ts`; prior P2024; TX maxWait 10s | All concurrent transport | Queue + timeouts; merges block reads | Set limit 3–5 with budget math; keep TX on `tx` | Large throughput / p95 | Medium (pooler mode) | &lt;1 day |
| 2 | Readiness duplicate SQL without bbox | EXPLAIN 911 ms → 20 ms with rewrite | Review readiness, mark-reviewed gates | ~1 s+ per open | Mirror stop-quality `&& ST_Expand` | ~45× on hotspot | Low | &lt;1 day |
| 3 | Request waterfall + no shared cache | `TransportRouteDetailContent` | Route review page | Multi-RTT + pool queue | Parallelize safe reads after pool fix; cache keys | Perceived 2–3× | Low | 1–2 days |
| 4 | Parallel API queries serialize on pool=1 | Promise.all + limit 1 | Overview, readiness, list+count | Sum of query times | Modest pool + fewer round-trips | Large under load | Low | &lt;1 day |
| 5 | Long interactive merge TX | Stage map; prior 13–14 s failures | Merge | Holds only connection | Keep preview out; shorten locked work | Toward &lt;2.5 s | Medium | 2–5 days |
| 6 | Nearby debounce unused | `immediate: true` | Map candidate search | Extra GETs | Use debounce on pan/drag | Fewer requests | Low | &lt;1 day |
| 7 | Missing `routes`/`route_variants.public_id` unique indexes | pg_indexes | Detail lookups | Negligible now | Add UNIQUE | Integrity + future | Low | &lt;1 day |
| 8 | Aggregate COUNT / regex scans | overview/queues EXPLAIN | Overview/quality pages | Tens of ms each; many queries | TTL cache 30s–5m | Perceived snappiness | Low | 2–5 days |
| 9 | Cold start | Hosting model | First open after idle | Seconds | Measure; then always-on if needed | Cold only | Cost | Later |
| 10 | Cross-region RTT (if any) | DB Tokyo; API region unknown | All sequential queries | N×RTT | Confirm regions; move API if needed | Medium if mismatched | Migration | Later |

---

## 16. Recommended fixes

See §17–§18 and Phase 15 implementation plan. Priority order:

**P0:** pool configuration + keep TX client correctness  
**P1:** readiness/list duplicate SQL bbox rewrite; reduce waterfall / duplicate fetches  
**P2:** list COUNT strategy; nearby debounce; payload/cache TTL for aggregates  
**P3:** public_id unique indexes; virtualization polish; hosting upgrade after measurement  

---

## 17. Expected improvement

| Change | Expected gain (warm) |
|---|---|
| Bbox rewrite on readiness duplicate | Readiness DB **~1 s → ~50–100 ms** class |
| `connection_limit` 1 → 3–5 | Concurrent tabs/map no longer fully serialize; fewer P2024 |
| Waterfall + cache | First interactive map content sooner; fewer redundant GETs |
| Merge TX trim + pool | Merge p95 toward **&lt;2.5 s** (after correctness preserved) |
| Always-on Render alone | Cold opens only; **limited** warm gain |

Combined realistic target for route review first paint (warm, Tokyo-local API): readiness+detail in **&lt;800 ms p95** after P0+P1 (vs multi-second today under contention).

---

## 18. Validation plan

1. Enable temporary structured timing (Phase 2) on staging + one warm prod sample window.  
2. Capture before metrics: p50/p95, query count, pool wait, TX duration, rows from EXPLAIN.  
3. Apply fixes in order: pool → SQL rewrite → dashboard debounce/cache → TX scope.  
4. Re-run same fixtures/endpoints.  
5. Regression suite: `npm run test:transport-review-regression` + merge P2024 tests.  
6. Confirm no correctness/atomicity/staleness regression on merge/delete/review.

---

## 19. Rollback plan

| Change | Rollback |
|---|---|
| `PRISMA_CONNECTION_LIMIT` / URL param | Revert env to previous; redeploy |
| SQL rewrite | Revert PR; no schema change |
| New UNIQUE indexes | `DROP INDEX` migration (only if added later) |
| Dashboard fetch changes | Revert PR |
| Hosting plan change | Downgrade plan |

No production data migration in the SQL rewrite path.

---

## 20. Performance SLOs (initial)

### Warm reads (p95)

| Endpoint class | Target |
|---|---|
| Simple list/detail | &lt; 500 ms |
| Ordered stops | &lt; 800 ms |
| Nearby candidates | &lt; 500 ms |
| Review readiness | &lt; 800 ms |
| Aggregate quality | &lt; 1.5 s |

### Mutations (p95)

| Action | Target |
|---|---|
| Review action | &lt; 800 ms |
| Remove route stop | &lt; 1.5 s |
| Merge preview | &lt; 1 s |
| Merge execution | &lt; 2.5 s |
| Path generation | Exclude if external engine dominates |

### Cold start

Report separately; do not fail warm SLOs on cold samples.

### Aggregate freshness (if caching later)

| Endpoint | Acceptable freshness |
|---|---|
| Overview counts | 30 s – 5 min |
| Quality queues | 30 s – 5 min |
| Review readiness | Near real-time / on mutation |
| Stop quality | On membership change |
| Route usage | Real-time on open |

Do **not** introduce materialized views until freshness is agreed.

---

## Phase 2 — Instrumentation plan (not implemented this audit)

For every transport request log (no JWTs/secrets/SQL params with PII):

- `requestId`, `endpoint`, `method`, `authenticatedRole`
- `totalDurationMs`, `authDurationMs`, `validationDurationMs`, `serviceDurationMs`, `repositoryDurationMs`
- `dbAcquireDurationMs`, `dbQueryDurationMs`, `queryCount`, `serializationDurationMs`, `responseSizeBytes`, `resultCount`
- `transactionDurationMs` when applicable; success/error

Merge/delete/review named stages:  
`preview_validation`, `acquire_connection`, `begin_transaction`, `lock_rows`, `load_entities`, `validate_references`, `apply_field_sources`, `update_route_stops`, `update_variants`, `update_terminals`, `update_children`, `update_names`, `update_source_links`, `verify_references`, `delete_or_archive`, `insert_audit`, `build_response`, `commit`.

Existing hook: `TRANSPORT_PERF_LOG=1` partial logging in `transport.repo.ts` / some routes — extend, do not leave verbose forever.

---

## Phase 15 — Implementation plan (do not implement yet)

### Quick wins (&lt; 1 day)

| Change | Files | Tests | Deploy order | Metrics |
|---|---|---|---|---|
| Set `PRISMA_CONNECTION_LIMIT=3..5` (confirm pooler) | Render env; `prisma.ts` docs | merge-p2024 tests | Env only | pool wait, P2024 rate |
| Bbox rewrite readiness + stop list duplicate filter | `transport-review.repo.ts`, `transport.repo.ts` | readiness unit + EXPLAIN | API | readiness p95, EXPLAIN |
| Nearby debounce (`immediate: false` on move) | `useReviewMapNearbyCandidates.ts`, map shell | hook tests | Dashboard | nearby request count |
| Avoid depending readiness effect on whole `route` | `TransportRouteDetailContent.tsx` | manual | Dashboard | readiness fetch count |
| Document pool + omit exact count option | list routes | list tests | API | list duration |

### Medium (2–5 days)

| Change | Files | Tests | Deploy order | Metrics |
|---|---|---|---|---|
| Shorten merge TX / batch updates | `transport.repo.ts` | merge regression | API | TX stage timings |
| React Query (or shared cache) for detail/variants/readiness | dashboard transport | contract tests | Dashboard | waterfall |
| Aggregate TTL cache | overview/queues service | freshness tests | API | overview p95 |
| DTO separation / ETag | routes | OpenAPI | API | payload bytes |

### Larger

| Change | Prerequisite |
|---|---|
| Precomputed quality flags / async refresh | Freshness policy |
| Materialized views | Explicit freshness + refresh job |
| API region move next to Tokyo DB | Measured RTT gain |
| Always-on Render | Cold-start measurements prove need |

---

## Optimization priority table

| Priority | Change | Layer | Expected gain | Cost | Risk | Prerequisite |
|---|---|---|---|---|---|---|
| P0 | Raise Prisma pool to 3–5 (budgeted) | API/host | Unblocks concurrency | Low | Pooler mode mismatch | Confirm Supabase URL type + limits |
| P0 | Keep/verify all interactive TX use `tx` | API | Prevents P2024 regression | Low | Low | Existing tests |
| P1 | Bbox-prefilter duplicate readiness/list SQL | API/SQL | ~45× on hotspot | Low | Low | EXPLAIN proof (done) |
| P1 | Reduce review-page waterfall / shared cache | Dashboard | Lower perceived latency | Low | Stale UI | Pool fix first |
| P1 | Debounce/cancel nearby | Dashboard | Fewer GETs | Low | Low | — |
| P2 | Soften exact list COUNT | API | Faster lists | Low | UX count | Product OK |
| P2 | Short TTL on overview/queues | API | Snappier admin home | Low | Stale counts | Freshness policy |
| P2 | UNIQUE `public_id` routes/variants | DB | Integrity + scale | Low | Migration | Migration review |
| P3 | Virtualize earlier / memo polish | Dashboard | Scroll jank | Low | Low | — |
| P3 | Always-on Render / region align | Host | Cold / RTT | $$ | Ops | Measure first |

---

## Appendix A — Dataset sizes (live SELECT, 2026-07-24)

| Entity | Count (non-deleted where applicable) |
|---|---:|
| stops | 12 457 |
| routes | 215 |
| route_variants | 361 |
| route_stops | 18 146 |
| route_paths | 300 |
| terminals | 3 832 |

## Appendix B — Commands and measurements run

- Supabase MCP `list_projects` → region `ap-northeast-1`
- `execute_sql` live counts (SELECT only)
- `pg_indexes` / constraint inventory for transport tables
- `EXPLAIN (ANALYZE, BUFFERS)` on:
  - readiness-style duplicate EXISTS (current)
  - bbox-prefiltered duplicate EXISTS (proposed)
  - nearby candidates
  - overview-style counts
  - generated-name regex scan
  - route `public_id` lookup
  - stop-quality-style nearby aggregate on largest variant
- Code scans: `prisma.ts`, `transport-review.repo.ts`, `transport.repo.ts`, dashboard route detail / nearby hooks
- Python scan: `this.prisma` inside `$transaction` → **0**

**Not run:** production DML, merge execution, index creation, deploys, `npm audit fix --force`, live authenticated HTTP p50/p95 harness against Render.

## Appendix C — Confirmation

**Production data was not modified.**  
**No optimizations were implemented in this audit.**  
**No indexes were added.**
