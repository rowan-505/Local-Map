-- =============================================================================
-- 06_backfill_buildings_admin_area.sql
-- Chunked backfill: smallest containing admin area for NULL or invalid rows.
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

\echo '=== Buildings admin_area backfill (smallest containing, chunked) ==='

DO $backfill$
DECLARE
    v_has_manual_override boolean;
    v_has_verification_status boolean;
    v_has_normalized_data boolean;
    v_dry_run boolean;
    v_write_metadata boolean;
    v_force_verified boolean;
    v_force_manual boolean;
    v_chunk_limit integer;
    v_chunk_num integer := 0;
    v_chunk_selected bigint;
    v_after_id bigint := 0;
    v_chunk_max_id bigint;
    v_updated bigint;
    v_total_updated bigint := 0;
    v_repair_method constant text := 'smallest_containing';
BEGIN
    v_dry_run := core.pipeline_dry_run_enabled();
    v_write_metadata := core.pipeline_write_admin_repair_metadata();
    v_chunk_limit := core.pipeline_chunk_limit();
    v_force_verified := core.pipeline_force_recalculate_verified();
    v_force_manual := core.pipeline_force_manual_override();

    RAISE NOTICE 'buildings backfill session: dry_run=%, chunk_limit=%, write_admin_repair_metadata=%, force_recalculate_verified=%, force_manual_override=%',
        v_dry_run, v_chunk_limit, v_write_metadata, v_force_verified, v_force_manual;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_buildings'
          AND c.column_name = 'manual_override'
    )
    INTO v_has_manual_override;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_buildings'
          AND c.column_name = 'verification_status'
    )
    INTO v_has_verification_status;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_buildings'
          AND c.column_name = 'normalized_data'
    )
    INTO v_has_normalized_data;

    LOOP
        v_chunk_num := v_chunk_num + 1;

        IF v_has_manual_override THEN
            EXECUTE $sql$
                CREATE TEMP TABLE _buildings_chunk ON COMMIT DROP AS
                SELECT
                    b.id,
                    b.admin_area_id AS old_admin_area_id,
                    coalesce(b.manual_override, false) AS manual_override,
                    b.is_verified,
                    CASE
                        WHEN $1 THEN b.verification_status
                        ELSE NULL::text
                    END AS verification_status,
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
                FROM core.core_buildings AS b
                WHERE b.deleted_at IS NULL
                  AND coalesce(b.is_active, true) IS TRUE
                  AND b.geom IS NOT NULL
                  AND NOT st_isempty(b.geom)
                  AND st_isvalid(b.geom)
                  AND (
                      b.admin_area_id IS NULL
                      OR NOT core.is_admin_area_id_valid_for_point(
                          b.admin_area_id,
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
                          )::geometry(Point, 4326)
                      )
                  )
                  AND NOT core.entity_admin_assignment_is_protected(
                      coalesce(b.manual_override, false),
                      b.is_verified,
                      CASE WHEN $1 THEN b.verification_status ELSE NULL::text END
                  )
                  AND b.id > $3
                ORDER BY b.id
                LIMIT $2
            $sql$
            USING v_has_verification_status, v_chunk_limit, v_after_id;
        ELSE
            EXECUTE $sql$
                CREATE TEMP TABLE _buildings_chunk ON COMMIT DROP AS
                SELECT
                    b.id,
                    b.admin_area_id AS old_admin_area_id,
                    false::boolean AS manual_override,
                    b.is_verified,
                    CASE
                        WHEN $1 THEN b.verification_status
                        ELSE NULL::text
                    END AS verification_status,
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
                FROM core.core_buildings AS b
                WHERE b.deleted_at IS NULL
                  AND coalesce(b.is_active, true) IS TRUE
                  AND b.geom IS NOT NULL
                  AND NOT st_isempty(b.geom)
                  AND st_isvalid(b.geom)
                  AND (
                      b.admin_area_id IS NULL
                      OR NOT core.is_admin_area_id_valid_for_point(
                          b.admin_area_id,
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
                          )::geometry(Point, 4326)
                      )
                  )
                  AND NOT core.entity_admin_assignment_is_protected(
                      false,
                      b.is_verified,
                      CASE WHEN $1 THEN b.verification_status ELSE NULL::text END
                  )
                  AND b.id > $3
                ORDER BY b.id
                LIMIT $2
            $sql$
            USING v_has_verification_status, v_chunk_limit, v_after_id;
        END IF;

        SELECT count(*)::bigint, max(c.id)
        INTO v_chunk_selected, v_chunk_max_id
        FROM _buildings_chunk AS c;

        IF v_chunk_selected = 0 THEN
            DROP TABLE IF EXISTS _buildings_chunk;
            EXIT;
        END IF;

        DELETE FROM _buildings_chunk AS c
        WHERE c.lookup_point IS NULL
           OR st_isempty(c.lookup_point);

        ALTER TABLE _buildings_chunk
            ADD COLUMN new_admin_area_id bigint;

        UPDATE _buildings_chunk AS c
        SET new_admin_area_id = core.find_admin_area_for_point(c.lookup_point, NULL);

        DELETE FROM _buildings_chunk AS c
        WHERE c.new_admin_area_id IS NULL
           OR c.old_admin_area_id IS NOT DISTINCT FROM c.new_admin_area_id;

        SELECT count(*)::bigint
        INTO v_updated
        FROM _buildings_chunk AS c;

        IF v_dry_run THEN
            RAISE NOTICE 'DRY RUN chunk %: selected=%, updated_count=%',
                v_chunk_num, v_chunk_selected, v_updated;
            v_total_updated := v_total_updated + v_updated;
            DROP TABLE IF EXISTS _buildings_chunk;
            IF v_updated = 0 AND v_chunk_selected < v_chunk_limit THEN
                EXIT;
            END IF;
            IF v_updated = 0 THEN
                RAISE WARNING 'buildings backfill chunk %: skipping % unassignable candidates (id <= %)',
                    v_chunk_num, v_chunk_selected, v_chunk_max_id;
            END IF;
            v_after_id := v_chunk_max_id;
            CONTINUE;
        END IF;

        IF v_write_metadata AND v_has_normalized_data THEN
            UPDATE core.core_buildings AS b
            SET
                admin_area_id = c.new_admin_area_id,
                normalized_data = core.merge_admin_area_repair_normalized_data(
                    b.normalized_data,
                    core.build_admin_area_repair_metadata(
                        c.old_admin_area_id,
                        c.new_admin_area_id,
                        v_repair_method
                    )
                ),
                updated_at = now()
            FROM _buildings_chunk AS c
            WHERE b.id = c.id
              AND b.admin_area_id IS DISTINCT FROM c.new_admin_area_id;
        ELSE
            UPDATE core.core_buildings AS b
            SET
                admin_area_id = c.new_admin_area_id,
                updated_at = now()
            FROM _buildings_chunk AS c
            WHERE b.id = c.id
              AND b.admin_area_id IS DISTINCT FROM c.new_admin_area_id;
        END IF;

        GET DIAGNOSTICS v_updated = ROW_COUNT;

        RAISE NOTICE 'buildings backfill chunk %: selected=%, updated_count=%',
            v_chunk_num, v_chunk_selected, v_updated;
        v_total_updated := v_total_updated + v_updated;

        DROP TABLE IF EXISTS _buildings_chunk;

        IF v_updated = 0 THEN
            IF v_chunk_selected < v_chunk_limit THEN
                EXIT;
            END IF;
            v_after_id := v_chunk_max_id;
            RAISE WARNING 'buildings backfill chunk %: skipping % unassignable candidates (id <= %)',
                v_chunk_num, v_chunk_selected, v_after_id;
            CONTINUE;
        END IF;

        v_after_id := 0;
    END LOOP;

    RAISE NOTICE 'buildings backfill finished: total_updated=%, chunks_processed=%',
        v_total_updated, v_chunk_num;
END $backfill$;
