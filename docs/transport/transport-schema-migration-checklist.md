# Transport schema migration QA checklist

Manual QA checklist for applying Supabase migrations **066–072** (transport schemas, tile view cutover, deprecation comments, YBS calendar seed). Use this before and after a migration window on staging or production.

**Related assets**

| Asset | Path |
|-------|------|
| Migrations | `infrastructure/database/migrations/supabase/066`–`072` |
| Future drop (do not apply) | `infrastructure/database/migrations/supabase/073_future_drop_core_bus_tables_do_not_run_yet.sql` |
| SQL verification script | `infrastructure/database/checks/supabase/check_transport_schema_migration.sql` |
| Import plan | `docs/transport/ybs-import-plan.md` |
| GTFS export plan | `docs/transport/gtfs-export-plan.md` |
| OTP future plan | `docs/routing/TRANSIT_OTP_FUTURE_PLAN.md` |

---

## 1. Before migration

Complete these steps **before** running any migration SQL.

### 1.1 Backup database

- [ ] Take a full logical backup (Supabase dashboard backup, `pg_dump`, or your operator’s snapshot process).
- [ ] Record backup ID / timestamp and who approved the window.
- [ ] Confirm you can restore to a non-production clone if this is the first transport migration on that environment.

### 1.2 Confirm legacy `core.core_bus_*` row counts

Record baseline counts for rollback comparison. All six tables should still exist.

```sql
select 'core.core_bus_routes' as table_name, count(*)::bigint as row_count from core.core_bus_routes
union all select 'core.core_bus_route_variants', count(*) from core.core_bus_route_variants
union all select 'core.core_bus_route_stops', count(*) from core.core_bus_route_stops
union all select 'core.core_bus_stops', count(*) from core.core_bus_stops
union all select 'core.core_bus_route_names', count(*) from core.core_bus_route_names
union all select 'core.core_bus_stop_names', count(*) from core.core_bus_stop_names
order by table_name;
```

- [ ] Save results (screenshot or pasted output).
- [ ] Note whether legacy data is still in active use (API, dashboard, Martin tiles).

### 1.3 Confirm current tile view dependencies

**Expected before 070:** `tiles.tiles_bus_stops_v` and `tiles.tiles_bus_routes_v` may still depend on `core.core_bus_*`.

**Known follow-up (not in 070):** `tiles.tiles_bus_route_variants_v` still reads legacy `core` tables (dashboard map preview). That is OK for this migration window; track separately.

```sql
-- Views depending on legacy core bus tables (any schema)
select
    vn.nspname as view_schema,
    v.relname as view_name,
    refn.nspname as ref_schema,
    ref.relname as ref_name
from pg_depend as d
join pg_class as v on v.oid = d.objid
join pg_namespace as vn on vn.oid = v.relnamespace
join pg_class as ref on ref.oid = d.refobjid
join pg_namespace as refn on refn.oid = ref.namespace
where v.relkind = 'v'
  and d.deptype in ('n', 'a')
  and refn.nspname = 'core'
  and ref.relname like 'core_bus%'
order by 1, 2, 4;
```

- [ ] Document which views still point at `core.core_bus_*`.
- [ ] Confirm Martin / tile server config lists the bus views you expect (`infrastructure/tiles/martin/martin_config.yaml`).

### 1.4 Confirm migration order

Apply **only** in this sequence (after your current latest applied migration, typically **065** or whatever your environment reports):

| Order | File | Purpose |
|------:|------|---------|
| 1 | `066_create_import_transport_schema.sql` | `import_transport` staging schema |
| 2 | `067_create_core_transport_schema.sql` | `core_transport` production schema |
| 3 | `068_create_gtfs_export_schema.sql` | `gtfs_export` build tracking |
| 4 | `069_core_transport_validation_views.sql` | Validation + GTFS readiness views |
| 5 | `070_tiles_bus_views_core_transport.sql` | Repoint `tiles_bus_routes_v` / `tiles_bus_stops_v` |
| 6 | `071_deprecate_core_bus_tables_comments.sql` | Deprecation comments only |
| 7 | `072_seed_core_transport_ybs_default_service_calendar.sql` | Default YBS operator + calendar seed |

**Do not apply**

- [ ] `073_future_drop_core_bus_tables_do_not_run_yet.sql` — prepared only; blocks until full cutover.

- [ ] Prior migration chain on target DB is verified (no skipped numbers).
- [ ] Migration window owner and rollback contact are identified.

---

## 2. Migration order (execution)

During the window, run files from section 1.4 in order via Supabase SQL Editor or your standard migration runner.

