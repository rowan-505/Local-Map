---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Deployment troubleshooting
---

# Deployment debugging

## API on Render

- **No open ports:** ensure `server.ts` binds `PORT` before slow DB work
- Check Render logs for `[api] listening`
- Verify `CORS_ORIGIN` includes Vercel URLs

## Vercel

- Build logs for `apps/web` / `apps/dashboard`
- Env vars scoped to correct project

## R2 / tiles

```bash
curl -I -H "Origin: <your-origin>" "<pmtiles-url>"
```

See [Cloudflare R2](../09-deployment/cloudflare-r2.md)

## Supabase

- Connection string uses pooler correctly for serverless vs long-running API
- Import-review separate connection if applicable

## Related docs

- [Production checklist](../09-deployment/production-checklist.md)
- [Deployment overview](../09-deployment/deployment-overview.md)
