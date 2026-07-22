# Current-production remaining repair

One-time runner for leftover township admin links and safe boardwalk road fixes after [Production Baseline v1](PRODUCTION_BASELINE_V1.md).

## Purpose

Automatically:

1. Set up an idempotent repair queue
2. Assign township admin to remaining streets (batches of 250)
3. Assign township admin to remaining stops / terminals / infrastructure lines (up to 500 per family)
4. Apply safe `bridge=boardwalk` → `bridge=true` once
5. Verify and print SUCCESS / SUCCESS WITH DOCUMENTED UNRESOLVED ROWS / FAILED

Unresolved rows (no township containment) stay unresolved. Manual/verified streets are not auto-assigned.

## Prerequisites

- `psql` installed
- Direct PostgreSQL URL (prefer Supabase **direct** DB host, not the transaction pooler)
- Repo root working directory

## Environment

Set one of (priority order):

1. `DATABASE_URL`
2. `DIRECT_DATABASE_URL`
3. `SUPABASE_DB_URL`

If none are set, the runner loads `.env` from the repo root when present. Never commit credentials.

## One command

From the repository root:

```bash
npm run data:repair:remaining
```

or:

```bash
./tools/data-repair/current-production/run-remaining-repair.sh
```

## What it changes

- `admin_area_id` on queued unprotected streets and transport rows when a township covers the point/midpoint
- `bridge = true` on unprotected/unverified streets tagged `bridge=boardwalk`
- Queue / slim backup tables under `system.repair_remaining_*_20260722`

## What it does not change

- Geometry, street names, OSM re-import, search, PMTiles, Valhalla
- `manual_override` / verified street admin or road values
- `bridge=low_water_crossing` rows
- Guessed “nearest township” without containment
- Review history (no deletes)

## How to read the final status

| Result | Meaning | Exit |
| --- | --- | ---: |
| `SUCCESS` | Pending queue empty; safe boardwalk OK; no unprotected class mismatch | 0 |
| `SUCCESS WITH DOCUMENTED UNRESOLVED ROWS` | Same, plus unresolved and/or protected rows remain | 0 |
| `FAILED` | Pending left, boardwalk mismatch, unprotected class mismatch, or bad resolved township | 1 |

## Safe rerun

Safe to rerun. Setup uses `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`. Already resolved/unresolved/protected queue rows are not re-seeded as pending. Batch scripts only process `status = 'pending'`.

## Logs

Written under:

```text
tools/data-repair/current-production/logs/remaining-repair-YYYYMMDD-HHMMSS.log
```

## Prior Prompt 1–12 work

Historical inspect/apply SQL and Baseline v1 remain in this folder (`00_baseline.sql` … `26_final_baseline.sql`, `PRODUCTION_BASELINE_V1.md`). The remaining runner files are:

```text
00_setup.sql
01_run_street_batch.sql
02_run_transport_batches.sql
03_fix_safe_road_values.sql
04_verify.sql
run-remaining-repair.sh
```
