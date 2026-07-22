# Places safe loader dry-run (2026-07-22)

Fixture transaction on Supabase project `locghyuranqaqsnbxflc`.  
**Entire test transaction ROLLED BACK.** Durable `core.core_places` count remained **282**. No fixture leaks.

## Exact affected counts (happy path)

| metric | count |
|--------|------:|
| inserted (`safe_new`) | 1 |
| updated (`safe_update` allowlist) | 1 |
| skipped (manual + verified) | 2 |
| failed | 0 |
| core_places delta | +1 |

## Identical rerun (same batch)

| metric | count |
|--------|------:|
| inserted | 0 |
| updated | 0 |
| skipped | 4 |
| core_places delta | 0 |

## Failure cases (savepoint rollback)

| case | result |
|------|--------|
| duplicate identity (`osm:node:X` + `osm:N:X`) | aborted; no core write |
| invalid `category_id` | aborted; no core write |
| partial failure | family transaction / savepoint restored |

## Test matrix

- new safe record — PASS  
- identical rerun — PASS  
- safe update — PASS  
- manual protected — PASS  
- verified meaningful conflict — PASS  
- duplicate external/identity — PASS  
- invalid target category — PASS  
- partial failure rollback — PASS  

## Production apply status

Loader SQL is ready (`places_safe_loader.sql` with `-v dry_run=false`).  
**Not applied to real import_work places data** — `import_work.place_rows` is still empty (no COPY of classified Kyauktan rows yet).

Next: COPY local `safe_new`/`safe_update` place rows into `import_work`, dry-run that batch, then apply only if counts reconcile.
