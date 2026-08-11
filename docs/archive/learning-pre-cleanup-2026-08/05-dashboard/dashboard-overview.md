---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Admin dashboard application structure
---

# Dashboard overview

`apps/dashboard` — Next.js 16 admin UI. **API consumer only** — never connects to PostgreSQL.

## Entry flow

```text
src/app/layout.tsx
  → src/app/page.tsx (redirects to /dashboard)
  → src/app/(admin)/layout.tsx (sidebar shell)
  → src/app/(admin)/dashboard/.../page.tsx
```

## API client

`src/lib/api.ts` — large typed client using `NEXT_PUBLIC_API_BASE_URL`.

## Major sections

| Path | Feature folder | Purpose |
|------|----------------|---------|
| `/dashboard/core-review` | `features/core-review` | Edit published core entities |
| `/dashboard/import-review` | `features/import-review` | Review/promote OSM imports |
| `/dashboard/core-verification` | `features/core-verification` | Verification workflows |
| `/dashboard/transport` | `features/transport` | Bus routes, stops, terminals |
| `/dashboard/routing` | `features/routing-admin` | Routing build admin |
| `/dashboard/references` | reference pages | Lookup table CRUD |
| `/dashboard/users`, `/reports`, `/point-management` | user/report admin | Operations |

## Map previews

MapLibre used on pages that need geometry preview/edit. Config: `src/config/map.ts`, `src/lib/basemaps/`.

Do not load MapLibre on list-only pages unnecessarily.

## Auth

Login: `src/app/login/` — JWT from API `POST /auth/login`.

Import-review may use `x-import-review-admin-token` in dev — see [Import review](import-review.md).

## Run & deploy

```bash
cd apps/dashboard && npm run dev    # :3000
```

Vercel: [`apps/dashboard/vercel.json`](../../apps/dashboard/vercel.json)

## Related docs

- [Core review](core-review.md)
- [Import review](import-review.md)
- [Geometry editor](geometry-editor.md)
- [Dashboard debugging](../10-debugging/dashboard-debugging.md)
