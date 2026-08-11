---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Tile system overview — PMTiles, Martin, map style
---

# Tiles overview

**Tiles are rendering only.** Database remains source of truth.

## Components

| System | Path | Role |
|--------|------|------|
| Regional PMTiles | `infrastructure/tiles/pmtiles/` | OSM-derived basemap per region |
| Overview PMTiles | `infrastructure/tiles/pmtiles/overview/` | National z0–z8 context |
| Map style | `packages/map-style/` | MapLibre JSON + protocol |
| Martin | `infrastructure/tiles/martin/` | Dynamic PostGIS MVT (overlays) |
| R2 CDN | `infrastructure/cloud/r2/` | Production tile hosting |

## V2 national packages

16 packages planned: 1 overview + 15 region/state PMTiles.

Runtime loading — do not load all regions at once. See [MapLibre rendering](../04-web-map/maplibre-rendering.md).

## Build pipeline (summary)

```text
PostGIS tiles.*_v views → GeoJSON export → tippecanoe → .pmtiles → R2
```

Commands: [Common commands](../01-getting-started/common-commands.md)

## Related docs

- [PMTiles](pmtiles.md)
- [Martin](martin.md)
- [Map style](map-style.md)
- [R2 / CDN](r2-cdn.md)

Operational README: [`infrastructure/tiles/README.md`](../../infrastructure/tiles/README.md)
