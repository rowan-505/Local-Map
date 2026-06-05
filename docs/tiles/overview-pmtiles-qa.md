# Visual QA: `myanmar-overview-v1.pmtiles`

Short manual checklist for overview basemap quality. Run after building PMTiles, editing `overview-map.json`, or before uploading to R2.

**Setup (local):**

```bash
npm run tiles:verify:overview          # file + current.json
npm run tiles:serve                    # terminal 1 — :8080
cd apps/web && VITE_MAP_BASEMAP=overview npm run dev   # terminal 2
```

Open **http://localhost:5173**. DevTools → **Console** open for the whole pass.

**Web integration QA (env + POI/routing):** [overview-web-integration-qa.md](./overview-web-integration-qa.md)

**Automated style guard (before/after style edits):**

```bash
npm run test:overview-style
```

---

## 1. Initial viewport

| Check | Pass |
|-------|------|
| Map opens with **Myanmar centered** (not Yangon/Kyauktan detail) | ☐ |
| Opening zoom ≈ **4.7** — country + neighbors framed | ☐ |
| Cannot zoom out below **4.3** | ☐ |
| Cannot pan far outside Myanmar + direct neighbors (bounds ~ **78°E–112°E, 3°N–34°N**) | ☐ |

Quick test: scroll zoom out → stops at 4.3. Drag hard toward India/China/Thailand → pan stops inside bounds, no empty gray void.

Constants: `MYANMAR_OVERVIEW_*` in `packages/map-style/overviewConstants.ts`.

---

## 2. Data rules (must NOT appear)

Overview is **Natural Earth + MIMU only** — no OSM detail.

| Check | Pass |
|-------|------|
| **No OSM roads** (no street grid, no road casings at any zoom) | ☐ |
| **No OSM buildings** | ☐ |
| **No POI markers** / place pins from regional basemap | ☐ |
| **No bus / rail / transit** layers or labels | ☐ |
| **Neighbor countries** show **boundaries + country names only** — no foreign city clutter at z4–5 | ☐ |

Zoom **z6–8**: only **major** cities (capitals / world cities), not dense local labels.

Console: no `source-layer` errors for `streets`, `buildings`, `landuse`, etc.

---

## 3. Visual rules

### z4–5 (default view)

| Check | Pass |
|-------|------|
| **Ocean** — light blue, no gaps or wrong color patches | ☐ |
| **Land** — clean beige fill, no holes over Myanmar | ☐ |
| **Myanmar Admin 1** — subtle state/region tint visible from z4 | ☐ |
| **Country labels** — Myanmar + neighbors readable; not overlapping heavily | ☐ |
| **No label overcrowding** — no small-town clutter | ☐ |
| **Coastline** — smooth Bay of Bengal / Andaman edge (not jagged fragments) | ☐ |

### z6–8 (zoom in)

| Check | Pass |
|-------|------|
| **Lakes / rivers** appear gradually; **not noisy** (no stream spaghetti) | ☐ |
| **Coastline** line still clean | ☐ |
| **Admin 1 boundaries + labels** still readable | ☐ |
| **Major cities only** — Yangon/Naypyitaw capitals OK; not every village | ☐ |

Style layers: `overview-*` in `packages/map-style/overview-map.json`.

---

## 4. Performance & technical

Record on each rebuild (paste into PR / release notes):

| Metric | Value |
|--------|-------|
| File path | `infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles` |
| File size | `________` bytes (`wc -c < …/myanmar-overview-v1.pmtiles`) |
| Build date / version | `________` |
| Tester / env | local / staging / prod CDN |

| Check | Pass |
|-------|------|
| **First load** acceptable on cold refresh (no long blank map) | ☐ |
| **No console errors** (MapLibre, network, CORS) | ☐ |
| **No missing source-layer errors** in console or network tab | ☐ |
| `window.__MAP_SOURCES__()` includes source **`overview`** | ☐ |
| Tile requests return **200/206** from expected URL | ☐ |

---

## 5. Regression notes

### After rebuilding PMTiles

1. Run `npm run tiles:verify:overview` — file exists, `PMTiles` header OK.
2. Record **file size**; flag if size jumps >~20% without explanation.
3. Re-run **§2 Data rules** at z4, z6, z8 — especially no accidental OSM layers in tippecanoe inputs.
4. Confirm all **12 source-layers** still present: `land`, `ocean`, `coastline`, `countries`, `country_boundaries`, `populated_places`, `lakes`, `rivers`, `mmr_admin0_z0_2`, `mmr_admin0_z3_4`, `mmr_admin0_z5_6`, `mmr_admin1`. Must **not** include `mmr_country_highlight`, `mmr_admin0`, or `mmr_admin0_overview`.
5. Pan to **edges** (Arakan coast, Shan plateau, Tanintharyi) — no tile gaps or wrong projection.

### After changing MapLibre style (`overview-map.json` / filters)

1. Run `npm run test:overview-style` — must pass.
2. Re-check **§3 Visual rules** at z4–5 and z6–8 (filters affect labels and water).
3. Confirm layer `source-layer` names still match PMTiles (test catches mismatches).
4. Confirm **no regional/OSM layers** crept into overview style.

### Before uploading to R2 / CDN

1. Final **§1–4** pass against the **exact file** being uploaded.
2. Update `current.json` (or registry) **version + URL** if filename changed.
3. Smoke-test **HTTP range request** on CDN URL (`curl -I -H "Range: bytes=0-6" …`).
4. Confirm **CORS** allows web origin (or same-origin proxy).
5. Keep previous version on CDN until new build is signed off.

---

## Related docs

- [Overview local dev](./pmtiles/overview-local-dev.md)
- [Overview build README](../../infrastructure/tiles/pmtiles/overview/README.md)
- [PMTiles release workflow](./pmtiles/pmtiles-release-workflow.md)
