---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Pre-production and go-live checklist
---

# Production checklist

From [`AGENTS.md`](../../AGENTS.md) security and V2 readiness requirements.

## Security

- [ ] Backend authorization on every protected route
- [ ] Zod/input validation on API
- [ ] Rate limits on sensitive routes (`@fastify/rate-limit`)
- [ ] Audit logs for admin/destructive actions
- [ ] No secrets in frontend bundles
- [ ] `CORS_ORIGIN` set in production (not empty)
- [ ] `AUTH_BYPASS` **not** set in production
- [ ] `JWT_SECRET` strong and platform-managed
- [ ] Import-review uses proper token or admin JWT (not bypass)
- [ ] Public APIs use `public_id` where appropriate
- [ ] Point ledger immutable; corrections via reversal rows

## Database

- [ ] Supabase migrations applied in order
- [ ] Seeds applied after dependent migrations
- [ ] `checks/supabase/` pass
- [ ] GIST/GIN indexes on search and geo paths
- [ ] No ad-hoc production DDL outside migrations

## API (Render)

- [ ] `PORT` injected by platform (not overridden by committed `.env`)
- [ ] `DATABASE_URL` configured
- [ ] Health endpoint responds before long bootstraps block port
- [ ] `/docs` reachable if intentionally public
- [ ] `ROUTING_ENABLED` + `VALHALLA_BASE_URL` if directions live

## Web (Vercel)

- [ ] `VITE_API_BASE_URL` points to production API
- [ ] PMTiles URLs point to R2/CDN (not localhost)
- [ ] `npm run build` succeeds
- [ ] Map loads overview + regional tiles per zoom policy
- [ ] Search index rebuilt on production DB

## Dashboard (Vercel)

- [ ] `NEXT_PUBLIC_API_BASE_URL` set
- [ ] Basemap env vars use production URLs (see `basemapEnv.ts` localhost guard)
- [ ] No `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` in production

## Tiles (R2)

- [ ] CORS applied: `wrangler r2 bucket cors set …`
- [ ] Versioned paths published (no in-place overwrite of live objects)
- [ ] `npm run tiles:verify:regions` passed before cutover

## Routing

- [ ] Valhalla build published and smoke-tested
- [ ] API routing adapter tested for walk/drive/motorcycle

## Monitoring

- [ ] Error logs do not leak secrets
- [ ] Import-review readiness 503 behavior understood when Supabase slow

## Related docs

- [Deployment overview](deployment-overview.md)
- [Debugging overview](../10-debugging/debugging-overview.md)
