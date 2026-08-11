# OSM core vs PMTiles selection policy

**Status:** Local selection and classification policy implemented; direct-Core
imports remain regional, family-specific, and explicitly authorized. National /
full-city loads remain **disabled**.
**Related:** Production Baseline v1, V2 map architecture (PostGIS = truth, PMTiles = rendering), Stage 05→08b classification.  
**Contract:** `tools/data-pipeline/direct-core/README.md`
**Historical pilots:** retained under the retired loader reports directory as
evidence only; those commands are not current architecture.

---

## 1. Purpose

Decide which OSM **buildings**, **water**, and **landuse** records may enter Supabase **core** (searchable / reviewable entities) versus remaining **PMTiles-only** basemap geometry.

This prevents bulk unnamed footprints and ordinary farmland/forest/residential polygons from flooding `core.*` or Import Review.

---

## 2. Architecture reminder

```text
PostgreSQL / PostGIS  = source of truth for important entities
Fastify API           = business logic
PMTiles + MapLibre    = rendering only
Import Review         = human decisions for core-eligible conflicts only
```

Important data must not live only in tiles. Ordinary visual basemap geometry must not live in core.

---

## 3. Core-eligible (search / detail / Import Review path)

### Buildings → `core.core_map_buildings` (when loaders are enabled later)

| Rule | `core_selection_reason` |
|------|-------------------------|
| Has a real name | `named_building` |
| Hospital / clinic | `hospital_or_clinic` |
| School / university | `school_or_university` |
| Government / civic | `government_building` |
| Station / terminal | `station_or_terminal` |
| Market | `market` |
| Landmark / religious / historic / major tourism | `important_landmark` |
| Other important public / civic building types | `important_public_building` |
| Footprint linked to an important CoreMap place (≤30 m, or same name ≤75 m) | `linked_to_important_place` |

### Water → `core.core_map_water_lines` / `core.core_map_water_polygons`

| Rule | `core_selection_reason` |
|------|-------------------------|
| Named river / stream | `named_river` |
| Named lake | `named_lake` |
| Named (major) reservoir | `major_reservoir` |
| Named canal | `important_canal` |
| Ferry / navigation signals | `important_ferry_or_navigation` |
| Other named water feature | `named_water_feature` |

### Landuse → `core.core_map_landuse`

| Rule | `core_selection_reason` |
|------|-------------------------|
| Named park / public leisure zone | `named_park_or_public_zone` |
| Protected area | `protected_area` |
| Named campus / education / healthcare / religious / civic zone | `named_campus_or_public_zone` |
| Named industrial zone | `named_industrial_zone` |
| Other clearly useful named searchable area | `named_searchable_area` |

Named ordinary farmland / forest / residential stays **PMTiles-only** (name alone is not enough for those classes).

---

## 4. PMTiles only (basemap; never Import Review)

| Geometry | `pmtiles_only_reason` |
|----------|----------------------|
| Ordinary unnamed building footprints | `unnamed_ordinary_building` |
| Ordinary farmland / paddy / orchard | `ordinary_farmland` |
| Ordinary forest / wood | `ordinary_forest` |
| Ordinary residential landuse | `ordinary_residential_landuse` |
| Ordinary industrial landuse (unnamed) | `ordinary_industrial_landuse` |
| Unnamed small water | `unnamed_small_water` |
| Other bulk visual basemap geometry | `ordinary_basemap_geometry` |

---

## 5. Staging fields (local)

On `staging_building_candidates`, `staging_landuse_candidates`, `staging_water_line_candidates`, `staging_water_polygon_candidates`:

| Column | Type | Meaning |
|--------|------|---------|
| `eligible_for_core` | boolean | May continue to direct-core / IR conflict classification |
| `core_selection_reason` | text | Why core-eligible (null if not) |
| `pmtiles_only_reason` | text | Why PMTiles-only (null if not) |

Assigned in **Stage 05c** (`pipeline_stage05c_core_pmtiles_selection.sql`) after validation.

---

## 6. Classification gate (Stage 08b)

For buildings / landuse / water_*:

```text
if validation invalid → import_class = invalid
else if eligible_for_core = false → import_class = pmtiles_only
else → normal F2 / settlement-aware decide (safe_new, safe_update, conflict, …)
```

| `import_class` | Direct core | Import Review |
|----------------|-------------|---------------|
| `safe_new` / `safe_update` | yes, validated regional direct-Core only | no |
| IR conflict classes | no | yes |
| `pmtiles_only` | **no** | **no** |
| `invalid` | no | no |

Stage J packages only IR conflict classes; `pmtiles_only` is excluded.

Reconciliation (Stage 18):

```text
valid = safe_new + safe_update + unchanged + duplicate + conflict
      + manual_protected + verified_conflict + pmtiles_only
```

---

## 7. Implementation map

| File | Role |
|------|------|
| `tools/data-pipeline/local-osm/pipeline_core_pmtiles_selection.sql` | Selection functions |
| `tools/data-pipeline/local-osm/pipeline_stage05c_core_pmtiles_selection.sql` | Assign fields |
| `tools/data-pipeline/local-osm/05_raw_to_staging.sql` | Includes 05c after 05b |
| `tools/data-pipeline/local-osm/08b_assign_import_class.sql` | Forces `pmtiles_only` |
| `tools/data-pipeline/local-osm/11_prepare_remote_review_package.sql` | Counts `pmtiles_only` in assertions |
| `tools/data-pipeline/local-osm/18_classification_bucket_report.sql` | Includes `pmtiles_only` |
| `tools/data-pipeline/local-osm/19_core_pmtiles_selection_dry_run.sql` | Kyauktan dry-run |

---

## 8. Explicit non-goals

- No national / full-Yangon bulk load of ordinary footprints into core
- No PMTiles rebuild in this policy task
- Places / roads / admin are out of this filter scope (already curated differently)
- Ordinary farmland / forest / residential / unnamed water stay PMTiles-only forever in V2 loaders

---

## 9. Dry-run evidence

See: `tools/data-pipeline/local-osm/reports/core_pmtiles_selection_kyauktan_2026-07-23.md`
