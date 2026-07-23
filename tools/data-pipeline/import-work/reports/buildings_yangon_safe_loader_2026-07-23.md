# Buildings Yangon safe loader — 2026-07-23

## Verdict

**PASS**

Production-safe loader for important/named buildings is implemented, fixture-tested, and verified on the **50 Yangon downtown `safe_new` sample only**.  
Full Yangon City and national building loading remain **disabled**.

---

## Scope

| Item | Value |
|---|---|
| Target | production Supabase `locghyuranqaqsnbxflc` |
| Contract | `docs/safe-loader-contract.md` |
| Policy | `docs/osm-core-vs-pmtiles-selection-policy.md` (important/named only) |
| Sample snapshot | id **10** `osm_myanmar_2026_07_21_yangon_downtown_sample_v1` |
| Batch | `buildings_yangon_downtown_safe_2026_07_23` (import_batch_id **52**) |
| Work rows | 50 `safe_new`, all typed, no `pmtiles_only` |
| Core before → after | **1075 → 1125** (+50) |
| Names written (apply) | **54** |

Not in scope: ordinary footprints, full Yangon, national load, Import Review for `pmtiles_only`.

---

## Artifacts

| Path | Role |
|---|---|
| `infrastructure/database/migrations/supabase/141_import_work_buildings.sql` | `import_work.building_rows` + family allowlist |
| `tools/data-pipeline/import-work/buildings_safe_loader.sql` | dry-run / apply wrapper |
| `tools/data-pipeline/import-work/buildings_safe_loader_body.sql` | set-based insert/update/skip/fail |
| `tools/data-pipeline/import-work/run_buildings_safe_loader.sh` | contract-aware runner |
| `tools/data-pipeline/import-work/buildings_safe_loader_tests.sql` | fixture suite (outer ROLLBACK) |
| `tools/data-pipeline/import-work/yangon_downtown_buildings_preload.sh` | local export → production COPY |
| `tools/data-pipeline/import-work/yangon_downtown_buildings_preload.sql` | batch + `building_rows` load |

Shared contract gates: explicit `--target production`, dry-run default, production apply needs  
`APPLY buildings <batch_id>`.

---

## Core eligibility (enforced)

Only `eligible_for_core` / `safe_new|safe_update` enter `import_work.building_rows` and the loader.

Examples in sample: named buildings and important amenity buildings (hospital/clinic, school, government, market, station/terminal, landmark-class where classified).

`pmtiles_only` footprints must not enter import_work, core loader, or Import Review — preload refuses them; loader ignores non-safe classifications.

Live core has no `manual_override` column; protection uses `source_refs` dashboard/manual markers + `is_verified` / `verification_status` (same spirit as places).

---

## Pilot runs

### 1. Preload (COPY / set-based)

| metric | value |
|---|---:|
| exported from local staging | 50 |
| loaded into `import_work.building_rows` | 50 |
| missing `building_type_id` | 0 |
| batch status after preload | `loaded` |

### 2. Production dry-run

| metric | value |
|---|---:|
| inserted (planned) | 50 |
| updated | 0 |
| skipped | 0 |
| failed | 0 |
| names_written (planned) | 54 |
| core delta (rolled back) | +50 → **ROLLBACK** |
| duration_ms | 27.26 |
| publish_batch_id (ephemeral) | 92 |

### 3. Controlled real apply

Confirmation: `APPLY buildings 52`

| metric | value |
|---|---:|
| inserted | 50 |
| updated | 0 |
| skipped | 0 |
| failed | 0 |
| names_written | 54 |
| core_buildings_before | 1075 |
| core_buildings_after | 1125 |
| duration_ms | 13.72 |
| publish_batch_id | **93** (`promoted`) |
| work rows after cleanup | **0** |
| batch status | `cleaned` |

### 4. Identical rerun

Re-preloaded same 50 identities → apply again.

| metric | value |
|---|---:|
| inserted | 0 |
| updated | 0 |
| skipped | 50 (`identity already in core (rerun skip)`) |
| failed | 0 |
| core delta | 0 (1125 → 1125) |
| publish_batch_id | **94** |
| durable pilot rows (region `MM-YANGON-DT` + sample snapshot) | **50** |

Stable core IDs preserved; no duplicate buildings.

---

## Required tests

| Test | Result | Evidence |
|---|---|---|
| production dry-run | PASS | batch 52, insert=50, ROLLBACK |
| controlled real apply | PASS | publish 93, core 1075→1125 |
| identical rerun | PASS | skip=50, delta=0 |
| duplicate external ID | PASS | fixture abort; no core write |
| manual protected target | PASS | fixture skip |
| verified target | PASS | fixture skip |
| missing type | PASS | fixture abort |
| invalid geometry | PASS | fixture abort |
| transaction rollback | PASS | savepoint / outer ROLLBACK |
| name insertion | PASS | apply names=54; fixture names_written=2 |

Fixture summary (`buildings_safe_loader_tests.sql` on production, rolled back):

```text
buildings_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)
```

Live `core.core_map_buildings` after fixtures: **1125** (no fixture leaks).

---

## Allowlist (safe_update)

`name`, `geom`, `centroid`, `area_m2`, `building_type_id`, `admin_area_id`, `levels`, `height_m`, `confidence_score`, `normalized_data`, `source_refs`, `building_names`

Protected: manual/dashboard source markers; verified buildings not meaningfully overwritten.

---

## Safety notes

- No generic JSON loader.
- Ordinary PMTiles footprints never entered this path.
- Full Yangon / national building load **not** enabled.
- Production apply requires explicit confirmation string.
- Completed work rows cleaned after apply.

---

## How to re-verify (sample only)

```bash
# preload 50 downtown safe_new
./tools/data-pipeline/import-work/yangon_downtown_buildings_preload.sh \
  tools/data-pipeline/local-osm/imports/yangon_city_production_pilot_2026_07_23.env

# dry-run
./tools/data-pipeline/import-work/run_buildings_safe_loader.sh \
  --env-file tools/data-pipeline/local-osm/imports/yangon_city_production_pilot_2026_07_23.env \
  --target production \
  --batch-code buildings_yangon_downtown_safe_2026_07_23 \
  --dry-run

# fixture suite (always rolls back)
psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/import-work/buildings_safe_loader_tests.sql
```

---

## Remaining risks

- Downtown sample only; Yangon City / national volumes not exercised.
- `admin_area_id` may be null on some rows until admin snap is filled.
- Live schema has no `manual_override` boolean; protection depends on source_refs + verification fields matching loader conventions.

---

## PASS
