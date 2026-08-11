# CoreMap national-import final authorization

> Historical authorization evidence. Any loader-path details below describe the
> retired pilot architecture and do not authorize current production commands.
> Use the entity import runbook and direct-Core contract for current operations.

**Date:** 2026-07-23  
**Updated:** 2026-07-28 (pipeline Stage 08c/08d + live blocker re-check; verdict unchanged)
**Review type:** Final authorization (read-only inspection + report evidence)  
**Live project:** Supabase `locghyuranqaqsnbxflc` (Map Project)  
**Local DB:** `geo_core` @ localhost:5433  

**Import started by this review:** **No.**

---

## 2026-07-28 update (do not flip READY yet)

Operator runbook: [`docs/myanmar-national-osm-entity-import-runbook.md`](myanmar-national-osm-entity-import-runbook.md)

| Blocker | 2026-07-28 | Action |
|---|---|---|
| Township overlaps | **FIXED** (0 pairs >100 m²) | `tools/data-pipeline/local-osm/reports/township_overlap_reverify_2026-07-28.md` |
| Pipeline local admin IDs | **CODE FIXED** | Stage 05 no longer writes local ids; Stage 08c assigns `prod_mirror` township ids |
| National Stage 18 | **Still incomplete** | Finish batched dry-run reports |
| Roads policy | **DOC LOCKED** | [`docs/national-roads-osm-reload-policy.md`](national-roads-osm-reload-policy.md) |
| Admin OSM apply | **EXCLUDED** | [`docs/national-admin-osm-exclude.md`](national-admin-osm-exclude.md) |
| Per-family ≥1k prove-out | **Pending** | [`docs/national-entity-proveout-checklist.md`](national-entity-proveout-checklist.md) |
| Landuse IR admin column | Migration **147** filed | Apply on Supabase before landuse IR upload |

**Verdict remains: NOT READY** for country-wide apply until Stage 18 + prove-outs pass per family.

---

## Overall verdict

# NOT READY — BLOCKERS REMAIN

**National Myanmar OSM import is not authorized.**

No family meets the bar for **country-wide** load. Several families have **scoped regional pilots** that already applied safely; those are **not** a national grant. Per user rule, fixture-only or ≤50-row prove-outs do **not** authorize bulk/family national import.

---

## Evidence read

| Source | Path / note |
|--------|-------------|
| Production Baseline v1 | `tools/data-repair/current-production/PRODUCTION_BASELINE_V1.md` |
| Kyauktan classification | `tools/data-pipeline/local-osm/reports/classification_kyauktan_2026-07-22.md` |
| Kyauktan F2 unchanged repair | `tools/data-pipeline/local-osm/reports/f2_unchanged_repair_kyauktan_2026-07-22.md` |
| Kyauktan core/PMTiles | `tools/data-pipeline/local-osm/reports/core_pmtiles_selection_kyauktan_2026-07-23.md` |
| Rural settlements pilot | `tools/data-pipeline/local-osm/reports/settlements_rural_pilot_2026-07-23.md` |
| Yangon real-apply matrix | `docs/yangon-real-apply-verification.md` |
| Yangon production pilot | `tools/data-pipeline/local-osm/reports/yangon_production_pilot_2026-07-23.md` |
| National dry-run runbook | `docs/myanmar-national-osm-dry-run.md` |
| National admin assignment | `tools/data-pipeline/local-osm/reports/myanmar_national_admin_assignment_2026-07-23.md` |
| Loader reports | `tools/data-pipeline/import-work/reports/*_2026-07-23.md` |
| IR Apply / cleanup / History | `docs/import-review-places-apply-pilot-2026-07-23.md` |
| Prior readiness | `docs/osm-pipeline-production-readiness.md` (2026-07-22; superseded for live counts) |
| Safe-loader contract | `docs/safe-loader-contract.md` |

---

## Live inspection (2026-07-23)

### Production core (`locghyuranqaqsnbxflc`)

