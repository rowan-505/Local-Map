# Transport mutation latency fixes — implementation — 2026-07-28

**Based on:** [`transport-mutation-latency-audit-2026-07-24.md`](./transport-mutation-latency-audit-2026-07-24.md)  
**Pool ops:** [`transport-mutation-latency-pool-ops-2026-07-28.md`](./transport-mutation-latency-pool-ops-2026-07-28.md)  
**Production data modified:** **No**  
**Deployed:** **No**

## Changes

### API

| Area | File(s) | What |
|---|---|---|
| Timing N+1 | `transport.repo.ts` | One `UPDATE … FROM (VALUES …)` for timetable offsets |
| Merge | `transport.repo.ts`, schema, errors, service, routes | No full preview redo; TX locks + membership conflict + optional `updatedAt` stale 409; slim before-counts |
| Review | `transport-review.repo.ts` | Route/path review return `readiness` (one calc max) |
| Remove audit | `transport.repo.ts` | Compact metadata (no full `new_sequence`) |
| Perf log | `transport-perf.ts`, routes | Already gated; timing/review/replace logging retained |

### Dashboard

| Area | File(s) | What |
|---|---|---|
| Review | `TransportRouteDetailContent.tsx`, `TransportRouteReviewPanel.tsx` | Apply readiness from mutation; skip second GET |
| Merge UI | `ReviewMapCandidateCompareDialog.tsx`, `api.ts` | Send preview versions; refresh on stale |
| Refetch | `TransportRouteDetailContent.tsx` | Merge success not awaited on quality; quality after ordered-stops is background |

## Expected gains (from audit evidence)

| Action | Before | After (expected) |
|---|---|---|
| Save timing (150 stops) | ~7–8 s | ~0.3–0.8 s |
| Merge | ~2–5 s | ~0.6–1.5 s |
| Mark route/path reviewed | ~1–3 s | ~0.3–0.7 s |

## How to verify

```bash
cd apps/api && npm run typecheck
node --import tsx --test src/modules/transport/transport.timing-batch.repo.test.ts \
  src/modules/transport/transport.merge-execution.repo.test.ts \
  src/modules/transport/transport.merge-p2024.repo.test.ts \
  src/modules/transport/transport.remove-route-stop.repo.test.ts

cd apps/dashboard && npx tsc --noEmit
node --import tsx --test src/features/transport/routeReviewReadinessFetch.test.ts
```

Staging (manual): enable `TRANSPORT_PERF_LOG=1`, warm API, time save-timing on a ~150-stop variant, merge, mark path/route reviewed. Confirm Network has no second readiness GET after successful review mutations.

## Ops still required

Confirm Render `[api] prisma connection_limit=` and set `PRISMA_CONNECTION_LIMIT=3` if still `1` (see pool ops doc). Not auto-deployed.
