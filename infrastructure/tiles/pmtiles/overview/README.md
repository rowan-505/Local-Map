# Myanmar overview PMTiles

Low-zoom, Myanmar-centered basemap for the public web map. **Natural Earth + MIMU only** — no OSM, no routing graph, no POIs.

**Local dev quick start:** [docs/tiles/pmtiles/overview-local-dev.md](../../../../docs/tiles/pmtiles/overview-local-dev.md)

---

## 1. Purpose

Overview PMTiles provide **national context at low zoom only** (z0–z8):

- Frame **Myanmar** and neighboring countries at country / state-region scale.
- Show **admin boundaries and labels** suitable for a clean overview map.
- **Do not** replace regional PMTiles (Yangon, Mandalay, …) used for OSM-level detail.

**Included:** Natural Earth 1:10m layers + MIMU Myanmar admin0/admin1.

**Excluded by design:**

- OSM roads, buildings, landuse polygons from PostGIS
- POIs, bus routes, transit, or search index data
- Routing / Valhalla graph data
- Admin2, admin3, township, or village detail

Search, directions, POI markers, and live edits remain **API + GeoJSON overlays** in the web app.

---

## 2. Source data

### Natural Earth (1:10m, clipped to overview bbox)

Downloaded manually into `infrastructure/tiles/data/natural-earth/unzipped/`, then clipped to GeoJSONSeq under `data/processed/natural-earth/clipped/`.

| PMTiles `source-layer` | Natural Earth source |
|------------------------|----------------------|
| `land` | `ne_10m_land` |
| `ocean` | `ne_10m_ocean` |
| `coastline` | `ne_10m_coastline` |
| `countries` | `ne_10m_admin_0_countries` |
| `country_boundaries` | `ne_10m_admin_0_boundary_lines_land` |
| `populated_places` | `ne_10m_populated_places` |
| `lakes` | `ne_10m_lakes` |
| `rivers` | `ne_10m_rivers_lake_centerlines` |

Clip script (repo root):

```bash
bash infrastructure/tiles/scripts/clip-natural-earth-overview.sh
```

Overview bbox (WGS84): **75°E–115°E, 0°N–36°N** (Myanmar-centered, includes neighbors).

### MIMU (Myanmar admin boundaries)

Processed GeoJSONSeq (not clipped by the Natural Earth script):

| PMTiles `source-layer` | Description |
|------------------------|-------------|
| `mmr_admin0` | Myanmar country outline |
| `mmr_admin1` | State / region polygons |

Expected paths:

```text
infrastructure/tiles/data/processed/mimu/mmr_admin0.geojsonseq
infrastructure/tiles/data/processed/mimu/mmr_admin1.geojsonseq
```

Source shapefiles typically live under `data/mimu/unzipped/` (gitignored). There is **no** checked-in MIMU export script yet — produce GeoJSONSeq with `ogr2ogr` from the MIMU 250k admin layers, reusing the same overview bbox if you need to trim extent.

**Not in overview tiles:** MIMU admin2/admin3 (district/township) — keep those out of the tippecanoe build.

---

## 3. Local ignored data folder

`infrastructure/tiles/data/` is **gitignored** (see root `.gitignore`).

Do **not** commit:

- Downloaded ZIPs (`*.zip`, …)
- Unzipped shapefiles (`**/unzipped/**`, `*.shp`, …)
- Processed intermediates (`**/processed/**`, `*.geojsonseq`, …)
- Scratch / cache directories

Committed artifacts in this area: **`data/README.md`** and **`data/.gitkeep`** only.

---

## 4. PMTiles output

**Canonical path** (matches `current.json` and local static server URLs):

```text
infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles
```

Pointer file (committed):

```text
infrastructure/tiles/pmtiles/overview/regions/current.json
```

The `.pmtiles` file is a **generated binary** — `*.pmtiles` is gitignored. Copy or rebuild locally; upload to object storage for deployment (URL placeholder: `https://<your-cdn>/overview/regions/myanmar-overview-v1.pmtiles`).