- [ ] **066** — `import_transport` created; no data required.
- [ ] **067** — `core_transport` created; tables empty is OK.
- [ ] **068** — `gtfs_export` created.
- [ ] **069** — validation views created (`core_transport.v_*`).
- [ ] **070** — `tiles.tiles_bus_routes_v` and `tiles.tiles_bus_stops_v` now read `core_transport` (view names unchanged).
- [ ] **071** — deprecation comments on six `core.core_bus_*` tables only (no DROP/TRUNCATE).
- [ ] **072** — idempotent seed: YBS operator + `ybs_daily_default` service calendar.
- [ ] **073** — **not run** (future drop migration).

After each file (or after the full batch):

- [ ] No transaction left aborted; note any `RAISE` / constraint errors immediately.
- [ ] If **070** fails with `42P16` (geometry type change), use the version in repo with explicit `::geometry(LineString,4326)` / `::geometry(Point,4326)` casts.

---

## 3. SQL verification

Run the bundled check script (read-only):

```bash
# From repo root, with DATABASE_URL pointing at the migrated database:
psql "$DATABASE_URL" -f infrastructure/database/checks/supabase/check_transport_schema_migration.sql
```

Or paste the file into Supabase SQL Editor.

### 3.1 Schemas exist

- [ ] Check **01**: `import_transport`, `core_transport`, `gtfs_export` all `exists = true`.

### 3.2 Tables exist

- [ ] Check **02**: 14 `core_transport` tables exist.
- [ ] Check **03**: 14 `import_transport` tables exist.
- [ ] Check **04**: 3 `gtfs_export` tables exist.

### 3.3 Tile views query successfully

```sql
select count(*) from tiles.tiles_bus_stops_v;
select count(*) from tiles.tiles_bus_routes_v;
```

- [ ] Both queries complete without error (row count may be **0** if `core_transport` has no routes/stops yet).
- [ ] Check **05**: both views exist in `information_schema`.
- [ ] Optional: **optional_tile_view_geom_types** — `geom` typed as `geometry` LineString/Point SRID 4326.

### 3.4 `pg_depend`: tile views must not reference old `core_bus` tables

- [ ] Check **06**: **0 rows** for `tiles_bus_stops_v` and `tiles_bus_routes_v` depending on `core.core_bus_*`.
- [ ] Check **06b**: at least one dependency row per view on `core_transport` base tables.

**Note:** `tiles.tiles_bus_route_variants_v` is **not** included in check 06. It may still depend on `core.core_bus_*` until a follow-up migration. Document separately if you query it:

```sql
select count(*) from tiles.tiles_bus_route_variants_v;  -- may still use legacy core
```

### 3.5 Validation views query successfully

- [ ] Check **08**: all seven issue views + `v_gtfs_readiness_summary` return without error (`row_count >= 0`).
- [ ] Check **07b**: legacy tables have `Deprecated` in table comment (071).
- [ ] Check **09** / **10**: GIST geom indexes and `confidence_score` 0–100 constraints (as applicable).

### 3.6 Post-072 seed (manual)

```sql
select operator_code, name_en
from core_transport.operators
where operator_code = 'ybs';

select calendar_code, monday, tuesday, wednesday, thursday, friday, saturday, sunday
from core_transport.service_calendars
where calendar_code = 'ybs_daily_default';
```

- [ ] YBS operator and default calendar present (or already existed from a prior 072 run).

### 3.7 Legacy tables still present

- [ ] Check **07**: all six `core.core_bus_*` tables still queryable; row counts match pre-migration baseline (unless you intentionally migrated data).

---

## 4. App verification

Run from repository root unless noted.

### 4.1 API build / typecheck

```bash
cd apps/api && npm run typecheck && npm run build
```

- [ ] Passes (API may still reference `core.core_bus_*` in import-review / core-review until a later code cutover — note any failures).

### 4.2 Dashboard build / typecheck

```bash
cd apps/dashboard && npm run build
```

Optional:

```bash
cd apps/dashboard && npm run lint
```

- [ ] Passes.
- [ ] Bus / transit pages that use **variants** tile layer still behave (variants view may still be legacy-backed).

### 4.3 Web build / typecheck

```bash
cd apps/web && npm run build
```

- [ ] Passes (`tsc -b` + Vite build).

### 4.4 Map loads

- [ ] Public web map loads basemap and UI without console errors.
- [ ] Dashboard map preview loads for a page that uses bus layers (if enabled in env).
- [ ] Martin (or local tile server) serves `tiles_bus_stops_v` / `tiles_bus_routes_v` without 500s when layers are enabled.

### 4.5 Bus tile layers with empty `core_transport`

