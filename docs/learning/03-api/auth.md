---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Authentication and authorization in the API
---

# Auth

## Public auth (`/auth/*`)

- Registration, login, refresh tokens, email verification, password reset
- JWT access tokens via `Authorization: Bearer <token>`
- Session metadata in `app_auth` schema

## Protected routes

`app.authenticate` decorator (see `apps/api/src/plugins/auth.js`).

Role checks use `request.user.roles` (`admin`, `editor`, etc.).

## Development bypass

`AUTH_BYPASS=true` — accepts any bearer and injects dev admin user.

**Does not apply to `/api/import-review/*`** — those routes always use import-review guard.

## Import review auth

Separate modes — see [Import review API](import-review-api.md).

## QA checklists (archived)

- [`auth-mvp-manual-test-checklist.md`](../archive/old-docs/apps/api/docs/auth-mvp-manual-test-checklist.md)
- [`admin-users-qa-checklist.md`](../archive/old-docs/apps/api/docs/admin-users-qa-checklist.md)
- [`saved-places-qa-checklist.md`](../archive/old-docs/apps/api/docs/saved-places-qa-checklist.md)
- [`points-qa-checklist.md`](../archive/old-docs/apps/api/docs/points-qa-checklist.md)

## Related docs

- [API overview](api-overview.md)
- [Production checklist](../09-deployment/production-checklist.md)
