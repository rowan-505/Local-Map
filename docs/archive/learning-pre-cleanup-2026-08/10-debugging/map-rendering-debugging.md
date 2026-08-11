---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Map and tile rendering troubleshooting
---

# Map rendering debugging

## Web tests

```bash
cd apps/web && npm run test:map
```

## Common issues

| Issue | Check |
|-------|-------|
| Blank basemap | PMTiles URL, CORS on R2, browser network tab |
| Wrong region loaded | `regionalZoomPolicy.ts`, zoom level |
| Myanmar labels missing | Font glyphs in `public/fonts/`, complex-text plugin |
| 403 on tiles | R2 CORS `Origin` header |
| Martin overlay fails | `VITE_MARTIN_TILE_URL` optional — should degrade gracefully |

## Local tiles

```bash
npm run tiles:serve
```

## QA (archive)

- [`regional-pmtiles-qa.md`](../archive/old-docs/apps/web/docs/regional-pmtiles-qa.md)
- [`overview-pmtiles-qa.md`](../archive/old-docs/tiles/overview-pmtiles-qa.md)

## Related docs

- [MapLibre rendering](../04-web-map/maplibre-rendering.md)
- [PMTiles](../06-tiles/pmtiles.md)
