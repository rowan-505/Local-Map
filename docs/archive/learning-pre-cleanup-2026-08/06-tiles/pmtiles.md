---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Regional and overview PMTiles build workflow
---

# PMTiles

Full runbook: [`infrastructure/tiles/pmtiles/README.md`](../../infrastructure/tiles/pmtiles/README.md)

## Phase diagram

```text
export   PostGIS (tiles.*_v)  →  exports/<region>/*.geojson
build    exports/*.geojson     →  regions/<region>/<region>-<version>.pmtiles
upload   .pmtiles              →  Cloudflare R2
```

## Command decision

| Situation | Command |
|-----------|---------|
| GeoJSON fresh on disk | `npm run tiles:build -- <region> <version>` |
| DB changed or new region | `npm run tiles:rebuild -- <region> <version>` |
| Export only | `npm run tiles:export -- <region> <version>` |
| Upload to R2 | `npm run tiles:upload:r2 -- …` |

## Overview tiles

[`infrastructure/tiles/pmtiles/overview/README.md`](../../infrastructure/tiles/pmtiles/overview/README.md)

```bash
npm run tiles:build:overview
npm run tiles:rebuild:overview
```

## Local serve

```bash
npm run tiles:serve
```

## Archived QA / guides

- [`pmtiles-release-workflow.md`](../archive/old-docs/tiles/pmtiles/pmtiles-release-workflow.md)
- [`overview-pmtiles-qa.md`](../archive/old-docs/tiles/overview-pmtiles-qa.md)
- [`overview-web-integration-qa.md`](../archive/old-docs/tiles/overview-web-integration-qa.md)
- [`pmtiles-r2-beginner-guide.md`](../archive/old-docs/tiles/pmtiles-r2-beginner-guide.md)
- [`boundary-source-inspection.md`](../archive/old-docs/tiles/boundary-source-inspection.md)

## Related docs

- [Tiles overview](tiles-overview.md)
- [R2 / CDN](r2-cdn.md)
