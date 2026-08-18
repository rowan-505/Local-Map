# Slim prod_mirror refresh — 2026-07-22

Local only. Supabase core was not written.

## Meta

- `refreshed_at`: 2026-07-22 08:44:00 UTC
- `source_project_ref`: `locghyuranqaqsnbxflc`
- `refresh_mode`: `slim_family_columns`
- omits `normalized_data`
- includes soft-deleted rows (`deleted_at`)

## Reconcile (live FDW = mirror)

| table | rows |
|-------|-----:|
| core_streets | 823013 |
| core_places | 282 |
| core_buildings | 1083 |
| core_admin_areas | 2518 |
| core_street_names | 26460 |
| core_admin_area_names | 3362 |

## Protection / soft-delete (streets)

- `manual_override` present; 515 true
- `is_verified` present; 98 true
- `verification_status` present
- `deleted_at` present; 7 deleted rows kept
- duplicate `external_id` groups: **0**

## Pipeline

- `00b_preflight_prod_mirror.sql`: PASS
- Stage K refuses identical READ/WRITE URLs unless override

## Env

- `LOCAL_DATABASE_URL`
- `SUPABASE_READ_DATABASE_URL` (preferred) / legacy `SUPABASE_DB_*`
- `SUPABASE_WRITE_DATABASE_URL` (Stage K only; never used by refresh)
