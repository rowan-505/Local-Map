---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Fastify API structure, docs, and main route families
---

# API overview

The API (`apps/api`) is the **only** application layer that accesses PostgreSQL. Fastify + TypeScript + Zod.

## Entry points

| File | Role |
|------|------|
| `src/server.ts` | Boot, env, listen on `PORT` |
| `src/app.ts` | Plugins, CORS, route registration |
| `src/config/env.ts` | Env validation |

## Run locally

```bash
cd apps/api
npm install && npm run prisma:generate && npm run dev
```

Default: `http://localhost:3001`

## Documentation sources

| Resource | URL / path |
|----------|------------|
| Interactive Swagger | `http://localhost:3001/docs` |
| OpenAPI JSON | `http://localhost:3001/openapi.json` |
| Generated Markdown | [`apps/api/docs/API.md`](../../apps/api/docs/API.md) |
| Regenerate API.md | `npm run docs:api` (in `apps/api`) |
| OpenAPI setup notes | [Module pattern](module-pattern.md) |

**Needs verification:** Archived route inventory from 2026-05-08 in [`docs/archive/old-docs/api-route-inventory.md`](../archive/old-docs/api-route-inventory.md) may be stale — prefer live OpenAPI.

## Main route families (registered in `app.ts`)

| Prefix / path | Module | Audience |
|---------------|--------|----------|
| `/health` | built-in | Ops |
| `/auth/*` | `auth` | Public + sessions |
| `/public/*` | `public-map` | Web map (search, POI, viewport) |
| `/core-review/*` | `core-review` | Dashboard entity CRUD |
| `/api/import-review/*` | `import-review` | Dashboard import review |
| `/api/routing/*` | `routing` | Public directions |
| `/admin/routing/*` | `routing-admin` | Routing builds |
| `/transport/*` | `transport` | Bus/express data |
| `/admin/ref/*` | `ref` | Reference tables |
| Places, streets, buildings, addresses, categories… | various | Dashboard + public details |

## Module pattern

See [Module pattern](module-pattern.md): `routes → schema → service → repo`.

## Auth

- JWT Bearer via `@fastify/jwt`
- `AUTH_BYPASS=true` in dev only (not import-review)
- Import-review has separate guard — [Import review API](import-review-api.md)

## CORS

Non-production: allows `localhost:3000` and `localhost:5173`.  
Production: **`CORS_ORIGIN`** must list web + dashboard URLs.

## Database access

- Primary: `DATABASE_URL` via Prisma + `pg`
- Import-review: separate Supabase connection (bootstrapped after listen)

## Tests & scripts

```bash
npm run typecheck
npm run test:unified-search
npm run rebuild:search-index
node ../../tools/core-review-api-regression.mjs
```

## Related docs

- [Auth](auth.md)
- [Search API](search-api.md)
- [Core review API](core-review-api.md)
- [Import review API](import-review-api.md)
- [API debugging](../10-debugging/api-debugging.md)
