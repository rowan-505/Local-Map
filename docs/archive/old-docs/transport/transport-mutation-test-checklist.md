---
status: archived
reason: replaced by docs/archive/old-docs/transport/transport-mutation-test-checklist.md
archived_at: 2026-07-01
---

# Transport Mutation Test Checklist (developer note)

Safe, repeatable smoke test for **Transport dashboard mutations + audit logging**.
Planning/checklist only — this document does **not** create fixtures and does **not**
run any live mutation. Follow it manually when you are ready to test.

Scope (do **not** touch): Core review, Import review, Routing, public web map.
Workflows in scope: route name edit, stop name edit, stop point move, route_stop
insert-existing, quick-create stop + insert, route_stop remove, terminal sync from
stop, infrastructure metadata edit.

---

## 0. STOP — check where you are pointed FIRST

> The dashboard does not connect to a database. It calls the API
> (`NEXT_PUBLIC_API_BASE_URL`), and **the API's `DATABASE_URL` decides which
> Supabase/Postgres gets written**. Always confirm the API target before any save.

### Current repo state (as checked-in)

| Setting | File | Value | Target |
|---|---|---|---|
| `DATABASE_URL` (active) | `.env`, `apps/api/.env` | `postgres.locghyuranqaqsnbxflc@...pooler.supabase.com` | **PRODUCTION Supabase** |
| `LOCAL_DATABASE_URL` | `.env`, `apps/api/.env` | `postgres@localhost:5433/geo_core` | local (not active; "raw import" DB) |
| `NEXT_PUBLIC_API_BASE_URL` | `apps/dashboard/.env.local` | `http://localhost:3001` | local API → **writes to whatever `DATABASE_URL` says** |
| `AUTH_BYPASS` | `apps/api/.env` | `true` | auth disabled locally |

**⚠️ As configured today, running any Transport save in the dashboard writes to
PRODUCTION Supabase.** Do not run the mutation cases below until you have switched
the API to a local or staging database, OR you have explicitly accepted the
production-fixture path in Section 1.

### Verify the live target before testing

```bash
# What the API will actually connect to (mask the password before sharing):
grep -E '^DATABASE_URL=' apps/api/.env

# Confirm the running API process target (optional sanity check):
curl -s http://localhost:3001/health   # or the documented health route
```

A host containing `pooler.supabase.com` / `locghyuranqaqsnbxflc` = **production**.
A host of `localhost:5433` (or your staging project ref) = safe to mutate freely.

---

## 1. Environment selection (priority order)

**A. Local Postgres/PostGIS (preferred).**
1. Ensure migrations `067_create_core_transport_schema.sql` onward are applied to the
   local DB (the `transport` schema must exist — the default `geo_core` raw-import DB
   may not have it).
2. Point the API at local: set `apps/api/.env` `DATABASE_URL` to `LOCAL_DATABASE_URL`
   and restart the API.
3. Mutate freely; cleanup optional.

**B. Staging Supabase branch / project.**
1. Point `DATABASE_URL` at the staging project ref.
2. Mutate freely; discard the branch afterward.

**C. Production Supabase — fallback ONLY, requires explicit manual confirmation.**
Allowed only if A and B are unavailable. Hard rules:
1. **Get explicit human go-ahead in writing** before the first production mutation.
2. Operate ONLY on a disposable fixture tree you created for QA. Never edit
   pre-existing real routes/stops/terminals/infrastructure for write tests.
3. Mark every fixture unmistakably:
   - `routes.route_code = 'ZZZ_QA_ROUTE'`
   - names prefixed `ZZZ_QA …`
   - stamp `normalized_data->>'qa_fixture' = 'true'` on stops you create
4. Run mutations **through the dashboard/API only** (never raw SQL writes), so the
   real audit path is what gets exercised.
5. Snapshot before → verify audit after → roll back (Section 5). Log every created
   id in a scratch `created_ids.txt`.

---

## 2. Before you start: baseline snapshot (read-only, safe anywhere)

> `transport.transport_audit_logs` is currently **empty (0 rows)** — these tests are
> the first real exercise of the audit-write path. The audit `INSERT` runs inside the
> same transaction as each mutation, so an audit failure rolls the mutation back.
> Test case **TC-1 is the canary** that proves the audit path works.

```sql
SELECT count(*) AS audit_rows_baseline FROM transport.transport_audit_logs;

-- fixture ids (record these as :rid/:vid/:sidA… for the checks below)
SELECT id, public_id FROM transport.routes         WHERE route_code = 'ZZZ_QA_ROUTE';
SELECT id, public_id, route_id FROM transport.route_variants WHERE variant_code = 'ZZZ_QA_V1';
SELECT id, public_id, name FROM transport.stops    WHERE normalized_data->>'qa_fixture' = 'true';
```

