# Routing barriers Kyauktan safe loader — 2026-07-23

## Verdict

**PASS**

Production-safe direct loader for routing barriers verified on the **15-barrier Kyauktan sample** (`safe_new`).  
**Valhalla was not rebuilt.**

---

## Scope

| Item | Value |
|---|---|
| Target | production `locghyuranqaqsnbxflc` |
| Contract | `docs/safe-loader-contract.md` |
| Snapshot | id **4** `osm_myanmar_2026_05_15_kyauktan_v2` |
| Batch | `routing_barriers_kyauktan_safe_2026_07_23` (id **85**) |
| Work rows | **15** `safe_new` (12 points + 3 line barriers → Point via `ST_PointOnSurface`) |
| Core before → after | **0 → 15** |
| Conflict IR (pilot) | **0** (all safe_new into empty core) |

---

## Artifacts

| Path | Role |
|---|---|
| `infrastructure/database/migrations/supabase/143_import_work_routing_barriers.sql` | `import_work.routing_barrier_rows` + family allowlist |
| `routing_barriers_safe_loader.sql` / `_body.sql` | dry-run/apply loader |
| `run_routing_barriers_safe_loader.sh` | contract-aware runner |
| `kyauktan_routing_barriers_preload.sh` / `.sql` | staging → import_work |
| `routing_barriers_safe_loader_tests.sql` | fixture suite (ROLLBACK) |

Identity: `source_refs.external_id` + `system.pipeline_osm_identity_key` (core table has no `external_id` column).

Street snap: nearest active `core.core_streets` within ~30 m (same as promotion).

---

## Safety rules

### Direct load
- `safe_new` insert (validated Point geom, barrier_type required)
- Tight `safe_update` allowlist only: `source_refs` + `normalized_data` when type, access meaning, and location (≤2 m) are unchanged

### Import Review (`conflict_ir` upload)
- access meaning change (`access` / `foot` / `bicycle` / `motor_vehicle` / `vehicle`)
- barrier type change
- substantial location movement (>5 m)
- manual/dashboard protected target
- verified target
- duplicate-distance ≤10 m (batch or other core identity)

Conflict rows land in `import_review.review_batches` + `import_review.routing_barrier_candidates` (`upload_mode=safe_loader_conflict`).

---

## Pilot metrics

| Step | inserted | updated | skipped | conflict_ir | failed | notes |
|---|---:|---:|---:|---:|---:|---|
| Dry-run | 15 | 0 | 0 | 0 | 0 | ROLLBACK; duration 55.93 ms |
| Apply | 15 | 0 | 0 | 0 | 0 | committed; cleanup |
| Identical rerun | 0 | 0 | 15 | 0 | 0 | identity already in core |

Live `routing.routing_barriers`: **15**. Work rows after cleanup: **0**.

---

## Fixture tests

`routing_barriers_safe_loader_tests.sql` — **ALL CHECKS PASSED** (rolled back):

- new safe record
- identical rerun
- safe_update allowlist
- manual / verified → conflict upload
- type / access / movement → conflict_ir (core not overwritten)
- duplicate external ID abort
- invalid geometry abort
- savepoint rollback

---

## Explicit non-actions

- No Valhalla rebuild
- No national / Yangon barrier load
- No automatic rewrite of barrier type, access, or large moves into core

---

## Remaining risks

- Line/polygon barriers are stored as Point centroids/points-on-surface only (matches `routing.routing_barriers.geom` type).
- No `ref` barrier taxonomy; `barrier_type` is free text.
- Barriers do not mutate `routing_edges`; they are source metadata for future graph builds only.

## PASS
