# Transport mutation latency — pool ops confirmation

**Related:** [`transport-mutation-latency-audit-2026-07-24.md`](./transport-mutation-latency-audit-2026-07-24.md)  
**Date:** 2026-07-28

## Code behavior (unchanged default)

- When `DATABASE_URL` has no `connection_limit`, the API appends `PRISMA_CONNECTION_LIMIT` or default **`1`** ([`apps/api/src/db/prisma.ts`](../../apps/api/src/db/prisma.ts)).
- Startup logs: `[api] prisma connection_limit=<n>` (never logs the URL).
- Interactive transport TX options remain `maxWait: 10s`, `timeout: 30s`.

## Manual Render confirmation (required under load)

1. Open the Render API service logs and find a recent boot line:
   ```text
   [api] prisma connection_limit=<n>
   ```
2. If `<n>` is **`1`**, set environment:
   ```text
   PRISMA_CONNECTION_LIMIT=3
   ```
   Or ensure `DATABASE_URL` already includes `connection_limit=3` (URL wins over env).
3. Redeploy / restart the API.
4. Confirm logs show `connection_limit=3`.
5. Do **not** raise above 3 until Supabase pooler budget and concurrent load are measured.

## Local note

Local developer `.env` may already set `connection_limit=5` on the transaction pooler (`:6543`). That does not change production until Render is updated.

## This change set

No automatic production env change was applied. Pool confirmation remains an ops step.
