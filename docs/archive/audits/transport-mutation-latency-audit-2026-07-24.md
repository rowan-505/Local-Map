# Transport mutation latency audit — 2026-07-24

**Audit type:** read-only analysis + gated instrumentation + rollback-only timing probes  
**Scope:** Dashboard mutation buttons → Fastify transport API → Prisma interactive transactions → Supabase PostGIS  
**Production data modified:** **No** (no successful destructive DML; rollback-only no-op UPDATE sims; SELECT/EXPLAIN/settings only)  
**Optimizations implemented:** **No** (instrumentation only; recommendations below)  
**Deployed:** **No**

Related prior work:

- [`transport-api-performance-audit-2026-07-24.md`](./transport-api-performance-audit-2026-07-24.md)
- [`transport-performance-quick-wins-implementation-2026-07-24.md`](./transport-performance-quick-wins-implementation-2026-07-24.md)
- [`transport-stop-merge-execution-root-cause-2026-07-23.md`](./transport-stop-merge-execution-root-cause-2026-07-23.md)

---

## 1. Executive summary

Mutation buttons feel slow for three **measured** reasons that stack:

1. **Save timing is an N+1 UPDATE storm.** `recalculateVariantTimetableOffsetsInTx` issues one UPDATE per route_stop. Rollback-only probe on production data (YBS-106, 150 stops): **7 050 ms** for 150 no-op sequential UPDATEs (~47 ms/row). Same 50 rows batched in one statement: **53 ms**.
2. **Merge pays a full preview again, then ~20+ sequential round trips inside an interactive transaction.** Client→Tokyo pooler `SELECT 1` RTT ≈ **44 ms**. An 18-query merge-shaped rollback sim took **853 ms** of network alone before real write cost.
3. **Dashboard post-success work still blocks perceived “done”.** Merge closes the dialog after commit, then **awaits** ordered-stops + stop-quality refetch and fires route-usage reload. Path/route review triggers a second full `GET .../review-readiness` (duplicate spatial check included).

Pool risk remains: code default `connection_limit=1` when URL has none; local `.env` URL already sets `connection_limit=5` on transaction pooler `:6543`. **Render production effective limit was not readable this pass** (no Render API access). Do not raise further without confirming Render env + Supabase connection budget.

| Rank | Action | Slow stage | Evidence | Current duration | Root cause | Fix | Expected duration |
|---|---|---|---|---|---|---|---|
| 1 | Save timing | per-row offset UPDATEs | rollback sim 150× UPDATE = 7 050 ms | ~7–8 s API on large variants | N+1 in TX | one set-based / VALUES UPDATE | ~100–300 ms TX |
| 2 | Merge stops | preview recompute + sequential TX stages | preview outside TX + ~20 RTTs × 44 ms; sim 853 ms / 18 queries | ~2–5+ s (prior failed merges 13–14 s under pool=1) | preview redo + RTT × query count; pool wait under load | preview token + critical revalidation only; batch counts | ~0.5–1.5 s warm |
| 3 | Mark route reviewed | readiness before TX + UI refetch | `getRouteReviewReadiness` (~8 queries, duplicate EXISTS) then TX (3 queries); UI `reloadReadiness()` again | ~1–3 s perceived | double readiness | return readiness in mutation; skip second GET | ~200–500 ms |
| 4 | Mark path reviewed | UI `reloadReadiness()` | local status patch then full readiness GET | API ~150–300 ms; UI +0.5–1.5 s | unnecessary readiness refetch | return compact readiness / cache | ~150–400 ms |
| 5 | Remove from route | TX + lite re-read; optional usage refetch | bulk resequence already fixed; still post-TX `listOrderedStopsLite` + usage GET | ~300–800 ms | extra round trips after good TX | use returned list only; background usage | ~200–400 ms |
| 6 | Archive / permanent delete | eligibility + TX revalidation | eligibility GET then full re-check in TX | hundreds of ms–1 s | duplicate reference work | keep TX check; compact eligibility cache | ~200–500 ms |

---

## 2. Effective Prisma pool configuration

