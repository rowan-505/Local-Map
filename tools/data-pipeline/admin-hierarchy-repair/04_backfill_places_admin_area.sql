-- =============================================================================
-- 04_backfill_places_admin_area.sql
-- Idempotent backfill: smallest containing admin area; update only when values change.
-- Skips manual_override unless force_manual_override=true.
-- Skips verified rows unless force_recalculate_verified=true.
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

DO $$
BEGIN
    IF to_regprocedure('core.find_admin_area_for_point(geometry,text)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before place backfill';
    END IF;
END $$;

\echo '=== Places admin_area backfill ==='

DO $backfill$
DECLARE
    v_has_manual_override boolean;
    v_has_verification_status boolean;
    v_dry_run boolean;
    v_force_verified boolean;
    v_force_manual boolean;
    v_updated bigint;
    v_skipped_verified bigint;
    v_skipped_manual_override bigint;
    v_skipped_no_calc bigint;
    v_skipped_same bigint;
    v_unmatched bigint;
    v_repair_method constant text := 'smallest_containing';
BEGIN
    v_force_verified := core.pipeline_force_recalculate_verified();
    v_force_manual := core.pipeline_force_manual_override();
    RAISE NOTICE 'places backfill session: force_recalculate_verified=%, force_manual_override=%',
        v_force_verified, v_force_manual;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_places'
          AND c.column_name = 'manual_override'
    )
    INTO v_has_manual_override;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_places'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    v_dry_run := core.pipeline_dry_run_enabled();

    IF v_has_manual_override THEN
        EXECUTE $sql$
            CREATE TEMP TABLE _places_backfill AS
            SELECT
                p.id,
                p.admin_area_id AS old_admin_area_id,
                p.normalized_data,
                p.is_verified,
                coalesce(p.manual_override, false) AS manual_override,
                NULL::text AS verification_status,
                coalesce(
                    CASE
                        WHEN p.point_geom IS NOT NULL
                             AND NOT st_isempty(p.point_geom)
                             AND st_isvalid(p.point_geom)
                            THEN p.point_geom
                        ELSE NULL
                    END,
                    CASE
                        WHEN p.entry_geom IS NOT NULL
                             AND NOT st_isempty(p.entry_geom)
                             AND st_isvalid(p.entry_geom)
                            THEN p.entry_geom
                        ELSE NULL
                    END
                ) AS lookup_geom,
                core.entity_rep_point_for_admin_lookup(
                    coalesce(
                        CASE
                            WHEN p.point_geom IS NOT NULL
                                 AND NOT st_isempty(p.point_geom)
                                 AND st_isvalid(p.point_geom)
                                THEN p.point_geom
                            ELSE NULL
                        END,
                        CASE
                            WHEN p.entry_geom IS NOT NULL
                                 AND NOT st_isempty(p.entry_geom)
                                 AND st_isvalid(p.entry_geom)
                                THEN p.entry_geom
                            ELSE NULL
                        END,
                        st_setsrid(st_makepoint(p.lng, p.lat), 4326)
                    )
                ) AS rep_point
            FROM core.core_places AS p
            WHERE p.deleted_at IS NULL
        $sql$;
    ELSE
        EXECUTE $sql$
            CREATE TEMP TABLE _places_backfill AS
            SELECT
                p.id,
                p.admin_area_id AS old_admin_area_id,
                p.normalized_data,
                p.is_verified,
                false::boolean AS manual_override,
                NULL::text AS verification_status,
                coalesce(
                    CASE
                        WHEN p.point_geom IS NOT NULL
                             AND NOT st_isempty(p.point_geom)
                             AND st_isvalid(p.point_geom)
                            THEN p.point_geom
                        ELSE NULL
                    END,
                    CASE
                        WHEN p.entry_geom IS NOT NULL
                             AND NOT st_isempty(p.entry_geom)
                             AND st_isvalid(p.entry_geom)
                            THEN p.entry_geom
                        ELSE NULL
                    END
                ) AS lookup_geom,
                core.entity_rep_point_for_admin_lookup(
                    coalesce(
                        CASE
                            WHEN p.point_geom IS NOT NULL
                                 AND NOT st_isempty(p.point_geom)
                                 AND st_isvalid(p.point_geom)
                                THEN p.point_geom
                            ELSE NULL
                        END,
                        CASE
                            WHEN p.entry_geom IS NOT NULL
                                 AND NOT st_isempty(p.entry_geom)
                                 AND st_isvalid(p.entry_geom)
                                THEN p.entry_geom
                            ELSE NULL
                        END,
                        st_setsrid(st_makepoint(p.lng, p.lat), 4326)
                    )
                ) AS rep_point
            FROM core.core_places AS p
            WHERE p.deleted_at IS NULL
        $sql$;
    END IF;

    IF v_has_verification_status THEN
        EXECUTE $sql$
            UPDATE _places_backfill AS s
            SET verification_status = p.verification_status
            FROM core.core_places AS p
            WHERE p.id = s.id
        $sql$;
    END IF;

    EXECUTE $sql$
        ALTER TABLE _places_backfill
            ADD COLUMN new_admin_area_id bigint,
            ADD COLUMN needs_overwrite boolean,
            ADD COLUMN skip_reason text
    $sql$;

    EXECUTE $sql$
        UPDATE _places_backfill AS s
        SET new_admin_area_id = core.find_admin_area_for_point(s.lookup_geom, NULL)
    $sql$;

    EXECUTE $sql$
        UPDATE _places_backfill AS s
        SET
            needs_overwrite = (
                s.new_admin_area_id IS NOT NULL
                AND (
                    s.old_admin_area_id IS NULL
                    OR NOT core.is_admin_area_id_valid_for_point(s.old_admin_area_id, s.rep_point)
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
                WHEN s.lookup_geom IS NULL OR st_isempty(s.lookup_geom) THEN 'no_calculated_admin'
                WHEN s.new_admin_area_id IS NULL THEN 'no_calculated_admin'
                WHEN NOT (
                    s.new_admin_area_id IS NOT NULL
                    AND (
                        s.old_admin_area_id IS NULL
                        OR NOT core.is_admin_area_id_valid_for_point(s.old_admin_area_id, s.rep_point)
                        OR s.new_admin_area_id IS DISTINCT FROM s.old_admin_area_id
                    )
                ) THEN 'same_value'
                ELSE NULL
            END
    $sql$;

    SELECT count(*)::bigint
    INTO v_unmatched
    FROM _places_backfill AS s
    WHERE s.skip_reason = 'no_calculated_admin';

    SELECT count(*)::bigint
    INTO v_skipped_verified
    FROM _places_backfill AS s
    WHERE s.skip_reason = 'verified';

    SELECT count(*)::bigint
    INTO v_skipped_manual_override
    FROM _places_backfill AS s
    WHERE s.skip_reason = 'manual_override';

    SELECT count(*)::bigint
    INTO v_skipped_no_calc
    FROM _places_backfill AS s
    WHERE s.skip_reason = 'no_calculated_admin';

    SELECT count(*)::bigint
    INTO v_skipped_same
    FROM _places_backfill AS s
    WHERE s.skip_reason = 'same_value';

    RAISE NOTICE 'places backfill plan: skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
        v_skipped_verified, v_skipped_manual_override, v_skipped_no_calc, v_skipped_same;

    IF v_dry_run THEN
        SELECT count(*)::bigint
        INTO v_updated
        FROM _places_backfill AS s
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

        RAISE NOTICE 'DRY RUN: would update % place row(s)', v_updated;
        RETURN;
    END IF;

    UPDATE core.core_places AS p
    SET
        admin_area_id = s.new_admin_area_id,
        normalized_data = core.merge_admin_area_repair_normalized_data(
            p.normalized_data,
            core.build_admin_area_repair_metadata(
                s.old_admin_area_id,
                s.new_admin_area_id,
                v_repair_method
            )
        ),
        updated_at = now()
    FROM _places_backfill AS s
    WHERE p.id = s.id
      AND s.needs_overwrite IS TRUE
      AND s.skip_reason IS NULL
      AND (
          p.admin_area_id IS DISTINCT FROM s.new_admin_area_id
          OR core.normalized_data_needs_admin_area_repair_update(
              p.normalized_data,
              s.old_admin_area_id,
              s.new_admin_area_id,
              v_repair_method
          )
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RAISE NOTICE 'places backfill applied: updated=%, skipped_verified=%, skipped_manual_override=%, skipped_no_calculated_admin=%, skipped_same_value=%',
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
FROM _places_backfill AS s;

SELECT 'skipped_verified' AS metric, count(*)::bigint AS value
FROM _places_backfill AS s
WHERE s.skip_reason = 'verified';

SELECT 'skipped_manual_override' AS metric, count(*)::bigint AS value
FROM _places_backfill AS s
WHERE s.skip_reason = 'manual_override';

SELECT 'skipped_no_calculated_admin' AS metric, count(*)::bigint AS value
FROM _places_backfill AS s
WHERE s.skip_reason = 'no_calculated_admin';

SELECT 'skipped_same_value' AS metric, count(*)::bigint AS value
FROM _places_backfill AS s
WHERE s.skip_reason = 'same_value';
