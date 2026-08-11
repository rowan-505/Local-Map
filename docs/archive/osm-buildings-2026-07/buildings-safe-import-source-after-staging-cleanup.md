# Buildings safe-import source after staging cleanup

**Date:** 2026-07-31  
**Scope:** Read-only inspection of local `geo_core` after staging snapshot-13 cleanup.  
**Supabase:** not queried / not modified.

## Verdict

**GO_WITH_ARTIFACT**

Exact `safe_new` (22,703) and `safe_update` (82) rows are **not** labeled inside `basemap_source.buildings`, but they are **fully recoverable** from retained direct-Core artifacts whose identities all exist in `basemap_source.buildings`.

`basemap_source` alone is **not** enough to rebuild the four-way staging classification (`safe_new` / `safe_update` / `duplicate` / `pmtiles_only`).

Do **not** rerun the national pipeline to recover the approved Core set.

---

## Confirmed local state

| Object | Count / status |
|--------|----------------|
| `basemap_source.buildings` | **5,578,282** |
| `staging.staging_building_candidates` snap 13 | **0** (cleaned) |
| pg_dump | `tools/data-pipeline/basemap-source/artifacts/buildings_snap13_20260731T050542Z/basemap_source_buildings.dump` (**855 MB**, non-empty) |

---

## 1. `basemap_source.buildings` columns and indexes

### Columns

| Column | Notes |
|--------|-------|
| `id` | bigserial PK |
| `external_id` | text NOT NULL, unique |
| `osm_feature_type` | `way` \| `relation` |
| `osm_id` | bigint > 0 |
| `source_snapshot_id` | all rows = **13** |
| `raw_id`, `source_staging_id` | preserved |
| `class_code` | OSM/building class string (e.g. `unknown`, `residential`) — **not** Core `building_type_id` |
| `canonical_name` | nullable (10,049 non-null) |
| `normalized_data` | jsonb (tags/address/building metrics) |
| `source_refs` | jsonb (OSM identity + snapshot lineage) |
| `geom` | `geometry(MultiPolygon,4326) NOT NULL` |
| `geometry_hash`, `content_hash` | preserved |
| `imported_at`, `updated_at` | set at copy |

### Indexes

- `UNIQUE (external_id)`
- `UNIQUE (osm_feature_type, osm_id)`
- GiST `(geom)`
- PK `(id)`

No `import_class` column. No workflow columns.

---

## 2. Field preservation matrix

| Staging / Core field | In `basemap_source`? | Where |
|----------------------|----------------------|-------|
| `import_class` | **No** | Intentionally omitted by copy SQL |
| `eligible_for_core` | **No** | Not copied |
| `core_selection_reason` | **No** | Not copied |
| `match_status` | **No** | Not copied |
| `source_snapshot_id` | **Yes** | column (= 13) + `source_refs.source_snapshot_id` |
| `external_id` | **Yes** | column |
| OSM typed identity | **Yes** | columns `osm_feature_type` / `osm_id` + `source_refs` |
| `canonical_name` | **Yes** | column |
| `class_code` | **Yes** | column (OSM class, not Core type id) |
| `admin_area_id` | **Partial** | not a column; often in `normalized_data` JSON for assigned rows |
| `building_type_id` | **No** as Core FK | only OSM class / tags in JSON; Core type id lives in export CSV |

Copy comment in `tools/data-pipeline/basemap-source/sql/copy_buildings_from_staging_snap13.sql` states workflow fields including `import_class` were excluded on purpose.

---

## 3–4. Reconstructable class counts

### From `basemap_source` alone

| Class | Reconstructable count | Exact expected match? |
|-------|----------------------:|-----------------------|
| `safe_new` | unknown | **No** |
| `safe_update` | unknown | **No** |
| `duplicate` | unknown | **No** |
| `pmtiles_only` | unknown | **No** |

There is **0** row with `import_class` in `normalized_data` or `source_refs`.

Remainder math only: `5,578,282 − 22,785 = 5,555,497 = 15 + 5,555,482`, but that does **not** identify which 15 are `duplicate`.

### From retained artifacts + basemap join

Artifacts (checksums verified):

| File | sha256 | Rows |
|------|--------|-----:|
| `tools/data-pipeline/direct-core/artifacts/buildings_national_2026_07_31/buildings.safe.csv` | `d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6` | 22,785 |
| `.../buildings.dry_run_manifest.csv` | `83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be` | 22,785 |

| Class | Artifact count | Present in basemap | Missing |
|-------|---------------:|-------------------:|--------:|
| `safe_new` | **22,703** | **22,703** | **0** |
| `safe_update` | **82** | **82** | **0** |
| **Approved total** | **22,785** | **22,785** | **0** |
| `duplicate` | 15 (counts only; no ID list in export) | n/a | n/a |
| `pmtiles_only` | 5,555,482 (counts only) | n/a | n/a |

Manifest and safe CSV identity sets are identical. All manifest rows are `final_readiness = ready`.

---

## 5. Safest recovery of the exact 22,785 approved rows

**Do not** rerun Stage 05 / national classify.

**Preferred (no DB restore):**

1. Use `buildings.safe.csv` (or the dry-run manifest for identity + class).
2. Optionally join to `basemap_source.buildings` on `external_id` if geometry/hash should come from the persistent archive.
3. Keep using CSV `building_type_id` / `admin_area_id` / names for Core mapping (already how direct-Core applied).

**Fallback:** restore only `basemap_source.buildings` from the pg_dump if the live table is damaged. Staging restore is **not** required for the approved Core set.

**Not available without extra work:** exact ID list of the 15 `duplicate` rows (not in safe export; staging cleaned; not found as a dedicated CSV in artifacts).

---

## 6. Quality of all 22,785 approved rows (joined to basemap)

Fast checks only (no full-table `ST_IsValid` on 5.5M):

| Check | Result |
|-------|--------|
| Stable identity (`way`/`relation` + `osm_id > 0`) | **0** bad |
| `external_id` present / unique join | **0** missing |
| `geom IS NULL` | **0** |
| `ST_IsEmpty(geom)` | **0** |
| Typmod MultiPolygon 4326 | **PASS** (column type) |
| Sample invalid (`id % 50 = 7` on approved join) | **0** |
| CSV `building_type_id` present | **22,785 / 22,785** |
| CSV `admin_area_id` present | **20,077 / 22,785** (**2,708** null — same known nullable set from apply) |

`buildings.safe.csv` also embeds `geom_ewkt` for every approved row (0 blank), so geometry is recoverable from the artifact even without basemap.

---

## Recommendation

| Need | Source |
|------|--------|
| Re-run / audit Core-eligible import | **`buildings.safe.csv` + manifest** (+ optional basemap join) |
| Full national basemap footprints for PMTiles | **`basemap_source.buildings`** |
| Split `duplicate` vs `pmtiles_only` by identity | **Not recoverable from basemap alone**; would need staging restore, raw reclassify, or a future labeled export |

## Final label

**GO_WITH_ARTIFACT** — exact `safe_new` + `safe_update` (22,785) are recoverable from retained checksummed exports; geometry/identity also present in `basemap_source.buildings`. Classification labels were intentionally not stored on the persistent table.