| Setting | Source | Value this pass |
|---|---|---|
| Code default when URL has no `connection_limit` | `apps/api/src/db/prisma.ts` `resolvePrismaConnectionLimitValue` | **`"1"`** |
| Local `DATABASE_URL` | apps/api `.env` (inspected, secrets not logged) | host `aws-1-ap-northeast-1.pooler.supabase.com`, port **`6543`**, `pgbouncer=true`, **`connection_limit=5`**, `pool_timeout=20` |
| Effective local limit | URL wins over env | **5** |
| `PRISMA_CONNECTION_LIMIT` | local env | unset |
| Interactive TX options | `ROUTE_STOP_TX_OPTIONS` | `maxWait: 10_000`, `timeout: 30_000` |
| `IMPORT_REVIEW_DATABASE_URL` | second Prisma client possible | set locally; same `applyPrismaConnectionLimit`; **not used by transport mutations** |
| Render production | not readable | **unconfirmed**; prior audit + quick-wins note target `PRISMA_CONNECTION_LIMIT=3` **not auto-deployed** |
| Supabase `max_connections` | MCP `SELECT` | **60** |
| `statement_timeout` | MCP | **2min** |
| `lock_timeout` / idle-in-tx | MCP | **0** (disabled) |

**Conclusion:** Do **not** recommend a new production limit until Render’s effective URL/`PRISMA_CONNECTION_LIMIT` and pooler type are confirmed in Render logs (`[api] prisma connection_limit=<n>`).

---

## 3. Render and Supabase regions

| Layer | Region | Evidence |
|---|---|---|
| Supabase DB | **`ap-northeast-1` (Tokyo)** | MCP `list_projects` → `locghyuranqaqsnbxflc` |
| Pooler | `aws-1-ap-northeast-1.pooler.supabase.com:6543` | local URL host (transaction pooler) |
| Render API | **Not confirmed** | `render.yaml` only lists Martin; no API region |
| Martin tiles (related) | `sin` (Singapore) | `infrastructure/tiles/martin/fly.toml` |

**Measured client→DB RTT (developer Mac → Tokyo pooler, warm):**

| Probe | Result |
|---|---|
| `SELECT 1` ×5 sequential | avg **44.2 ms**, p50 **43.8 ms**, max **46.9 ms** |
| `BEGIN` + `SELECT 1` + `ROLLBACK` ×5 | avg **133.7 ms** |
| 5× `SELECT 1` in one TX | **310 ms** |
| Implication | each sequential Prisma round trip ≈ **~44 ms** network floor |

If Render API is **not** in Tokyo, production RTT may be higher. Quantify with the same probes from the Render shell before recommending a region move.

---

## 4. Button-to-usable timing

### 4.1 Measurement method

| Method | Status |
|---|---|
| Code path map (Phase 1) | Complete |
| Browser Network/Playwright on staging | **Not run** (no authenticated staging harness this pass) |
| Rollback-only DB probes | Complete (timing N+1, merge RTT sim, ref-count) |
| Prior production evidence | Failed merge ~13–14 s / P2024 under pool=1 |
| Code-derived UI waterfall | Complete |

### 4.2 Estimated / measured perceived latency

| Action | API duration | UI update duration | Refetch duration | Total perceived duration |
|---|---|---|---|---|
| Merge stops | preview (already done) + TX ~0.9–2.5 s + writes | close dialog after commit; success overlay | **await** ordered-stops + quality; usage GET | **~2–5 s** warm; worse under pool starvation |
| Remove from route | TX ~200–500 ms + lite re-read | `applyMutationResult` local | usage reload | **~0.4–1.0 s** |
| Archive stop | TX ~200–600 ms | navigate away | list `invalidateQueries` | **~0.5–1.5 s** |
| Permanent delete | eligibility GET + TX | local filter or detail+variants reload | list invalidate | **~0.5–2 s** |
| Replace stop | TX ~150–300 ms | `refreshOrderedStops` | stops + quality | **~0.5–1.5 s** |
| Insert existing | TX + lite re-read | `applyMutationResult` | none required | **~0.3–0.8 s** |
| Mark stop reviewed | TX 3 queries ~150–250 ms | local patch | none | **~0.2–0.4 s** (API) |
| Mark path reviewed | TX ~150–250 ms | local patch | **full readiness GET** | **~0.7–2.0 s** |
| Mark route reviewed | readiness (~8q) + TX | local status | **readiness again** | **~1–3 s** |
| Save timing | **N+1 offsets** + full ordered stops | `applyMutationResult` | none extra | **~7–8 s** on 150-stop variant (measured floor) |
| Save path | TX upsert + path re-read | local path set | legacy path may reload quality | **~0.4–1.5 s** (+ geometry parse) |
| Generate path | Valhalla + TX upsert | local path set | none | **engine-bound** (exclude from DB SLO) |

