-- =============================================================================
-- 06_backfill_buildings_admin_area.sql
-- Idempotent backfill: smallest containing admin area; update only when values change.
-- Lookup point: centroid when valid, else ST_PointOnSurface(geom).
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

DO $$
BEGIN
    IF to_regprocedure('core.find_admin_area_for_point(geometry,text)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before building backfill';
    END IF;
END $$;

\echo '=== Buildings admin_area backfill ==='

DO $backfill$
DECLARE
    v_has_manual_override boolean;
    v_has_verification_status boolean;
    v_has_normalized_data boolean;
    v_dry_run boolean;
    v_updated bigint;
    v_unmatched bigint;
    v_skipped_verified bigint;
    v_skipped_manual bigint;
    v_skipped_no_calc bigint;
    v_skipped_same bigint;
    v_force_verified boolean;
    v_force_manual boolean;
    v_repair_method constant text := 'smallest_containing';
BEGIN
    v_force_verified := core.pipeline_force_recalculate_verified();
    v_force_manual := core.pipeline_force_manual_override();
    RAISE NOTICE 'buildings backfill session: force_recalculate_verified=%, force_manual_override=%',
        v_force_verified, v_force_manual;
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_map_buildings'
          AND c.column_name = 'manual_override'
    )
    INTO v_has_manual_override;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_map_buildings'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_map_buildings'
          AND c.column_name = 'normalized_data'
    )
    INTO v_has_normalized_data;

    v_dry_run := core.pipeline_dry_run_enabled();

    IF v_has_manual_override THEN
        EXECUTE $sql$
            CREATE TEMP TABLE _buildings_backfill AS
            SELECT
                b.id,
                b.admin_area_id AS old_admin_area_id,
                b.geom,
                b.centroid,
                b.is_verified,
                coalesce(b.manual_override, false) AS manual_override,
                NULL::text AS verification_status,
                st_setsrid(
                    coalesce(
                        CASE
                            WHEN b.centroid IS NOT NULL
                                 AND NOT st_isempty(b.centroid)
                                 AND st_isvalid(b.centroid)
                                THEN b.centroid
                            ELSE NULL
                        END,
                        st_pointonsurface(st_makevalid(st_setsrid(b.geom, 4326)))
                    ),
                    4326
                )::geometry(Point, 4326) AS lookup_point
            FROM core.core_map_buildings AS b
            WHERE b.deleted_at IS NULL
              AND coalesce(b.is_active, true) IS TRUE
              AND b.geom IS NOT NULL
              AND NOT st_isempty(b.geom)
              AND st_isvalid(b.geom)
        $sql$;
    ELSE
        EXECUTE $sql$
            CREATE TEMP TABLE _buildings_backfill AS
            SELECT
                b.id,
                b.admin_area_id AS old_admin_area_id,
                b.geom,
                b.centroid,
                b.is_verified,
                false::boolean AS manual_override,
                NULL::text AS verification_status,
                st_setsrid(
                    coalesce(
                        CASE
                            WHEN b.centroid IS NOT NULL
                                 AND NOT st_isempty(b.centroid)
                                 AND st_isvalid(b.centroid)
                                THEN b.centroid
                            ELSE NULL
                        END,
                        st_pointonsurface(st_makevalid(st_setsrid(b.geom, 4326)))
                    ),
                    4326
                )::geometry(Point, 4326) AS lookup_point
            FROM core.core_map_buildings AS b
            WHERE b.deleted_at IS NULL
              AND coalesce(b.is_active, true) IS TRUE
              AND b.geom IS NOT NULL
              AND NOT st_isempty(b.geom)
              AND st_isvalid(b.geom)
        $sql$;
    END IF;

    IF v_has_verification_status THEN
        EXECUTE $sql$
            UPDATE _buildings_backfill AS s
            SET verification_status = b.verification_status
            FROM core.core_map_buildings AS b
            WHERE b.id = s.id
        $sql$;
    END IF;

    IF v_has_normalized_data THEN
        EXECUTE $sql$
            ALTER TABLE _buildings_backfill
                ADD COLUMN normalized_data jsonb
        $sql$;
        EXECUTE $sql$
            UPDATE _buildings_backfill AS s
            SET normalized_data = b.normalized_data
            FROM core.core_map_buildings AS b
            WHERE b.id = s.id
        $sql$;
    END IF;

    EXECUTE $sql$
        ALTER TABLE _buildings_backfill
            ADD COLUMN new_admin_area_id bigint,
            ADD COLUMN needs_overwrite boolean,
            ADD COLUMN skip_reason text
    $sql$;

    EXECUTE $sql$
        UPDATE _buildings_backfill AS s
        SET new_admin_area_id = core.find_admin_area_for_point(s.lookup_point, NULL)
        WHERE s.lookup_point IS NOT NULL
          AND NOT st_isempty(s.lookup_point)
    $sql$;

    EXECUTE $sql$
        UPDATE _buildings_backfill AS s
        SET
            needs_overwrite = (
                s.new_admin_area_id IS NOT NULL
                AND (
                    s.old_admin_area_id IS NULL
                    OR NOT core.is_admin_area_id_valid_for_point(s.old_admin_area_id, s.lookup_point)
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
                WHEN s.lookup_point IS NULL OR st_isempty(s.lookup_point) THEN 'no_calculated_admin'
                WHEN s.new_admin_area_id IS NULL THEN 'no_calculated_admin'
                WHEN NOT (
                    s.new_admin_area_id IS NOT NULL
                    AND (
                        s.old_admin_area_id IS NULL
                        OR NOT core.is_admin_area_id_valid_for_point(s.old_admin_area_id, s.lookup_point)
                        OR s.new_admin_area_id IS DISTINCT FROM s.old_admin_area_id
                    )
                ) THEN 'same_value'
                ELSE NULL
            END
    $sql$;

    SELECT count(*)::bigint INTO v_skipped_verified
    FROM _buildings_backfill AS s WHERE s.skip_reason = 'verified';

    SELECT count(*)::bigint INTO v_skipped_manual
    FROM _buildings_backfill AS s WHERE s.skip_reason = 'manual_override';

    SELECT count(*)::bigint INTO v_skipped_no_calc
    FROM _buildings_backfill AS s WHERE s.skip_reason = 'no_calculated_admin';

    SELECT count(*)::bigint INTO v_skipped_same
    FROM _buildings_backfill AS s WHERE s.skip_reason = 'same_value';

    RAISE NOTICE 'buildings backfill plan: skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
        v_skipped_verified, v_skipped_manual, v_skipped_no_calc, v_skipped_same;

    IF v_dry_run THEN
        IF v_has_normalized_data THEN
            EXECUTE $sql$
                SELECT count(*)::bigint
                FROM _buildings_backfill AS s
                WHERE s.needs_overwrite IS TRUE
                  AND s.skip_reason IS NULL
                  AND (
                      s.old_admin_area_id IS DISTINCT FROM s.new_admin_area_id
                      OR core.normalized_data_needs_admin_area_repair_update(
                          s.normalized_data,
                          s.old_admin_area_id,
                          s.new_admin_area_id,
                          $1
                      )
                  )
            $sql$
            INTO v_updated
            USING v_repair_method;
        ELSE
            SELECT count(*)::bigint
            INTO v_updated
            FROM _buildings_backfill AS s
            WHERE s.needs_overwrite IS TRUE
              AND s.skip_reason IS NULL
              AND s.old_admin_area_id IS DISTINCT FROM s.new_admin_area_id;
        END IF;

        RAISE NOTICE 'DRY RUN: would update % building row(s)', v_updated;
        RETURN;
    END IF;

    IF v_has_normalized_data THEN
        UPDATE core.core_map_buildings AS b
        SET
            admin_area_id = s.new_admin_area_id,
            normalized_data = core.merge_admin_area_repair_normalized_data(
                b.normalized_data,
                core.build_admin_area_repair_metadata(
                    s.old_admin_area_id,
                    s.new_admin_area_id,
                    v_repair_method
                )
            ),
            updated_at = now()
        FROM _buildings_backfill AS s
        WHERE b.id = s.id
          AND s.needs_overwrite IS TRUE
          AND s.skip_reason IS NULL
          AND (
              b.admin_area_id IS DISTINCT FROM s.new_admin_area_id
              OR core.normalized_data_needs_admin_area_repair_update(
                  b.normalized_data,
                  s.old_admin_area_id,
                  s.new_admin_area_id,
                  v_repair_method
              )
          );
    ELSE
        UPDATE core.core_map_buildings AS b
        SET
            admin_area_id = s.new_admin_area_id,
            updated_at = now()
        FROM _buildings_backfill AS s
        WHERE b.id = s.id
          AND s.needs_overwrite IS TRUE
          AND s.skip_reason IS NULL
          AND b.admin_area_id IS DISTINCT FROM s.new_admin_area_id;
    END IF;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RAISE NOTICE 'buildings backfill applied: updated=%, skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
        v_updated, v_skipped_verified, v_skipped_manual, v_skipped_no_calc, v_skipped_same;
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
FROM _buildings_backfill AS s;

SELECT 'skipped_verified' AS metric, count(*)::bigint AS value
FROM _buildings_backfill AS s WHERE s.skip_reason = 'verified';

SELECT 'skipped_manual_override' AS metric, count(*)::bigint AS value
FROM _buildings_backfill AS s WHERE s.skip_reason = 'manual_override';

SELECT 'skipped_no_calculated_admin' AS metric, count(*)::bigint AS value
FROM _buildings_backfill AS s WHERE s.skip_reason = 'no_calculated_admin';

SELECT 'skipped_same_value' AS metric, count(*)::bigint AS value
FROM _buildings_backfill AS s WHERE s.skip_reason = 'same_value';
