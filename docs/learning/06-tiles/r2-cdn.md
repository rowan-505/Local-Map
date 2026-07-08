---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Cloudflare R2 tile hosting and CORS
---

# R2 / CDN

Production PMTiles hosted on **Cloudflare R2**.

## Bucket

Documented name: `coremap-tiles-prod`  
Example path: `basemaps/yangon/v2/basemap.pmtiles`

## CORS

Config: [`infrastructure/cloud/r2/cors.json`](../../infrastructure/cloud/r2/cors.json)

```bash
wrangler r2 bucket cors set coremap-tiles-prod --file infrastructure/cloud/r2/cors.json
```

Full guide: [`infrastructure/cloud/r2/README.md`](../../infrastructure/cloud/r2/README.md)

## Publish rule

**Do not overwrite versioned tile objects in place** for live traffic. Publish new version paths (e.g. `v3/`) and cut over via manifest/`current.json`.

## Archived beginner guide

[`pmtiles-r2-beginner-guide.md`](../archive/old-docs/tiles/pmtiles-r2-beginner-guide.md)

## Related docs

- [PMTiles](pmtiles.md)
- [Cloudflare R2 (deployment)](../09-deployment/cloudflare-r2.md)
