-- Preserve import-review history and release assignments if an application user
-- is deleted. Existing actor FKs defaulted to NO ACTION in migration 024.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $block$
DECLARE
  target record;
  existing_definition text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('address_candidates', 'assigned_to', 'irr_addr_assigned_to_fkey'),
      ('admin_area_candidates', 'assigned_to', 'irr_adm_assigned_to_fkey'),
      ('building_candidates', 'assigned_to', 'irr_bld_assigned_to_fkey'),
      ('land_area_candidates', 'assigned_to', 'irr_lu_assigned_to_fkey'),
      ('place_candidates', 'assigned_to', 'irr_plc_assigned_to_fkey'),
      ('protected_area_candidates', 'assigned_to', 'irr_pa_assigned_to_fkey'),
      ('review_comments', 'created_by', 'irr_rcm_created_by_fkey'),
      ('review_tasks', 'assigned_to', 'irr_rtk_assigned_to_fkey'),
      ('road_candidates', 'assigned_to', 'irr_road_assigned_to_fkey'),
      ('routing_barrier_candidates', 'assigned_to', 'irr_rbar_assigned_to_fkey'),
      ('routing_turn_restriction_candidates', 'assigned_to', 'irr_rtr_assigned_to_fkey'),
      ('water_line_candidates', 'assigned_to', 'irr_wl_assigned_to_fkey'),
      ('water_polygon_candidates', 'assigned_to', 'irr_wp_assigned_to_fkey')
    ) AS v(table_name, column_name, constraint_name)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO existing_definition
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass(format('import_review.%I', target.table_name))
      AND c.conname = target.constraint_name
      AND c.contype = 'f';

    IF existing_definition IS NULL
       OR existing_definition NOT LIKE '%REFERENCES app_auth.auth_users(id)%' THEN
      RAISE EXCEPTION '183 refused: unexpected or missing constraint % on import_review.%',
        target.constraint_name, target.table_name;
    END IF;

    EXECUTE format(
      'ALTER TABLE import_review.%I DROP CONSTRAINT %I',
      target.table_name, target.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE import_review.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL NOT VALID',
      target.table_name, target.constraint_name, target.column_name
    );
    EXECUTE format(
      'ALTER TABLE import_review.%I VALIDATE CONSTRAINT %I',
      target.table_name, target.constraint_name
    );
  END LOOP;
END
$block$;

COMMIT;
