---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Import review API authentication and routes
---

# Import review API

Prefix: `/api/import-review/*`

Separate Supabase `import_review` schema. Bootstrapped **after** API listen (non-blocking).

## Authentication

`AUTH_BYPASS` **does not** apply to these routes.

### Mode A — `IMPORT_REVIEW_ADMIN_TOKEN` set

Send header: `x-import-review-admin-token: <exact token>`

- Missing → `401`
- Wrong → `403`
- Bearer JWT ignored for access

### Mode B — token unset

Send `Authorization: Bearer <jwt>` from `POST /auth/login`

- JWT must include `"roles":["admin"]`

CORS exposes `x-import-review-admin-token` for browser dashboards.

## Curl examples

```bash
npm run curl-examples:import-review-auth --prefix apps/api
```

## Full auth doc (archived verbatim)

[`docs/archive/old-docs/apps/api/docs/import-review-auth.md`](../archive/old-docs/apps/api/docs/import-review-auth.md)

## Dashboard dev token

`NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` for local dashboard — see [Dashboard import review](../05-dashboard/import-review.md).

## Historical QA / status docs

See [`docs/archive/old-docs/import-review/`](../archive/old-docs/import-review/) for checklists, promotion contracts, and status snapshots.

## Related docs

- [Import review (dashboard)](../05-dashboard/import-review.md)
- [Review and promotion](../07-data-pipeline/review-and-promotion.md)
