---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Domains and DNS for production services
---

# Domains & DNS

**Needs verification:** Exact production domain names are not committed in this repo. Check your Vercel, Cloudflare, and Render dashboards.

## Typical mapping

| Service | Expected pattern |
|---------|------------------|
| Public web | `map.<yourdomain>` or Vercel default |
| Dashboard | `admin.<yourdomain>` or Vercel default |
| API | `api.<yourdomain>` on Render |
| Tiles CDN | R2 public host or `tiles.<yourdomain>` |
| Martin | Render service URL (internal or public) |

## CORS & tile origins

When domains change, update:

1. API `CORS_ORIGIN`
2. R2 `cors.json` allowed origins
3. Vercel env vars for basemap URLs

## Related docs

- [Vercel](vercel.md)
- [Cloudflare R2](cloudflare-r2.md)
