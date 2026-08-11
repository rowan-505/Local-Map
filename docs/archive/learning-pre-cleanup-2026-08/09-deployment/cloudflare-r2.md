---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Cloudflare R2 tile deployment
---

# Cloudflare R2

See also [R2 / CDN (tiles)](../06-tiles/r2-cdn.md).

## Bucket

`coremap-tiles-prod` (per repo docs)

## Upload

```bash
npm run tiles:upload:r2 -- <local-path> <region> <version>
npm run tiles:upload:regions
npm run tiles:verify:regions
```

## CORS

[`infrastructure/cloud/r2/cors.json`](../../infrastructure/cloud/r2/cors.json)

Update allowed origins when production domains change.

## Related docs

- [PMTiles](../06-tiles/pmtiles.md)
- [Production checklist](production-checklist.md)
