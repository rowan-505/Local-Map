---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Environment variable reference across apps
---

# Environment variables

Never commit `.env` files. Use each app's `env.example` or repo-root `.env.example` as templates.

## API (`apps/api`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Production/core Postgres (Supabase) |
| `PORT` | Listen port (default `3001`; Render injects this) |
| `HOST` | Bind host (default `0.0.0.0`) |
| `JWT_SECRET` | Required for server start |
| `CORS_ORIGIN` | Comma-separated allowed origins (required in production) |
| `AUTH_BYPASS` | Dev only — bypasses JWT (not on import-review) |
| `IMPORT_REVIEW_*` | Separate Supabase connection for import_review schema |
| `IMPORT_REVIEW_ADMIN_TOKEN` | Optional symmetric header auth for import-review |
| `ROUTING_ENABLED` | Gate public directions API |
| `VALHALLA_BASE_URL` | Valhalla HTTP base |
| `RESEND_API_KEY` | Email sending |

Full list: [`apps/api/env.example`](../../apps/api/env.example)

**Load order (local):** `apps/api/.env` then repo-root `.env` (api wins on duplicates). Production: platform-injected env only.

## Web (`apps/web`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base URL (required) |
| Basemap / PMTiles vars | See `apps/web/src/features/map/config/` |

## Dashboard (`apps/dashboard`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | API base URL (required) |
| `NEXT_PUBLIC_BASEMAP_PMTILES_URL` | Regional basemap PMTiles URL |
| `NEXT_PUBLIC_OVERVIEW_PMTILES_URL` | Overview PMTiles URL |
| `NEXT_PUBLIC_BASEMAP_MANIFEST_URL` | Basemap manifest JSON |
| `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` | Dev import-review header (local only) |

See [`apps/dashboard/src/config/map.ts`](../../apps/dashboard/src/config/map.ts).

## Database pipelines (local only)

| Variable | Purpose |
|----------|---------|
| `LOCAL_RAW_DATABASE_URL` | Local raw/staging/system DB — **never** used by web/dashboard |
| `DATABASE_URL` | Supabase / production mirror for promotion |

## Tiles / R2 (operators)

Configured in shell env for upload scripts — see [`infrastructure/cloud/r2/README.md`](../../infrastructure/cloud/r2/README.md).

## Related docs

- [Local setup](local-setup.md)
- [Supabase](../09-deployment/supabase.md)
- [Production checklist](../09-deployment/production-checklist.md)
