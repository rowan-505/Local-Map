---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Vercel deployment for web and dashboard
---

# Vercel

## Apps

| App | Config |
|-----|--------|
| Web | [`apps/web/vercel.json`](../../apps/web/vercel.json) — SPA rewrites, geolocation policy |
| Dashboard | [`apps/dashboard/vercel.json`](../../apps/dashboard/vercel.json) — `framework: nextjs` |

## Required env (production)

**Web:** `VITE_API_BASE_URL`, basemap/PMTiles public URLs

**Dashboard:** `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_BASEMAP_*`, `NEXT_PUBLIC_OVERVIEW_PMTILES_URL`

## CORS

API `CORS_ORIGIN` must include Vercel deployment URLs.

## Related docs

- [Production checklist](production-checklist.md)
- [Web overview](../04-web-map/web-overview.md)
