# Deployment

| Piece | Host |
|-------|------|
| Web + Dashboard | Vercel |
| API (+ Martin if used) | Render (or current host) |
| Database | Supabase (PostGIS) |
| Tiles | Cloudflare R2 / CDN |

## Before production

- API auth on protected routes
- Zod validation + rate limits on sensitive paths
- CORS locked (`CORS_ORIGIN`)
- Secrets not in frontend
- Migrations applied and indexed
- Audit for admin / destructive actions
- Tile packages published with checksum / version
- Routing build smoke-tested if shipping directions

## Check locally first

1. `curl` health and OpenAPI.
2. Web map loads basemap + search.
3. Dashboard login and one review page.
4. No direct DB from clients.

App-specific notes stay next to code READMEs under `apps/` and `infrastructure/`.
