# API

Fastify + TypeScript + Zod. This is the only app that accesses the database.

## Run

```bash
cd apps/api && npm install && npm run prisma:generate && npm run dev
```

- App: http://localhost:3001
- Swagger: http://localhost:3001/docs
- Generated ref: [`apps/api/docs/API.md`](../apps/api/docs/API.md)

## Module pattern

```text
apps/api/src/modules/<domain>/
  <domain>.routes.ts → schema → service → repo
```

Keep route handlers thin. Use raw SQL for geospatial and search-heavy work.

## Main route groups

| Path | Purpose |
|------|---------|
| `/health` | Health |
| `/auth/*` | Sessions / accounts |
| `/public/*` | Public map search and details |
| `/core-review/*` | Dashboard entity review |
| `/api/import-review/*` | Import review |
| `/api/routing/*` | Directions (Valhalla adapter) |

## Auth rule

Frontend hiding is not security. Every protected action must check permissions in the API.

Entry: `src/server.ts` → `src/app.ts`.