| Table | Live count |
|-------|----------:|
| `core.core_places` | **11 213** |
| `core.core_streets` | **823 006** |
| `core.core_admin_areas` (active) | **2 518** |
| `core.core_map_buildings` | **1 125** |
| `core.core_map_landuse` | **57** |
| `core.core_map_water_lines` | **2** |
| `core.core_map_water_polygons` | **12** |
| `routing.routing_barriers` | **15** |

Matches Yangon real-apply verification after controlled pilots (baseline v1 was pre-pilot: places 265 → now 11 213).

### Import Review / publish History / import_work

| Metric | Live value |
|--------|-----------:|
| `import_review.review_batches` | 5 |
| `import_review.place_candidates` | 291 |
| `system.system_publish_batches` | 52 |
| `system.system_publish_items` | 6 045 |
| Items with durable `review_decision` | **4 225** |
| Items with durable `source_snapshot_version` | **4 225** |
| Migration **139** columns present | **Yes** (`review_decision`, `applied_by`, `source_snapshot_version`) |
| `import_work.import_batches` | 12 (places applied; sample families cleaned; some roads `loaded`/`applied`) |

### Local (`geo_core`)

| Item | Status |
|------|--------|
| National raw snap **13** | Present (`osm_myanmar_2026_07_21_national_dry_run_v1`) |
| Raw volume | ~385k points / ~919k lines / ~5.77M polys |
| `prod_mirror` | Present (places ~11.2k, streets ~823k, admin 2518) |
| National Stage 05 (`places,roads`) | **Still long-running** at review time — Stage 18 national classification **incomplete** |
| Local vs prod admin drift | Documented (304 vs 377 townships; 0 local towns) |

---

## National blockers (must clear before any national grant)

1. **National Stage 18 classification unfinished** — no country-wide `safe_*` / `unchanged` / conflict volume report.
2. **National dry-run suspicion gates not scored** (roads mass `safe_update`, building eligibility, admin-all-changed, review volume, null `external_id`).
3. **Admin covering not production-ready nationally** — ~15% sample township null; local/mirror level drift; country envelope oversized.
4. **No `admin_areas` safe loader** — family cannot be nationally imported through the approved path.
5. **Map families only proven on tiny/named samples** (buildings 50, landuse 19, water 1–3, barriers 15) — below authorization threshold for bulk.
6. **Roads national apply not proven** — F2 gate PASS on Yangon **5k classify**; production apply only **5** allowlist rows.
7. **Streets already national in core** (823k) from legacy fast path — any national OSM road reload needs explicit conflict/identity plan (baseline: 486 null `external_id`, 796k generated names).
8. **Valhalla not rebuilt** after barrier pilot (acceptable for pilot; blocker if routing barriers go wider).

---

## Checklist legend

| Symbol | Meaning |
|--------|---------|
| PASS | Proven on real data at meaningful volume |
| PARTIAL | Proven narrowly or with known gaps |
| FAIL | Broken or missing for national use |
| N/A | Not required for that family / not in scope |

---

## Per-family authorization matrix

### 1) places (settlements + POI/essential)

| Gate | Status | Evidence |
|------|--------|----------|
| Stable identity | PASS | OSM external_id; rural fingerprint identical ×2 |
| Validation | PASS | Kyauktan / Yangon / rural pilots |
| Unchanged detection | PARTIAL | F2 repair: places 11 unchanged / 10 safe_update (Kyauktan); national Stage 18 pending |
| Duplicate detection | PASS | Type-aware radii; IR duplicate classes |
| Core eligibility | PASS | Settlements + essential filters |
| Real loader | PASS | Production applies: Kyauktan settlements 77; Yangon settlements +1463; essential +9407 |
| Identical rerun | PASS | Skip proven (sample + prior full) |
| Manual / verified protection | PASS | Loader tests + IR manual_protected; protected not auto-written |
| Conflict-only upload | PASS | Yangon IR packages; Kyauktan conflict IR; Apply pilot batch 44 |
| Apply lifecycle | PASS | Dry-run → exact_actions → promote → retry recovery |
| Cleanup | PARTIAL | IR candidate cleanup after Apply; places `import_work` batches still `applied` with rows retained |
| Durable History | PASS | Migration 139 live; History after cleanup documented (item-level durable; batch derived_status caveat) |
| Performance | PARTIAL | City-scale OK; national Stage 05 still heavy |
| Failure restart | PASS | Soft-deleted core → keep_existing recovery on batch 44 |
| Pilot coverage | PASS | Kyauktan rural + Yangon City (not national) |
| **National authorize?** | **NO** | Need finished national classify + admin/review-volume gates |

