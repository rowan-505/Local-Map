# Regional PMTiles (basemap)

Static vector basemap archives and per-region `current.json` pointers. Paths mirror CDN layout: `regions/<region>/…`.

---

## Build vs rebuild — which command to use

The pipeline has two phases. **Do not confuse them:**

```text
export   PostGIS (tiles.*_v views)  →  exports/<region>/*.geojson
build    exports/<region>/*.geojson  →  regions/<region>/<region>-<version>.pmtiles
```

| Command | Phases | Needs `DATABASE_URL`? |
|---------|--------|------------------------|
| `npm run tiles:export -- <region> <version>` | export only | Yes |
| `npm run tiles:build -- <region> <version>` | build only | No |
| `npm run tiles:rebuild -- <region> <version>` | export + build | Yes |
| `npm run tiles:upload -- <region> <version>` | upload built `.pmtiles` to R2 | No (needs Wrangler) |

### Decision rule

```text
Are exports/<region>/*.geojson present AND up to date with the database?
  YES → tiles:build   (faster; no DB/network)
  NO  → tiles:rebuild   OR   tiles:export then tiles:build
```

**`tiles:build` is not safe in every situation.** It never reads the database. If GeoJSON on disk is missing or stale, build will fail or produce wrong tiles.

### When to use `tiles:build`

- Export already finished for this region/version
- Re-running tippecanoe after a **build-only** failure (export succeeded, build crashed)
- Tuning build flags: `--roads-only`, `--skip-buildings`, `--light-only`
- Iterating on tippecanoe options without DB changes

```bash
npm run tiles:build -- yangon v2
```

### When to use `tiles:rebuild`

- **New region** — no `exports/<region>/` yet (`build` will fail with missing GeoJSON)
- **Database changed** — tile view columns, migrations, backfills, OSM import
- You need a guaranteed fresh snapshot from PostGIS

```bash
npm run tiles:rebuild -- yangon v2
```

Equivalent two-step form (same result):

```bash
npm run tiles:export -- yangon v2
npm run tiles:build -- yangon v2
```

### Scenario cheat sheet

| Situation | Command | Why |
|-----------|---------|-----|
| First time for a new region (e.g. `mandalay v1`) | `tiles:rebuild` | No exports exist yet |
| Changed `tiles.*_v` view columns or DB data | `tiles:rebuild` | On-disk GeoJSON is stale |
| Export done; build failed or not started | `tiles:build` | Re-export would be wasted time |
| Same exports; retry after tippecanoe error | `tiles:build` | DB unchanged |
| Debug road/label pass only | `tiles:build -- --roads-only` | Skips heavy non-road layers |
| Production archive after confirmed export | `tiles:build` | Fastest full build |

### Time and cost

| | `tiles:build` | `tiles:rebuild` |
|--|---------------|-----------------|
| **Time** | Build only (tippecanoe is usually the longest step) | Export (~minutes) **+** build |
| **Database** | Not used | 10 clipped `ogr2ogr` queries per region |
| **Network** | Local files only | Pulls large GeoJSON from Supabase |
| **Wasteful when** | Exports missing or stale | Exports already fresh (re-exports for no reason) |

For Yangon, export alone is often ~3–4 minutes; the streets tippecanoe pass is often much longer. **Avoid `rebuild` when `build` is enough.**

### Partial pipeline failure

If `tiles:rebuild` finishes export but fails before build (for example a script error after `export complete`):

- `exports/<region>/` is valid — **do not** run full `rebuild` again
- Run **`tiles:build`** to complete the `.pmtiles` step only

### New region example

```bash
# First time — must hit the database
npm run tiles:rebuild -- mandalay v1

# Later — exports unchanged, retry build only
npm run tiles:build -- mandalay v1

# After DB/view changes
npm run tiles:rebuild -- mandalay v1
```

---

## Normal build (recommended after export)

```bash
# From repo root — uses existing exports/yangon/*.geojson
npm run tiles:build -- yangon v2
```

**Stage milestones** (source of truth — not tippecanoe inner %):

| % | Stage |
|---|-------|
| 5 | input inventory |
| 15 | validating GeoJSON |
| 22 | preparing GeoJSONSeq |
| 28 | building light layers |
| 55 | building roads (dense streets pass) |
| 75 | building road labels |
| 90 | finalizing PMTiles (tile-join + convert) |
| 100 | done |

During long commands (prepare, tippecanoe, finalize), an **estimated progress ticker** updates every 2 seconds on one line:

```text
[build] 28.43% building light layers... elapsed 1m 24s (estimated)
```

The ticker slowly moves between the current milestone and the next minus 0.01. It never reaches 100% until the command actually finishes. When a stage completes, the script prints the real next milestone line with stage/total elapsed time.

Disable the ticker:

```bash
npm run tiles:build -- yangon v2 --no-progress-ticker
```

