---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: MapLibre basemap and layer composition in web
---

# MapLibre rendering

## Stack

- **MapLibre GL JS** — map engine
- **PMTiles** — static basemap protocol (`packages/map-style/registerPmtilesProtocol.ts`)
- **maplibre-gl-complex-text** — Myanmar complex text shaping
- Shared styles: `packages/map-style/base-map.json`, `overview-map.json`

## Key files

| Path | Role |
|------|------|
| `features/map/components/MapView.tsx` | Main map instance |
| `features/map/lib/maplibre/` | Style composition, basemap modes, layer insert |
| `features/map/config/` | PMTiles URLs, viewport, regional loading |
| `lib/basemaps/` | Basemap manifest resolution |

## Regional loading policy

Do **not** load all regional PMTiles at once.

```text
Low zoom: overview only
Regional zoom: overview + visible region
Near border: optional adjacent region
```

See `packages/map-style/regionalZoomPolicy.ts`.

## Dynamic overlays

- Search result highlights via API geometry endpoint
- Directions route GeoJSON overlay
- User location layers (client-only, no API)
- Optional Martin overlay when `VITE_MARTIN_TILE_URL` configured

## Tests

```bash
cd apps/web && npm run test:map
```

## QA (archived)

[`regional-pmtiles-qa.md`](../archive/old-docs/apps/web/docs/regional-pmtiles-qa.md)

## Related docs

- [Layer order](../06-tiles/layer-order.md)
- [Map rendering debugging](../10-debugging/map-rendering-debugging.md)