---

## 5. Endpoint timing

Instrumentation expanded behind `TRANSPORT_PERF_LOG=1` (see § instrumentation). Live warm HTTP p50/p95 for mutations **not collected** against Render (no authenticated mutation runs; no successful destructive prod ops).

Enable on a staging/warm instance:

```text
TRANSPORT_PERF_LOG=1
```

Logged fields (safe): `requestId`, `endpoint`, `action`, `totalDurationMs`, `validationDurationMs`, `serviceDurationMs`, `transactionDurationMs`, `queryCount`, `responseSizeBytes`, `statusCode`, `success`, stage console marks. Never JWT / secrets / `DATABASE_URL` / raw private payloads.

---

## 6. Transaction stage timings

### 6.1 Merge (`mergeStopsKeepCanonical`)

**Outside TX (every execution):** full `getStopMergePreview` again (stops, geom compare, reference counts, usage, terminals, conflict analysis) — **recomputes preview the UI already fetched**.

**Inside TX (named stages already marked):**

| Stage | Necessary in TX? | Notes |
|---|---|---|
| lock_stops | Yes | FOR UPDATE |
| lock_terminals | Yes | terminal conflict |
| validate_same_variant_ack | Yes (flag) | cheap |
| resolve_canonical_parent + parent walk | Yes | **N queries** up parent chain |
| load_duplicate_snapshot | Partially | needed for audit/response |
| apply_field_sources | Yes if present | extra stop loads |
| count_references_before ×2 | Partially | audit richness; can slim |
| update_route_stops / origins / destinations / terminals / fares / children / names / links | Yes | already set-based UPDATEs |
| delete leftover names/links | Yes | |
| verify_duplicate_references_cleared | Yes | critical |
| hard_delete_duplicate | Yes | |
| count + load canonical after | Partially | response/audit |
| insert_audit_log | Yes | keep; slim payload |
| build_response | Yes | |

**Rollback-only merge-shaped sequential sim (18 queries):** **852.6 ms** total; each stage ~43–64 ms (RTT-dominated).

### 6.2 Remove-from-route

Stages: lock → delete → SELECT remaining FOR UPDATE → **two bulk resequence UPDATEs** → audit → commit → **outside TX** `listOrderedStopsLite`.

Sequence normalization is already set-based (not per-row). Good.

### 6.3 Archive / permanent delete

Archive: lock stop → route_count → lock terminals → soft-delete terminals + audits → soft-delete stop + audit.  
Permanent: `loadStopDeleteReferences` (eligibility-style) → delete names/links/stop → audit.

### 6.4 Review

Stop/path: lock → update status → audit (3 queries). Fast.  
Route mark_reviewed: **full readiness before TX**, then 3-query TX. UI refetches readiness again.

### 6.5 Save timing

Lock one row → update travel/wait → audit → **FOR UPDATE all stops** → **N UPDATEs** → outside TX `getOrderedStops`.

---

## 7. Query count by action

| Action | Approx. DB round trips | Notes |
|---|---|---|
| Merge (execution) | preview ~6–10 + TX ~18–30 | preview fully repeated; parent walk N+1; 4× `countSingleStopReferences` |
| Remove from route | ~6–8 in TX + 1 lite re-read | bulk resequence |
| Archive | ~5 + 2×terminals | |
| Permanent delete | eligibility ~2 + TX ~5 | eligibility recalculated |
| Replace stop | ~4 | lock membership, load stop, update, audit |
| Insert existing | ~8–12 | resequence pattern |
| Mark stop/path reviewed | **3** | good |
| Mark route reviewed | readiness **~8** + TX **3** | then UI another ~8 |
| Save timing | **4 + N** (N = stop count) + ordered re-read | **dominant** |
| Save path | ~5–7 | |
| Generate path | 2 reads + Valhalla + TX upsert | |

