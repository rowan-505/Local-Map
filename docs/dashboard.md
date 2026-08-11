# Dashboard

Next.js admin UI. Path: `apps/dashboard`. **API only** — no Prisma, no direct DB.

## Run

```bash
cd apps/dashboard && npm install && npm run dev
```

http://localhost:3000

## Main areas

| Area | Purpose |
|------|---------|
| Core review | Edit / verify published entities |
| Import review | Promote staging conflicts into core |
| Reference | Lookup tables and config |
| Ops | Tiles, routing builds, health (as built) |

API client: `apps/dashboard/src/lib/api.ts`.

## Rules

- Paginate large lists.
- Do not load MapLibre on pages that do not need a map.
- Destructive actions need confirmation.
- Auth is enforced by the API, not by hiding buttons.
