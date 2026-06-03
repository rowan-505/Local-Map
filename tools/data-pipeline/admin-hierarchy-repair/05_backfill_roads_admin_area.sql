-- =============================================================================
-- 05_backfill_roads_admin_area.sql
-- Idempotent backfill: best/minimum admin area for lines; update only when changed.
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

DO $$
BEGIN
    IF to_regprocedure('core.find_admin_area_for_line(geometry,text)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before street backfill';
    END IF;
    IF to_regprocedure('core.merge_admin_area_repair_normalized_data(jsonb,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before street backfill (repair helpers)';
    END IF;
END $$;

\echo '=== Streets (roads) admin_area backfill ==='

DO $backfill$
DECLARE
    v_has_verification_status boolean;
    v_dry_run boolean;
    v_force_verified boolean;
    v_force_manual boolean;
    v_updated bigint;
    v_skipped_verified bigint;
    v_skipped_manual_override bigint;
    v_skipped_no_calc bigint;
    v_skipped_same bigint;
    v_repair_method constant text := 'best_minimum_admin_area';
BEGIN
    v_force_verified := core.pipeline_force_recalculate_verified();
    v_force_manual := core.pipeline_force_manual_override();
    RAISE NOTICE 'streets backfill session: force_recalculate_verified=%, force_manual_override=%',
        v_force_verified, v_force_manual;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    v_dry_run := core.pipeline_dry_run_enabled();

    CREATE TEMP TABLE _streets_backfill AS
    SELECT
        s.id,
        s.admin_area_id AS old_admin_area_id,
        s.normalized_data,
        s.geom,
        s.is_verified,
        coalesce(s.manual_override, false) AS manual_override,
        NULL::text AS verification_status
    FROM core.core_streets AS s
    WHERE s.deleted_at IS NULL
      AND coalesce(s.is_active, true) IS TRUE
      AND s.geom IS NOT NULL
      AND NOT st_isempty(s.geom)
      AND st_isvalid(s.geom);

    IF v_has_verification_status THEN
        EXECUTE $sql$
            UPDATE _streets_backfill AS s
            SET verification_status = src.verification_status
            FROM core.core_streets AS src
            WHERE src.id = s.id
        $sql$;
    END IF;

    ALTER TABLE _streets_backfill
        ADD COLUMN new_admin_area_id bigint,
        ADD COLUMN needs_overwrite boolean,
        ADD COLUMN skip_reason text;

    UPDATE _streets_backfill AS s
    SET new_admin_area_id = core.find_admin_area_for_line(s.geom, NULL);

    UPDATE _streets_backfill AS s
    SET
        needs_overwrite = (
            s.new_admin_area_id IS NOT NULL
            AND (
                s.old_admin_area_id IS NULL
                OR NOT core.is_admin_area_id_valid_for_line(s.old_admin_area_id, s.geom)
                OR s.new_admin_area_id IS DISTINCT FROM s.old_admin_area_id
            )
        ),
        skip_reason = CASE
            WHEN core.entity_admin_assignment_is_protected(
                s.manual_override, s.is_verified, s.verification_status
            ) THEN
                CASE
                    WHEN coalesce(s.manual_override, false)
                         AND NOT core.pipeline_force_manual_override()
                        THEN 'manual_override'
                    ELSE 'verified'
                END
            WHEN s.new_admin_area_id IS NULL THEN 'no_calculated_admin'
            WHEN NOT (
                s.new_admin_area_id IS NOT NULL
                AND (
                    s.old_admin_area_id IS NULL
                    OR NOT core.is_admin_area_id_valid_for_line(s.old_admin_area_id, s.geom)
                    OR s.new_admin_area_id IS DISTINCT FROM s.old_admin_area_id
                )
            ) THEN 'same_value'
            ELSE NULL
        END;

    SELECT count(*)::bigint
    INTO v_skipped_verified
    FROM _streets_backfill AS s
    WHERE s.skip_reason = 'verified';

    SELECT count(*)::bigint
    INTO v_skipped_manual_override
    FROM _streets_backfill AS s
    WHERE s.skip_reason = 'manual_override';

    SELECT count(*)::bigint
    INTO v_skipped_no_calc
    FROM _streets_backfill AS s
    WHERE s.skip_reason = 'no_calculated_admin';

    SELECT count(*)::bigint
    INTO v_skipped_same
    FROM _streets_backfill AS s
    WHERE s.skip_reason = 'same_value';

    RAISE NOTICE 'streets backfill plan: skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
        v_skipped_verified, v_skipped_manual_override, v_skipped_no_calc, v_skipped_same;

    IF v_dry_run THEN
        SELECT count(*)::bigint
        INTO v_updated
        FROM _streets_backfill AS s
        WHERE s.needs_overwrite IS TRUE
          AND s.skip_reason IS NULL
          AND (
              s.old_admin_area_id IS DISTINCT FROM s.new_admin_area_id
              OR core.normalized_data_needs_admin_area_repair_update(
                  s.normalized_data,
                  s.old_admin_area_id,
                  s.new_admin_area_id,
                  v_repair_method
              )
          );

        RAISE NOTICE 'DRY RUN: would update % street row(s)', v_updated;
        RETURN;
    END IF;

    UPDATE core.core_streets AS s
    SET
        admin_area_id = b.new_admin_area_id,
        normalized_data = core.merge_admin_area_repair_normalized_data(
            s.normalized_data,
            core.build_admin_area_repair_metadata(
                b.old_admin_area_id,
                b.new_admin_area_id,
                v_repair_method
            )
        ),
        updated_at = now()
    FROM _streets_backfill AS b
    WHERE s.id = b.id
      AND b.needs_overwrite IS TRUE
      AND b.skip_reason IS NULL
      AND (
          s.admin_area_id IS DISTINCT FROM b.new_admin_area_id
          OR core.normalized_data_needs_admin_area_repair_update(
              s.normalized_data,
              b.old_admin_area_id,
              b.new_admin_area_id,
              v_repair_method
          )
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RAISE NOTICE 'streets backfill applied: updated=%, skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
        v_updated, v_skipped_verified, v_skipped_manual_override, v_skipped_no_calc, v_skipped_same;
END $backfill$;

\echo ''
\echo '--- Summary metrics ---'

SELECT
    'updated_count' AS metric,
    count(*) FILTER (
        WHERE s.needs_overwrite IS TRUE AND s.skip_reason IS NULL
    )::bigint AS value,
    CASE
        WHEN core.pipeline_dry_run_enabled() THEN 'planned (dry run)'
        ELSE 'applied'
    END AS note
FROM _streets_backfill AS s;

SELECT 'skipped_verified' AS metric, count(*)::bigint AS value
FROM _streets_backfill AS s
WHERE s.skip_reason = 'verified';

SELECT 'skipped_manual_override' AS metric, count(*)::bigint AS value
FROM _streets_backfill AS s
WHERE s.skip_reason = 'manual_override';

SELECT 'skipped_no_calculated_admin' AS metric, count(*)::bigint AS value
FROM _streets_backfill AS s
WHERE s.skip_reason = 'no_calculated_admin';

SELECT 'skipped_same_value' AS metric, count(*)::bigint AS value
FROM _streets_backfill AS s
WHERE s.skip_reason = 'same_value';
