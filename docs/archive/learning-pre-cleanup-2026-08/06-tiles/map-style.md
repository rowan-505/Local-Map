---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Shared MapLibre style package
---

# Map style

Shared package: [`packages/map-style/`](../../packages/map-style/)

## Key files

| File | Purpose |
|------|---------|
| `base-map.json` | Regional basemap style |
| `overview-map.json` | Overview basemap style |
| `registerPmtilesProtocol.ts` | PMTiles protocol for MapLibre |
| `regionalZoomPolicy.ts` | Which packages load per zoom |
| `overviewConstants.ts`, `basemapSource.ts` | Source URL helpers |

## Consumers

- `apps/web` — postinstall links package
- `apps/dashboard` — postinstall links package

## Rules

- Style JSON is **rendering configuration only**
- No business logic in style files
- No important data stored only in tiles

## Tests

```bash
npm test --prefix packages/map-style
# or from root:
npm run test:overview-style
```

## Related docs

- [MapLibre rendering](../04-web-map/maplibre-rendering.md)
- [Layer order](layer-order.md)
