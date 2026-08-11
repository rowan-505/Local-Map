---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Basemap layer ordering conventions
---

# Layer order

MapLibre draws layers bottom-to-top in style JSON order.

## Typical stack (bottom → top)

1. Background / land
2. Water polygons
3. Landuse
4. Buildings (fill)
5. Roads (casing then fill)
6. Road labels
7. Place / POI labels
8. **Client overlays** (search highlight, directions route, user location)

## Implementation

- Static order defined in `packages/map-style/*.json`
- Dynamic inserts via `apps/web/src/features/map/lib/maplibre/mapLayerInsert.ts`

## Related docs

- [Map style](map-style.md)
- [MapLibre rendering](../04-web-map/maplibre-rendering.md)
