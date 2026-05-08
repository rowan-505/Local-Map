# Local Map API

Fastify backend for Local Map (`apps/api`). See the repo root [`AGENTS.md`](../../AGENTS.md) for architecture boundaries.

## Development

```bash
npm install
npm run prisma:generate
npm run dev
```

Default listen address: `http://0.0.0.0:3001` (override with `PORT`).

## Build and run

```bash
npm run build
npm start
```

## API documentation

- **Interactive:** With the server running, open [`/docs`](http://localhost:3001/docs) (Swagger UI) and [`/openapi.json`](http://localhost:3001/openapi.json) for the raw OpenAPI 3 spec.
- **Markdown (checked in):** Regenerate the human-readable reference with:

  ```bash
  npm run docs:api
  ```

  This runs `scripts/generate-api-docs.ts`, which loads the same Fastify app as production (`buildApp()`), calls `app.swagger()`, and writes **`docs/API.md`**. It does not duplicate route definitions.

  **When to re-run:** After any change to Fastify route `schema` objects or module OpenAPI helpers (`*.openapi.ts`). Commit the updated `docs/API.md` if you want the repo to stay in sync.

## Typecheck

```bash
npm run typecheck
```
