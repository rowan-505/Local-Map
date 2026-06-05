# Myanmar overview PMTiles

Low-zoom, Myanmar-centered basemap for the public web map. **Natural Earth + MIMU only** — no OSM, no routing graph, no POIs.

**Local dev quick start:** [docs/tiles/pmtiles/overview-local-dev.md](../../../../docs/tiles/pmtiles/overview-local-dev.md)

---

## 1. Purpose

Overview PMTiles provide **national context at low zoom only** (z0–z8):

- Frame **Myanmar** and neighboring countries at country / state-region scale.
- Show **admin boundaries and labels** suitable for a clean overview map.
- **Do not** replace regional PMTiles (Yangon, Mandalay, …) used for OSM-level detail.

**Included:** Natural Earth 1:10m layers + **high-precision land-aligned Myanmar admin0 tiers** (`mmr_admin0_z0_2`, `z3_4`, `z5_6`) + MIMU admin1.

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
| `mmr_admin0_z0_2` / `z3_4` / `z5_6` | NE `ne_10m_land` ∩ Myanmar mask, zoom-tier simplify (see `prepare-mmr-admin0-boundaries.py`) |
| `populated_places` | `ne_10m_populated_places` |
| `lakes` | `ne_10m_lakes` |
| `rivers` | `ne_10m_rivers_lake_centerlines` |

Clip script (repo root):

```bash
bash infrastructure/tiles/scripts/clip-natural-earth-overview.sh
```

Overview bbox (WGS84): **75°E–115°E, 0°N–36°N** (Myanmar-centered, includes neighbors).

### Myanmar admin0 overview outline (land-aligned Natural Earth)

The **overview outer Myanmar boundary** uses three zoom-tier layers (`mmr_admin0_z0_2`, `z3_4`, `z5_6`) derived from **NE land polygons** clipped to a Myanmar mask — aligned with `overview-land` / `overview-ocean`. Visible in MapLibre only **z0–z6** (tier `maxzoom` 3 / 5 / 7).

Pipeline:

```text
clip-natural-earth-overview.sh → mmr_country_highlight.geojsonseq (mask only, not tiled)
prepare-mmr-admin0-boundaries.py → mmr_admin0_overview.geojsonseq
```

MapLibre layers: `myanmar-admin0-boundary-line` + `myanmar-admin0-boundary-casing` (`source-layer: mmr_admin0_overview`).

Regional Yangon PMTiles use `core.core_admin_areas` via `tiles_admin_boundaries_v` from **z7+** — separate from overview.

### MIMU (Myanmar state/region admin1)

Processed GeoJSONSeq (not clipped by the Natural Earth script):

| PMTiles `source-layer` | Description |
|------------------------|-------------|
| `mmr_admin1` | State / region polygons |

Expected path:

```text
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

Overview builds use **GDAL**, **tippecanoe**, and optional **pmtiles** CLI. No PostGIS export is required for the overview outer boundary.

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

The clip step writes `mmr_country_highlight.geojsonseq` (Myanmar mask) and runs `prepare-mmr-admin0-boundaries.py` → `mmr_admin0_overview.geojsonseq`.

**2. MIMU — admin1 GeoJSONSeq**

Ensure `mmr_admin1.geojsonseq` exists under `infrastructure/tiles/data/processed/mimu/`.

**3. tippecanoe — vector tiles z0–z8** (or use `npm run tiles:build:overview`)

```bash
npm run tiles:build:overview
```

Manual equivalent:

```bash
bash infrastructure/tiles/pmtiles/scripts/build-overview.sh v1
```

```bash
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
  -L mmr_admin0_overview:infrastructure/tiles/data/processed/natural-earth/clipped/mmr_admin0_overview.geojsonseq \
  -L populated_places:infrastructure/tiles/data/processed/natural-earth/clipped/populated_places.geojsonseq \
  -L lakes:infrastructure/tiles/data/processed/natural-earth/clipped/lakes.geojsonseq \
  -L rivers:infrastructure/tiles/data/processed/natural-earth/clipped/rivers.geojsonseq \
  -L mmr_admin1:infrastructure/tiles/data/processed/mimu/mmr_admin1.geojsonseq
```

Layer names after `-L` become MapLibre **`source-layer`** ids — they must match `packages/map-style/overview-map.json`.

**One-shot rebuild** (clip Natural Earth incl. Myanmar highlight + tippecanoe):

```bash
npm run tiles:rebuild:overview
```

Verify archive includes `mmr_admin0_overview` (and not `mmr_country_highlight` / `mmr_admin0`):

```bash
pmtiles show infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles --metadata \
  | python3 -c "import json,sys; print([l['id'] for l in json.load(sys.stdin).get('vector_layers',[])])"
```

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
6. Neighbor country boundaries (Myanmar segments excluded), admin1 boundaries, Natural Earth Myanmar highlight
7. Neighbor country labels (z4–6.5 only; hide `TINY` + Myanmar; stepped `LABELRANK`)
8. Admin1 labels (z5.5+, point placement, `ST` / `ST_MMR`; Myanmar only)
9. Major populated places (z7+; capitals / `SCALERANK` filter)

**Neighbor countries:** fill + boundaries + country names only — no admin1 detail outside Myanmar.

**Myanmar:** Land-aligned admin0 outline (`mmr_admin0_overview` / `myanmar-admin0-boundary-line`, z0–z6) + MIMU admin1 polygons, boundaries, and labels. Natural Earth Myanmar segments are filtered out of `country_boundaries` to avoid duplicate neighbor outlines. Regional OSM admin from z7+.

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
- **Admin1:** raise `minzoom` on `overview-mmr-admin1-labels` (currently z5.5).
- **Myanmar duplicate:** country labels exclude `ISO_A3=MMR`; admin1 labels cover Myanmar from z5.5+.

### Clipped bbox too tight

Edit bbox in `infrastructure/tiles/scripts/clip-natural-earth-overview.sh` (`MIN_LNG`, `MIN_LAT`, `MAX_LNG`, `MAX_LAT`), re-clip, rebuild tippecanoe. If neighbors are cut off at pan limits, also review `MYANMAR_OVERVIEW_MAX_BOUNDS` in `overviewConstants.ts` (web pan lock, separate from clip bbox).

### Still seeing OSM roads / buildings

Overview mode is off — set `VITE_MAP_BASEMAP=overview` and restart Vite. Regional Yangon PMTiles use `local-basemap` source layers (`streets`, `buildings`, …), not `overview`.

---

## Related docs

- [Overview local dev (web app)](../../../../docs/tiles/pmtiles/overview-local-dev.md)
- [Regional PMTiles](../README.md)
- [PMTiles release / CDN placeholders](../../../../docs/tiles/pmtiles/pmtiles-release-workflow.md)
