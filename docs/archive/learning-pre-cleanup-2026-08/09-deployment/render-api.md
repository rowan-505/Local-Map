---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Render deployment for API and Martin
---

# Render API

## API service

`apps/api` deployed to Render.

Critical startup behavior (`server.ts`):

- Binds `PORT` and `HOST=0.0.0.0` immediately
- Import-review DB bootstrap runs **after** listen (non-blocking)

## Martin

[`render.yaml`](../../render.yaml) — Docker service `local-map-martin` from `infrastructure/tiles/martin/`.

Requires `DATABASE_URL` on Render.

## OpenAPI in production

Optional `PUBLIC_API_URL` for Swagger server list — see archived [`openapi.md`](../archive/old-docs/apps/api/docs/openapi.md).

## Related docs

- [API overview](../03-api/api-overview.md)
- [Martin](../06-tiles/martin.md)