Empty production transport data is **expected** immediately after schema migration.

- [ ] Map does **not** crash when bus route/stop layers are on but return zero features.
- [ ] No Martin/Postgres errors in logs for empty result sets.
- [ ] UI degrades gracefully (no routes shown) rather than breaking the whole map.

---

## 5. OTP preparation

OTP is **not** part of this migration window. Confirm tooling posture only.

### 5.1 Import script skeleton

- [ ] `tools/transit/import/import-ybs-dataset.ts` exists (`ENABLE_DATA_IMPORT = false`).
- [ ] `tools/transit/import/validate-ybs-import.ts` exists.
- [ ] `tools/transit/import/promote-ybs-to-core.ts` exists (`ENABLE_PROMOTION = false`).
- [ ] `tools/transit/import/README.md` describes env and flags.

### 5.2 GTFS export skeleton

- [ ] `tools/transit/gtfs-export/export-gtfs.ts` exists (`ENABLE_GTFS_EXPORT = false`).
- [ ] `tools/transit/gtfs-export/validate-gtfs.ts` exists.
- [ ] `tools/transit/gtfs-export/README.md` describes planned `core_transport` → GTFS flow.

### 5.3 No OTP production deployment yet

- [ ] No production OpenTripPlanner instance wired to live GTFS from this DB.
- [ ] No API routing adapter changes claiming transit routing is live.
- [ ] `docs/routing/TRANSIT_OTP_FUTURE_PLAN.md` treated as future work only.

---

## 6. Rollback notes

If you must roll back **before** dropping legacy tables:

| What changed | Rollback implication |
|--------------|----------------------|
| `core.core_bus_*` tables | **Still exist** — data unchanged by 066–072 |
| `import_transport` / `core_transport` / `gtfs_export` | New schemas; rollback = do not use + optional DROP in reverse order only if no production data was written |
| `tiles.tiles_bus_routes_v` / `tiles_bus_stops_v` | **070** replaced view definitions — restore prior view SQL from git history / pre-070 backup if you must point tiles back to `core.core_bus_*` |
| `tiles.tiles_bus_route_variants_v` | Unchanged by 070 — still on legacy `core` if it was before |
| 071 comments | Cosmetic only |
| 072 seed | Small reference rows in `core_transport`; safe to leave or delete operator/calendar rows if needed |
| 073 | **Not applied** — no effect |

**Practical rollback (tile emergency):**

1. Re-apply pre-070 `CREATE OR REPLACE VIEW` definitions for `tiles_bus_routes_v` and `tiles_bus_stops_v` from migration history.
2. Restart Martin / tile cache if used.
3. Legacy `core.core_bus_*` data remains the fallback source of truth for those two views.

**Not in scope for this checklist:** dropping `core_transport` or legacy bus tables.

---

## 7. Done criteria

Mark the migration window **complete** when all of the following are true:

### Database

- [ ] Migrations **066–072** applied successfully; **073 not applied**.
- [ ] `check_transport_schema_migration.sql` checks **01–08** pass expectations (06 = zero rows for legacy deps on the two main bus tile views).
- [ ] Legacy `core.core_bus_*` tables exist with baseline row counts documented.
- [ ] `core_transport` may be empty or partially seeded; that is OK for “schema done.”

### Tiles / map

- [ ] `tiles_bus_stops_v` and `tiles_bus_routes_v` query successfully against `core_transport`.
- [ ] Map loads with bus layers enabled; empty transport data does not crash clients or Martin.

### Applications

- [ ] `apps/api` typecheck + build pass (or failures documented with follow-up tickets).
- [ ] `apps/dashboard` build passes.
- [ ] `apps/web` build passes.

### Process / future work

- [ ] Stakeholders know `tiles_bus_route_variants_v` and API import-review paths may still use legacy `core` until follow-up work.
- [ ] `073_future_drop_core_bus_tables_do_not_run_yet.sql` remains unapplied until: zero legacy rows, no view/FK blockers, full app/GTFS cutover, and explicit approval.
- [ ] Next work tracked: YBS import → promote → GTFS export → optional variants tile migration → legacy code removal → only then 073.

---

## Quick sign-off template

```text
Environment: _____________  Date: __________  Operator: __________

Pre-migration backup ID: __________
Legacy core_bus row counts recorded: Y / N
Migrations 066–072 applied: Y / N
073 applied: N (must be N)
SQL check script run: Y / N — failures: __________
API / dashboard / web builds: pass / fail — notes: __________
Map + bus layers smoke test: pass / fail — notes: __________

Approved complete: Y / N   Signature / ticket: __________
```
