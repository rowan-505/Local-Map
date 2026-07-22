# OSM pipeline + Import Review — production readiness

**Date:** 2026-07-22  
**Verdict:** **NOT READY — BLOCKERS REMAIN**  
**National import:** Do **not** start. This document does not authorize a national run.

Live project checked: Supabase `locghyuranqaqsnbxflc` (Map Project).  
Evidence sources: Kyauktan local-osm reports (2026-07-22), places conflict-only IR pilot, places safe-loader fixture dry-run, live MCP counts, Import Review / History code state.

---

## 1. Pilot scopes required

| Scope | Status | Evidence |
|-------|--------|----------|
| **1. Kyauktan** | **Partial** | Classification + validation + places conflict IR + loader fixtures |
| **2. Yangon** | **Not run** | No `imports/yangon_*.env` / no Yangon classification report |
| **3. One rural township** | **Not run** | Called out in Gate 3 as not ready; no env/snapshot in repo |

Only Kyauktan has a completed local classification dry-run for the shared family set. Yangon and rural township gates are **open**.

---

## 2. Live baseline (2026-07-22)

| Metric | Value |
|--------|------:|
| `import_review.review_batches` | 1 |
| `import_review.place_candidates` | 34 |
| Other IR family candidates (expected for this pilot) | 0 in places-only upload |
| `import_work.place_rows` | **0** (no COPY of real safe rows) |
| `core.core_places` | 282 |
| `system.system_publish_batches` | 33 |
| `system.system_publish_items` | 6015 |
| Items with `before_data.review_decision` | 4195 |
| Migration `139` durable history columns | **not applied** |

Places IR match_status mix (conflict-only pilot): `manual_protected` 23 + `duplicate_candidate` 11 = **34**. No `safe_new` / `safe_update` in IR for this batch.

---

## 3. Kyauktan metrics matrix

Snapshot: `osm_myanmar_2026_05_15_kyauktan_v2` (local id=4).

### 3.1 Classification (Stage 08b / 18) — local only

Source: `tools/data-pipeline/local-osm/reports/classification_kyauktan_2026-07-22.md`

| family | valid | safe_new | safe_update | unchanged | duplicate | conflict | manual_protected | verified_conflict | possible_delete | invalid |
|--------|------:|---------:|------------:|----------:|----------:|---------:|-----------------:|------------------:|----------------:|--------:|
| admin_areas | 14 | 0 | 0 | 0 | 2 | 1 | 11 | 0 | 0 | 0 |
| buildings | 1402 | 379 | 953 | 0 | 70 | 0 | 0 | 0 | 0 | 0 |
| landuse | 59 | 18 | 30 | 0 | 11 | 0 | 0 | 0 | 0 | 0 |
| places | 117 | 62 | 21 | 0 | 11 | 0 | 23 | 0 | 0 | 0 |
| roads | 1400 | 0 | 1400 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| routing_barriers | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| water_lines | 26 | 22 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| water_polygons | 14 | 3 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **3047** | **499** | **2404** | **0** | **109** | **1** | **34** | **0** | **0** | **0** |

Reconciliation assertion (`valid = safe_* + unchanged + conflict classes`): **PASS** (Stage 18).

### 3.2 Validation / F1 (Stage 05b / 06 / 17) — local only

Source: `tools/data-pipeline/local-osm/reports/validation_source_kyauktan_2026-07-22.md`

| family | raw | normalized | valid | warning | invalid |
|--------|----:|-----------:|------:|--------:|--------:|
| admin_areas | 14 | 14 | 14 | 0 | 0 |
| roads | 1400 | 1400 | 1400 | 0 | 0 |
| places | 116 | 117 | 117 | 0 | 0 |
| buildings | 1402 | 1402 | 21 | 1381 | 0 |
| landuse | 59 | 59 | 4 | 55 | 0 |
| water_lines | 26 | 26 | 3 | 23 | 0 |
| water_polygons | 14 | 14 | 4 | 10 | 0 |
| routing_barriers | 15 | 15 | 0 | 15 | 0 |

Notes: no previous OSM snapshot for F1 → all `source_new`. Invalid geometry count = 0 on this extract (invalid-geometry scenario not observed in data).

### 3.3 Places conflict upload (Stage J/K) — remote IR

Source: `tools/data-pipeline/local-osm/reports/remote_review_conflict_places_pilot_2026-07-22.md`

| metric | places |
|--------|------:|
| uploaded_to_review | 34 |
| duplicate | 11 |
| manual_protected | 23 |
| safe_new/safe_update in IR | 0 |
| conflict upload retry (same snapshot refresh) | PASS (34 pending refreshed; 1 approved preserved) |

