# Yangon production pilot — 2026-07-23

## Verdict

**FAIL — blockers**

Places (settlements + essential) can load through the existing safe loader path.  
Buildings / landuse / water / roads have **no production direct-load safe loaders**, so this pilot stops at classify + Import Review readiness (and roads F2 gate).  
**Do not start national import.**

---

## Scope

| Item | Value |
|---|---|
| Goal | Yangon dense-data / performance pilot (not whole country) |
| City clip | Admin district 2043 (`ရန်ကုန်မြို့`) → `yangon-city-260721.osm.pbf` |
| Fast sample clip | Downtown CBD → `yangon-downtown-sample-260721.osm.pbf` (~457KB) |
| City snapshot | `osm_myanmar_2026_07_21_yangon_city_v1` (id **9**) |
| Sample snapshot | `osm_myanmar_2026_07_21_yangon_downtown_sample_v1` (id **10**) |
| Sample raw counts | pts **2718** / lines **2243** / polys **6666** |

---

## Progress / dry-run fixes (this session)

Problem: dry-run / pipeline runs looked stuck; no live % status; full Yangon City / all footprints were too slow for smoke tests.

Fixes shipped:

1. **Pipeline stage %** — `run_local_osm_pipeline.sh` logs `[pipeline N%]` per stage and `[pipeline 100%]` at end.
2. **`PIPELINE_TO_STAGE`** — stop after a stage (used for extract-only then filter).
3. **Named + capped sample runner** — `scripts/run_yangon_downtown_family_sample.sh`  
   stage 05 → keep named (+ optional row cap) → stages 06–10 with live progress.
4. **Places loader sample** — `-v sample_limit=N` / 4th arg on `run_places_safe_loader.sh`; NOTICE stream `[0%]…[100%]`.
5. **Roads F2 prod extract** — do not copy all ~823k `prod_mirror.core_streets`; keep identity + staging-extent candidates only.

Verified sample dry-run (remote, `sample_limit=5`, ~3s):

```text
places_loader [0%] SAMPLE MODE limit=5
places_loader [5%] … [15%] … [25%] … [30%] … [45%] … [50%] … [80%] … [100%]
DRY RUN rolled back — no durable core writes
skipped=5 (identity already in core)
```

---

## Family results

### 1) Settlements (Yangon City) — places path PASS

| Check | Result |
|---|---|
| Valid staging | ~1474 |
| `safe_new` | **1463** |
| Conflicts → IR | **11** (package `remote_review_settlement_conflicts_yangon_city_2026_07_23`) |
| Direct load batch | `places_yangon_settlements_safe_2026_07_23` |
| Identical rerun | skip / no dup growth (per run logs) |

### 2) Essential places (Yangon City) — places path PASS

| Check | Result |
|---|---|
| Load-ready `safe_new` | **9407** (admin-mapped subset) |
| Conflicts → IR | **273** (exclude settlements) |
| Direct load batch | `places_yangon_essential_safe_2026_07_23` |
| Remote `core.core_places` live | **11213** (after loads) |
| Identical sample dry-run | 5/5 skip “already in core” |

Note: loads landed on **Supabase remote** `core.core_places`. Local `geo_core` still has only the old demo (~15 live places). `run_places_safe_loader.sh` prefers `SUPABASE_DATABASE_URL` when set.

### 3) Buildings (downtown sample) — classify only

| Check | Result |
|---|---|
| Extracted footprints | 6422 |
| Named kept / capped | 235 → **50** |
| F2 vs prod_mirror | 50 `new` |
| Import class | **50 `safe_new`** |
| Duration | ~53s (with progress) |
| Core write | **blocked** — no `buildings_safe_loader` |

### 4) Landuse (downtown sample) — classify only

| Check | Result |
|---|---|
| Extracted | 96 |
| Named kept | **26** |
| Import class | **19 `safe_new`**, **7 `pmtiles_only`** |
| Duration | ~18s |
| Core write | **blocked** — no landuse safe loader |

### 5) Water (downtown sample) — classify only

| Family | Extracted | Named kept | Class |
|---|---|---|---|
| water_lines | 20 | **1** | 1 `safe_new` |
| water_polygons | 5 | **0** | (empty after named filter) |

Core write: **blocked** — no water safe loaders.  
`pmtiles_only` must never go to IR/core (policy unchanged).

### 6) Roads (downtown sample) — F2 gate, no write

| Check | Result |
|---|---|
| Extracted | 1800 |
| Sample kept | **50** |
| F2 prod candidates (scoped) | 5322 (not full 823013) |
| Source matches | **50 / 50** |
| Auto actions | **49 `ignore_unchanged`**, **1 `update_candidate`** |
| Staging class | 49 `unchanged`, 1 `safe_update` |
| Duration | ~64s with progress |
| Core write | **none** (by design) |

F2 unchanged gate: **PASS for sample** (majority unchanged; one conflict stays review/update, not auto national write).

---

## Blockers (why FAIL)

1. **Missing production safe loaders** for buildings, landuse, water_lines, water_polygons, roads — cannot direct-load safe classes to core.
2. Full Yangon City Stage 05/07 on all footprints/roads remains heavy without named/sample caps (use downtown sample tooling for smoke).
3. Local vs remote split: places apply used remote when `SUPABASE_DATABASE_URL` is exported; document target DB explicitly on every apply.
4. Admin hierarchy gaps for Yangon townships remain (city clip used district 2043; essential admin join used township ST_Covers).

---

## What passed

- Incremental places path for settlements + essential (classify → IR conflicts → safe loader → identical skip).
- Downtown sample classify for buildings / landuse / water / roads with live `[pipeline N%]` logs.
- Roads F2 sample gate without core write.
- Tiny loader dry-run with real-time % and `sample_limit`.

---

## Explicit non-actions

- No national Myanmar import.
- No core write for buildings / landuse / water / roads.
- No fake IR upload for empty/tiny water polygon sample.

---

## How to re-run fast samples

```bash
# Family classify (named + cap 50), live %
./scripts/run_yangon_downtown_family_sample.sh buildings 50
./scripts/run_yangon_downtown_family_sample.sh roads 50

# Places loader smoke (positional args)
./run_places_safe_loader.sh places_yangon_essential_safe_2026_07_23 true "$SUPABASE_DATABASE_URL" 5
```

---

## Final line

**FAIL — blockers**