Suggested fixture tree (create manually via the dashboard when ready — **not yet**):
1 test route `ZZZ_QA_ROUTE` (mode `bus`) → 1 variant `ZZZ_QA_V1` → 3 stops
`ZZZ_QA Stop A/B/C`; variant seeded with A(seq 1), B(seq 2); one stop linked to a
test terminal for TC-7.

---

## 3. Mutation test cases

Confirmed audit actions / entity types:

| Case | action | entity_type |
|---|---|---|
| route name edit | `transport.route.update` | `transport_route` |
| stop name edit | `transport.stop.update` | `transport_stop` |
| stop point move (point only) | `transport.stop.point_move` | `transport_stop` |
| route_stop insert existing | `transport.route_stop.insert` | `transport_route_stop` |
| quick-create stop | `transport.stop.create` then `transport.route_stop.insert` | `transport_stop` / `transport_route_stop` |
| route_stop remove | `transport.route_stop.remove` | `transport_route_stop` |
| terminal sync from stop | `transport.terminal.sync_from_stop` | `transport_terminal` |
| infrastructure edit | `transport.infrastructure_line.update` | `transport_infrastructure_line` |

Each case = Setup → Action → Expected DB → Expected audit → Rollback.

- [ ] **TC-1 Route name edit (my/en) — audit canary**
  - Action: Route detail → set `name_mm` + `name_en` → Save.
  - DB: `route_names` has 2 rows (`my`,`en`, `name_type='primary'`, `is_primary=true`,
    `search_weight=100`); `routes.public_name` = Myanmar value (en fallback); `updated_at` bumped.
  - Audit: `transport.route.update`, `changed_fields` ⊇ name fields, old/new populated.
  - Rollback: revert names via UI / teardown.

- [ ] **TC-2 Stop name edit (my/en)**
  - Action: Stop detail → set `name_mm` + `name_en` → Save.
  - DB: `stop_names` 2 rows; `stops.name_mm`/`name_en` set; `stops.name` derived Myanmar-first.
  - Audit: `transport.stop.update`.
  - Rollback: revert via UI / teardown.

- [ ] **TC-3 Stop point move**
  - Action: Stop detail → move map point only → Save.
  - DB: `stops.geom` changed; other columns unchanged.
  - Audit: `transport.stop.point_move`, `changed_fields=["point"]`, old/new point lat/lng.
  - Rollback: move back / teardown.

- [ ] **TC-4 route_stop insert existing**
  - Action: Ordered stops → Insert (e.g. between A and B) → choose existing stop C.
  - DB: membership added; sequences contiguous **1..N**; no duplicate `stop_id`.
  - Audit: `transport.route_stop.insert`, `metadata` has inserted stop + resequence info.
  - Rollback: remove C (TC-6) or delete the membership row (Section 5).

- [ ] **TC-4b Duplicate insert (negative)**
  - Action: insert stop C again into same variant.
  - Expect: **409**; no new row; no audit row. (Uniqueness of `(variant, stop_id)` is
    app-enforced — there is no DB unique constraint.)

- [ ] **TC-5 Quick-create stop + insert**
  - Action: Insert → "Create new stop" → names + mode + stop_type + map location → confirm.
  - DB: new `stops` row + `stop_names` (my/en) + new `route_stops` membership; seq **1..N**;
    one transaction (no orphan stop on failure).
  - Audit: `transport.stop.create` then `transport.route_stop.insert` (two rows, in order).
  - Rollback: delete membership → `stop_names` → stop (Section 5). Record `:newSid`.

- [ ] **TC-6 route_stop remove**
  - Action: remove a middle stop.
  - DB: membership row gone; **underlying `stops` row untouched**; remaining seq **1..N**.
  - Audit: `transport.route_stop.remove`, `old_values` = full removed row, `metadata.resequenced_count`.
  - Rollback: re-insert if needed.

- [ ] **TC-7 Terminal sync from stop**
  - Setup: test stop linked to a test terminal (`terminals.linked_stop_id`).
  - Action: edit linked stop name + point → Save.
  - DB: terminal `name`/`mode`/`geom` synced to the stop; terminal `updated_at` bumped.
  - Audit: `transport.stop.update`/`point_move` **plus** `transport.terminal.sync_from_stop`.
  - Rollback: revert stop fields (sync follows) / teardown.

- [ ] **TC-8 Infrastructure metadata edit**
  - Action: Infra detail → change `review_status`, `confidence_score`, `mode`,
    `name_mm`/`name_en` → Save. Do **not** touch geometry.
  - DB: only metadata columns + `updated_at` change; `geom`/`source_refs`/`normalized_data`
    untouched. (`name` is a direct editable column for infra — not derived.)
  - Audit: `transport.infrastructure_line.update`.
  - Negative: confidence 150 / unknown mode / unknown review_status / forbidden keys → **400**.
  - Rollback: revert edited fields to recorded originals.