`countSingleStopReferences` is already one SQL with scalar subselects (**78.8 ms** measured) — good batching; still called **four times** per merge.

---

## 8. Pool wait analysis

| Observation | Evidence |
|---|---|
| Default code path can be pool=1 | `prisma.ts` default `"1"` |
| Local effective limit 5 | URL `connection_limit=5` |
| Merge holds interactive TX | `ROUTE_STOP_TX_OPTIONS`; blocks one pool slot for entire TX |
| Parallel reads on pool=1 serialize | prior audit; P2024 tests in `transport.merge-p2024.repo.test.ts` |
| Snapshot `pg_stat_activity` | 0 active, 0 idle-in-tx, 0 lock waits at sample time |
| Concurrent mutation metrics | **not yet instrumented** (recommended: gauge active `$transaction` count) |

**Hypothesis (prior + architecture):** under production pool=1, dashboard readiness/detail traffic waits behind merge/timing TX → pool wait dominates SQL. Confirm with Render `connection_limit` log + `TRANSPORT_PERF_LOG` `connectionAcquireDurationMs` (to add when measuring live).

---

## 9. Lock wait analysis

| Check | Result |
|---|---|
| Live lock waits | **0** at sample |
| idle in transaction | **0** |
| `lock_timeout` | 0 (unlimited wait) |
| Deadlocks | not observed this pass |

Slow mutations in quiet periods are **SQL + RTT**, not lock contention. Under concurrent reviewers, FOR UPDATE on popular stops/routes can still queue — keep critical sections short.

---

## 10. Network RTT contribution

| Action | Sequential queries (approx) | RTT floor @ 44 ms | Measured / notes |
|---|---|---|---|
| Timing 150 stops | 150 UPDATEs | ~6 600 ms | **7 050 ms** measured |
| Timing 50 stops | 50 | ~2 200 ms | **2 291 ms** measured |
| Timing batched 50 | 1 | ~44 ms | **53 ms** measured |
| Merge TX skeleton | 18 | ~792 ms | **853 ms** sim |
| Stop review | 3 | ~132 ms | expected |

**Region move:** only after measuring Render→Supabase `SELECT 1`. If Render is already Tokyo, region change gains little; batching queries gains more.

---

## 11. Audit-log cost

| Action | Snapshot shape | Risk |
|---|---|---|
| Merge | counts, reference deltas, route/variant codes, field_sources — **no full geometries** | moderate JSON |
| Remove | full membership scalars + **entire `new_sequence` array** for all remaining stops | grows with variant size (150 entries) |
| Timing | only changed travel/waiting fields | small |
| Review | old/new `review_status` | small |
| Archive | stop scalars + terminal list | small |
| Path save | path metadata; geom stored in entity not necessarily duplicated in audit | check `insertTransportAuditLog` callers |

**Recommend compact audit:**

- Remove: store removed row + `resequenced_count` + sequence range, not full `new_sequence` list.
- Merge: keep reference deltas; drop redundant four full count objects if identical info is in `referencesChanged`.
- Never drop audit inserts.

---

## 12. Post-mutation request waterfall

| Action | Requests after success | Class |
|---|---|---|
| Merge | `GET ordered-stops` (includePath), `GET stop-quality`, `GET route-usage-detail` | ordered-stops **can use mutation delta**; quality/usage **background**; currently **awaited** in `refreshReviewMapAfterGlobalMerge` |
| Remove | none required (response has ordered_stops); **usage GET** still fired | usage → background |
| Replace | `refreshOrderedStops` = stops + quality | quality → background |
| Path reviewed | `GET review-readiness` | **unnecessary if response includes readiness** |
| Route reviewed | readiness before API + **again after** | **duplicate** |
| Stop reviewed | local patch only | good |
| Timing | uses mutation `ordered_stops` | good |
| Permanent delete (route page) | may `getTransportRouteDetail` + variants | often **unnecessary** if local filter enough |
| Archive (stop page) | list invalidate + navigate | acceptable |

