# National buildings direct-Core apply — 2026-07-31

One-time guarded production apply of approved `safe_new` / `safe_update` building candidates into Supabase Core via the existing `tools/data-pipeline/direct-core` pipeline.

## Verdict

**APPLIED SUCCESSFULLY** (COMMIT). Publish batch **255**.

Local staging was **not** cleaned. `duplicate` (15) and `pmtiles_only` (5,555,482) were **not** imported. Existing mixed Core inventory was **not** cleaned.

## Inputs

| Item | Value |
|------|-------|
| Local `source_snapshot_id` | 13 |
| Production snapshot version | `osm_myanmar_2026_07_21_national_dry_run_v1` |
| Production `source_snapshot_id` | 10 |
| Region code | `mm-core-buildings-v1` |
| Approved CSV | `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/buildings.safe.csv` |
| CSV sha256 | `d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6` |
| Approved manifest | `.../buildings.dry_run_manifest.csv` |
| Manifest sha256 | `83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be` |
| Gate | `EXECUTE_BUILDINGS_DIRECT_CORE=I_UNDERSTAND` |
| Confirmation | `IMPORT buildings mm-core-buildings-v1 osm_myanmar_2026_07_21_national_dry_run_v1` |

## Scope

| Class | Count | Action |
|-------|------:|--------|
| ready `safe_new` | 22,703 | insert |
| ready `safe_update` | 82 | update if changed |
| protected / skipped | 0 | none |
| `duplicate` | 15 | excluded |
| `pmtiles_only` | 5,555,482 | excluded |
| rejected | 0 in approved manifest | excluded |

## Pre-apply checks

All passed before write:

1. Live Supabase schema has migration 149 typed identity columns + `core_map_buildings_source_identity_uidx`.
2. Local staging snap 13 unchanged: total 5,578,282; `safe_new` 22,703; `safe_update` 82; `duplicate` 15; `pmtiles_only` 5,555,482.
3. Production identity recheck: safe_new collisions = 0; safe_update active matches = 82/82.
4. Manifest + CSV checksums matched approved dry-run artifacts.
5. Scoped backups created under  
   `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/backups_20260731T045326Z/`.

### Before counts

| Table | Count |
|-------|------:|
| `core.core_map_buildings` | 1,133 |
| `core.core_map_building_names` | 259 |
| `core.core_place_buildings` | 51 |
| `system.system_publish_batches` | 16 |
| `system.system_publish_items` | 2,538 |
| `system.system_import_batches` | 9 |

## Apply result

| Metric | Value |
|--------|------:|
| Mode | production `--apply` (COMMIT) |
| Inserted | **22,703** |
| Updated | **29** |
| Ready but unchanged | **53** (of 82 safe_update) |
| Protected skipped | **0** |
| Name rows attempted / written | 17,898 attempted; names table +17,834 |
| Publish batch ID | **255** |
| Import batch ID | **44** |
| Publish items | 22,732 success (`insert` 22,703 + `update` 29) |
| Transaction | single regional transaction; internal insert batches of 1,000 |
| Apply log | `.../buildings.apply.log` |

### Insert batch notices

Batch window uses CSV `row_no` (includes safe_update rows), so some windows insert fewer than 1,000. Sum of inserted = **22,703**.

| Rows window | Inserted |
|-------------|----------:|
| 1–1000 | 998 |
| 1001–2000 | 1000 |
| 2001–3000 | 999 |
| 3001–4000 | 995 |
| 4001–5000 | 1000 |
| 5001–6000 | 1000 |
| 6001–7000 | 1000 |
| 7001–8000 | 994 |
| 8001–9000 | 990 |
| 9001–10000 | 1000 |
| 10001–11000 | 1000 |
| 11001–12000 | 997 |
| 12001–13000 | 980 |
| 13001–14000 | 994 |
| 14001–15000 | 989 |
| 15001–16000 | 992 |
| 16001–17000 | 993 |
| 17001–18000 | 1000 |
| 18001–19000 | 1000 |
| 19001–20000 | 1000 |
| 20001–21000 | 1000 |
| 21001–22000 | 997 |
| 22001–23000 | 785 |

## After counts