### 3.4 Direct-core load (import_work) — fixture only

Source: `tools/data-pipeline/import-work/reports/places_safe_loader_dry_run_2026-07-22.md`

| metric | happy path | identical rerun |
|--------|----------:|----------------:|
| inserted | 1 | 0 |
| updated | 1 | 0 |
| skipped (manual+verified) | 2 | 4 |
| failed | 0 | 0 |
| core_places durable delta | 0 (rolled back) | 0 |

**Real Kyauktan safe rows:** not COPYed (`import_work.place_rows = 0`).  
**inserted / updated / skipped / applied / failed / duration for production apply:** **not measured** on real data.

### 3.5 Metrics still missing per family (required list)

For each family and each pilot scope, the following are **not fully filled**:

- `inserted`, `updated`, `skipped`, `applied`, `failed`, `duration` on a **real** apply path  
- `unchanged` meaningful F2 counts (Kyauktan shows **0** because F2 “changed” is too broad)  
- `verified_conflict`, `possible_delete` scenarios with real rows (Kyauktan buckets often 0)  
- `unsupported category` end-to-end on real staging (fixture-only for places loader)  
- History-after-cleanup + Apply-retry on the new conflict decision model (code partial; migration 139 not applied)

---

## 4. Required test cases — status

Legend: **PASS** = evidenced · **PARTIAL** = some evidence, not full gate · **FAIL / NOT RUN** = blocker

| Test case | Kyauktan | Yangon | Rural |
|-----------|----------|--------|-------|
| Same snapshot twice (local staging / classification) | PARTIAL (Stage 05 regen + places IR refresh) | NOT RUN | NOT RUN |
| Newer snapshot | NOT RUN | NOT RUN | NOT RUN |
| Safe new entity | PARTIAL (classified + loader fixture) | NOT RUN | NOT RUN |
| Safe update | PARTIAL (classified + loader fixture) | NOT RUN | NOT RUN |
| Unchanged entity | FAIL/weak (`unchanged=0` F2) | NOT RUN | NOT RUN |
| Possible duplicate | PARTIAL (places IR 11) | NOT RUN | NOT RUN |
| Conflict | PARTIAL (admin 1 local; places IR mostly duplicate/manual) | NOT RUN | NOT RUN |
| Manual-protected row | PARTIAL (places IR 23; loader fixture) | NOT RUN | NOT RUN |
| Verified conflict | PARTIAL (loader fixture only; Kyauktan class count 0) | NOT RUN | NOT RUN |
| Possible deletion | NOT RUN (bucket 0; no auto-delete proof on real delete candidates) | NOT RUN | NOT RUN |
| Invalid geometry | NOT RUN (no invalid rows in extract) | NOT RUN | NOT RUN |
| Unsupported category | PARTIAL (loader fixture abort) | NOT RUN | NOT RUN |
| Direct-core load retry | PARTIAL (fixture identical rerun PASS; real COPY not done) | NOT RUN | NOT RUN |
| Conflict upload retry | PASS (places J/K refresh) | NOT RUN | NOT RUN |
| Partial family failure | PARTIAL (loader savepoint fixture) | NOT RUN | NOT RUN |
| Apply retry | NOT RUN (decision→Apply orchestration not completed) | NOT RUN | NOT RUN |
| Candidate cleanup | NOT RUN (no approved cleanup pilot after conflict apply) | NOT RUN | NOT RUN |
| History after cleanup | PARTIAL (History API no longer joins candidates; migration 139 not applied; cleanup not executed) | NOT RUN | NOT RUN |

---

## 5. Required assertions — status

| # | Assertion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Valid classification totals reconcile | **PASS** (Kyauktan Stage 18) | Yangon/rural missing |
| 2 | Same snapshot rerun creates no duplicate core rows | **PARTIAL** | Fixture PASS; real Gate 4 apply not run |
| 3 | Same snapshot rerun creates no duplicate review candidates | **PARTIAL** | Places refresh preserved uniqueness; other families not uploaded |
| 4 | Manual rows never auto-overwritten | **PARTIAL** | Classification + loader fixture; not proven on real COPY apply |
| 5 | Verified meaningful conflicts never auto-overwritten | **PARTIAL** | Fixture only |
| 6 | Possible deletions never auto-delete | **NOT PROVEN** | No `possible_delete` rows in Kyauktan class report |
| 7 | Each family commits independently | **PARTIAL** | Loader/promotion design aims for family tx; full Apply path incomplete |
| 8 | Import Review contains only conflict records | **PASS for places pilot** | Other families not conflict-uploaded; must not re-enable full upload |
| 9 | Temporary candidates cleaned safely | **NOT RUN** | |
| 10 | Apply history readable after cleanup | **PARTIAL** | Durable JSON path in code; column migration 139 pending; cleanup not run |

