---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: PostgreSQL/PostGIS role, folder layout, local vs Supabase
---

# Database overview

PostgreSQL + PostGIS is the **source of truth** for all map data. Schema and data changes are versioned under [`infrastructure/database/`](../../infrastructure/database/).

## Access rule

| App | Database access |
|-----|-----------------|
| `apps/api` | Yes — via `DATABASE_URL` (and import-review connection) |
| `apps/dashboard` | **No** — API only |
| `apps/web` | **No** — API only |

## Folder layout

```text
infrastructure/database/
├── migrations/
│   ├── local/          raw, staging, system — local workflow DDL
│   └── supabase/       production core, ref, system, tiles, app_auth
├── seeds/              Idempotent reference data
├── checks/             Validation SELECT scripts
├── docs/               → see canonical docs in docs/02-database/
├── snapshots/          Generated dumps (not source of truth)
├── introspection/      ERD export scripts
├── data/               OSM extracts, boundaries
└── lua/                osm2pgsql flex config
```

## Local vs Supabase

| | **Local** (`LOCAL_RAW_DATABASE_URL`) | **Supabase** (`DATABASE_URL`) |
|---|--------------------------------------|-------------------------------|
| Schemas | `raw`, `staging`, `system`, `ref`, `core`, `tiles`, … | `core`, `ref`, `system`, `tiles`, `app_auth` |
| Role | OSM import, staging, diff/review | Production published data |
| Migrations | `migrations/local/` | `migrations/supabase/` |

**Numeric IDs may differ** between environments. Use `public_id`, `source_code`, `snapshot_version`, `region_code`, OSM `external_id`.

## Pipeline layers

```text
raw → staging → core → tiles (views) → PMTiles
```

- **raw** — untouched source (do not normalize here)
- **staging** — cleaned candidates
- **core** — production-ready entities
- **tiles** — lightweight views for rendering export only

## Safety rules

1. Never drop production tables without explicit approval.
2. Never recreate local DB blindly — loses in-progress workflow data.
3. Supabase MCP is **inspect-only** — DDL goes in `migrations/supabase/`.
4. Always change `migrations/` first; snapshots are for diffing only.

## Applying Supabase SQL

1. Run numbered files in `migrations/supabase/` in order.
2. Run matching `seeds/supabase/` after dependent migrations.
3. Run `checks/supabase/` to verify.

## Introspection commands

| Command | Output |
|---------|--------|
| `npm run db:schema:local` | `introspection/local/schema/local-db-schema.sql` |
| `npm run db:erd:local` | `introspection/local/erd/local-current-db.mmd` |
| `npm run db:erd:supabase` | `introspection/supabase/erd/current.mmd` |

## Related docs

- [Schemas and tables](schemas-and-tables.md)
- [Migrations](migrations.md)
- [ERD](erd.md)
- [OSM import](../07-data-pipeline/osm-import.md)

**Historical detail:** archived copies of old `infrastructure/database/docs/*.md` are in [`docs/archive/old-docs/infrastructure/database/docs/`](../archive/old-docs/infrastructure/database/docs/).