Dialog behavior (merge): closes **after** API success (does not toast success before commit). Then awaits refresh — map feels busy until stops/quality return.

---

## 13. Confirmed bottlenecks

1. **Timing N+1 UPDATEs** — measured 7.05 s / 150 stops.  
2. **Merge full preview recomputed inside execution** before TX.  
3. **Merge sequential round trips × ~44 ms RTT**.  
4. **Route review readiness computed twice** (gate + UI refetch); duplicate spatial query included.  
5. **Post-merge awaited refetch waterfall** (stops + quality).  
6. **Pool starvation risk** if production still at connection_limit=1 (unconfirmed on Render).  
7. Remove resequence already bulk — not the main remove bottleneck.

---

## 14. Recommended fixes

| Priority | Fix | Layer | Risk | Effort | Expected gain |
|---|---|---|---|---|---|
| P0 | Confirm Render `connection_limit` / set `PRISMA_CONNECTION_LIMIT=3` only after confirmation | Ops / `prisma.ts` | Medium | S | Removes P2024 / queue under concurrent reads |
| P0 | Batch timing offset updates (single `UPDATE ... FROM (VALUES ...)`) in `recalculateVariantTimetableOffsetsInTx` | API `transport.repo.ts` | Low–Med | M | **~7 s → ~0.1–0.3 s** on large variants |
| P0 | Stop re-running full `getStopMergePreview` in `mergeStopsKeepCanonical`; accept preview versions + critical TX checks | API `transport.repo.ts` | Med | M | **-0.5–1.5 s** + less pool hold before TX |
| P1 | Return readiness from route/path review mutations; skip `reloadReadiness()` when present | API + dashboard | Low | S | **-0.5–1.5 s** perceived |
| P1 | Merge: close + apply canonical locally; background quality/usage | dashboard `TransportRouteDetailContent.tsx` | Low | S | **-0.3–1.0 s** perceived |
| P1 | Combine merge pre/post reference counts where safe; avoid 4× full count | API | Low | S | **-150–300 ms** |
| P1 | Compact remove audit `new_sequence` | API | Low | S | smaller TX / IO |
| P2 | Preview token (`updated_at` pair) → 409 stale | API | Med | M | safer shorter TX |
| P2 | Instrument connection acquire + active TX gauges | API | Low | S | observability |
| P2 | Measure Render↔Tokyo RTT before region move | Ops | — | S | decide host move |

**Do not:** raise timeouts as primary fix; remove validation/audit/locks; trust preview without TX stale checks.

---

## 15. Expected gains

| After | Timing save (150) | Merge warm | Route mark reviewed |
|---|---|---|---|
| Now (evidence-based) | ~7–8 s | ~2–5 s (+ worse if pool=1) | ~1–3 s |
| After P0/P1 | **~0.3–0.8 s** | **~0.6–1.5 s** | **~0.3–0.7 s** |

---

## 16. Tests required

- Unit: batched offset recalculation preserves arrival/departure for 10/50/150 fixtures.  
- Existing: `transport.remove-route-stop.repo.test.ts`, merge P2024 / execution suites.  
- Regression: mark_reviewed still blocked when readiness blockers present.  
- Dashboard: merge success does not await quality before overlay; readiness not double-fetched when payload present.  
- Staging: 20× warm runs per fixture class (Phase 13) with `TRANSPORT_PERF_LOG=1`.

---

## 17. Safe deployment order

1. Ship **instrumentation only** (`TRANSPORT_PERF_LOG`) — already local; enable on staging.  
2. Confirm Render pool effective value; set `PRISMA_CONNECTION_LIMIT=3` if still 1.  
3. Deploy timing batch UPDATE (highest measured gain).  
4. Deploy merge preview skip + critical TX revalidation.  
5. Deploy dashboard refetch reductions + review readiness in response.  
6. Re-benchmark; only then consider region / further pool.

---

## 18. Rollback plan

