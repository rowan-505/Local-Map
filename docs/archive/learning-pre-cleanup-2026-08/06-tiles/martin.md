---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Martin dynamic vector tile server
---

# Martin

Optional **dynamic** vector tiles from PostGIS — for selected shared overlays (e.g. dashboard building previews), not the static national basemap.

## Location

[`infrastructure/tiles/martin/`](../../infrastructure/tiles/martin/)

## Deploy

`render.yaml` at repo root defines `local-map-martin` Docker service on Render.

## Local config

`infrastructure/tiles/martin/config.local.yaml` — keep pool small against Supabase pooler.

## Usage

- Dashboard may use Martin for dynamic layers when configured
- Web optional overlay via `VITE_MARTIN_TILE_URL`
- **Not** a substitute for PMTiles basemap

## Related docs

- [Tiles overview](tiles-overview.md)
- [Render API](../09-deployment/render-api.md)
