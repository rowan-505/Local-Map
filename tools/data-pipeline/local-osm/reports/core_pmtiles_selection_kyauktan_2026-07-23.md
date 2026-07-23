# Core vs PMTiles selection — Kyauktan dry-run — 2026-07-23

**Snapshot:** `osm_myanmar_2026_05_15_kyauktan_v2` (local id 4)  
**Families:** buildings, landuse, water_lines, water_polygons  
**Script:** `tools/data-pipeline/local-osm/19_core_pmtiles_selection_dry_run.sql`  
**Policy:** [`docs/osm-core-vs-pmtiles-selection-policy.md`](../../../docs/osm-core-vs-pmtiles-selection-policy.md)  
**Production load:** **not run** (no core loaders enabled)

## Verdict

**PASS** — selection fields assigned; Stage 08b sets `pmtiles_only` for non-core-eligible rows; gate confirms no PMTiles-only row has direct-core or Import Review conflict classes.

---

## Grand totals

| Metric | Count |
|--------|------:|
| total normalized | **1501** |
| core eligible | **60** |
| PMTiles only | **1441** |
| invalid | **0** |
| import_class direct-core (`safe_new`/`safe_update`) | **43** |
| import_class IR conflict | **17** |
| import_class `pmtiles_only` | **1441** |

Core eligible (60) = direct-core (43) + IR conflict (17). All non-eligible rows are `pmtiles_only`.

---

## By family

| Family | total normalized | core eligible | PMTiles only | invalid | direct-core class | IR conflict class | `pmtiles_only` class |
|--------|-----------------:|--------------:|-------------:|--------:|------------------:|------------------:|---------------------:|
| buildings | 1402 | 47 | 1355 | 0 | 34 | 13 | 1355 |
| landuse | 59 | 3 | 56 | 0 | 0 | 3 | 56 |
| water_lines | 26 | 6 | 20 | 0 | 6 | 0 | 20 |
| water_polygons | 14 | 4 | 10 | 0 | 3 | 1 | 10 |

---

## Selection reasons by count

### Buildings (core)

| Reason | n |
|--------|--:|
| hospital_or_clinic | 22 |
| named_building | 19 |
| linked_to_important_place | 4 |
| government_building | 1 |
| school_or_university | 1 |

### Buildings (PMTiles)

| Reason | n |
|--------|--:|
| unnamed_ordinary_building | 1355 |

### Landuse (core)

| Reason | n |
|--------|--:|
| named_industrial_zone | 2 |
| named_park_or_public_zone | 1 |

### Landuse (PMTiles)

| Reason | n |
|--------|--:|
| ordinary_residential_landuse | 39 |
| ordinary_basemap_geometry | 9 |
| ordinary_industrial_landuse | 8 |

### Water lines (core)

| Reason | n |
|--------|--:|
| important_ferry_or_navigation | 4 |
| named_river | 1 |
| named_water_feature | 1 |

### Water lines (PMTiles)

| Reason | n |
|--------|--:|
| unnamed_small_water | 20 |

### Water polygons (core)

| Reason | n |
|--------|--:|
| major_reservoir | 3 |
| named_water_feature | 1 |

### Water polygons (PMTiles)

| Reason | n |
|--------|--:|
| unnamed_small_water | 10 |

---

## Gate check

| Check | Result |
|-------|--------|
| PMTiles-only rows with `safe_*` or IR conflict `import_class` | **0** |
| Status | **PASS** |

---

## How to re-run

```bash
psql "$LOCAL_DATABASE_URL" \
  -v snapshot_version='osm_myanmar_2026_05_15_kyauktan_v2' \
  -v staging_schema='staging' \
  -v entity_families='buildings,landuse,water_lines,water_polygons' \
  -v prod_mirror_schema='prod_mirror' \
  -f tools/data-pipeline/local-osm/19_core_pmtiles_selection_dry_run.sql
```

Log: `tools/data-pipeline/local-osm/logs/core_pmtiles_selection_kyauktan_dry_run.log`
