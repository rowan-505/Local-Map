# YBS / transport import tools (skeleton)

CLI scripts to import external YBS route/stop data into `import_transport`, validate, and promote to `core_transport`. Full parsing and writes are **not implemented yet** — scripts verify `DATABASE_URL` and log planned steps.

**Plan:** [docs/transport/ybs-import-plan.md](../../../docs/transport/ybs-import-plan.md)

## Architecture

```text
External dataset (JSON / TSV / CSV)
        → import-ybs-dataset.ts
        → import_transport.*  (raw, messy)
        → validate-ybs-import.ts
        → promote-ybs-to-core.ts
        → core_transport.*    (production SoT)
        → GTFS export → gtfs_export.* → OTP
```

- **Do not** write to `core.core_bus_*` (deprecated).
- **Do not** import directly into `core_transport` without validation + promotion.
- OTP and map tiles read **`core_transport`** / GTFS only — not `import_transport`.

## Prerequisites

1. Repo root `.env` with `DATABASE_URL` (Supabase / production PostGIS).
2. Migrations applied: `066` (import_transport), `067` (core_transport), optionally `068`–`072`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (same as API) |

Optional (planned; not all wired in skeleton):

| Variable | Description |
|----------|-------------|
| `YBS_DATA_DIR` | Default input directory if `--input-dir` omitted (future) |
| `YBS_MAX_STOP_PATH_DISTANCE_M` | Validation threshold (default 75) |

## Command examples

From **repository root** (uses root `pg`, `dotenv`, `tsx`):

```bash
# Import (skeleton — connection check + TODO log only)
npx tsx tools/transit/import/import-ybs-dataset.ts \
  --source-code=ybs_yangon_local \
  --source-name="YBS Yangon Local" \
  --input-dir=./tools/transit/import/data/ybs \
  --batch-code=ybs_yangon_2026-05-29 \
  --scope=local_bus

# Validate (skeleton)
npx tsx tools/transit/import/validate-ybs-import.ts \
  --batch-code=ybs_yangon_2026-05-29

# Promote (skeleton; warnings need explicit flag when implemented)
npx tsx tools/transit/import/promote-ybs-to-core.ts \
  --batch-code=ybs_yangon_2026-05-29

npx tsx tools/transit/import/promote-ybs-to-core.ts \
  --batch-code=ybs_yangon_2026-05-29 \
  --confirm-warnings
```

## Files

| File | Role |
|------|------|
| `import-ybs-dataset.ts` | CLI entry: register batch, parse files → `import_transport` raw tables |
| `validate-ybs-import.ts` | CLI entry: validation rules → `validation_issues` |
| `promote-ybs-to-core.ts` | CLI entry: `promotion_batches` → `core_transport` |
| `transport-import-db.ts` | `pg` pool, env load, connection + schema checks |
| `transport-import-types.ts` | Shared TypeScript types |

## Skeleton limitations (current)

- **`ENABLE_DATA_IMPORT`**, **`ENABLE_VALIDATION_WRITES`**, **`ENABLE_PROMOTION`** are `false` in source — **no data inserts or updates**.
- No file parsing (routes JSON, stops TSV, route_stops, geometries).
- `--batch-code` maps to `import_transport.import_batches.batch_name` (read-only lookup today).
- No npm scripts in root `package.json` yet — invoke via `npx tsx` paths above.

## Typecheck / run

Root package provides `pg`, `dotenv`, `tsx`:

```bash
# Smoke-run skeleton (requires DATABASE_URL)
npx tsx tools/transit/import/import-ybs-dataset.ts \
  --source-code=test \
  --source-name=test \
  --input-dir=. \
  --batch-code=test_batch \
  --scope=local_bus
```

There is no dedicated `tsconfig` for `tools/transit/import`. Options:

```bash
# Runtime via tsx (transpiles on the fly)
npx tsx tools/transit/import/validate-ybs-import.ts --batch-code=test_batch

# Optional: one-off typecheck with NodeNext resolution
npx tsc --noEmit --module nodenext --moduleResolution nodenext --target ES2022 \
  --skipLibCheck tools/transit/import/*.ts
```

## Verification SQL (after migrations)

```bash
psql "$DATABASE_URL" -f infrastructure/database/checks/supabase/check_transport_schema_migration.sql
```

## Data directory (planned)

Place YBS drops under `tools/transit/import/data/ybs/` (gitignore large files). See plan for `manifest.json` layout.