- Env: unset `PRISMA_CONNECTION_LIMIT` / restore prior URL `connection_limit`.  
- Code: revert single PR per layer (timing batch, merge, dashboard).  
- Feature flags not required if changes are small and tested; keep audit + TX guards intact.  
- No data migration involved.

---

## Appendix A — Phase 1 map

| Action | Dashboard file | API endpoint | Service method | Repository method | Transaction? | Post-success requests |
|---|---|---|---|---|---|---|
| Merge stops | `ReviewMapCandidateCompareDialog.tsx` → `TransportRouteDetailContent.tsx` | `POST /transport/stops/merge` | `mergeStopsGlobal` | `mergeStopsKeepCanonical` | Yes | ordered-stops, quality, usage |
| Remove stop | `RemoveRouteStopDialog` / usage dialog | `DELETE /transport/route-stops/:id` | `removeRouteStop` | `removeRouteStop` | Yes | usage (optional) |
| Archive stop | `ArchiveStopDialog` / `TransportStopDetailContent` | `DELETE /transport/stops/:publicId` | `archiveStop` | `archiveStopByPublicId` | Yes | list invalidate |
| Permanent delete | `PermanentDeleteStopDialog` | `DELETE /transport/stops/:publicId/permanent` | `permanentDeleteStop` | `permanentDeleteStopByPublicId` | Yes | local/detail refresh |
| Replace stop | `ReplaceStopInRouteDialog` | `PATCH /transport/route-stops/:id/replace-stop` | `replaceRouteStop` | `reviewOps.replaceRouteStop` | Yes | ordered-stops + quality |
| Insert existing | `InsertRouteStopDialog` | `POST .../stops/insert-existing` | `insertExistingRouteStop` | `insertExistingRouteStop` | Yes | local applyMutationResult |
| Mark stop reviewed | `TransportReviewMapReviewActions` | `POST /transport/stops/:id/review-action` | `applyStopReviewAction` | `applyStopReviewAction` | Yes | local patch |
| Mark path reviewed | same | `POST /transport/route-paths/:id/review-action` | `applyRoutePathReviewAction` | `applyRoutePathReviewAction` | Yes | readiness GET |
| Mark route reviewed | review actions / panel | `POST /transport/routes/:id/review-action` | `applyRouteReviewAction` | `applyRouteReviewAction` | Yes (+ readiness pre) | readiness GET |
| Save timing | `ReviewMapStopTimingEditor` | `PATCH /transport/route-stops/:id/timing` | `updateRouteStopTiming` | `updateRouteStopTiming` | Yes | local ordered_stops |
| Save path | review map path edit | `PUT /transport/variants/:id/path` | `upsertVariantPath` | `upsertVariantPath` | Yes | local path |
| Generate path | `GeneratePathFromStopsDialog` | `POST .../generate-path-from-stops` | `generatePathFromStops` | load stops + `upsertValhallaSnappedVariantPath` | Yes (upsert) | local path |

API clients: `apps/dashboard/src/features/transport/api.ts` only.

---

## Appendix B — Instrumentation added this audit

| File | Change |
|---|---|
| `apps/api/src/modules/transport/transport-perf.ts` | Extended log fields; `createMutationStageTimer`; `estimateJsonResponseBytes` |
| `apps/api/src/modules/transport/transport.routes.ts` | Perf logs: timing, remove, route/stop/path review, replace |
| `apps/api/src/modules/transport/transport.repo.ts` | Stage marks on offset recalculation N+1 loop |

No business-logic optimizations.

---

## Appendix C — Phase 13 staging benchmarks

**Not executed** this pass (no disposable staging fixture runner / 20× authenticated mutation suite).

Required next: fixtures (10/50/150 stops; 1 vs 5 variant usage; terminal merge cases; review with/without blockers) × 20 warm iterations → p50/p95/max, queryCount, TX ms, refetch ms.

Use rollback-only or disposable stops only.

---

## Appendix D — Production safety confirmation

- No successful merge/archive/delete/timing/path mutations executed against production.  
- Rollback-only probes used no-op UPDATEs (`SET col = col`) inside `BEGIN`/`ROLLBACK`.  
- Supabase MCP: SELECT settings/activity only.  
- No deploy. No index DDL. No timeout increases as “fix”.
