---
status: archived
reason: replaced by docs/archive/old-docs/tiles/boundary-source-inspection.md
archived_at: 2026-07-01
---

# Boundary Source Inspection

**Date:** 2026-06-05  
**Scope:** Public web map (`apps/web`) composed style — overview + regional Yangon PMTiles.  
**Method:** Code/style inspection, PMTiles metadata (`pmtiles show --metadata`), env URLs. No styling changes were made.

---

## Visual problem

Around **Yangon coast**, **Ayeyarwady delta**, **Mon/Kayin**, and **Rakhine/Tanintharyi coast**, the **purple Myanmar country outline** does not sit on the visible land/water edge. Typical symptoms:

- Boundary line offset from the blue water / beige land fill
- Thick purple fragments along inlets, islands, and river mouths
- At medium zoom (z6–8), boundary and coastline/water disagree in the same viewport

This is a **geometry / dataset alignment** issue, not a color choice issue.

---

## Runtime MapLibre sources

The public web app builds style in `apps/web/src/features/map/config/basemapStyle.ts` → `composeWebMapStyle(regionalStyle, overviewUrl)`.

| Source id | Type | URL (runtime) | Origin |
|-----------|------|---------------|--------|
| `overview` | vector PMTiles | `pmtiles://{VITE_OVERVIEW_PMTILES_URL}` | Overview archive (NE + MIMU) |
| `local-basemap` | vector PMTiles | `pmtiles://{VITE_BASEMAP_PMTILES_URL}` or `current.json` | Yangon regional archive (OSM/core via PostGIS) |
| `background` | background | n/a | Style JSON only |
| API GeoJSON overlays | geojson | API | POIs, routes, search — **not** basemap boundaries |

### Env URLs observed in repo

| Env var | `apps/web/.env` (default) | `apps/web/.env.local` (dev override) |
|---------|---------------------------|--------------------------------------|
| `VITE_OVERVIEW_PMTILES_URL` | `https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/overview/v1/myanmar-overview-v1.pmtiles` | `http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles` |
| `VITE_BASEMAP_PMTILES_URL` | `https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v1/basemap.pmtiles` | same R2 URL |

Vite loads `.env.local` over `.env` in development.

**Dashboard** (`apps/dashboard/src/components/map/dashboardBasemapStyle.ts`) uses **regional `base-map.json` only** (no overview compose). Not the primary path for the reported public-map issue.

---

## Runtime layer table (composed web map)

Layers below are from `createOverviewLayers()` (`overviewBasemap.ts`) + `base-map.json`, after `patchOverviewLayersForProgressiveDetail` / `patchRegionalLayersForProgressiveDetail` (`basemapZoomVisibility.ts`).

Paint order (bottom → top): `background` → **overview** layers → **regional** layers → API overlays.

### Overview source (`overview` PMTiles)

| layer_id | type | source | source-layer | filter (summary) | minzoom | maxzoom (runtime) | paint summary | dataset |
|----------|------|--------|--------------|------------------|---------|-------------------|---------------|---------|
| `overview-ocean` | fill | overview | `ocean` | none | 0 | 9 | `#b8ddea` opacity 1 | Natural Earth `ne_10m_ocean` |
| `overview-land` | fill | overview | `land` | none | 0 | 9 | `#e8ebe0` opacity 1 | Natural Earth `ne_10m_land` |
| `overview-lakes` | fill | overview | `lakes` | scalerank / min_zoom | 6 | 9 | `#c5dde8` faded | Natural Earth `ne_10m_lakes` |
| `overview-rivers` | line | overview | `rivers` | scalerank / min_zoom | 6 | 9 | `#9cc6d8` thin | Natural Earth `ne_10m_rivers_lake_centerlines` |
| `overview-countries-fill` | fill | overview | `countries` | none | 0 | **9→patched 9** | `#e4e2dc` low opacity | Natural Earth `ne_10m_admin_0_countries` |
| `overview-mmr-admin1-fill` | fill | overview | `mmr_admin1` | none | 4 | **9→patched 9** | tinted by `PCode_V` | **MIMU** admin1 polygons |
| `overview-coastline` | line | overview | `coastline` | none | 5 | **9→patched 9** | `#8fb8c8` thin | Natural Earth `ne_10m_coastline` |
| `neighbor-country-boundary-line` | line | overview | `country_boundaries` | excludes MMR segments | 0 | **9→patched 9** | `#c8ccd2` opacity 0.45 | Natural Earth `ne_10m_admin_0_boundary_lines_land` |
| `myanmar-internal-admin-boundary-line` | line | overview | `mmr_admin1` | none | 4 | **9→patched 9** | `#b9bec5` opacity 0.25–0.4 | **MIMU** admin1 polygon rings |
| `myanmar-admin0-boundary-casing` | line | overview | **`mmr_country_highlight`** | ADM0/ISO = MMR | 0 | **9→patched 9** | `#ffffff` halo, width 2.2–4.0 | **NE admin0 countries** (intended) |
| **`myanmar-admin0-boundary-line`** | line | overview | **`mmr_country_highlight`** | ADM0/ISO = MMR | 0 | **9→patched 9** | **`#5b4b78` opacity 1, width 1.4–3.0** | **NE admin0 countries** (intended) |
| `overview-country-labels` | symbol | overview | `countries` | not MMR; LABELRANK | 4 | 6.5 | `#4a5568` text | Natural Earth countries |
| `overview-mmr-admin1-labels` | symbol | overview | `mmr_admin1` | ST/SR not empty | 5.5 | 10 (patched) | `#5c5670` text | **MIMU** admin1 |
| `overview-populated-places` | symbol | overview | `populated_places` | major cities | 7 | 10 (patched) | `#3d4a5c` text | Natural Earth places |

