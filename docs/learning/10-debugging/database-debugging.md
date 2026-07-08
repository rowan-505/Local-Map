---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Database troubleshooting
---

# Database debugging

## Introspection

```bash
npm run db:schema:local
npm run db:erd:local
npm run db:erd:supabase
```

## Validation checks

```bash
psql "$DATABASE_URL" -f infrastructure/database/checks/supabase/<check>.sql
```

## Common issues

| Issue | Check |
|-------|-------|
| Slow search | Index rebuild status, `EXPLAIN ANALYZE` |
| Geometry errors | SRID 4326, valid GeoJSON |
| ID mismatch local vs prod | Use `public_id`, not numeric `id` |
| Pool exhaustion | Supabase pooler limits; Martin pool size |

## Rules

Read-only MCP inspection only — DDL in migration files.

## Related docs

- [Database overview](../02-database/database-overview.md)
- [Migrations](../02-database/migrations.md)
