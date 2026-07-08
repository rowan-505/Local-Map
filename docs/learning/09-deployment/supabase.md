---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Supabase production database
---

# Supabase

Production Postgres hosted on Supabase — `DATABASE_URL` for API.

## Migrations

Apply SQL from `infrastructure/database/migrations/supabase/` in order via SQL Editor or deploy process.

**MCP is inspect-only** — no DDL through Cursor MCP.

## Schemas (typical production)

`core`, `ref`, `system`, `tiles`, `app_auth`

Separate `import_review` may use additional Supabase project/connection.

## Introspection

```bash
npm run db:erd:supabase
```

## Setup

[`.cursor/rules/09-supabase-cursor-setup.mdc`](../../.cursor/rules/09-supabase-cursor-setup.mdc)

## Related docs

- [Database overview](../02-database/database-overview.md)
- [Migrations](../02-database/migrations.md)
