-- Read-only verification for migration 157
SELECT to_regclass('core.core_coastlines') IS NOT NULL AS table_exists;
SELECT to_regclass('tiles.tiles_coastlines_v') IS NOT NULL AS tiles_view_exists;

SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'core_coastlines'
ORDER BY ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'core' AND tablename = 'core_coastlines'
ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'core.core_coastlines'::regclass
ORDER BY conname;

SELECT count(*) AS coastline_rows FROM core.core_coastlines;
SELECT count(*) AS active_tile_rows FROM tiles.tiles_coastlines_v;

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core' AND p.proname = 'replace_active_coastline';
