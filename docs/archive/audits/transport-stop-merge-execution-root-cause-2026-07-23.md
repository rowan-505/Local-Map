# Transport stop merge execution root cause — 2026-07-23

**Audit type:** inspection + temporary diagnostics (no merge business-logic fix)  
**Production symptom:** `POST /transport/stops/merge` → HTTP **500** on `admin.coremapmm.com`  
**Dashboard copy:** “Stop merge failed. The merge was not applied. No stops or references were changed.”  
**Production data modified during this inspection:** **No** (SELECT-only Supabase MCP; no successful merge; no DML)

---

## 1. Exact failing request payload

Dashboard sender: `mergeTransportStopsGlobal` in  
`apps/dashboard/src/features/transport/api.ts` (lines 480–502).

Called from `ReviewMapCandidateCompareDialog.tsx` (~265–275) with:

| Field | Type | Meaning |
|---|---|---|
| `canonicalStopId` | UUID `public_id` | Surviving stop |
| `duplicateStopId` | UUID `public_id` | Stop to hard-delete |
| `currentStopId` | UUID `public_id` | Preview “current” side |
| `candidateStopId` | UUID `public_id` | Preview “candidate” side |
| `fieldSources` | optional object | Field pickers (`current` \| `candidate`) |
| `acknowledgeSameVariantOccurrences` | optional boolean | Same-variant ack (UI may set) |
| `reason` | optional string | Free text |

There are **no** fields named `survivingStopId`, `fieldSelections`, or `acknowledgeSameVariantConflicts` in the live contract. Those map to:

- surviving → `canonicalStopId`
- field selections → `fieldSources`
- ack → `acknowledgeSameVariantOccurrences`

IDs are **stop `public_id` UUIDs**, not numeric `transport.stops.id`.

### Critical client bug (payload truncation)

```484:502:apps/dashboard/src/features/transport/api.ts
    const payload: TransportStopMergeGlobalBody = {
        canonicalStopId: body.canonicalStopId,
        duplicateStopId: body.duplicateStopId,
        currentStopId: body.currentStopId,
        candidateStopId: body.candidateStopId,
    };
    // ... fieldSources, reason ...
    // acknowledgeSameVariantOccurrences is NEVER copied onto payload
```

UI passes `acknowledgeSameVariantOccurrences`, but the client **drops** it. That yields **HTTP 409** `MERGE_VARIANT_ACK_REQUIRED` when same-variant conflicts exist — **not** the observed generic 500 path.

---

## 2. Frontend / backend contract comparison

| Topic | Frontend | Backend Zod (`stopMergeGlobalBodySchema`) | Match? |
|---|---|---|---|
| Endpoint | `POST /transport/stops/merge` | same | Yes |
| Canonical / duplicate / current / candidate | UUID strings | `z.string().uuid()` + set equality refine | Yes |
| Field sources | camelCase keys | `stopMergeFieldSourcesSchema` | Yes |
| Same-variant ack | UI sets flag; **client omits** | `acknowledgeSameVariantOccurrences` optional | **Broken client** |
| Response on guard errors | Overlay + `MERGE_NOT_APPLIED_NOTE` | 409 + `code` | Yes for guards |
| Response on unexpected DB errors | Generic “could not be completed” | Unhandled → 500 (before diagnostics) | Hides SQL |

Observed overlay text matches `formatTransportStopMergeErrorOverlay` when the message is **not** a mapped 409 code → generic completion failure + “not applied” note. That is the **500** path, not ack-required.

---

## 3. Transaction stage map

```text
POST /transport/stops/merge
  → transport.routes.ts (~640+)
  → stopMergeGlobalBodySchema.parse
  → TransportService.mergeStopsGlobal (transport.service.ts ~469)
  → TransportRepository.mergeStopsKeepCanonical (transport.repo.ts ~3802)
       1. getStopMergePreview (read-only) + mergeAllowed / same-variant ack
       2. BEGIN transaction
       3. lock_stops (FOR UPDATE)
       4. validate mode / manual_protected
       5. load_duplicate_snapshot
       6. apply_field_sources (optional)
       7. count_references_before
       8. update_route_stops          ← blind SET stop_id = canonical
       9. update_variant_origins
      10. update_variant_destinations
      11. update_terminals            ← FAILING STAGE (primary)
      12. update_fares_* (if columns exist)
      13. update_child_stops
      14. update_stop_names
      15. update_source_links
      16. delete leftover names/links
      17. verify_duplicate_references_cleared
      18. hard_delete_duplicate_stop
      19. insert_audit_log
      20. build_response (jsonSafeNumber on adminAreaId)
  → reply.send(result)
```

