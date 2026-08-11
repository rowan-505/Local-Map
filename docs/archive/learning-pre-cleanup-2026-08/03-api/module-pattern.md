---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: API module file layout and conventions
---

# API module pattern

Each domain lives under `apps/api/src/modules/<domain>/`:

```text
<domain>.routes.ts    Fastify plugin, thin handlers
<domain>.schema.ts    Zod request/response schemas
<domain>.service.ts   Business logic
<domain>.repo.ts        SQL / Prisma data access
<domain>.openapi.ts   Swagger metadata (optional)
<domain>.types.ts     Shared types
```

## Registration

Modules export a Fastify plugin registered in `apps/api/src/app.ts`:

```typescript
await app.register(coreReviewRoutes, { prefix: "/core-review" });
```

## OpenAPI

- `@fastify/swagger` registered before routes
- `@fastify/swagger-ui` after all routes
- Per-module `*.openapi.ts` files feed route `schema` objects
- Regenerate checked-in docs: `npm run docs:api` → `apps/api/docs/API.md`

See archived [`openapi.md`](../archive/old-docs/apps/api/docs/openapi.md) for Swagger UI usage (JWT, `PUBLIC_API_URL`, production notes).

## Error responses

Shared helper: `apps/api/src/lib/api-error-response.ts`

## When to use raw SQL

- Geospatial queries, search ranking, complex PostGIS
- Search index rebuild
- Core-review list queries with filters

Prisma where models already exist and queries are straightforward.

## Related docs

- [API overview](api-overview.md)
