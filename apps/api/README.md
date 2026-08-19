# CoreMap API

Fastify backend for CoreMap (`apps/api`). See [`docs/api.md`](../../docs/api.md) and repo root [`AGENTS.md`](../../AGENTS.md).

## Development

```bash
npm install
npm run prisma:generate
npm run dev
```

Default listen address: `http://0.0.0.0:3001` (override with `PORT`).

Environment files load in order: repo root `.env`, then `apps/api/.env` (api wins on duplicate keys). See [`env.example`](./env.example) for documented variables.

### Routing / Valhalla (local)

| Variable | Default | Purpose |
|----------|---------|---------|
| `ROUTING_ENABLED` | `false` | Master gate for public directions API |
| `ROUTING_DEFAULT_ENGINE` | `valhalla` | Engine adapter selection |
| `VALHALLA_BASE_URL` | `http://localhost:8002` | Internal Valhalla HTTP base (no trailing slash) |
| `ROUTING_REQUEST_TIMEOUT_MS` | `8000` | Upstream timeout for route requests |
| `ROUTING_PUBLIC_PROFILES` | `walk,car,motorcycle` | Comma-separated profiles exposed when routing is enabled |

Start local Valhalla: [`infrastructure/routing/valhalla/README.md`](../../infrastructure/routing/valhalla/README.md).

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

  This runs `scripts/generate-api-docs.ts`, which loads the same Fastify app as production (`buildApp()`), calls `app.swagger()`, and writes **`apps/api/docs/API.md`**. It does not duplicate route definitions.

  Human-oriented API docs index: [`docs/api.md`](../../docs/api.md).

  **When to re-run:** After any change to Fastify route `schema` objects or module OpenAPI helpers (`*.openapi.ts`). Commit the updated `apps/api/docs/API.md` if you want the repo to stay in sync.

## Typecheck

```bash
npm run typecheck
```
