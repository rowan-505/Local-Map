# Regional PMTiles (basemap)

This directory holds **static vector basemap** archives and a small **pointer file** per region. It is laid out so you can mirror the same paths on **Cloudflare R2, S3, or any CDN** later (`regions/<region>/…`).

---

## 1. PMTiles is stable basemap only

The `.pmtiles` archives are **read-only rendering**: landuse, water, admin boundaries and labels, streets, road labels, and building footprints. They are built on a schedule (or on demand) from exported PostGIS views and are not a write path for application data.

---

## 2. API GeoJSON is used for live CRUD / search / selected features

**Places, search results, selection highlights, and anything users edit** should come from the **API** (GeoJSON or other API-driven layers in MapLibre). The web app keeps using env-based basemap URLs; overlays stay on API sources. Do not push live or frequently changing business data into PMTiles.

---

## 3. Regional structure (CDN-compatible paths)

Each **region** has a folder under `regions/<region>/`. **Version** is encoded only in the PMTiles filename; **GeoJSON exports** are shared per region under `exports/<region>/`.

| Path | Role |
|------|------|
| `regions/yangon/current.json` | Pointer: `region`, `version`, `filename`, `url` — same path on R2/CDN. |
| `regions/yangon/yangon-v2.pmtiles` | Immutable versioned archive (example). Older `yangon-v1.pmtiles` stay until you delete them. |
| `exports/yangon/*.geojson` | Latest exported basemap layers for Yangon (re-export overwrites in place). |
| `exports/mandalay/*.geojson` | Same pattern for another region after you export it. |

```text
infrastructure/tiles/pmtiles/
  regions/yangon/
    current.json
    yangon-v1.pmtiles
    yangon-v2.pmtiles
  regions/mandalay/
    current.json
    mandalay-v1.pmtiles
  exports/yangon/
    *.geojson
  exports/mandalay/
    *.geojson
  scripts/
    load-root-env.sh
    export-region.sh
    build-region.sh
    rebuild-region.sh
    serve-local.sh
```

`*.pmtiles` are typically **gitignored** at the repo root; commit **scripts**, **README**, and usually **`current.json`**. Upload **`regions/<region>/`** to object storage preserving paths (e.g. `https://<cdn>/regions/yangon/current.json`).

---

## 4. Local commands (repo root, parameterized)

From **`Local-Map` (repo root)**:

```bash
# Static server — same URL layout as CDN (port 8080, CORS)
npm run tiles:serve
```

Examples once tiles are built:

- `http://localhost:8080/regions/yangon/current.json`
- `http://localhost:8080/regions/yangon/yangon-v1.pmtiles`

### Rebuild any region / version

Put **`DATABASE_URL`** in the **repository root** `.env`. `export-region.sh` and `build-region.sh` load it automatically (a **non-empty** shell variable overrides `.env` — useful in CI).

**Generic (preferred):**

```bash
npm run tiles:rebuild -- yangon v2
npm run tiles:rebuild -- mandalay v1
```

**Convenience (Yangon v1 only):**

```bash
npm run tiles:rebuild:yangon:v1
```

Under the hood, `tiles:rebuild` runs **`rebuild-region.sh`** → **`export-region.sh`** → **`build-region.sh`**, each with **`$1 = region`**, **`$2 = version`**. Scripts print **`[rebuild]`**, **`[export]`**, **`[build]`** lines with **region**, **version**, **GeoJSON path** (`exports/<region>/`), and **PMTiles path** (`regions/<region>/<region>-<version>.pmtiles`). Env logs: **`[env] loaded root .env`** and **`[env] using DATABASE_URL host: …`** (host:port only).

**Separate steps:**

```bash
npm run tiles:export -- mandalay v1
npm run tiles:build -- mandalay v1
```

Prerequisites: **Node/npx**, **GDAL `ogr2ogr`**, **Python 3** with `json.tool` (each exported `.geojson` is validated before the build), **tippecanoe**, **`pmtiles`** CLI (e.g. `brew install gdal tippecanoe pmtiles`; Python 3 is often already installed).

Each **`tiles:export`** run **removes and recreates** `exports/<region>/` so no stale or partial GeoJSON remains; **`tiles:build`** deletes this run’s temp `.mbtiles` / `.pmtiles.new` / `current.json.new` before building. **`current.json`** is updated only after **tippecanoe** and **`pmtiles convert`** both succeed; older **`*.pmtiles`** in the region folder are never deleted by these scripts.

If **`npm run tiles:serve`** cannot bind **8080**, stop other servers on that port. Serve the folder **`infrastructure/tiles/pmtiles`** (not `output/`).

---

## 5. How rollback works

**`current.json` is the switch.** Keep old **`*.pmtiles`** on the CDN. Edit **`regions/<region>/current.json`** so **`filename`** and **`url`** point at an older file (e.g. `yangon-v1.pmtiles` instead of `yangon-v2.pmtiles`), and align **`version`** for bookkeeping.

---

## 6. CDN / R2 (future)

**PMTiles (`*.pmtiles`):**

```http
Cache-Control: public, max-age=31536000, immutable
```

**`current.json`:**

```http
Cache-Control: no-cache, max-age=60
```

---

## 7. Do not include POIs in PMTiles

`export-region.sh` only exports basemap **`tiles.*`** views. It does **not** export **`tiles.tiles_places_v`** or other POI layers.

---

## 8. Do not delete old PMTiles versions immediately

`build-region.sh` adds **`regions/<region>/<region>-<version>.pmtiles`** and updates **`current.json` only after a successful build**. It does **not** delete older **`*.pmtiles`** in that folder. GeoJSON under **`exports/<region>/`** is overwritten on each export for that region — the durable versioned artifacts are the **`.pmtiles`** files plus **`current.json`**.

---

## Verification (sanity check)

Serve **`infrastructure/tiles/pmtiles`** and check:

- `GET /regions/yangon/current.json` → **200**
- `GET /regions/yangon/yangon-v1.pmtiles` (byte range) → **200** or **206**, body starts with **`PMTiles`** archive header.