### Regional source (`local-basemap` PMTiles)

| layer_id | type | source | source-layer | filter (summary) | minzoom | maxzoom | paint summary | dataset |
|----------|------|--------|--------------|------------------|---------|---------|---------------|---------|
| `background` | background | — | — | — | 0 | ∞ | `#f3f4f1` | style only |
| `landuse` | fill | local-basemap | `landuse` | none | **8→patched 7** | ∞ | green tint | OSM → `tiles_landuse_v` |
| `water-polygons` | fill | local-basemap | `water_polygons` | none | **0→patched 7** | ∞ | `#b8ddea` opacity 0.9 | OSM → `tiles_water_polygons_v` |
| `water-lines` | line | local-basemap | `water_lines` | none | **9→patched 7** | ∞ | `#9ccfe1` | OSM → `tiles_water_lines_v` |
| `admin-boundaries` | line | local-basemap | `admin_boundaries` | not village unless official | **8→patched 7** | ∞ | `#b8bcb6` dashed, subtle | **core** `tiles_admin_boundaries_v` ← `core.core_admin_areas` |
| (+ road/building/label layers) | line/symbol | local-basemap | `streets`, etc. | tier filters | 8–15+ | ∞ | warm road stack | OSM streets |

---

## Purple Myanmar boundary layer

| Field | Value |
|-------|-------|
| **Exact layer id (purple stroke)** | `myanmar-admin0-boundary-line` |
| **Companion halo layer** | `myanmar-admin0-boundary-casing` (white, not purple) |
| **Exact MapLibre source** | `overview` |
| **Exact source-layer in style** | **`mmr_country_highlight`** |
| **Exact filter** | `any(ADM0_A3=MMR, ISO_A3=MMR, ISO_A2=MM)` — see `OVERVIEW_MMR_ADMIN0_BOUNDARY_FILTER` in `packages/map-style/overviewConstants.ts` |
| **Exact paint** | `line-color: #5b4b78`, `line-opacity: 1`, width interpolate z0=1.4 → z6=3.0 |
| **Style definition files** | `packages/map-style/overview-map.json`, `apps/web/src/features/map/lib/maplibre/overviewBasemap.ts` (`mmrCountryHighlightLayer`) |
| **Intended dataset origin** | Natural Earth `ne_10m_admin_0_countries` clipped to MMR → `mmr_country_highlight.geojsonseq` → tippecanoe layer `mmr_country_highlight` |

### Identification without style edits

`overviewBasemap.ts` logs at dev startup:

```text
[map] Myanmar admin0 outer boundary: myanmar-admin0-boundary-line (casing: myanmar-admin0-boundary-casing, source-layer: mmr_country_highlight)
```

Constants: `OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_LAYER_ID`, `OVERVIEW_MMR_ADMIN0_BOUNDARY_LINE_COLOR = '#5b4b78'`.

No temporary red-color test was applied (inspection-only).

---

