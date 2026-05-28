# QA: Web overview PMTiles integration

Manual pass for **apps/web** after changing `VITE_OVERVIEW_PMTILES_URL`, overview style layers, or deployment.  
Tile archive QA (build quality): [overview-pmtiles-qa.md](./overview-pmtiles-qa.md).

**Prereqs:** API running (`VITE_API_BASE_URL`), web dev or staging build, browser DevTools **Console** + **Network** open.

---

## Quick setup

```bash
# Optional automated checks (repo root)
npm run test:map
npm run test:overview-style

# Local tiles (if testing localhost URL)
npm run tiles:serve          # :8080, CORS on

# Web (from apps/web — rebuild after env change)
npm run dev
```

Open the map (e.g. **http://localhost:5173**). Default mode composes **overview + regional** when `VITE_OVERVIEW_PMTILES_URL` is set.

---

## 1. Hosted URL checks

Replace `YOUR_OVERVIEW_URL` with the value of `VITE_OVERVIEW_PMTILES_URL` (no secrets in tickets—use host/path only).

```bash
# 200 OK
curl -sI "YOUR_OVERVIEW_URL"

# PMTiles header (first bytes)
curl -s -H "Range: bytes=0-6" "YOUR_OVERVIEW_URL" | head -c 7
# expect: PMTiles

# Range supported (206 Partial Content) — typical on R2/CDN
curl -sI -H "Range: bytes=0-6" "YOUR_OVERVIEW_URL"
```

| Check | Pass |
|-------|------|
| `GET` overview `.pmtiles` returns **200** (or **206** for range) | ☐ |
| Response body starts with **`PMTiles`** | ☐ |
| **No CORS error** when the **web app origin** fetches the URL (Network tab) | ☐ |

Local note: use `npm run tiles:serve` so CORS allows `localhost:5173`.

---

## 2. Web env

| Check | Pass |
|-------|------|
| `apps/web/.env` or deploy env has **`VITE_OVERVIEW_PMTILES_URL`** set to the hosted `.pmtiles` URL | ☐ |
| URL is **`http://` or `https://`** and path includes **`.pmtiles`** | ☐ |
| After env change, web app was **restarted / rebuilt** (Vite bakes env at build) | ☐ |
| **`VITE_BASEMAP_PMTILES_URL`** still set for regional Yangon/detail (unchanged) | ☐ |

**Production:** missing `VITE_OVERVIEW_PMTILES_URL` fails at map load (`OverviewPmtilesConfigError`).  
**Development:** missing URL logs a warning and uses **regional-only** basemap (app still runs).

Optional overview-only local test: `VITE_MAP_BASEMAP=overview` (requires overview URL).

---

## 3. Visual checks (overview basemap)

Test at **z4–5** first, then zoom to **z10–14** for handoff.

| Check | Pass |
|-------|------|
| Map opens with **Myanmar centered** (~96.2°E, 20.5°N) | ☐ |
| Cannot zoom out below **minZoom 4.3** | ☐ |
| Pan stops inside overview bounds (~78–112°E, 3–34°N) | ☐ |
| **Ocean** (light blue) and **land** (beige) visible | ☐ |
| **Myanmar Admin 0** outline and **Admin 1** tint/labels visible (z4+) | ☐ |
| **Neighbor countries**: boundaries + **country names** only at low zoom — not dense foreign cities | ☐ |
| **No OSM roads / buildings** in the basemap at z4–8 | ☐ |
| **No POI/building tiles** from PMTiles (app POI pins at detail zoom are OK—see §4) | ☐ |

**z7–9:** regional water/admin may appear over overview; overview labels still reasonable.  
**z10+:** overview **country/city labels** faded/hidden; **Yangon roads/buildings** from regional tiles dominate.

---

## 4. Existing feature regression

| Check | Pass |
|-------|------|
| **POI overlay** — markers appear when zoomed in; click opens selection | ☐ |
| **Search** — pick a result; map flies to location; result still sensible | ☐ |
| **Route line** — directions draw **above** basemap; connectors + start/end visible | ☐ |
| **Route / report UI** — planner and feedback still usable | ☐ |
| **Place detail panel** — opens for a selected POI | ☐ |

---

## 5. Console / network

| Check | Pass |
|-------|------|
| No **`source-layer` does not exist** / unknown layer errors | ☐ |
| No **`pmtiles://` protocol** / failed to register protocol errors | ☐ |
| No **404** on overview `.pmtiles` URL in Network | ☐ |
| No **CORS** blocked on overview or regional PMTiles | ☐ |
| Dev: `[map] composed style: overview base + regional detail` when URL configured | ☐ |

Useful dev console (localhost):

```js
window.__MAP_SOURCES__()   // includes "overview" and "local-basemap"
window.__MAP_LAYERS__().map(l => l.id).filter(id => id.startsWith('overview-'))
```

---

## 6. Rollback

If overview breaks production or staging:

1. **Fast:** Remove or comment `VITE_OVERVIEW_PMTILES_URL` and redeploy web — map falls back to **regional-only** (dev warns; prod requires URL only when overview-only mode is on).
2. **URL fix:** Point env to last known good `.pmtiles` URL on CDN/R2.
3. **Deploy:** Revert the web deployment to the previous release.
4. **Tiles:** Re-upload prior overview `.pmtiles` object on R2 if the archive is corrupt (see [overview-pmtiles-qa.md](./overview-pmtiles-qa.md)).

Regional tiles (`VITE_BASEMAP_PMTILES_URL`) are independent—rollback overview env does not remove Yangon detail.

---

## Related docs

- [Overview local dev](./pmtiles/overview-local-dev.md)
- [Overview tile build QA](./overview-pmtiles-qa.md)
- [PMTiles release workflow](./pmtiles/pmtiles-release-workflow.md)
