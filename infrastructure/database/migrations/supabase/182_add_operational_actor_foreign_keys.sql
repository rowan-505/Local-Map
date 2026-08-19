-- Add validated actor FKs to routing, search, and system workflow tables.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $block$
DECLARE
  target record;
  orphan_count bigint;
BEGIN
  IF to_regclass('app_auth.auth_users') IS NULL THEN
    RAISE EXCEPTION '182 refused: app_auth.auth_users is missing';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('routing', 'routing_barriers', 'verified_by', 'routing_barriers_verified_by_auth_users_fk'),
      ('routing', 'routing_build_jobs', 'created_by', 'routing_build_jobs_created_by_auth_users_fk'),
      ('routing', 'routing_builds', 'created_by', 'routing_builds_created_by_auth_users_fk'),
      ('routing', 'routing_turn_restrictions', 'verified_by', 'routing_turn_restrictions_verified_by_auth_users_fk'),
      ('search', 'search_aliases', 'created_by', 'search_aliases_created_by_auth_users_fk'),
      ('system', 'system_conflict_queue', 'assigned_to', 'system_conflict_queue_assigned_to_auth_users_fk'),
      ('system', 'system_publish_batches', 'approved_by', 'system_publish_batches_approved_by_auth_users_fk'),
      ('system', 'system_publish_batches', 'created_by', 'system_publish_batches_created_by_auth_users_fk'),
      ('system', 'system_review_tasks', 'assigned_to', 'system_review_tasks_assigned_to_auth_users_fk')
    ) AS v(schema_name, table_name, column_name, constraint_name)
  LOOP
    IF to_regclass(format('%I.%I', target.schema_name, target.table_name)) IS NULL THEN
      RAISE EXCEPTION '182 refused: %.% is missing', target.schema_name, target.table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = to_regclass(format('%I.%I', target.schema_name, target.table_name))
        AND c.contype = 'f'
        AND a.attname = target.column_name
    ) THEN
      RAISE EXCEPTION '182 refused: %.%.% already has a foreign key',
        target.schema_name, target.table_name, target.column_name;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I.%I t WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_auth.auth_users u WHERE u.id = t.%I)',
      target.schema_name, target.table_name, target.column_name, target.column_name
    ) INTO orphan_count;

    IF orphan_count <> 0 THEN
      RAISE EXCEPTION '182 refused: %.%.% has % orphan values',
        target.schema_name, target.table_name, target.column_name, orphan_count;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL NOT VALID',
      target.schema_name, target.table_name, target.constraint_name, target.column_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
      target.schema_name, target.table_name, target.constraint_name
    );
  END LOOP;
END
$block$;

COMMIT;