---

## 5. Build overview

There is **no** `npm run tiles:rebuild:overview` yet. Overview builds use the same tools as regional PMTiles: **GDAL**, **tippecanoe**, optional **pmtiles** CLI.

### Prerequisites

```bash
# macOS example
brew install gdal tippecanoe pmtiles
```

Also: **Node/npx** (for `npm run tiles:serve`).

### Steps (from repo root)

**1. Natural Earth — clip to overview bbox**

Place Natural Earth 1:10m shapefiles under `infrastructure/tiles/data/natural-earth/unzipped/` (layer folder names must match the clip script), then:

```bash
bash infrastructure/tiles/scripts/clip-natural-earth-overview.sh
```

Outputs: `infrastructure/tiles/data/processed/natural-earth/clipped/*.geojsonseq`

**2. MIMU — admin0 / admin1 GeoJSONSeq**

Ensure `mmr_admin0.geojsonseq` and `mmr_admin1.geojsonseq` exist under `infrastructure/tiles/data/processed/mimu/`.

**3. tippecanoe — vector tiles z0–z8**

```bash
mkdir -p infrastructure/tiles/pmtiles/overview/regions

tippecanoe \
  -o infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles \
  -Z0 -z8 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  -L land:infrastructure/tiles/data/processed/natural-earth/clipped/land.geojsonseq \
  -L ocean:infrastructure/tiles/data/processed/natural-earth/clipped/ocean.geojsonseq \
  -L coastline:infrastructure/tiles/data/processed/natural-earth/clipped/coastline.geojsonseq \
  -L countries:infrastructure/tiles/data/processed/natural-earth/clipped/countries.geojsonseq \
  -L country_boundaries:infrastructure/tiles/data/processed/natural-earth/clipped/country_boundaries.geojsonseq \
  -L populated_places:infrastructure/tiles/data/processed/natural-earth/clipped/populated_places.geojsonseq \
  -L lakes:infrastructure/tiles/data/processed/natural-earth/clipped/lakes.geojsonseq \
  -L rivers:infrastructure/tiles/data/processed/natural-earth/clipped/rivers.geojsonseq \
  -L mmr_admin0:infrastructure/tiles/data/processed/mimu/mmr_admin0.geojsonseq \
  -L mmr_admin1:infrastructure/tiles/data/processed/mimu/mmr_admin1.geojsonseq
```

Layer names after `-L` become MapLibre **`source-layer`** ids — they must match `packages/map-style/overview-map.json`.

**4. Verify locally**

```bash
npm run tiles:verify:overview
npm run tiles:serve
```

Regional PostGIS basemaps use `npm run tiles:rebuild -- <region> <version>` — that pipeline is **separate** and must not be mixed into overview layers.

### Style validation (CI / local)

```bash
npm run test:overview-style
```

Pure Node tests in `packages/map-style/overviewStyleValidation.test.ts` verify `source-layer` names, layer order, and no OSM layers in `overview-map.json`.

**Manual visual QA:** [docs/tiles/overview-pmtiles-qa.md](../../../../docs/tiles/overview-pmtiles-qa.md) · **Web integration:** [docs/tiles/overview-web-integration-qa.md](../../../../docs/tiles/overview-web-integration-qa.md)

---

## 6. Runtime behavior

| Zoom | Basemap |
|------|---------|
| **z0–z8** | Overview PMTiles only (`overview` vector source) |
| **z9+** (planned) | Regional PMTiles for visible state/region + optional adjacent regions |

Current web app (overview dev mode):

- Loads overview style when `VITE_MAP_BASEMAP=overview` (see local dev doc).
- Viewport locked to overview coverage (`MYANMAR_OVERVIEW_*` constants in `@local-map/map-style/overviewConstants`).
- POI/search/directions overlays still come from the **API** above the basemap.

