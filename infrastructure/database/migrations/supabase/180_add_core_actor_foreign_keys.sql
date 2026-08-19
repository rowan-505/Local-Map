-- Add validated app_auth actor FKs to Core tables except core_streets.
-- No row updates and no table rewrites.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $block$
DECLARE
  target record;
  orphan_count bigint;
BEGIN
  IF to_regclass('app_auth.auth_users') IS NULL THEN
    RAISE EXCEPTION '180 refused: app_auth.auth_users is missing';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('core', 'core_addresses', 'verified_by', 'core_addresses_verified_by_auth_users_fk'),
      ('core', 'core_admin_areas', 'verified_by', 'core_admin_areas_verified_by_auth_users_fk'),
      ('core', 'core_buildings', 'created_by', 'core_buildings_created_by_auth_users_fk'),
      ('core', 'core_buildings', 'updated_by', 'core_buildings_updated_by_auth_users_fk'),
      ('core', 'core_buildings', 'verified_by', 'core_buildings_verified_by_auth_users_fk'),
      ('core', 'core_land_areas', 'created_by', 'core_land_areas_created_by_auth_users_fk'),
      ('core', 'core_land_areas', 'updated_by', 'core_land_areas_updated_by_auth_users_fk'),
      ('core', 'core_land_areas', 'verified_by', 'core_land_areas_verified_by_auth_users_fk'),
      ('core', 'core_place_versions', 'approved_by', 'core_place_versions_approved_by_auth_users_fk'),
      ('core', 'core_place_versions', 'created_by', 'core_place_versions_created_by_auth_users_fk'),
      ('core', 'core_places', 'verified_by', 'core_places_verified_by_auth_users_fk'),
      ('core', 'core_protected_areas', 'created_by', 'core_protected_areas_created_by_auth_users_fk'),
      ('core', 'core_protected_areas', 'updated_by', 'core_protected_areas_updated_by_auth_users_fk'),
      ('core', 'core_protected_areas', 'verified_by', 'core_protected_areas_verified_by_auth_users_fk'),
      ('core', 'core_water_lines', 'verified_by', 'core_water_lines_verified_by_auth_users_fk'),
      ('core', 'core_water_polygons', 'verified_by', 'core_water_polygons_verified_by_auth_users_fk')
    ) AS v(schema_name, table_name, column_name, constraint_name)
  LOOP
    IF to_regclass(format('%I.%I', target.schema_name, target.table_name)) IS NULL THEN
      RAISE EXCEPTION '180 refused: %.% is missing', target.schema_name, target.table_name;
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
      RAISE EXCEPTION '180 refused: %.%.% already has a foreign key',
        target.schema_name, target.table_name, target.column_name;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I.%I t WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_auth.auth_users u WHERE u.id = t.%I)',
      target.schema_name, target.table_name, target.column_name, target.column_name
    ) INTO orphan_count;

    IF orphan_count <> 0 THEN
      RAISE EXCEPTION '180 refused: %.%.% has % orphan values',
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
