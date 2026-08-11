# Review and promotion workflow (agent outline)

> Placeholder — points agents at human docs. Do not duplicate full promotion logic here.

## Import review → core promotion (high level)

```text
staging / import tables
→ dashboard import-review UI
→ human or agent-assisted verification
→ promotion API (authorized)
→ core PostGIS tables
→ search index / tile builds as needed
```

## Rules for agents

- Database is source of truth; tiles are rendering only.
- Dashboard calls API only; never connect dashboard to PostgreSQL directly.
- Promotion and destructive actions must go through API with authorization and audit.
- Schema changes require migration SQL under `infrastructure/database/migrations/`.

## Human documentation

- [`docs/dashboard.md`](../../dashboard.md)
- [`docs/data-pipeline.md`](../../data-pipeline.md)
