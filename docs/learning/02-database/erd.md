---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Entity-relationship diagrams and schema export
---

# ERD

## Generate diagrams

From repo root:

```bash
npm run db:erd:local       # Local DB → mermaid
npm run db:erd:supabase    # Supabase → mermaid
npm run db:schema:local    # Full schema SQL export
```

## Output paths

| Command | Output |
|---------|--------|
| `db:erd:local` | `infrastructure/database/introspection/local/erd/local-current-db.mmd` |
| `db:erd:supabase` | `infrastructure/database/introspection/supabase/erd/current.mmd` |
| `db:schema:local` | `infrastructure/database/introspection/local/schema/local-db-schema.sql` |

Generated files may be gitignored — regenerate when schema changes.

## Archived ERD snapshot

A point-in-time ERD doc may exist at [`docs/archive/old-docs/database/current-erd.md`](../archive/old-docs/database/current-erd.md). Prefer live introspection over static snapshots.

## Related docs

- [Schemas and tables](schemas-and-tables.md)
- [Database overview](database-overview.md)