- [ ] **Final:** audit row count grew by the number of mutations performed; canary TC-1
  proved audit writes succeed on the previously-empty table.

---

## 4. Verification SQL (read-only — safe in any environment)

```sql
-- (a) route_names my/en
SELECT language_code, name, name_type, is_primary, search_weight
FROM transport.route_names
WHERE route_id = :rid AND language_code IN ('my','en')
ORDER BY language_code;

-- (b) routes.public_name derived (expect = my name, else en name)
SELECT public_name FROM transport.routes WHERE id = :rid;

-- (c) stop_names my/en
SELECT language_code, name, name_type, is_primary, search_weight
FROM transport.stop_names
WHERE stop_id = :sid AND language_code IN ('my','en')
ORDER BY language_code;

-- (d) stops derived name / mm / en (expect name = name_mm, else name_en)
SELECT name, name_mm, name_en FROM transport.stops WHERE id = :sid;

-- (e) route_stops contiguity 1..N (PASS when min=1, max=n, distinct=n)
SELECT count(*) AS n, min(stop_sequence) AS min_seq,
       max(stop_sequence) AS max_seq, count(DISTINCT stop_sequence) AS distinct_seq
FROM transport.route_stops WHERE route_variant_id = :vid;

-- gap detector (expect 0 rows)
SELECT g.seq
FROM generate_series(1, (SELECT count(*)::int FROM transport.route_stops WHERE route_variant_id = :vid)) g(seq)
WHERE NOT EXISTS (
  SELECT 1 FROM transport.route_stops rs
  WHERE rs.route_variant_id = :vid AND rs.stop_sequence = g.seq);

-- duplicate stop_id detector (expect 0 rows)
SELECT stop_id, count(*) FROM transport.route_stops
WHERE route_variant_id = :vid GROUP BY stop_id HAVING count(*) > 1;

-- (f) terminal sync vs linked stop (expect name/mode equal, geom_match = true)
SELECT t.id, t.name AS t_name, s.name AS s_name,
       t.mode AS t_mode, s.mode AS s_mode,
       ST_Equals(t.geom, s.geom) AS geom_match
FROM transport.terminals t
JOIN transport.stops s ON s.id = t.linked_stop_id
WHERE t.linked_stop_id = :sidLinked;

-- (g) audit log exists for an entity (newest first)
SELECT id, action, entity_type, entity_id, entity_public_id,
       changed_fields, old_values, new_values, actor_user_id, request_id, metadata, created_at
FROM transport.transport_audit_logs
WHERE entity_public_id = :pub
ORDER BY created_at DESC, id DESC
LIMIT 10;

-- (h) audit growth vs baseline
SELECT count(*) AS audit_rows_now FROM transport.transport_audit_logs;
```

---

## 5. Cleanup / rollback (production fixtures — FK-safe order)

Run only after audit rows are confirmed. Children before parents.

```sql
-- 1. membership rows (no soft delete on route_stops)
DELETE FROM transport.route_stops
WHERE route_variant_id IN (SELECT id FROM transport.route_variants WHERE route_id = :rid);

-- 2. localized names (no soft delete)
DELETE FROM transport.route_names WHERE route_id = :rid;
DELETE FROM transport.stop_names
WHERE stop_id IN (SELECT id FROM transport.stops WHERE normalized_data->>'qa_fixture' = 'true');

-- 3. terminals -> stops -> variants -> route
DELETE FROM transport.terminals
WHERE linked_stop_id IN (SELECT id FROM transport.stops WHERE normalized_data->>'qa_fixture' = 'true');
DELETE FROM transport.stops          WHERE normalized_data->>'qa_fixture' = 'true';
DELETE FROM transport.route_variants WHERE route_id = :rid;
DELETE FROM transport.routes         WHERE id = :rid;
```

Notes:
- `routes`, `route_variants`, `stops`, `terminals` support soft delete (`deleted_at`);
  `route_stops`, `route_names`, `stop_names` do not — those are hard `DELETE`.
- **Do not delete `transport_audit_logs` rows** — the ledger is meant to be immutable.
  QA audit rows can be filtered out later by `request_id` / actor.
- Verify post-cleanup: the three fixture SELECTs in Section 2 return 0 rows.

---

## 6. Guardrail summary

- [ ] Confirmed API `DATABASE_URL` target (local / staging / prod) before any save.
- [ ] If prod: explicit human confirmation obtained; only `ZZZ_QA` / `qa_fixture=true` rows touched.
- [ ] Baseline audit count + fixture ids recorded.
- [ ] All 8 cases (+ TC-4b negative) run via dashboard/API, not raw SQL.
- [ ] Contiguity / gap / duplicate SELECTs clean on every touched variant.
- [ ] Audit growth matches mutation count.
- [ ] Cleanup done in FK order; fixture SELECTs return 0; `created_ids.txt` reconciled.