## Land/water basemap layers

### Low–medium zoom (z4–8) — overview dominates land/ocean color

| Role | layer_id | source | source-layer | Dataset origin |
|------|----------|--------|--------------|----------------|
| Ocean fill | `overview-ocean` | overview | `ocean` | Natural Earth `ne_10m_ocean` |
| Land fill | `overview-land` | overview | `land` | Natural Earth `ne_10m_land` |
| Coast stroke | `overview-coastline` | overview | `coastline` | Natural Earth `ne_10m_coastline` |
| Country tint | `overview-countries-fill` | overview | `countries` | Natural Earth admin0 countries (all countries in bbox) |
| State tint | `overview-mmr-admin1-fill` | overview | `mmr_admin1` | MIMU state/region polygons |

### Regional zoom (z7+) — OSM water appears under/over NE overview

| Role | layer_id | source | source-layer | Dataset origin |
|------|----------|--------|--------------|----------------|
| Water fill | `water-polygons` | local-basemap | `water_polygons` | OSM water → PostGIS `tiles.tiles_water_polygons_v` |
| Water lines | `water-lines` | local-basemap | `water_lines` | OSM → `tiles.tiles_water_lines_v` |
| Land tint | `landuse` | local-basemap | `landuse` | OSM landuse → `tiles.tiles_landuse_v` |
| Background | `background` | — | — | flat `#f3f4f1` (no regional land polygon fill) |

**Important:** Regional Yangon PMTiles has **no dedicated land polygon layer**. Land appearance at z7+ is `background` + optional `landuse`, while water is detailed OSM. Overview **NE land/ocean fills remain visible until overview boundary maxzoom (9)** while regional water starts at z7 — **mixed datasets in the same zoom band**.

---

## Admin1 / internal boundaries

| layer_id | When visible | source-layer | Dataset |
|----------|--------------|--------------|---------|
| `myanmar-internal-admin-boundary-line` | overview z4–8 (maxzoom patched 9) | `mmr_admin1` | **MIMU** state/region polygon outlines |
| `admin-boundaries` | regional z7+ (minzoom patched 7) | `admin_boundaries` | **core** `core.core_admin_areas` via `tiles.tiles_admin_boundaries_v` (levels: `country`, `state_region`, `district`, `township`, `ward_village_tract`) |

At z7–8 **both** MIMU internal lines (overview) and core/OSM admin lines (regional) can be active.

---

## Labels

| layer_id | source-layer | Dataset | Zoom |
|----------|--------------|---------|------|
| `overview-country-labels` | `countries` | Natural Earth (neighbors only; MMR excluded) | z4–6.5 |
| `overview-mmr-admin1-labels` | `mmr_admin1` | MIMU `ST` / `ST_MMR` names | z5.5–10 (fades) |
| `overview-populated-places` | `populated_places` | Natural Earth major cities | z7–10 |
| Regional road/place labels | `road_labels`, etc. | OSM | z10+ per `base-map.json` |

---

## PMTiles metadata — style vs tiles mismatch (critical)

### Local archive (rebuilt on disk)

**Path:** `infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles`  
**Served at:** `http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles` (when `tiles:serve` running)

**Vector layers present:**

```text
coastline, countries, country_boundaries, lakes, land, mmr_admin0_overview, mmr_admin1, ocean, populated_places, rivers
```

**Not present:** `mmr_country_highlight` (what the style expects for the purple line).

Local build `generator_options` includes `mmr_admin0_overview` from land-aligned NE export (artifact newer than committed `build-overview.sh`, which still lists `mmr_country_highlight`).

### Production R2 archive

**URL:** `https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/overview/v1/myanmar-overview-v1.pmtiles`

**Vector layers present:**

```text
coastline, countries, country_boundaries, lakes, land, mmr_admin0, mmr_admin1, ocean, populated_places, rivers
```

**Not present:** `mmr_country_highlight`.

R2 `generator_options` shows:

```text
-L mmr_admin0:infrastructure/tiles/data/processed/mimu/mmr_admin0.geojsonseq
```

So production tiles embed **MIMU admin0**, while runtime style references **`mmr_country_highlight` (Natural Earth)**. The purple MapLibre layers bind to a **non-existent source-layer** in both local and R2 archives.

### Registry drift