Temporary stage labels were added in `mergeStopsKeepCanonical` for structured logs (`stage=update_terminals`, etc.).

---

## 4. Exact failing stage

**Primary failing stage:** `update_terminals`

Failing statement (conceptual):

```sql
UPDATE transport.terminals
SET linked_stop_id = <canonical.id>, updated_at = now()
WHERE deleted_at IS NULL
  AND linked_stop_id = <duplicate.id>;
```

When the canonical stop **already** has an active linked terminal, and the duplicate also has one, this UPDATE tries to create a **second** active row with the same `linked_stop_id`.

---

## 5. Exact database / serialization error

| Item | Value |
|---|---|
| Constraint | `transport_terminals_linked_stop_unique` |
| Definition | `UNIQUE (linked_stop_id) WHERE deleted_at IS NULL AND linked_stop_id IS NOT NULL` |
| SQLSTATE | **23505** (unique_violation) |
| Prisma | typically **P2010** (raw query) or **P2002** |
| HTTP | **500** (unhandled before diagnostics; now logged with `stage`) |

Live evidence (read-only):

- Index exists on production (`pg_indexes`).
- ≥ **681** nearby same-mode stop pairs within 50 m where **both** stops have active linked terminals.
- Concrete 0 m pairs exist (e.g. stop ids 4851/4852, both with terminals).

Merge-preview does **not** check terminal uniqueness, so preview can return `mergeAllowed: true` while execution dies on this UPDATE.

---

## 6. Constraint / schema involved

| Object | Relevance |
|---|---|
| `transport_terminals_linked_stop_unique` | **Primary** — blocks terminal repoint |
| `transport_stop_names_stop_language_unique` | Guarded by `NOT EXISTS` in merge SQL — lower risk |
| `route_stops_stop_id_fkey` (NO ACTION) | Hard-delete needs all route_stops repointed first (code does this) |
| `stops_parent_stop_id_fkey` | Secondary risk if canonical.`parent_stop_id` = duplicate (child update skips `id = canonical`) |
| No `(route_variant_id, stop_id)` unique | Same-variant double membership is allowed by schema |

---

## 7. Why preview succeeds but execution fails

1. Preview is read-only conflict analysis (routes/variants/sequences/modes).
2. Preview does not simulate `UPDATE terminals … linked_stop_id = canonical`.
3. Execution always runs that UPDATE when the duplicate has a linked terminal.
4. Unique index on `linked_stop_id` makes dual-terminal merges impossible without consolidating/unlinking first.
5. Separately, missing ack is a **409** path (not this 500 UI string).

---

## 8. Whether production data was partially changed

For this failure class: **transaction rolls back fully**.

- Failure occurs inside `$transaction` before commit.
- Prisma aborts the transaction on unique violation.
- Dashboard claim “No stops or references were changed” is **correct** for this 500.
- This inspection did not run a successful merge or any intentional DML.

---

## 9. Confirmed root cause

**Confirmed (code + live schema + pair counts):**

Keep-canonical merge blindly repoints `transport.terminals.linked_stop_id` from the duplicate stop to the canonical stop (`transport.repo.ts` stage `update_terminals`, ~3943–3953 before diagnostics wrap). That violates `transport_terminals_linked_stop_unique` whenever **both** stops already have an active linked terminal → SQLSTATE **23505** → unhandled Prisma error → HTTP **500**.

**Also confirmed (related, different status):**

Dashboard `mergeTransportStopsGlobal` drops `acknowledgeSameVariantOccurrences` → **409** when same-variant conflicts exist (not the generic 500 overlay text).

