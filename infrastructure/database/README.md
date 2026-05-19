# Database

PostgreSQL + PostGIS is the **source of truth** for map data. All schema and data changes are versioned in this folder and applied deliberately—never only via ad-hoc edits on production.

Apps (`apps/api`, `apps/dashboard`, `apps/web`) use **`DATABASE_URL`** at runtime **only through the API**. They must not use `LOCAL_RAW_DATABASE_URL`. Dashboard and web must not connect to the database directly.

Copy [`.env.example`](../../.env.example) to repo-root `.env`. Never commit `.env`.

---

## Folder layout

Every managed area is split by **target database**:

| Folder | Purpose |
|--------|---------|
| [`migrations/`](migrations/) | Versioned SQL schema changes (DDL, views, constraints) |
| [`seeds/`](seeds/) | Repeatable seed data (reference rows, registry entries) |
| [`checks/`](checks/) | Validation `SELECT` scripts (run after migrate/seed/import) |
| [`docs/`](docs/) | Schema, pipeline, and workflow documentation (hand-written) |
| [`snapshots/`](snapshots/) | Generated schema/data dumps for diffing—not source of truth |

```text
infrastructure/database/
├── README.md
├── migrations/
│   ├── local/          ← raw, staging, system workflow, local-only DDL
│   └── supabase/       ← production core, ref, system, tiles, app_auth DDL
├── seeds/
│   ├── local/
│   └── supabase/
├── checks/
│   ├── local/
│   └── supabase/
├── docs/
│   ├── local/          ← local pipeline / import docs
│   ├── supabase/       ← hosted DB / promotion docs
│   └── *.md            ← shared cross-environment docs
├── snapshots/
│   ├── local/          ← pg_dump outputs from LOCAL_RAW_DATABASE_URL
│   └── supabase/       ← pg_dump or export outputs from DATABASE_URL
├── introspection/      ← ERD + export scripts (see below)
├── data/               ← OSM extracts, boundaries (not SQL)
└── lua/                ← osm2pgsql flex config
```

### What each area is for

- **migrations** — Ordered, versioned SQL changes. Apply in sequence. Source of truth for *how* the schema should look.
- **seeds** — Idempotent inserts/updates (`ON CONFLICT` upserts). Safe to re-run. Not a substitute for migrations.
- **checks** — Read-only validation queries (counts, orphans, geometry sanity). No DDL/DML.
- **docs** — Human-written design notes, pipeline stages, promotion rules. Not generated dumps.
- **snapshots** — Point-in-time exports for comparison and recovery planning. **Never** treat these as the canonical schema; always change `migrations/` first.

---

## Local vs Supabase

| | **Local** (`LOCAL_RAW_DATABASE_URL`) | **Supabase** (`DATABASE_URL`) |
|---|--------------------------------------|-------------------------------|
| **Typical schemas** | `raw`, `staging`, `system`, `ref`, `core`, `tiles`, … | `core`, `ref`, `system`, `tiles`, `app_auth` |
| **Role** | OSM import, staging, diff/review workflow, experiments | Production-ready published data |
| **Migrations** | `migrations/local/` | `migrations/supabase/` (SQL Editor or deploy) |
| **Raw OSM** | Stays here; do not bulk-dump into Supabase unless intentional | — |

**Numeric IDs may differ** between local and Supabase. Do not assume `id` values match across environments. Use stable business keys instead: `source_code`, `snapshot_version`, `checksum`, `region_code`, `public_id`, OSM `external_id`, etc.

---

## Safety rules

1. **Never drop production tables** without explicit manual approval.
2. **Never recreate the local database blindly**—you may lose raw, staging, and in-progress system workflow data.
3. **Supabase MCP is inspect-only**—DDL belongs in `migrations/supabase/` and is applied via SQL Editor or your deploy process.
4. **Versioned SQL** lives in `migrations/`, `seeds/`, `checks/`, and `tools/data-pipeline/`—commit those. **Generated** exports (`snapshots/`, `introspection/**/schema/`, `backups/`, `generated/`) and dump/checkpoint filenames are gitignored at repo root (see `.gitignore`).

---

## Applying Supabase SQL

1. Run numbered files in `migrations/supabase/` in order (e.g. `021_…`, then `022_…`).
2. Run matching seeds in `seeds/supabase/` after the migrations they depend on.
3. Run `checks/supabase/` queries to verify.

---

## Introspection (ERD & live schema reads)

Separate from `snapshots/`—tooling for AI context and diagrams:

| Target | Env var | Folder |
|--------|---------|--------|
| Local | `LOCAL_RAW_DATABASE_URL` | [`introspection/local/`](introspection/local/) |
| Supabase | `DATABASE_URL` | [`introspection/supabase/`](introspection/supabase/) |

| Command (repo root) | Output |
|---------------------|--------|
| `npm run db:schema:local` | `introspection/local/schema/local-db-schema.sql` |
| `npm run db:erd:local` | `introspection/local/erd/local-current-db.mmd` |
| `npm run db:erd:supabase` | `introspection/supabase/erd/current.mmd` |

See [`.cursor/rules/supabase_cursor_setup.mdc`](../../.cursor/rules/supabase_cursor_setup.mdc) and [`../.cursor/rules/DATABASE_RULES.mdc`](../.cursor/rules/DATABASE_RULES.mdc).

---

## Related docs

- [`docs/database_pipeline_context.md`](docs/database_pipeline_context.md) — raw → staging → core → tiles
- [`docs/database_rules.md`](docs/database_rules.md) — design rules for ref/system/raw/staging
- [`docs/staging_to_core_mapping.md`](docs/staging_to_core_mapping.md)
- [`docs/core_promotion_quality_rules.md`](docs/core_promotion_quality_rules.md)