`infrastructure/tiles/pmtiles/overview/current.json` lists `mmr_country_highlight`.  
`docs/tiles/overview-pmtiles-qa.md` expects `mmr_admin0` + `mmr_admin1`.  
`packages/map-style/overviewConstants.ts` `OVERVIEW_PMTILES_SOURCE_LAYERS` expects `mmr_country_highlight`.

Three different naming/build conventions are active across docs, registry, style, and deployed tiles.

---

## Tile build source chain

### Overview PMTiles

| Output source-layer | Build script chain | Upstream dataset |
|---------------------|-------------------|------------------|
| `land` | `clip-natural-earth-overview.sh` → `build-overview.sh` | NE `ne_10m_land` |
| `ocean` | same | NE `ne_10m_ocean` |
| `coastline` | same | NE `ne_10m_coastline` |
| `countries` | same | NE `ne_10m_admin_0_countries` (all countries in bbox) |
| `country_boundaries` | same | NE `ne_10m_admin_0_boundary_lines_land` |
| `lakes`, `rivers`, `populated_places` | same | NE 10m layers |
| `mmr_country_highlight` | `clip-natural-earth-overview.sh` (ogr2ogr MMR filter on NE countries) → `build-overview.sh` | NE **political** admin0 polygon |
| `mmr_admin0` | older/alternate build (on **R2**) | **MIMU** `mimu/mmr_admin0.geojsonseq` |
| `mmr_admin0_overview` | alternate local build (land-aligned script, not in committed `build-overview.sh`) | NE **land** ∩ MMR mask |
| `mmr_admin1` | `build-overview.sh` | **MIMU** `mimu/mmr_admin1.geojsonseq` |

**npm scripts:** `tiles:rebuild:overview` → `clip-natural-earth-overview.sh` + `build-overview.sh`  
**Removed:** `export-overview-core.sh` / `tiles.tiles_overview_mmr_admin0_outline_v` (dropped in migration `093_drop_overview_mmr_admin0_outline.sql`).

### Regional Yangon PMTiles

| Output source-layer | Build script chain | Upstream dataset |
|---------------------|-------------------|------------------|
| `water_polygons`, `water_lines` | `export-region.sh` → `build-region.sh` | PostGIS `tiles.tiles_water_polygons_v` / `tiles_water_lines_v` (OSM) |
| `admin_boundaries` | same | PostGIS `tiles.tiles_admin_boundaries_v` ← `core.core_admin_areas` |
| `landuse`, `streets`, `buildings`, … | same | PostGIS `tiles.*_v` views (OSM/core) |

---

## Root cause

**Primary: different datasets for boundary vs land/water geometry**

Even when `mmr_country_highlight` tiles exist, the purple line uses Natural Earth **`ne_10m_admin_0_countries`** (political/admin polygon), while land/water/coast use **`ne_10m_land`**, **`ne_10m_ocean`**, and **`ne_10m_coastline`**. These are **different Natural Earth products** with different shoreline generalization. They will not match exactly around deltas, islands, and complex coast (Yangon, Ayeyarwady, Rakhine, Mon/Kayin, Tanintharyi).

**Secondary: style ↔ PMTiles source-layer mismatch (deployment)**

| Component | Expected source-layer |
|-----------|----------------------|
| Style (`myanmar-admin0-boundary-line`) | `mmr_country_highlight` |
| R2 PMTiles | `mmr_admin0` (MIMU) |
| Local rebuilt PMTiles on disk | `mmr_admin0_overview` |

The purple layers target a layer name **missing from deployed archives**. Depending on cache/build history, the visible outline may be absent, wrong, or from other layers (MIMU admin1 rings, NE coastline, regional admin).

**Tertiary: duplicate boundaries + zoom overlap (z7–8)**

`basemapZoomVisibility.ts` sets overview boundary `maxzoom: 9` while regional `water-polygons` and `admin-boundaries` start at **z7**. Between z7 and z8:

- NE overview land/ocean fills and purple/MIMU boundary lines can still draw
- OSM water polygons and core admin boundaries also draw
- **Natural Earth + MIMU + OSM/core** mix in one viewport → visible mismatch

**Contributing factors**

