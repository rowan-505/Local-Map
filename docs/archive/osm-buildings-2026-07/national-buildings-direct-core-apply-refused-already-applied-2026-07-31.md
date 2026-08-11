# National buildings direct-Core apply — refused (already applied)

**Date:** 2026-07-31  
**Requested action:** Apply approved artifact to Supabase  
**Result:** **REFUSED — ALREADY APPLIED** (no new production write)

## Why apply was not run

| Precondition | Status |
|--------------|--------|
| Artifact checksums match | **PASS** |
| Supabase migration 149 compatible | **PASS** |
| Artifact dry-run returned GO | **FAIL** — dry-run was **NO_GO** (22,703 safe_new collisions) |
| Live state unchanged since dry-run | **PASS** — still 23,836 buildings / batch 255 present |
| Scoped backups exist | **PASS** — `backups_20260731T045326Z/` |
| `EXECUTE_NATIONAL_BUILDINGS_DIRECT_CORE=I_UNDERSTAND` | **Not set / not used** — apply blocked |

Live checks just now:

- `core.core_map_buildings` = **23,836** (= 1,133 pre-import + 22,703 inserts)
- `core.core_map_building_names` = **18,093**
- `core.core_place_buildings` = **51**
- All **22,703** approved `safe_new` identities already match active Core rows
- All **82** approved `safe_update` identities already match active Core rows
- Publish batch **255** exists (`promoted`): inserted 22,703, updated 29, unchanged_ready 53

Re-running apply would hard-fail with `safe_new identity already exists in Core` for every approved insert.

## Prior successful apply (authoritative)

Report: [`docs/national-buildings-direct-core-apply-2026-07-31.md`](national-buildings-direct-core-apply-2026-07-31.md)

| Item | Value |
|------|-------|
| Publish batch ID | **255** |
| Import batch ID | **44** |
| Inserted | 22,703 |
| Updated | 29 |
| Unchanged ready updates | 53 |
| Protected skipped | 0 |
| Inserted IDs | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/inserted_building_ids.csv` |
| Updated IDs | `.../updated_building_ids.csv` |
| Backups | `.../backups_20260731T045326Z/` |
| Rollback | `.../backups_20260731T045326Z/ROLLBACK.md` + `rollback_targeted.sql` |

## Artifact gate (re-checked)

| File | SHA-256 | Match |
|------|---------|-------|
| `buildings.safe.csv` | `d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6` | yes |
| `buildings.dry_run_manifest.csv` | `83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be` | yes |

## What was not done in this task

- No second insert/update of the 22,785 rows
- No change to `basemap_source`
- No staging restore
- No cleanup of mixed Core buildings
- Artifacts left in place

## If a true re-apply were ever required

1. Rollback batch 255 using the scoped backups / targeted rollback procedure first.
2. Re-run artifact dry-run until collisions = 0 and verdict = GO.
3. Then apply with `EXECUTE_NATIONAL_BUILDINGS_DIRECT_CORE=I_UNDERSTAND` (or the existing buildings gate) via the artifact runner.

**Do not apply again on the current database.**
