# OpenAPI / Swagger UI

The API exposes machine-readable OpenAPI 3.0.3 metadata and interactive docs.

| URL | Purpose |
|-----|---------|
| `/docs/` | Swagger UI (interactive explorer) |
| `/docs/json` | OpenAPI document (same as below, plugin default) |
| `/openapi.json` | OpenAPI document (stable path for clients and CI) |

Spec metadata:

- **Title:** Local Map API  
- **Version:** Taken from `package.json` (`apps/api`), fallback `1.0.0`  
- **Security scheme:** HTTP Bearer JWT (`Authorization: Bearer <token>`). Use **Authorize** in Swagger UI after logging in via `POST /auth/login`.

## Local usage

1. Set `JWT_SECRET` (required to start the server).
2. Run `npm run dev` or `npm run build && npm start`.
3. Open `http://localhost:3001/docs` (or your `PORT`).
4. For protected routes, call `POST /auth/login`, copy `accessToken`, then click **Authorize** and enter: `Bearer <accessToken>` or paste only the token (depending on UI behavior; Swagger often expects just the raw JWT for Bearer).
5. Optionally set `AUTH_BYPASS=true` in development so `app.authenticate` accepts any bearer string and injects a dev admin user.

## Production (e.g. Render)

1. Deploy the same `apps/api` service; docs are served from the same process (no extra service).
2. **Optional:** set `PUBLIC_API_URL` to your public API base (e.g. `https://your-api.onrender.com`). This only adjusts the **Servers** list in OpenAPI so “Try it out” targets the right host. It must **not** contain database credentials or other secrets.
3. Open `https://<your-host>/docs` and `https://<your-host>/openapi.json`.
4. Ensure your CDN / proxy forwards `/docs` and `/openapi.json` (and static assets under `/docs/*`) to the API.

## Privacy / security

- OpenAPI and Swagger UI describe **routes only**; they do not embed `DATABASE_URL`, `JWT_SECRET`, or other environment values.
- Protecting `/docs` behind VPN or auth is optional and not configured by default; add middleware if you need private docs in production.

## Implementation

- Plugins: `src/plugins/swagger.ts`  
- `@fastify/swagger` is registered **before** route modules; `@fastify/swagger-ui` is registered **after** all routes so the spec includes every path.
