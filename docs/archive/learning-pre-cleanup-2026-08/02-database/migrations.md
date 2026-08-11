---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: How to apply and author migrations
---

# Migrations

## Location

```text
infrastructure/database/migrations/
├── local/       ← local raw/staging/system workflow
└── supabase/    ← production DDL (core, ref, system, tiles, app_auth)
```

## Rules

1. **All DDL changes** go in numbered migration SQL files — never ad-hoc on production.
2. Apply **in order** (e.g. `021_…` then `022_…`).
3. Follow with matching **seeds** in `seeds/supabase/` when reference data is required.
4. Run **checks** in `checks/supabase/` to verify.

## Local vs Supabase

| Target | Apply via |
|--------|-----------|
| Local raw DB | `psql "$LOCAL_RAW_DATABASE_URL" -f …` or pipeline scripts |
| Supabase | SQL Editor or deploy process — **not** via MCP writes |

## Import-review migrations

Separate folder: [`infrastructure/database/migrations/import-review/README.md`](../../infrastructure/database/migrations/import-review/README.md)

## Cursor / agent rules

Database inspection is read-only by default. See:

- [`infrastructure/.cursor/rules/DATABASE_RULES.mdc`](../../infrastructure/.cursor/rules/DATABASE_RULES.mdc)
- [`.cursor/rules/09-supabase-cursor-setup.mdc`](../../.cursor/rules/09-supabase-cursor-setup.mdc)

## Related docs

- [Database overview](database-overview.md)
- [ERD](erd.md)
