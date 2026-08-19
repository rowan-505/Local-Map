SELECT count(*)::int AS remaining_historical_artifact_tables
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='system' AND c.relkind IN ('r','p')
  AND (c.relname LIKE 'repair\_%' ESCAPE '\'
    OR c.relname LIKE 'backup\_%' ESCAPE '\'
    OR c.relname LIKE 'migration\_%' ESCAPE '\');

SELECT to_regprocedure(
  'system.apply_overlap_full_to_keeper_20260724(text,bigint,bigint,text,text)'
) IS NULL AS historical_helper_removed;

SELECT protected_table, to_regclass('system.'||protected_table) IS NOT NULL AS exists
FROM unnest(ARRAY[
  'system_source_registry','system_source_snapshots','system_import_batches',
  'system_diff_runs','system_diff_items','system_publish_batches','system_publish_items',
  'system_review_tasks','system_review_logs','audit_logs'
]) AS protected_table
ORDER BY protected_table;
