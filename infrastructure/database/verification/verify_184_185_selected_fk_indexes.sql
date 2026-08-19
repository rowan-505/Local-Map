-- Migrations 184-185 verification. Read-only.

SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisvalid,
  ix.indisready,
  pg_get_indexdef(i.oid) AS definition,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE i.relname IN (
  'core_admin_areas_admin_area_type_id_idx',
  'infrastructure_lines_admin_area_id_idx',
  'source_links_import_batch_id_idx',
  'stops_admin_area_id_idx',
  'terminals_admin_area_id_idx'
)
ORDER BY n.nspname, t.relname, i.relname;
