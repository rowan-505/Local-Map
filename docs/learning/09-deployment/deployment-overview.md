---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Production deployment topology
---

# Deployment overview

## Topology

```text
Users
  → Vercel (apps/web, apps/dashboard)
  → Render (apps/api, optional Martin)
  → Supabase (PostgreSQL)
  → Cloudflare R2 (PMTiles CDN)
  → Valhalla (routing — hosting Needs verification)
```

## Per component

| Component | Platform | Doc |
|-----------|----------|-----|
| Public web | Vercel | [Vercel](vercel.md) |
| Dashboard | Vercel | [Vercel](vercel.md) |
| API | Render | [Render API](render-api.md) |
| Database | Supabase | [Supabase](supabase.md) |
| PMTiles | Cloudflare R2 | [Cloudflare R2](cloudflare-r2.md) |
| Martin | Render (`render.yaml`) | [Render API](render-api.md) |

## Environment

Production secrets via platform env — never in frontend bundles except `NEXT_PUBLIC_*` / `VITE_*` public URLs.

See [Environment variables](../01-getting-started/environment-variables.md) and [Production checklist](production-checklist.md).

## Related docs

- [Domains & DNS](domains-dns.md)
- [Deployment debugging](../10-debugging/deployment-debugging.md)