| Factor | Present? |
|--------|----------|
| Different datasets (NE land vs NE/MIMU/OSM boundary) | **Yes** |
| Over-detailed geometry (admin0 multipolygon islands) | **Yes** (NE countries / MIMU polygons) |
| Duplicate boundary layers at same zoom | **Yes** (z7–8 overview + regional) |
| Wrong zoom handoff | **Partial** (regional starts z7; overview boundaries end z9) |
| Wrong layer order | Unlikely primary cause |
| Stale / wrong deployed PMTiles URL | **Yes** (layer name drift local vs R2 vs style) |
| Style source-layer ≠ tile layer | **Yes** |

---

## Resolution (2026-06-05, updated high-precision tiers)

Implemented in codebase:

- **High-precision zoom tiers:** `mmr_admin0_z0_2` (0.03°), `mmr_admin0_z3_4` (0.015°), `mmr_admin0_z5_6` (0.005°) from NE land ∩ Myanmar mask.
- Dissolved union vertex counts: **4602** raw → **645 / 1148 / 2284** per tier (replaces legacy single `mmr_admin0_overview` at ~342 verts with 0.1° simplify).
- Boundary tippecanoe pass: `--no-line-simplification --full-detail=8` (separate from base `--simplification=10` pass).
- `myanmar-admin0-boundary-line` / `myanmar-admin0-boundary-casing` use `maxzoom: 7` (visible z0–z6 only).
- `OVERVIEW_BOUNDARY_MAX_ZOOM = 7` for all other overview boundary/coastline/MIMU internal lines.
- Regional `admin-boundaries` country/state_region only at z7+ with subtle `#9b91aa` paint.
- `mmr_country_highlight` remains clip-time mask only; not packaged in PMTiles.
- Validation: `validate-overview-pmtiles-metadata.py` + extended `tiles:verify:overview`.

**Deploy:** rebuild overview PMTiles and upload to R2 so production matches style.

---

## Recommended fix (pre-implementation notes)

*Superseded by Resolution above.*

1. **Pick one Myanmar admin0 geometry per zoom band**
   - **z0–z6:** single simplified outline derived from the **same NE land** source as `overview-land` / `overview-ocean` (not `ne_10m_admin_0_countries`, not MIMU).
   - **z7+:** thin **regional** `admin_boundaries` (`country` / `state_region`) from OSM/core only; hide all overview boundary lines.

2. **Align style `source-layer` with PMTiles**
   - Rename tippecanoe layer and MapLibre `source-layer` together (`mmr_country_highlight` vs `mmr_admin0` vs `mmr_admin0_overview`).
   - Update `OVERVIEW_PMTILES_SOURCE_LAYERS`, `current.json`, QA docs, and upload matching archive to R2.

3. **Fix zoom handoff**
   - End overview Myanmar boundary at **z6** (`maxzoom: 7`).
   - Start regional water/admin at **z7** (already patched).
   - Avoid drawing NE purple boundary on top of OSM water at z7–8.

4. **Remove duplicate admin0 sources**
   - One overview admin0 layer only; remove casing+detail duplicates if still present.
   - Do not ship MIMU `mmr_admin0` in overview tiles if style uses NE land-aligned outline.

5. **Verification checklist after fix**
   - `pmtiles show --metadata` vector_layers matches every `source-layer` in `overviewBasemap.ts`
   - `npm run test:overview-style` + `cd apps/web && npm run test:map`
   - Visual pass: Yangon coast, Ayeyarwady delta, Rakhine, Mon/Kayin border, Tanintharyi at z4, z6, z8

---

## Files inspected

- `packages/map-style/base-map.json`
- `packages/map-style/overview-map.json`
- `packages/map-style/overviewConstants.ts`
- `apps/web/src/features/map/lib/maplibre/overviewBasemap.ts`
- `apps/web/src/features/map/lib/maplibre/composeWebMapStyle.ts`
- `apps/web/src/features/map/lib/maplibre/basemapZoomVisibility.ts`
- `apps/web/src/features/map/config/basemapStyle.ts`
- `apps/web/src/features/map/config/overviewPmtilesUrl.ts`
- `apps/web/.env`, `apps/web/.env.local`
- `infrastructure/tiles/scripts/clip-natural-earth-overview.sh`
- `infrastructure/tiles/pmtiles/scripts/build-overview.sh`
- `infrastructure/tiles/pmtiles/scripts/export-region.sh`
- `infrastructure/tiles/pmtiles/overview/current.json`
- PMTiles: local `myanmar-overview-v1.pmtiles` and R2 production URL (metadata via `pmtiles show --metadata`)
