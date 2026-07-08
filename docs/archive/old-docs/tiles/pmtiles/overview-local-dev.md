---
status: archived
reason: replaced by docs/archive/old-docs/tiles/pmtiles/overview-local-dev.md
archived_at: 2026-07-01
---

# Local dev: Myanmar overview PMTiles

Test the overview basemap in **`apps/web`** without guessing paths or env setup.

---

## 1. Place the PMTiles file

Put the archive here (gitignored):

```text
infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles
```

Pointer file (committed):

```text
infrastructure/tiles/pmtiles/overview/regions/current.json
```

Default local URL from `current.json`:

```text
http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles
```

---

## 2. Verify layout

From **repo root**:

```bash
npm run tiles:verify:overview
```

Checks that the file exists, the header starts with `PMTiles`, and `current.json` is valid. Optionally probes `localhost:8080` if the tile server is already running.

---

## 3. Start the local PMTiles server

**Terminal 1** (repo root):

```bash
npm run tiles:serve
```

- Serves `infrastructure/tiles/pmtiles/` on **http://localhost:8080**
- **CORS enabled** (`--cors`) so the Vite dev server can fetch tiles
- Same layout as CDN/R2 paths later

Quick checks:

```bash
curl -s http://localhost:8080/overview/regions/current.json
curl -I -H "Range: bytes=0-6" http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles
```

Expect **200** / **206** and a body starting with `PMTiles`.

---

## 4. Start the web app (overview mode)

**Terminal 2**:

```bash
cd apps/web
VITE_MAP_BASEMAP=overview npm run dev
```

Or add to **`apps/web/.env.local`** (not committed):

```env
VITE_MAP_BASEMAP=overview
# Optional — defaults to http://localhost:8080/overview/regions/current.json
# VITE_OVERVIEW_CURRENT_JSON_URL=http://localhost:8080/overview/regions/current.json
# Optional — skip current.json and point directly at the archive
# VITE_OVERVIEW_PMTILES_URL=http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles
```

**Important:** If `VITE_BASEMAP_PMTILES_URL` is set (regional Yangon R2 URL), it is **ignored** when `VITE_MAP_BASEMAP=overview`. Production keeps using the regional basemap unless you opt in to overview mode.

Open **http://localhost:5173**. The map opens centered on Myanmar (~z4.7) with overview viewport locks.

**Full visual QA checklist:** [overview-pmtiles-qa.md](../overview-pmtiles-qa.md) · **Web app integration:** [overview-web-integration-qa.md](../overview-web-integration-qa.md)

---

## 5. Verify layers visually

At **z4–5** (default opening view):

| Expect | Layer / source |
|--------|----------------|
| Light blue background | `overview-ocean` |
| Beige land | `overview-land` |
| Subtle country fills | `overview-countries-fill` |
| Gray country borders | `overview-country-boundaries` |
| Dark Myanmar country highlight (NE-aligned) | `overview-mmr-country-highlight` |
| Country names (not crowded) | `overview-country-labels` |
| State/region tint + labels | `overview-mmr-admin1-*` (from z4) |
| **No** city clutter | `overview-populated-places` hidden until z5+ |

Zoom **in to z6–8**: major city labels, lakes, rivers, coastline appear gradually.

**DevTools console** (Vite dev):

```text
[map] overview basemap active: ...
```

**Browser console** (map debug globals):

```js
window.__MAP_SOURCES__()   // should include source id "overview"
window.__MAP_LAYERS__().map(l => l.id).filter(id => id.startsWith('overview-'))
```

---

## 6. Local QA: all regional PMTiles at once

**Temporary dev-only mode** — loads every built regional archive from `http://localhost:8080/regions` on one map. **Not for production.** Can be **slow** (15 regional sources + full layer stacks).

**Terminal 1** (repo root):

```bash
npm run tiles:serve
```

**Terminal 2**:

```bash
cd apps/web
VITE_LOAD_ALL_LOCAL_REGION_PMTILES=true \
VITE_OVERVIEW_PMTILES_URL=http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles \
npm run dev
```

Or in `apps/web/.env.local`:

```env
VITE_LOAD_ALL_LOCAL_REGION_PMTILES=true
VITE_OVERVIEW_PMTILES_URL=http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles
```

Expect console logs:

```text
[pmtiles-qa] loading all local regions
[pmtiles-qa] loaded yangon http://localhost:8080/regions/yangon/yangon-v2.pmtiles
…
```

Ignored when `VITE_MAP_BASEMAP=overview` (overview-only mode). Ignored in production builds even if the env var is set.

---

## 7. Env reference (names only)

| Variable | App | Purpose |
|----------|-----|---------|
| `VITE_OVERVIEW_PMTILES_URL` | web | Direct overview `.pmtiles` HTTP(S) URL — composes with regional when set |
| `VITE_BASEMAP_PMTILES_URL` | web | Regional Yangon URL (unchanged) |
| `VITE_MAP_BASEMAP` | web | Optional: `overview` for overview-only style (requires overview URL) |
| `VITE_LOAD_ALL_LOCAL_REGION_PMTILES` | web | Dev-only: load all 15 regional PMTiles from localhost:8080 (local QA; may be slow) |

Web app reads **only** `VITE_OVERVIEW_PMTILES_URL` for overview (no `current.json`). Rebuild/restart Vite after env changes.

---

## 8. Common errors

### Blank map / “Failed to fetch”

- **`npm run tiles:serve` not running** — start it on port 8080.
- **Wrong path** — URL must match `overview/regions/myanmar-overview-v1.pmtiles`, not `regions/yangon/…`.
- **File missing** — run `npm run tiles:verify:overview`.

### CORS errors in browser

- Use `npm run tiles:serve` (includes `--cors`). Plain `python -m http.server` without CORS will fail from `localhost:5173`.

### PMTiles protocol / tiles never load

- MapLibre needs `ensurePmtilesProtocol()` — already called in `mapInstance.ts`. If you see protocol errors, confirm `pmtiles` is installed (`apps/web` / root `package.json`).

### Layers missing but tiles load

- **Wrong `source-layer` name** — overview layers use Natural Earth names (`land`, `ocean`, `mmr_admin1`, …). Style is in `packages/map-style/overview-map.json`.
- **Zoom too low/high** — many layers are gated (e.g. cities from z5, hydro from z6). Zoom to z6–8 to test.

### Still seeing Yangon OSM basemap

- **`VITE_MAP_BASEMAP=overview` not set** — default is regional `local-basemap`.
- Restart Vite after changing `.env.local`.

### Port 8080 in use

- Stop the other process or change the serve port (you would then update `VITE_OVERVIEW_PMTILES_URL` / `current.json` `url` to match).

---

## Related

- Overview style: `packages/map-style/overview-map.json`
- Regional PMTiles workflow: `infrastructure/tiles/pmtiles/README.md`
- Release / R2: `docs/tiles/pmtiles/pmtiles-release-workflow.md`
