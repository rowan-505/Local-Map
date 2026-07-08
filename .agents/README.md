# `.agents` (legacy)

This folder is a **legacy / optional** agent skill layout kept for backward compatibility.

## Canonical location

**Edit skills in [`docs/ai/skills/`](../docs/ai/skills/)**, not here.

| Skill | Canonical path |
|-------|----------------|
| Supabase | [`docs/ai/skills/supabase/`](../docs/ai/skills/supabase/) |
| Postgres best practices | [`docs/ai/skills/supabase-postgres-best-practices/`](../docs/ai/skills/supabase-postgres-best-practices/) |

## Tool mirrors

- **Claude Code:** [`.claude/skills/`](../.claude/skills/) — copied from `docs/ai/skills/`
- **Cursor:** [`.cursor/rules/`](../.cursor/rules/) — architecture and workflow rules

## This folder

`skills/` under `.agents/` retains the original copies from before the `docs/ai/` reorganization. Content is preserved; do not delete without a fresh backup. New work should use `docs/ai/skills/` as the single source of truth.

See [`docs/ai/README.md`](../docs/ai/README.md) for the full AI configuration layout.