**Limited note (not national):** Regional places loads already applied under existing gates may continue **only** as capped Yangon/Kyauktan follow-ups with conflict-only IR. That is **not** national authorization.

---

### 2) roads

| Gate | Status | Evidence |
|------|--------|----------|
| Stable identity | PASS | `osm:W:` / CoreMap key normalization |
| Validation | PASS | Pipeline + loader |
| Unchanged detection | PASS (scoped) | Kyauktan F2 repair 1217 unchanged; Yangon 5k **5000/5000 unchanged** after fingerprint fix |
| Duplicate detection | N/A | Identity-only (by design) |
| Core eligibility | PASS | Highway staging |
| Real loader | PARTIAL | Implemented; production apply = **5** surface updates only |
| Identical rerun | PASS | 5/5 skip |
| Manual / verified protection | PARTIAL | Loader contract; not exercised at volume |
| Conflict-only upload | PARTIAL | High-risk fields stay off allowlist; no bulk IR road package proven |
| Apply lifecycle | PARTIAL | Dry-run 500 rolled back; apply 5 committed |
| Cleanup | PARTIAL | Cleanup SQL supports `road_rows`; batches 91–93 still present |
| Durable History | N/A / PARTIAL | Safe-loader path ≠ publish History; IR History for roads not piloted |
| Performance | PARTIAL | 5k classify OK; national 823k already in core |
| Failure restart | PARTIAL | Loader contract; not stress-tested nationally |
| Pilot coverage | PARTIAL | Yangon 5k classify + 5-row apply — **not** national |
| **National authorize?** | **NO** | Apply volume insufficient; legacy national streets need explicit reload policy |

---

### 3) buildings

| Gate | Status | Evidence |
|------|--------|----------|
| Stable identity | PASS | OSM id keys |
| Validation | PASS | Kyauktan / downtown |
| Unchanged detection | FAIL/PARTIAL | Kyauktan still ~950 `safe_update` / 3 unchanged after F2 repair |
| Duplicate detection | PARTIAL | Present; dense zero-dup suspicion not cleared nationally |
| Core eligibility | PASS | Named/important only; Kyauktan + downtown policy; national census ~22.7k eligible / ~5.56M PMTiles |
| Real loader | PARTIAL | Production +50 downtown named only |
| Identical rerun | PASS | 50/50 skip |
| Manual / verified | PARTIAL | Fixture/tests |
| Conflict-only upload | PARTIAL | Sample had 0 loader IR |
| Apply lifecycle | PASS (sample) | Apply + cleanup |
| Cleanup | PASS | Work rows 0 after cleanup |
| Durable History | N/A | Direct safe-loader |
| Performance | FAIL for national | Full footprints forbidden; national Stage 05 buildings path not completed |
| Failure restart | PARTIAL | Contract only |
| Pilot coverage | FAIL for national | **50-row downtown only** — cannot authorize |
| **National authorize?** | **NO** | Below volume bar; F2 unchanged still noisy |

---

### 4) landuse

| Gate | Status | Evidence |
|------|--------|----------|
| Stable identity | PASS | |
| Validation / eligibility | PASS | Core vs PMTiles |
| Unchanged detection | PASS (Kyauktan) | 29 unchanged after F2 repair |
| Real loader | PARTIAL | Production +19 downtown named |
| Identical rerun | PASS | 19/19 |
| Pilot coverage | FAIL for national | **19 rows** |
| **National authorize?** | **NO** | |

---

### 5) water_lines

| Gate | Status | Evidence |
|------|--------|----------|
| Real loader | PARTIAL | Production +1 downtown |
| Identical rerun | PASS | 1/1 |
| Pilot coverage | FAIL for national | **1 row** |
| **National authorize?** | **NO** | |