Full build logs are also written to `infrastructure/tiles/pmtiles/logs/build-<region>-<version>-<timestamp>.log`.

---

## Debug fast builds

```bash
# Fastest — roads + labels only (Yangon clipped ~77k streets, 105 labels)
npm run tiles:build -- yangon v2 --roads-only

# Skip buildings (admin, water, roads, labels)
npm run tiles:build -- yangon v2 --skip-buildings

# Admin/water/landuse only (no streets pass)
npm run tiles:build -- yangon v2 --light-only
```

| Option | Layers built | Speed | Use for |
|--------|--------------|-------|---------|
| `--roads-only` | `streets`, `road_labels` | **Fastest** | Road line + label smoke test |
| `--light-only` | admin, water, landuse, buildings | Fast | Basemap context without streets pass |
| `--skip-buildings` | all except `buildings` | Medium | Full basemap minus buildings |
| (default) | all 9 layers | Normal | Production archive |

Pass the same flags to `tiles:rebuild` when you need a fresh export.

---

## Full rebuild from database

```bash
npm run tiles:rebuild -- yangon v2
```

Stages: **export 0–25%** → **build 25–100%**.

Requires `DATABASE_URL` in repo root `.env`.

---

## Regional clipping (export)

Each regional export is **spatially filtered** to one Myanmar state/region polygon from `core.core_admin_areas` (`admin_level_code = state_region`), plus a buffer around the border.

| Setting | Default | Purpose |
|---------|---------|---------|
| `PMTILES_REGION_BUFFER_METERS` | `10000` (10 km) | Expands the boundary so neighboring regional tiles overlap slightly — avoids visual gaps at borders |

**Behavior:**

- Export resolves the region key (e.g. `yangon`) to exactly one `state_region` row — not township/ward polygons.
- Every export layer uses a `region_boundary` CTE (buffered polygon) and `ST_Intersects(layer.geom, region_boundary.geom)`.
- The buffered polygon is split with `ST_Subdivide` so spatial filters stay fast on large layers (still `ST_Intersects`, not bbox-only).
- Hard clipping (`ST_Intersection`) is **not** used yet (avoids broken geometry and heavy queries).
- Overview PMTiles are unchanged (whole-country).

**Supported region keys:**  
`yangon`, `bago`, `ayeyarwady`, `mandalay`, `magway`, `sagaing`, `tanintharyi`, `naypyitaw`, `kachin`, `kayah`, `kayin`, `chin`, `mon`, `rakhine`, `shan`

**Yangon rebuild (clipped export + build):**

```bash
npm run tiles:rebuild -- yangon v2
```

After clipping, `exports/yangon/streets.geojson` should be **much smaller** than a whole-country export (no ~800k nationwide streets).

**Rebuild all regions sequentially (export + build):**

```bash
npm run tiles:rebuild:regions -- v1
YANGON_VERSION=v2 npm run tiles:rebuild:regions -- v1   # Yangon v2, other regions v1
npm run tiles:rebuild:regions -- v1 mandalay            # start at Mandalay
CONTINUE_ON_ERROR=1 npm run tiles:rebuild:regions -- v1
```

Logs: `infrastructure/tiles/pmtiles/logs/rebuild-all-<timestamp>.log`. Stops on first failure unless `CONTINUE_ON_ERROR=1` or `--continue-on-error`.

**Build all regions from existing exports (no DB):**

```bash
npm run tiles:build:regions -- v1
```

Logs: `infrastructure/tiles/pmtiles/logs/build-all-<timestamp>.log`.

**Verify export counts** — each layer prints after clipping:

```text
[export] clipped streets: 45231 features, 89M
[export] clipped buildings: 12034 features, 45M
```

Compare with `build-region.sh` input inventory (feature count + file size). Inspect archive bounds:

```bash
pmtiles show infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles
```

Bounds should match the region (+ buffer), not lat 9–28 whole-country.

**Change buffer** — set before export/rebuild:

```bash
PMTILES_REGION_BUFFER_METERS=15000 npm run tiles:rebuild -- yangon v2
```

Larger buffer = more overlap at borders and slightly larger files.

---

## Input inventory (printed every build)

Before tippecanoe, the build prints size + feature count for:

- `streets.geojson` — largest layer (Yangon clipped ~77k features, ~51MB)
- `road_labels.geojson` — named labels only (no `road-*` canonical)
- `admin_areas.geojson`, `admin_boundaries.geojson`, `admin_area_label_points.geojson`
- `buildings.geojson`, `landuse.geojson`
- `water_lines.geojson`, `water_polygons.geojson`

---

## Build performance strategy

Three tippecanoe passes + `tile-join` (stable layer names unchanged):

1. **Light** — admin, water, landuse, buildings, village_labels
2. **Roads** — `streets` only (class-based minzoom hints + coalesce; all clipped features kept through z20)
3. **Labels** — `road_labels` only (z12+; real names from `tiles_road_labels_v`)

