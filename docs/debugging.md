# Debugging

Start with the layer that fails.

| Symptom | Check |
|---------|--------|
| API 5xx / CORS | `apps/api` logs, env, `/health`, Swagger |
| Empty map / no basemap | PMTiles URL, protocol register, R2 CORS |
| Search wrong / empty | API `/public` search, DB indexes, language |
| Dashboard blank / 401 | Token, `NEXT_PUBLIC_API_BASE_URL`, API auth |
| Import / promote fail | Pipeline target URL, classification report, IR API |
| Slow spatial query | BBox filter first; GIST indexes; avoid full scans |
| Routing fail | `ROUTING_ENABLED`, Valhalla health, adapter logs |

## Useful habits

- Prefer live OpenAPI over old route inventories.
- Reproduce with the smallest curl or UI step.
- Confirm local vs Supabase target before any write.
- Archive one-off audit notes under `docs/archive/` — do not add them to this guide set.
