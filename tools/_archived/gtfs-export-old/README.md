> # ⚠️ DEPRECATED — DO NOT RUN
>
> These scripts target the **deleted** `core_transport.*` and `gtfs_export.*` schemas. Those database objects no longer exist.
>
> GTFS/OTP export is **not** part of the current scope. When it returns, it will read from `transport.*` and track builds in `transit_export.*`.
>
> This folder is archived for historical reference only. Do not execute any script here against a live database.

# GTFS export tools (skeleton)

Export verified `core_transport` data to a static GTFS bundle for OpenTripPlanner graph builds. **Full CSV/zip export is not implemented yet** — scripts verify the database, check schemas, and write TODO placeholders under the output directory.

**Plan:** [docs/transport/gtfs-export-plan.md](../../../docs/transport/gtfs-export-plan.md)

## Purpose

```text
core_transport.*  →  export-gtfs.ts  →  gtfs.zip (+ CSV files)
                              ↓
                      validate-gtfs.ts
                              ↓
                      gtfs_export.export_builds / export_files / validation_issues
                              ↓
                      OTP graph build (local) → API multimodal (future)
```

- GTFS is generated **only** from `core_transport`.
- OTP reads **files**, not Postgres.
- Do not export from `core.core_bus_*` or `import_transport`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL (Supabase) — same as API |

Optional (future):

| Variable | Description |
|----------|-------------|
| `GTFS_OUTPUT_ROOT` | Default parent for `--output-dir` |
| `GTFS_DEFAULT_SERVICE_CODE` | e.g. `ybs_daily_default` (migration 072) |

## Commands

From **repository root**:

```bash
# Skeleton export: DB checks + TODO files under output dir
npx tsx tools/transit/gtfs-export/export-gtfs.ts \
  --scope=yangon_local_bus \
  --output-dir=tmp/gtfs-yangon-test

# Optional: record draft row in gtfs_export.export_builds
npx tsx tools/transit/gtfs-export/export-gtfs.ts \
  --scope=yangon_local_bus \
  --output-dir=tmp/gtfs-yangon-test \
  --build-code=ybs_gtfs_2026-05-29 \
  --create-build

# Skeleton validator: list dir, note missing real GTFS files
npx tsx tools/transit/gtfs-export/validate-gtfs.ts \
  --input-dir=tmp/gtfs-yangon-test
```

`--build-code` is optional; default is `{scope}_gtfs_{YYYY-MM-DD}`.

## Expected future generated GTFS files

When `export-gtfs.ts` is implemented, the output directory should contain:

| File | Source (core_transport) |
|------|-------------------------|
| `agency.txt` | `operators` |
| `stops.txt` | `stops`, `stop_names` |
| `routes.txt` | `routes` |
| `trips.txt` | `route_variants` |
| `stop_times.txt` | `route_stops` |
| `calendar.txt` | `service_calendars` |
| `frequencies.txt` | `frequencies` |
| `shapes.txt` | `route_paths`, `route_variants.geom` |
| `feed_info.txt` | build metadata |

Bundled as `gtfs.zip` for OTP.

**Skeleton output today:** `README-SKELETON.md` and `*.TODO` files only — **not** valid GTFS.

## OTP local test flow (after real export)

1. Populate `core_transport` ([ybs-import-plan.md](../ybs-import-plan.md)).
2. `SELECT * FROM core_transport.v_gtfs_readiness_summary;`
3. `export-gtfs.ts` → `tmp/.../gtfs.zip`
4. `validate-gtfs.ts` → zero `severity=error` in `gtfs_export.validation_issues`
5. OTP build: GTFS zip + Myanmar/Yangon OSM PBF (`infrastructure/routing/otp/` TBD)
6. Smoke transit itinerary in Yangon bbox
7. Later: `OtpRoutingEngineAdapter` → `POST /api/routing/route` with `profile=multimodal`

Do **not** expose raw OTP JSON to the frontend. Do **not** use OTP for walk/drive/motorcycle (Valhalla only).

## Files

| File | Role |
|------|------|
| `export-gtfs.ts` | CLI: scope → output dir, optional `--create-build` |
| `validate-gtfs.ts` | CLI: inspect output dir, future validator |
| `gtfs-db.ts` | Connection, table checks, optional `export_builds` insert |
| `gtfs-types.ts` | Shared types |
| `gtfs-writers.ts` | Future CSV writers; skeleton placeholders only |

## Skeleton limitations

- `ENABLE_GTFS_EXPORT = false` — no production GTFS CSV content.
- No zip creation yet.
- `validate-gtfs.ts` does not run MobilityData GTFS Validator yet.
- Database writes only when `--create-build` is passed (single draft `export_builds` row).

## Prerequisites

Migrations: `067` (core_transport), `068` (gtfs_export), `069` (readiness views), `072` (default calendar seed optional).

```bash
psql "$DATABASE_URL" -f infrastructure/database/checks/supabase/check_transport_schema_migration.sql
```