`prepare-tippecanoe-input.py` adds per-feature `tippecanoe.minzoom` / `maxzoom` hints (no SQL changes). Every street feature is retained through z20; only **visibility** at low/mid zoom is reduced.

### Street class zoom hints

| Road class | minzoom | Visible from |
|------------|---------|--------------|
| motorway, trunk, primary | 8 | regional overview |
| secondary, tertiary | 10 | district |
| residential, unclassified, unknown | 12 | neighbourhood |
| service, track, path, footway | 14 | local |

Yangon clipped (~77k streets): counts scale down proportionally; class-based minzoom visibility rules unchanged.

### Prepare summary (printed each build)

```text
[build] prepare summary (mode=roads-only): before/after features + tippecanoe visibility
  streets                before=   76762  after=   76762  visible@z8=    ...   z10=    ...   z12=    ...   z14=   76762
```

### Streets tippecanoe tuning

- `--coalesce-densest-as-needed` + `--coalesce-smallest-as-needed` (merge, don’t drop at z16–z20)
- `--simplify-only-low-zooms` (geometry detail preserved at high zoom)
- `--no-feature-limit` (no feature-count drops at max zoom)
- Per-feature minzoom reduces tile-size fitting at z8–z13

Road text stays on `road_labels` only — no labels from `streets`.

### Tippecanoe sparsify warnings

If tiles still exceed byte limits, tippecanoe may coalesce or log `sparsest`. The build prints a summary WARNING per pass. Use `PMTILES_DEBUG=1` for full stderr.

---

## Inspect PMTiles layers

```bash
# Metadata + vector layer list
pmtiles show infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles

# Serve locally
npm run tiles:serve
# http://localhost:8080/regions/yangon/current.json
```

---

## Upload to Cloudflare R2

Prerequisites: `wrangler login`, built `.pmtiles` on disk.

```bash
# Regional (resolves local path + uploads)
npm run tiles:upload -- yangon v2
npm run tiles:upload -- bago v1

# Overview
npm run tiles:upload -- overview v1
```

Resolved local paths:

| Region | Local file |
|--------|------------|
| `yangon` `v2` | `infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles` |
| `overview` `v1` | `infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles` |

R2 object key (all regions): `coremap-tiles-prod/basemaps/<region>/<version>/basemap.pmtiles`

Explicit upload (any file path):

```bash
npm run tiles:upload:r2 -- infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles yangon v2
```

Verify after upload:

```bash
bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \
  "https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles" \
  "http://localhost:5173"
```

Release checklist: `docs/tiles/pmtiles/pmtiles-release-workflow.md`

---

## Optional env

| Variable | Default | Purpose |
|----------|---------|---------|
| `PMTILES_MIN_ZOOM` | `8` | Global tile minzoom |
| `PMTILES_MAX_ZOOM` | `20` | Native regional tile maxzoom (matches public map camera max z20) |
| `PMTILES_REGION_BUFFER_METERS` | `10000` | Regional export boundary buffer (overlap at state borders) |
| `PMTILES_REGION_SUBDIVIDE_SEGMENTS` | `512` | `ST_Subdivide` segments for fast `ST_Intersects` during export |
| `PMTILES_DEBUG` | `0` | `1` = full tippecanoe stderr + commands (disables quiet tippecanoe during ticker) |
| `PMTILES_PROGRESS_TICKER_ENABLED` | `1` | `0` or `--no-progress-ticker` disables estimated ticker |
| `SKIP_BUILDINGS` | `0` | `1` = same as `--skip-buildings` |
| `BASE_URL` | `http://localhost:8080` | Written into `current.json` |

---

## Prerequisites

```bash
brew install gdal tippecanoe pmtiles
```

Also: Node/npm (for `npm run`), Python 3, `DATABASE_URL` for export.

---

## Failure cleanup

On failure or Ctrl+C, `build-region.sh` removes temp files only:

- `.tmp-prep-*`, `.tmp-build-*` mbtiles, `.pmtiles.new`

It does **not** delete `exports/` or published `regions/<region>/*.pmtiles`. `current.json` updates only after successful convert.

---

## Layer names (stable — match `base-map.json`)

`streets`, `road_labels`, `admin_areas`, `admin_boundaries`, `admin_area_label_points`, `buildings`, `landuse`, `water_lines`, `water_polygons`, `village_labels`

Road lines = `streets`. Road text = `road_labels` only. Admin text = `admin_area_label_points` only (not `admin_areas` polygons). No fake `road-*` labels in PMTiles.

---

## Rollback

Edit `regions/<region>/current.json` to point `filename` / `url` at an older `.pmtiles`. Keep old archives on CDN.

---

## Overview tiles

Separate pipeline — see `overview/README.md` and `npm run tiles:verify:overview`.
