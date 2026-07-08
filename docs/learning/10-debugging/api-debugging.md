---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: API troubleshooting
---

# API debugging

## Swagger

`http://localhost:3001/docs` — try routes with JWT from `POST /auth/login`.

## Common issues

| Issue | Check |
|-------|-------|
| 401 on protected routes | Token expiry, `JWT_SECRET`, not using `AUTH_BYPASS` in prod |
| CORS errors | `CORS_ORIGIN`, API logs for blocked origin |
| Import-review 503 | `/health/import-review` — Supabase bootstrap still running or failed |
| Import-review 401/403 | [Import review API](../03-api/import-review-api.md) token vs JWT mode |
| Routing errors | `ROUTING_ENABLED`, `VALHALLA_BASE_URL`, engine logs |

## Regenerate API docs

```bash
cd apps/api && npm run docs:api
```

## QA checklists (archive)

`docs/archive/old-docs/apps/api/docs/*-qa-checklist.md`

## Related docs

- [API overview](../03-api/api-overview.md)
- [Debugging overview](debugging-overview.md)