**No OSM** appears in the overview archive or overview MapLibre style. Regional OSM-derived layers load only from **regional** PMTiles when that zoom handoff is implemented.

---

## 7. Styling rules

MapLibre style: **`packages/map-style/overview-map.json`**

Vector source id: **`overview`**

Layer stack (bottom → top):

1. Ocean, land
2. Lakes, rivers (z6+ only, rank-filtered)
3. Country fill (subtle neutral)
4. Myanmar admin1 fill (z4+, hue by `PCode_V`)
5. Coastline (z5+)
6. Country boundaries, Myanmar admin0 outline, admin1 boundaries
7. Country labels (stepped `LABELRANK`; hide `TINY` countries at low zoom)
8. Admin1 labels (z4+, `ST_MMR` / `ST`)
9. Major populated places (z5+; capitals / `SCALERANK` filter)

**Neighbor countries:** fill + boundaries + country names only — no admin1 detail outside Myanmar.

**Myanmar:** admin0 outline + admin1 polygons, boundaries, and labels.

Filter constants (shared with style JSON): `packages/map-style/overviewConstants.ts`

---

## 8. Troubleshooting

### Missing or empty layers

- **`source-layer` mismatch** — tippecanoe `-L name:path` must match style `source-layer` exactly (`mmr_admin1`, not `admin1_global`).
- **Wrong file in build** — rebuild tippecanoe after re-running the clip script.
- **Zoom gating** — many layers are hidden below z4–z6 by design; zoom to z6–8 before assuming data is missing.

### PMTiles protocol not registered

MapLibre requires `ensurePmtilesProtocol(maplibregl)` before creating the map (already in `apps/web` `mapInstance.ts`). Browser error mentioning `pmtiles://` usually means the protocol was skipped in a new map entry point.

### Wrong local URL

- Serve root: `infrastructure/tiles/pmtiles/` via `npm run tiles:serve` → **http://localhost:8080**
- Overview archive URL: `http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles`
- Web env: `VITE_MAP_BASEMAP=overview` and optionally `VITE_OVERVIEW_PMTILES_URL` / `VITE_OVERVIEW_CURRENT_JSON_URL`
- Do **not** point overview mode at `regions/yangon/…` — that is the regional OSM basemap.

### CORS / fetch failures

Use `npm run tiles:serve` (`--cors`). A plain static server without CORS will block reads from `http://localhost:5173`.

### Labels too crowded

Tune filters in `overview-map.json` / `overviewConstants.ts`:

- **Countries:** tighten `LABELRANK` steps or raise `minzoom` on `overview-country-labels`.
- **Cities:** populated_places filter uses `ADM0CAP`, `WORLDCITY`, `MEGACITY`, `FEATURECLA`, `SCALERANK`, `LABELRANK` — lower `SCALERANK` threshold only above z7.
- **Admin1:** raise `minzoom` on `overview-mmr-admin1-labels` (currently z4).

### Clipped bbox too tight

Edit bbox in `infrastructure/tiles/scripts/clip-natural-earth-overview.sh` (`MIN_LNG`, `MIN_LAT`, `MAX_LNG`, `MAX_LAT`), re-clip, rebuild tippecanoe. If neighbors are cut off at pan limits, also review `MYANMAR_OVERVIEW_MAX_BOUNDS` in `overviewConstants.ts` (web pan lock, separate from clip bbox).

### Still seeing OSM roads / buildings

Overview mode is off — set `VITE_MAP_BASEMAP=overview` and restart Vite. Regional Yangon PMTiles use `local-basemap` source layers (`streets`, `buildings`, …), not `overview`.

---

## Related docs

- [Overview local dev (web app)](../../../../docs/tiles/pmtiles/overview-local-dev.md)
- [Regional PMTiles](../README.md)
- [PMTiles release / CDN placeholders](../../../../docs/tiles/pmtiles/pmtiles-release-workflow.md)