| Table | Count | Delta |
|-------|------:|------:|
| `core.core_map_buildings` | 23,836 | +22,703 |
| `core.core_map_building_names` | 18,093 | +17,834 |
| `core.core_place_buildings` | 51 | 0 |
| `system.system_publish_batches` | 17 | +1 |
| `system.system_publish_items` | 25,270 | +22,732 |
| `system.system_import_batches` | 10 | +1 |

## Post-apply verification

| Check | Result |
|-------|--------|
| inserted = approved ready safe_new | **PASS** 22,703 |
| updated ≤ approved ready safe_update | **PASS** 29 (53 unchanged) |
| protected/skipped = manifest | **PASS** 0 |
| duplicate imported | **PASS** 0 |
| pmtiles_only imported | **PASS** 0 |
| unexpected typed identity duplicates | **PASS** 0 |
| invalid geometry on imported loader rows | **PASS** 0 |
| missing `building_type_id` on safe_new | **PASS** 0 |
| null `admin_area_id` on safe_new | **KNOWN** 2,708 (schema nullable; present in approved ready set) |
| missing centroid / area_m2 | **PASS** 0 |
| broken names FK | **PASS** 0 |
| broken place-building links | **PASS** 0 |
| legacy `core_map_buildings.name` set on safe_new | **PASS** 0 |
| place links unchanged | **PASS** 51 |
| dashboard-created buildings still present / not loader-touched | **PASS** (114 dashboard-sourced rows; soft-delete timestamps unchanged on sampled IDs) |
| `tiles.tiles_buildings_v` | **PASS** 23,828 (= active buildings) |
| `search.v_search_buildings_source` | **PASS** queryable (10,176 rows) |

### Integration smoke

| Surface | Result |
|---------|--------|
| API `GET /buildings?limit=2` | **200** (auth JWT) |
| API `GET /buildings/:public_id` (imported) | **200** |
| API `GET /core-review/buildings` | **200** |
| API `GET /core-review/buildings/:public_id` | **200** |
| Dashboard `/dashboard/core-review/buildings` | **200** page shell (session Unauthorized without browser login) |
| Dashboard detail edit route | **200** page shell |

## ID artifacts

Under `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/`:

| File | Contents |
|------|----------|
| `inserted_building_ids.csv` | 22,703 insert target IDs |
| `updated_building_ids.csv` | 29 update target IDs |
| `unchanged_safe_update_ids.csv` | 53 ready safe_update with no row change |
| `skipped_protected_ids.csv` | header only (0 protected) |
| `buildings.apply.log` | full apply transcript |

### Updated Core IDs (29)

143, 166, 198, 215, 228, 229, 232, 294, 299, 307, 328, 362, 363, 376, 502, 542, 544, 545, 557, 576, 609, 702, 745, 753, 823, 833, 858, 936, 977

## Backup and rollback

**Backup dir:**  
`tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/backups_20260731T045326Z/`

Includes:

- `core_buildings_names_links.sql`
- `system_publish_import_batches.sql`
- before CSVs
- `rollback_targeted.sql`
- `ROLLBACK.md`
- `SHA256SUMS`

### Exact rollback procedure

1. Stop further building imports.
2. Prefer full restore from scoped dumps (restores buildings, names, place links to pre-apply state **1,133 / 259 / 51**). See `ROLLBACK.md`.
3. For insert-only undo of batch **255**, review `rollback_targeted.sql` (defaults to `ROLLBACK`). It does **not** restore the 29 updated geometries from lean audit JSON; use the full dump for exact update restore.
4. Re-check table counts, tiles view, and search view after restore.

## Loader notes for this apply

- Existing direct-Core SQL/runner only (no new importer).
- Centroid and `area_m2` computed from final geometry (`ST_PointOnSurface` / `ST_Area(geography)`).
- Insert batch size **1000**.
- Names written to `core.core_map_building_names` with `ON CONFLICT DO NOTHING`.
- Production apply also requires `EXECUTE_BUILDINGS_DIRECT_CORE=I_UNDERSTAND` (added to runner).

## Not done (by design)

- No local staging cleanup.
- No import of `duplicate` or `pmtiles_only`.
- No cleanup of existing mixed production Core buildings.
- No automatic retry (apply succeeded on first commit).
