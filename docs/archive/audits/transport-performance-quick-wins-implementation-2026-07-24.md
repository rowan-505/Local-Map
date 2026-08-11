# Transport performance quick wins — implementation — 2026-07-24

**Based on:** [`transport-api-performance-audit-2026-07-24.md`](./transport-api-performance-audit-2026-07-24.md)  
**Scope:** P0/P1 pool + spatial SQL + nearby debounce + readiness deps + gated perf logs  
**Production data modified:** **No**  
**Deployed:** **No** (manual Render env change required for pool)

---

## 1. Changed files

### API

| File | Change |
|---|---|
| `apps/api/src/db/prisma.ts` | `resolvePrismaConnectionLimitValue`, `resolveEffectivePrismaConnectionLimit`; keep default `1` |
| `apps/api/src/db/prisma-connection-limit.test.ts` | Unit tests for limit resolution |
| `apps/api/src/server.ts` | Startup log: `[api] prisma connection_limit=<n>` (never logs URL) |
| `apps/api/.env.example` | Documents `PRISMA_CONNECTION_LIMIT` / prod target `3` |
| `apps/api/package.json` | Include prisma-connection-limit test in `npm test` |
| `apps/api/src/modules/transport/transport-spatial.ts` | Shared bbox+distance helpers |
| `apps/api/src/modules/transport/transport-spatial-duplicate.test.ts` | Predicate + SQL shape tests |
| `apps/api/src/modules/transport/transport-review.repo.ts` | Readiness duplicate EXISTS uses `ST_Expand` + `ST_DWithin`; tracks `lastDuplicateCheckDurationMs` |
| `apps/api/src/modules/transport/transport.repo.ts` | Stop-list duplicate filter + `has_nearby_duplicate` bbox rewrite; merge stage `startPerf`; `lastMergeTransactionDurationMs` |
| `apps/api/src/modules/transport/transport-perf.ts` | Structured request perf logger |
| `apps/api/src/modules/transport/transport.service.ts` | Expose last readiness/merge timing getters |
| `apps/api/src/modules/transport/transport.routes.ts` | `TRANSPORT_PERF_LOG` for readiness + merge |
| `apps/api/src/modules/transport/transport-stop-placeholder-geometry.test.ts` | Float tolerance on midpoint assert (pre-existing flake) |

### Dashboard

| File | Change |
|---|---|
| `apps/dashboard/src/features/transport/reviewMapNearbySearchSchedule.ts` | Debounce scheduler + `shouldSearchNearbyImmediately` |
| `apps/dashboard/src/features/transport/reviewMapNearbySearchSchedule.test.ts` | Rapid / stale / immediate tests |
| `apps/dashboard/src/features/transport/useReviewMapNearbyCandidates.ts` | Saved immediate; map-click debounced 300 ms |
| `apps/dashboard/src/features/transport/TransportPreviewMap.tsx` | Map click `{ immediate: false }` |
| `apps/dashboard/src/features/transport/routeReviewReadinessFetch.ts` | Auto-fetch guard helper |
| `apps/dashboard/src/features/transport/routeReviewReadinessFetch.test.ts` | Request-count / guard tests |
| `apps/dashboard/src/features/transport/TransportRouteDetailContent.tsx` | Readiness deps on `publicId` / `route?.public_id`; guard ref; explicit `reloadReadiness` |

---

## 2. Pool setting instructions

Code default remains **`connection_limit=1`** when unset (safe).

**Production (Render) target for this rollout:**

1. In the API service environment, set:
   ```text
   PRISMA_CONNECTION_LIMIT=3
   ```
2. Redeploy / restart the API so the URL rewrite and startup log apply.
3. Confirm logs show: `[api] prisma connection_limit=3`
4. Do **not** raise further until Supabase pooler budget and concurrent load are measured.

If `DATABASE_URL` already contains `connection_limit=…`, that value wins; remove or align it with the env setting.

---

## 3. Slow SQL before / after

| Query | Before (audit EXPLAIN) | After |
|---|---|---|
| Review-readiness duplicate `EXISTS` (bare geography `ST_DWithin`) | **~910.9 ms** (seq-scan nest-loop ~12k stops) | **~20.1 ms** with `geom && ST_Expand` + existing GiST (audit proof rewrite) |
| Stop-list `duplicateStatus=nearby` / `has_nearby_duplicate` | Same bare pattern | Same bbox rewrite (50 m / `50/90000` deg) |

**No new spatial index.** Uses existing `transport_stops_geom_gix`.

Exact geography semantics preserved; same-stop / deleted / active filters unchanged. Readiness still does **not** filter by mode (unchanged).

---

## 4. Request-count changes

| Area | Before | After |
|---|---|---|
| Route review readiness | Re-fetched on every `setRoute(...)` object identity change | Auto-fetch once per `publicId` success; `reloadReadiness()` after review mutations |
| Nearby candidates on map click | Immediate request every click | Debounced **300 ms**; rapid clicks → one final request; AbortController + request-id still ignore stale |
| Nearby on stop select / retry / revert | Immediate | Still immediate |

---

## 5. Tests run

```text
cd apps/api
npm run typecheck   # pass
npm run build       # pass
npm test            # 346 pass, 1 skipped
npm run test:transport-review-regression  # 107 pass, 1 skipped

cd apps/dashboard
npx tsc --noEmit    # pass
node --import tsx --test \
  src/features/transport/reviewMapNearbySearchSchedule.test.ts \
  src/features/transport/routeReviewReadinessFetch.test.ts  # 11 pass
npm run build       # pass
```

Merge TX-client suite (`transport.merge-p2024.repo.test.ts`) still passes — interactive merge queries use `tx`, not root Prisma.

---

## 6. Remaining medium-priority optimizations (not in this task)

- React Query / shared cache for detail+variants+readiness waterfall
- Soften exact `COUNT(*)` on list pages
- Short TTL cache for overview / quality queues
- Shorten merge interactive TX scope (batch updates) beyond instrumentation
- `UNIQUE(public_id)` on `routes` / `route_variants` (integrity/scale)
- Always-on Render / API region alignment with Supabase Tokyo (measure first)

---

## 7. How to enable perf logs

```text
TRANSPORT_PERF_LOG=1
```

Logs structured fields for readiness and merge: `requestId`, `endpoint`, `totalDurationMs`, `repositoryDurationMs`, `transactionDurationMs` (merge), `resultCount`, `statusCode`, plus `duplicateCheckDurationMs` on readiness. Merge also prints per-stage `startPerf` checkpoints. Never logs JWTs, secrets, or `DATABASE_URL`.

---

## 8. Confirmation

**Production data was not modified.**  
No production DML, no automatic deploy, no new indexes, no React Query migration, no materialized views.