---

### 6) water_polygons

| Gate | Status | Evidence |
|------|--------|----------|
| Real loader | PARTIAL | Production +3 Kyauktan (Yangon downtown 0 eligible) |
| Identical rerun | PASS | 3/3 |
| Pilot coverage | FAIL for national | **3 rows**; not Yangon-native |
| **National authorize?** | **NO** | |

---

### 7) routing_barriers

| Gate | Status | Evidence |
|------|--------|----------|
| Real loader | PARTIAL | Production 0→15 Kyauktan |
| Identical rerun | PASS | 15/15 |
| Valhalla rebuild | FAIL / deferred | Not run |
| Pilot coverage | FAIL for national | **15 rows**; no Yangon classify sample |
| **National authorize?** | **NO** | |

---

### 8) admin_areas

| Gate | Status | Evidence |
|------|--------|----------|
| Baseline hierarchy | PASS | Production Baseline v1 repaired |
| Classification (Kyauktan) | PARTIAL | 14 rows; mostly manual_protected |
| Unchanged detection | FAIL | Still 0 unchanged in F2 repair table |
| Real loader | **FAIL** | **No admin safe loader in import-work** |
| National covering | PARTIAL | 85% township sample assign; local/mirror drift |
| **National authorize?** | **NO** | No loader; covering not ready |

---

## Cross-cutting systems

| System | Status | Notes |
|--------|--------|-------|
| Conflict-only IR upload | PASS (places) | Other families mostly empty IR in samples |
| Apply lifecycle (IR) | PASS (places) | Batch 44 promoted 30/30 after recovery |
| Cleanup (IR candidates) | PASS with caveats | History batch derived_status can look wrong after cleanup |
| Durable History (139) | PASS | Columns live; 4225/6045 items populated |
| import_work cleanup | PASS for cleaned sample batches | Places/roads some batches still retained |
| National dry-run | FAIL / incomplete | Raw loaded; Stage 05+ classify not finished |
| Prod mirror | PARTIAL | Present locally; full refresh sometimes long; age must be recorded before next classify |

---

## What is explicitly not authorized

- Whole-country OSM load for **any** family  
- Full Yangon City buildings / landuse / water / roads bulk apply  
- National roads reseed / replace of existing 823k streets  
- Admin polygon import via pipeline (no loader)  
- Automatic continue-on-failure across families  
- Valhalla production rebuild as part of this grant (none granted)

---

## Minimum path to reopen national authorization

1. Finish **batched national dry-run** through Stage 18 for intended families; publish full bucket table + suspicion flags.  
2. Clear **admin** local↔production id/level mapping for township assignment (≥95% unique cover on national sample, or documented NULL policy).  
3. For each family requesting national load: **real** dry-run + capped apply at **≥1k** rows (or full regional township), identical rerun, cleanup, duration.  
4. Roads: written policy for legacy national streets + allowlisted field apply at meaningful volume after F2 gate.  
5. Buildings/landuse/water: national core-eligible counts from Stage 18; no PMTiles-only in work/IR.  
6. Admin: implement safe loader **or** exclude family from national import scope permanently.  
7. Re-run this authorization checklist; only then choose `READY FOR NATIONAL IMPORT` or `READY FOR LIMITED FAMILY IMPORT` with an explicit family list.

---

## Limited regional status (informational — not a national grant)

These scopes already passed controlled production pilots. They may continue under **existing** ops gates only:

| Scope | Status |
|-------|--------|
| Yangon City places settlements / essential | Applied; identical skip re-verified |
| Kyauktan rural settlements | Applied |
| Downtown named buildings / landuse / water | Tiny samples only — **no expansion without new authorization** |
| Kyauktan water polygons / barriers | Tiny samples only |
| Yangon roads allowlist ×5 | Probe only |

---

## Final statement

**NOT READY — BLOCKERS REMAIN**

Do **not** start national import.  
Do **not** treat Yangon/Kyauktan pilots as country authorization.  
Do **not** authorize bulk load from fixture or ≤50-row tests.
