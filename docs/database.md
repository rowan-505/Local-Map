# Database

PostgreSQL + PostGIS is the source of truth. Only `apps/api` connects.

## Folders

```text
infrastructure/database/
  migrations/local/      raw, staging, local system
  migrations/supabase/   production core / ref / system / tiles / app_auth
  seeds/ checks/         reference data and validation
```

## Environments

| | Local | Supabase (prod) |
|--|-------|-----------------|
| Use | OSM import, staging, mirror | Live published data |
| Typical schemas | `raw`, `staging`, `system`, `core`, … | `core`, `ref`, `system`, `tiles`, `app_auth` |

Do not assume numeric IDs match across envs. Prefer `public_id`, `external_id`, `snapshot_version`.

## Pipeline layers

```text
raw → staging → core → tiles views → PMTiles
              ↘ import_review → promote → core
```

- **raw** — source dump (do not normalize here)
- **staging** — cleaned candidates
- **core** — production entities
- **tiles** — export views for rendering only

## Safety

1. Never drop prod tables without approval.
2. Never point a write pipeline at prod by accident — see [data-pipeline](data-pipeline.md).
3. All schema changes = migration files in git.

More detail next to code: [`infrastructure/database/README.md`](../infrastructure/database/README.md).