**Not confirmed from Render API logs in this pass:** Render CLI unavailable; Supabase postgres log sample was dominated by PostgREST noise, not merge statements. Stage logging was added so the next production failure prints `stage`, `sqlErrorCode`, and `constraintName`.

---

## 10. Recommended code fix (do not implement yet)

1. **Before** updating terminals:
   - If canonical already has an active linked terminal and duplicate also has one:
     - Prefer: soft-unlink or soft-delete the duplicate’s terminal (policy), **or**
     - Return **409** `MERGE_TERMINAL_CONFLICT` with a clear message (no 500).
2. Never blind-update into a unique `linked_stop_id` collision.
3. Forward `acknowledgeSameVariantOccurrences` in `mergeTransportStopsGlobal`.
4. Clear `canonical.parent_stop_id` when it points at the duplicate before hard-delete.
5. Keep stage diagnostics until verified in production logs.

---

## 11. Required migration

**None required** for the primary fix (application logic / conflict handling).  
Optional later: document the unique index in merge docs; no DDL needed to restore merges.

---

## 12. Required regression tests

| Case | Expect |
|---|---|
| Both stops have linked terminals | 409 with `MERGE_TERMINAL_CONFLICT` (after fix), never 500 |
| Only duplicate has terminal | Terminal repoint succeeds |
| Only canonical has terminal | No terminal UPDATE needed / no-op |
| Same-variant without ack | 409 `MERGE_VARIANT_ACK_REQUIRED` |
| Same-variant with ack forwarded | Proceeds past ack gate |
| Canonical.parent = duplicate | Parent cleared; delete succeeds |
| Response with non-null `adminAreaId` | JSON-safe number (already) |
| Client payload includes ack when UI sets it | Unit test on `mergeTransportStopsGlobal` |

Diagnostics tests added: `transport.merge-execution.diagnostics.test.ts`.

---

## 13. Safe deployment plan

1. Deploy API with **diagnostics only** (this change) → capture one real production failure log (`stage=update_terminals`, `23505`, constraint name).
2. Implement terminal conflict handling + ack forwarding.
3. Staging merge on a dual-terminal fixture (rollback or disposable DB).
4. Deploy API then dashboard.
5. Smoke: preview → merge on dual-terminal pair → controlled 409 or successful consolidate per policy.

---

## 14. Rollback plan

- Revert API if diagnostics cause issues (unlikely).
- Do not roll back merge-preview BigInt fix.
- No DB migration to roll back.

---

## Final table

| Severity | Failure stage | File and line | SQL/table | Exact error | Root cause | Data impact | Recommended fix | Test |
|---|---|---|---|---|---|---|---|---|
| P0 | `update_terminals` | `transport.repo.ts` merge `UPDATE transport.terminals … linked_stop_id` (~3943–3953 / stage label) | `transport.terminals` / `transport_terminals_linked_stop_unique` | SQLSTATE **23505** / Prisma P2010 or P2002 | Blind terminal repoint when both stops already linked | Full rollback (no partial merge) | Detect dual terminals; 409 or consolidate before UPDATE | Dual-terminal fixture |
| P1 | Client payload | `api.ts` 480–502 | n/a | Would be 409 ack | Ack flag dropped | None | Forward `acknowledgeSameVariantOccurrences` | Client body unit test |
| P2 | `update_child_stops` / delete | `transport.repo.ts` parent update skips canonical | `stops_parent_stop_id_fkey` | Possible **23503** on delete | Canonical parent still points at duplicate | Rollback | Clear canonical.parent when = duplicate | Parent-cycle fixture |

---

## Diagnostics added (not the final fix)

| File | Change |
|---|---|
| `transport.errors.ts` | `TransportMergeExecutionFailedError` + context |
| `stopMergePreview.ts` | `extractPrismaErrorCode`, `extractConstraintMeta`, stronger SQLSTATE parse |
| `transport.repo.ts` | Named stages + wrap unexpected errors |
| `transport.routes.ts` | Structured error log + safe 500 body `{ code, stage }` |
| `transport.merge-execution.diagnostics.test.ts` | Helper + conflict-model tests |

**Report path:** `docs/audits/transport-stop-merge-execution-root-cause-2026-07-23.md`
