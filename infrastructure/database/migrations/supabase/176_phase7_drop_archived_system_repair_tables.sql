-- Phase 7: drop archived, dated historical repair/backup/migration artifacts.
-- Archive SHA-256:
-- c7af4542944fcfe42cf8e3f80d8085bfc34a2020bde2fa9a110715e301152a35
-- No CASCADE: any newly introduced dependency must fail this migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $block$
DECLARE
  expected_names text[] := ARRAY[
    'backup_core_map_buildings_before_building_type_simplification',
    'backup_ref_building_types_before_simplification',
    'migration_156_water_class_anomalies',
    'repair_admin_areas_before_202607',
    'repair_admin_assign_pbl_20260724',
    'repair_admin_assign_streets_20260724',
    'repair_admin_links_before_202607',
    'repair_dup_admin_areas_20260724',
    'repair_dup_fk_backup_20260724',
    'repair_final_fk_backup_20260724',
    'repair_major_overlap_admin_areas_20260724',
    'repair_major_overlap_apply_log_20260724',
    'repair_remaining_admin_backup_20260722',
    'repair_remaining_admin_queue_20260722',
    'repair_remaining_road_backup_20260722',
    'repair_review_backlog_before_202607',
    'repair_shan_cluster_admin_areas_20260724',
    'repair_shan_cluster_apply_log_20260724',
    'repair_small_core_before_202607',
    'repair_street_names_before_202607',
    'repair_streets_attrs_before_202607',
    'repair_streets_road_class_before_202607',
    'repair_township_catalogue_reclass_20260724',
    'repair_township_overlap_final_admin_areas_20260724',
    'repair_township_overlap_final_apply_log_20260724'
  ];
  expected_counts jsonb := '{
    "backup_core_map_buildings_before_building_type_simplification":116,
    "backup_ref_building_types_before_simplification":85,
    "migration_156_water_class_anomalies":44,
    "repair_admin_areas_before_202607":13,
    "repair_admin_assign_pbl_20260724":2853,
    "repair_admin_assign_streets_20260724":14827,
    "repair_admin_links_before_202607":210710,
    "repair_dup_admin_areas_20260724":8,
    "repair_dup_fk_backup_20260724":0,
    "repair_final_fk_backup_20260724":56,
    "repair_major_overlap_admin_areas_20260724":4,
    "repair_major_overlap_apply_log_20260724":2,
    "repair_remaining_admin_backup_20260722":0,
    "repair_remaining_admin_queue_20260722":25686,
    "repair_remaining_road_backup_20260722":14,
    "repair_review_backlog_before_202607":2298,
    "repair_shan_cluster_admin_areas_20260724":5,
    "repair_shan_cluster_apply_log_20260724":2,
    "repair_small_core_before_202607":26,
    "repair_street_names_before_202607":0,
    "repair_streets_attrs_before_202607":31106,
    "repair_streets_road_class_before_202607":340801,
    "repair_township_catalogue_reclass_20260724":9,
    "repair_township_overlap_final_admin_areas_20260724":29,
    "repair_township_overlap_final_apply_log_20260724":24
  }'::jsonb;
  actual_names text[];
  table_name text;
  actual_count bigint;
  dependency_count bigint;
  lifecycle_table text;
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO actual_names
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='system' AND c.relkind IN ('r','p')
    AND (c.relname LIKE 'repair\_%' ESCAPE '\'
      OR c.relname LIKE 'backup\_%' ESCAPE '\'
      OR c.relname LIKE 'migration\_%' ESCAPE '\');

  SELECT array_agg(x ORDER BY x) INTO expected_names FROM unnest(expected_names) AS x;
  IF actual_names IS DISTINCT FROM expected_names THEN
    RAISE EXCEPTION '176 refused: candidate table set changed since archive';
  END IF;

  FOREACH table_name IN ARRAY expected_names LOOP
    EXECUTE format('SELECT count(*) FROM system.%I', table_name) INTO actual_count;
    IF actual_count <> (expected_counts->>table_name)::bigint THEN
      RAISE EXCEPTION '176 refused: %.% row count changed (expected %, actual %)',
        'system', table_name, expected_counts->>table_name, actual_count;
    END IF;
  END LOOP;

  SELECT count(*) INTO dependency_count
  FROM pg_class target
  JOIN pg_namespace ns ON ns.oid=target.relnamespace
  JOIN pg_constraint fk ON fk.confrelid=target.oid AND fk.contype='f'
  WHERE ns.nspname='system' AND target.relname=ANY(expected_names)
    AND fk.conrelid<>target.oid;
  IF dependency_count <> 0 THEN
    RAISE EXCEPTION '176 refused: % inbound foreign keys found', dependency_count;
  END IF;

  SELECT count(*) INTO dependency_count
  FROM pg_class target
  JOIN pg_namespace ns ON ns.oid=target.relnamespace
  JOIN pg_depend d ON d.refobjid=target.oid
  JOIN pg_rewrite rw ON d.classid='pg_rewrite'::regclass AND rw.oid=d.objid
  WHERE ns.nspname='system' AND target.relname=ANY(expected_names)
    AND rw.ev_class<>target.oid;
  IF dependency_count <> 0 THEN
    RAISE EXCEPTION '176 refused: % dependent view rules found', dependency_count;
  END IF;

  IF EXISTS (SELECT 1 FROM system.repair_remaining_admin_queue_20260722 WHERE status='pending') THEN
    RAISE EXCEPTION '176 refused: remaining-admin repair still has pending rows';
  END IF;
  IF EXISTS (SELECT 1 FROM system.repair_township_overlap_final_apply_log_20260724 WHERE status<>'COMMITTED') THEN
    RAISE EXCEPTION '176 refused: final township-overlap log has non-COMMITTED rows';
  END IF;

  FOREACH lifecycle_table IN ARRAY ARRAY[
    'system_source_registry','system_source_snapshots','system_import_batches',
    'system_diff_runs','system_diff_items','system_publish_batches','system_publish_items',
    'system_review_tasks','system_review_logs','audit_logs'
  ] LOOP
    IF to_regclass(format('system.%I',lifecycle_table)) IS NULL THEN
      RAISE EXCEPTION '176 refused: protected lifecycle table system.% is missing', lifecycle_table;
    END IF;
  END LOOP;
END
$block$;

DROP FUNCTION IF EXISTS system.apply_overlap_full_to_keeper_20260724(text, bigint, bigint, text, text);

DROP TABLE system.backup_core_map_buildings_before_building_type_simplification;
DROP TABLE system.backup_ref_building_types_before_simplification;
DROP TABLE system.migration_156_water_class_anomalies;
DROP TABLE system.repair_admin_areas_before_202607;
DROP TABLE system.repair_admin_assign_pbl_20260724;
DROP TABLE system.repair_admin_assign_streets_20260724;
DROP TABLE system.repair_admin_links_before_202607;
DROP TABLE system.repair_dup_admin_areas_20260724;
DROP TABLE system.repair_dup_fk_backup_20260724;
DROP TABLE system.repair_final_fk_backup_20260724;
DROP TABLE system.repair_major_overlap_admin_areas_20260724;
DROP TABLE system.repair_major_overlap_apply_log_20260724;
DROP TABLE system.repair_remaining_admin_backup_20260722;
DROP TABLE system.repair_remaining_admin_queue_20260722;
DROP TABLE system.repair_remaining_road_backup_20260722;
DROP TABLE system.repair_review_backlog_before_202607;
DROP TABLE system.repair_shan_cluster_admin_areas_20260724;
DROP TABLE system.repair_shan_cluster_apply_log_20260724;
DROP TABLE system.repair_small_core_before_202607;
DROP TABLE system.repair_street_names_before_202607;
DROP TABLE system.repair_streets_attrs_before_202607;
DROP TABLE system.repair_streets_road_class_before_202607;
DROP TABLE system.repair_township_catalogue_reclass_20260724;
DROP TABLE system.repair_township_overlap_final_admin_areas_20260724;
DROP TABLE system.repair_township_overlap_final_apply_log_20260724;

COMMIT;