---

## 6. Import Review / Apply repair status (related)

Completed or partial in code (2026-07-22 workstream):

- Conflict-only UI filters / decisions / field compare (dashboard)
- Conflict-only Stage J/K default + places upload pilot
- History list/detail oriented to apply runs; no candidate join for item enrichment
- Places `import_work` schema + safe loader fixtures

Not complete / not production-proven:

- Decision→Apply orchestration (dry-run → exact actions → confirm → family apply → retry failed) as the sole Apply path
- Migrations **138** (status CHECKs) and **139** (durable publish-item columns) **not applied**
- Settlements subtype extraction, essential/named family filters, per-family direct-core loaders beyond places
- Roads/admin “baseline, no blind reseed” loaders with safe_new / conflict split on real Yangon/rural data

---

## 7. Exact blockers (must clear before national import)

1. **Yangon pilot not run** — no classification, conflict upload, or safe-load evidence.  
2. **Rural township pilot not run** — no env/snapshot/report.  
3. **Gate 4 incomplete** — `import_work.place_rows` empty; real Kyauktan `safe_*` places never COPYed or applied to core.  
4. **Direct-core loaders missing** for roads, admin_areas, buildings (named), water, landuse, routing_barriers.  
5. **F2 `unchanged` unreliable** — Kyauktan `unchanged=0` for all families; risk of over-updating on roads (1400 `safe_update`).  
6. **Named/important filters not implemented** — buildings/landuse/water would push bulk geometry into core if loaders were enabled; PMTiles policy not enforced in Stage 05.  
7. **Settlements (`place=*`) not extracted** — Stage 05 still POI-oriented; settlements plan not executed.  
8. **Possible-delete path untested** — no auto-delete proof; soft-delete Apply behavior not production-verified.  
9. **Apply workflow incomplete** — promotion UI/API still heavier than decision-application; Apply retry + family independence not signed off.  
10. **Candidate cleanup + History after cleanup not end-to-end tested** — migration 139 not applied; cleanup not executed on conflict pilot batch.  
11. **Status CHECK migration 138 not applied** — new review decisions may fail DB constraints on live saves.  
12. **Newer-snapshot pilot missing** — no second snapshot comparison for Kyauktan/Yangon/rural.  
13. **Invalid geometry / unsupported category** not proven on real staging extracts (fixture-only where present).  
14. **Duration / applied / failed metrics** not recorded for a real multi-family apply run.

---

## 8. What must pass next (minimum path)

Do **not** start national import. Clear blockers in this order:

1. Apply migrations **138** + **139** on a staged environment (with approval).  
2. Finish Gate 4 for **places** on Kyauktan (COPY → dry-run reconcile → apply → identical rerun).  
3. Harden F2 change detection so `unchanged` is meaningful (especially roads).  
4. Run **rural township** then **Yangon** through Stages 05→08b→18 + conflict-only J/K for places (then other families one at a time).  
5. Complete decision→Apply dry-run/apply/retry + cleanup + History-after-cleanup checklist.  
6. Add named/important filters before any buildings/landuse/water core load.  
7. Add roads/admin loaders that respect existing national baseline (no blind reseed).  
8. Re-issue this document with filled metrics tables and a READY verdict only when all assertions PASS on all three scopes.

---

## 9. Related artifacts

| Artifact | Path |
|----------|------|
| Classification Kyauktan | `tools/data-pipeline/local-osm/reports/classification_kyauktan_2026-07-22.md` |
| Validation Kyauktan | `tools/data-pipeline/local-osm/reports/validation_source_kyauktan_2026-07-22.md` |
| Places conflict IR pilot | `tools/data-pipeline/local-osm/reports/remote_review_conflict_places_pilot_2026-07-22.md` |
| Places loader fixture | `tools/data-pipeline/import-work/reports/places_safe_loader_dry_run_2026-07-22.md` |
| Classification rules | `docs/osm-pipeline-import-classification.md` |
| Repair plan / gates | `docs/osm-pipeline-repair-plan.md` |
| Durable history migration (pending) | `infrastructure/database/migrations/supabase/139_system_publish_items_durable_history.sql` |
| Status model migration (pending) | `infrastructure/database/migrations/supabase/138_import_review_status_model_checks.sql` |

---

## 10. Verdict

# NOT READY — BLOCKERS REMAIN

National import must **not** start automatically or manually until the blockers in §7 are cleared and this document is updated to **READY FOR NATIONAL IMPORT** with completed metrics for Kyauktan, Yangon, and one rural township.
