# Tiles

Tiles are for **rendering only**. PostGIS stays the source of truth.

## Pieces

| Piece | Path | Role |
|-------|------|------|
| Regional PMTiles | `infrastructure/tiles/pmtiles/` | Region basemaps |
| Overview PMTiles | `infrastructure/tiles/pmtiles/overview/` | Low-zoom national |
| Style | `packages/map-style/` | MapLibre style |
| Martin | `infrastructure/tiles/martin/` | Optional dynamic MVT |
| R2 | `infrastructure/cloud/r2/` | CDN hosting |

## V2 packages

16 packages: 1 overview + 15 region/state. At runtime load overview first, then only visible regions.

## Build flow

```text
PostGIS tiles views → GeoJSON → tippecanoe → .pmtiles → R2
```

Ops detail: [`infrastructure/tiles/README.md`](../infrastructure/tiles/README.md).
