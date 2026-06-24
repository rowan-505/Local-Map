# Regional PMTiles — Manual QA

Quick manual checks for the dynamic regional PMTiles loader (overview base + viewport-loaded
regions). Loader: `src/lib/basemaps/regionLoader.ts`. Manifest: `public/basemaps/manifest.json`.

## 1. Local dev

```bash
cd apps/web
npm run dev
```

- Manifest URL: `VITE_BASEMAP_MANIFEST_URL` (default `/basemaps/manifest.json`).
- Regional `.pmtiles` come from the manifest host (`https://tiles.coremapmm.com/...`).
- Open the browser console — the loader logs `[regions] visible/loaded/unloaded` in dev only.

## 2. Network tab checks

Open DevTools → Network, filter `pmtiles`:

- Overview archive request fires once at startup (range requests / `206 Partial Content`).
- No `region-*` archive requests until zoom ≥ 7.
- At zoom ≥ 7, only the visible region archives request (range `206`), max 4 at a time.
- Panning back to an already-loaded region triggers **no** new archive request.

## 3. Expected low-zoom behavior (zoom < 7)

- Overview basemap only (country/admin1 outlines, place labels).
- No regional roads/buildings.
- Console: `[regions] visible: []`. No `region-*` sources in `__MAP_SOURCES__()`.

## 4. Expected zoom ≥ 7 behavior

- Regions intersecting the viewport load: source id `region-<regionId>`, layers suffixed
  `-<regionId>` (e.g. `road-major-fill-yangon`, `water-polygons-yangon`).
- Regional roads/buildings/labels appear over the overview base.
- POI markers / routes stay on top (overlay stack re-applied after each sync).

## 5. Confirm only visible regions load

In the console:

```js
Object.keys(__MAP_SOURCES__()).filter((id) => id.startsWith('region-'));
```

- Should list only regions in view, and never more than 4.
- Pan away → out-of-view region logs `[regions] unloaded: <id>` and disappears from the list.
- The `overview` source must always remain present.

## 6. Test Ayeyarwady, Bago, Yangon, Shan

Zoom to ≥ 7 over each area and confirm the matching `region-<id>` source loads:

| Region      | Approx. center (lng, lat) |
| ----------- | ------------------------- |
| Ayeyarwady  | 95.2, 17.0                |
| Bago        | 96.0, 18.3                |
| Yangon      | 96.15, 16.85              |
| Shan        | 98.0, 21.5                |

Near a shared border (e.g. Yangon/Bago/Ayeyarwady meet), expect 2–3 regions loaded together.

## 7. Common failures

- **CORS error** — tile host missing `Access-Control-Allow-Origin` / range headers. Fix R2/CDN
  CORS; the overview base will still render while regions fail.
- **404 PMTiles URL** — manifest `url` or `version` doesn’t match the published R2 path
  (`basemaps/<id>/<version>/basemap.pmtiles`). Check `public/basemaps/manifest.json`.
- **Duplicate layer id** — a region’s layers were added twice. The loader is idempotent
  (`getLayer` guard) and removes layers before the source; if seen, check for a stale source not
  cleared on unload.
- **source-layer name mismatch** — regional layer renders empty. Archive vector layer names must
  match `base-map.json` (`streets`, `road_labels`, `water_polygons`, `admin_boundaries`, …).
- **All regions loading at startup** — should never happen. Verify zoom < 7 returns `[]` and that
  the loader is gated on zoom (`REGIONAL_MIN_ZOOM = 7`) and capped (`MAX_LOADED_REGIONS = 4`).
