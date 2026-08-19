# CoreMap — Claude Code

Entry point for Claude Code working in this repository.

## Read first

1. [`AGENTS.md`](AGENTS.md) — product direction, architecture rules, V2 scope, security, testing (tool-neutral).
2. [`docs/roadmap.md`](docs/roadmap.md) — V2 goals and implementation order summary.

## Skills

Canonical skill definitions live in [`docs/ai/skills/`](docs/ai/skills/).

Claude loads skills from [`.claude/skills/`](.claude/skills/), which mirrors `docs/ai/skills/`. When adding or updating a skill, edit the canonical copy under `docs/ai/skills/` and sync to `.claude/skills/`.

Current skills:

- `supabase` — Supabase database, auth, and platform workflows
- `supabase-postgres-best-practices` — Postgres performance and schema guidance

## Architecture (non-negotiable)

```text
Database/PostGIS = source of truth
Fastify API      = business logic and authorization
Tiles            = rendering only
Web/Dashboard    = API consumers only
MapLibre + PMTiles = public map rendering
```

- `apps/api` — only layer that accesses the database
- `apps/dashboard` — admin UI; API only
- `apps/web` — public map; API and tiles only
- Database changes — migration SQL in `infrastructure/database/migrations/`

## AI configuration map

| Location | Purpose |
|----------|---------|
| `docs/ai/` | Shared canonical AI docs, skills, workflows |
| `.claude/skills/` | Claude skill mirror |
| `.cursor/rules/` | Cursor-specific rules (if you also use Cursor) |

## Implementation discipline

- Inspect existing code before changing architecture.
- Change only the requested scope.
- Prefer small, reviewable diffs.
- Prioritize safety for auth, live location, points, and admin actions.
- Summarize changed files and test commands when done.
