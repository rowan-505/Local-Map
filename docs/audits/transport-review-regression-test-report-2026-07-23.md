# Transport review regression test report — 2026-07-23

**Suite type:** local mock/fixture + schema/contract regression (no production DML)  
**Production data modified:** **No**  
**API command:** `npm run test:transport-review-regression`  
**Dashboard commands:** `node --import tsx --test …regression…` + `npx tsc --noEmit` + `npm run build`  
**Date:** 2026-07-23 (UTC+9)

---

## 1. Executive summary

A dedicated transport review regression harness was added under:

- `apps/api/src/modules/transport/regression/`
- `apps/dashboard/src/features/transport/regression/`
- Inventory: `docs/audits/transport-review-regression-inventory-2026-07-23.md`

| Metric | Value |
|---|---:|
| API regression pack (incl. prior merge/archive/remove/permanent tests) | **107 pass / 0 fail / 1 skip** |
| Dashboard client contract tests (this run) | **13 pass / 0 fail** |
| Live staging HTTP (`TRANSPORT_REGRESSION_BASE_URL`) | **skipped** (env unset by design) |
| Production rows changed | **0** |

---

## 2. Tests added

### API fixtures / helpers
- `regression/fixtures.ts` — routes, variants, stops, names, route_stops, terminals, paths, audit actor, merge worlds
- `regression/helpers.ts` — case recorder, JSON bigint guard, rollback snapshot helper
- `regression/integrity.ts` — orphan FK, duplicate sequence, terminal unique, self-parent, mode mismatch

### API regression suites
- `regression/merge.regression.test.ts` (Phase 3)
- `regression/remove-archive.regression.test.ts` (Phases 4–5)
- `regression/review-path-timing.regression.test.ts` (Phases 6–7)
- `regression/read-contract.regression.test.ts` (Phase 8)
- `regression/integrity.regression.test.ts` (Phase 9)

### Dashboard
- `regression/client-contracts.regression.test.ts` — ack forwarding, remove/archive `{}` bodies, merge button gate

### Scripts
- `apps/api` → `npm test` (transport tests) and `npm run test:transport-review-regression`

---

## 3. Feature inventory

See full table: [`transport-review-regression-inventory-2026-07-23.md`](./transport-review-regression-inventory-2026-07-23.md).

---

## 4. Case results

| Feature | Test case | Expected | Actual | Result | Error code | Data changed |
|---|---|---|---|---|---|---|
| merge-preview | ordinary stops integrity | 200 | 200 | PASS | — | no |
| merge-preview | bigint admin_area_id JSON-safe | 200 | 200 | PASS | — | no |
| merge-preview | dual terminals block | 200 (`mergeAllowed=false`) | 200 | PASS | MERGE_TERMINAL_CONFLICT | no |
| merge-execution | neither terminal | 200 | 200 | PASS | — | yes |
| merge-execution | duplicate terminal only | 200 | 200 | PASS | — | yes |
| merge-execution | canonical terminal only | 200 | 200 | PASS | — | yes |
| merge-execution | dual terminals | 409 | 409 | PASS | MERGE_TERMINAL_CONFLICT | no |
| merge-execution | same variant without ack | 409 | 409 | PASS | MERGE_VARIANT_ACK_REQUIRED | no |
| merge-execution | same variant with ack | 200 | 200 | PASS | — | yes |
| merge client | forward acknowledgeSameVariantOccurrences | body includes flag | included | PASS | — | n/a |
| merge-execution | clear canonical.parent → duplicate | 200 | 200 | PASS | — | yes |
| merge-execution | repoint children | 200 | 200 | PASS | — | yes |
| merge-execution | dedupe stop names | 200 | 200 | PASS | — | yes |
| merge-execution | clear all duplicate refs | 200 | 200 | PASS | — | yes |
| merge-execution | audit failure rollback | 500 + rollback | rolled_back | PASS | MERGE_EXECUTION_FAILED | rolled_back |
| merge-execution | response no bigint | JSON-safe | JSON-safe | PASS | — | yes |
| merge-execution | expected conflicts not 500 | 409 | 409 | PASS | MERGE_* | no |
| remove-route-stop | empty body `{}` schema | ok | ok | PASS | — | no |
| remove-route-stop | reason preserved | ok | ok | PASS | — | no |
| remove-route-stop | first/middle/last resequence | 1..N | 1..N | PASS | — | yes |
| remove-route-stop | nonexistent → 404 domain | 404 | 404 | PASS | — | no |
| remove-route-stop | global stop remains | stop kept | kept | PASS | — | yes |
| remove-route-stop | audit failure rollback | rolled_back | rolled_back | PASS | — | rolled_back |
| remove client | always send `{}` | body `{}` | `{}` | PASS | — | n/a |
| archive-stop | empty body | ok | ok | PASS | — | no |
| archive-stop | unreferenced archive | 200 | 200 | PASS | — | yes |
| archive-stop | referenced → 409 | 409 | 409 | PASS | TransportStopInUseError | no |
| permanent-delete | blockers → 409 | 409 | 409 | PASS | TransportStopDeleteBlockedError | no |
| archive/delete | origin/terminal/child detectable | guards | guards | PASS | — | no |
| archive/delete | no raw FK as 500 | 409 domain | 409 domain | PASS | — | no |
| review | action→status map | ok | ok | PASS | — | no |
| review | mark_reviewed body | ok | ok | PASS | — | no |
| route-review | blocked by unreviewed paths | 409 readiness | blocked | PASS | — | no |
| route-review | reopen verified→needs_review | allowed | allowed | PASS | — | yes |
| stop-review | manual_protected blocked | blocked | blocked | PASS | — | no |
| review | inactive/deleted handling | integrity ok | ok | PASS | — | no |
| route-review | verify without path blocked | blocked | blocked | PASS | — | no |
| path-edit | ≥2 coordinates | ok | ok | PASS | — | no |
| path-edit | <2 coordinates | 400 | 400 | PASS | — | no |
| path-edit | invalid longitude | 400 | 400 | PASS | — | no |
| path-edit | previous path preserved | unchanged | unchanged | PASS | — | no |
| path-edit | duplicate coords schema-valid | ok | ok | PASS | — | no |
| timing-edit | valid offsets | ok | ok | PASS | — | no |
| timing-edit | negative offsets | 400 | 400 | PASS | — | no |
| timing-edit | first-stop null travel | ok | ok | PASS | — | no |
| timing-edit | failed validation no change | unchanged | unchanged | PASS | — | no |
| read-smoke | merge-preview distinct ids | schema | schema | PASS | — | no |
| auth | expired token → 401 class | 401 | 401 | PASS | — | no |
| read-smoke | protected GET inventory | documented | documented | PASS | — | no |
| read-smoke | public routes optional auth | documented | documented | PASS | — | no |
| read-smoke | live staging | skip | SKIP | SKIP | — | no |
| integrity | duplicate sequence | violation | violation | PASS | DUPLICATE_SEQUENCE | no |
| integrity | terminal unique | violation | violation | PASS | TERMINAL_UNIQUE | no |
| integrity | self-parent | violation | violation | PASS | SELF_PARENT | no |
| integrity | mode mismatch | violation | violation | PASS | MODE_MISMATCH | no |
| integrity | failed tx unchanged | rolled_back | rolled_back | PASS | — | rolled_back |

Prior repo tests included in the same pack (also PASS): merge preview/execution, remove resequence, archive, permanent delete, same-variant helpers.

---

## 5. Remaining defects

| Severity | Remaining defect | Endpoint | Root cause | Recommended fix |
|---|---|---|---|---|
| P2 | Live HTTP smoke not executed in CI/local without env | `GET /transport/*` | `TRANSPORT_REGRESSION_BASE_URL` unset; suite intentionally avoids production | Point env at **staging** only; never production |
| P2 | Replace-stop / path-generation / nearby-candidates lack dedicated repo mocks in new pack | replace / generate-path / nearby-candidates | Coverage is inventory + schema/readiness; full SQL mocks still thin | Add stateful Prisma mocks mirroring remove/archive style |
| P2 | API `npm run typecheck` still fails on unrelated import-review nullability | n/a | Pre-existing `import-review-promotion-simple-validation.ts` | Fix separately; transport regression files are clean |
| P3 | Impossible timing ordering / concurrent stale update not fully simulated | `PATCH .../timing` | Needs service-layer mock of timetable recalc | Extend timing service unit tests |
| P3 | Dashboard “refresh after review success” is UI integration, not unit-tested here | review panels | Needs component/integration harness | Optional Playwright against staging |

No new **P0** defects found by this regression pack. Known historical P0/P1 items (dual-terminal merge 500, empty DELETE body, fares.`deleted_at`) are covered by existing/new tests as **fixed or guarded**.

---

## 6. Verification commands run

```bash
cd apps/api
npm run typecheck          # fails only on unrelated import-review errors
npm run test:transport-review-regression   # 107 pass, 1 skip

cd ../dashboard
npx tsc --noEmit           # pass
node --import tsx --test src/features/transport/regression/*.test.ts \
  src/features/transport/mergeTransportStopsGlobal.test.ts \
  src/features/transport/mergeTransportStopsUi.test.ts \
  src/features/transport/removeTransportRouteStop.test.ts
npm run build              # pass
```

---

## 7. Confirmation

**Production data was not modified.**  
All mutation scenarios used in-memory fixtures, mock Prisma clients, or schema-only validation. Live staging HTTP was skipped. No Supabase MCP DML was run for this suite.
