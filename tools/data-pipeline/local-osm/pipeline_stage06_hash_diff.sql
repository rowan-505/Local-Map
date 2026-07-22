-- =============================================================================
-- Stage 06 F1 core: identity_key + normalized_hash compare + source_status writeback.
-- Included from 06_diff_current_vs_previous.sql inside an open transaction.
-- =============================================================================

DO $stage06_create_diffs$
DECLARE
    v_staging_schema text;
    ctx stage06_context%ROWTYPE;
    cfg record;
    v_current_count bigint;
    v_previous_count bigint;
    v_diff_run_id bigint;
    v_has_confidence boolean;
    v_has_point boolean;
    v_has_geom boolean;
    v_geom_expr text;
    v_confidence_expr text;
    v_written bigint;
    v_snap_ids bigint[];
    q text;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage06_params AS p;

    SELECT *
    INTO STRICT ctx
    FROM stage06_context;

    IF ctx.previous_snapshot_id IS NULL THEN
        v_snap_ids := ARRAY[ctx.current_snapshot_id];
    ELSE
        v_snap_ids := ARRAY[ctx.current_snapshot_id, ctx.previous_snapshot_id];
    END IF;

    FOR cfg IN SELECT * FROM stage06_family_config LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, cfg.target_table)) IS NULL THEN
            CONTINUE;
        END IF;

        -- Ensure status columns exist (safe if Stage 05b already ran).
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS normalized_hash text NULL',
            v_staging_schema, cfg.target_table
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS source_status text NULL',
            v_staging_schema, cfg.target_table
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS validation_status text NULL',
            v_staging_schema, cfg.target_table
        );

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = cfg.target_table
              AND column_name = 'point_geom'
        ) INTO v_has_point;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = cfg.target_table
              AND column_name = 'geom'
        ) INTO v_has_geom;

        IF v_has_geom AND v_has_point THEN
            v_geom_expr := 'coalesce';
        ELSIF v_has_point THEN
            v_geom_expr := 'point';
        ELSIF v_has_geom THEN
            v_geom_expr := 'geom';
        ELSE
            v_geom_expr := 'none';
        END IF;

        -- Backfill missing hashes for current + previous slices (local only).
        IF v_geom_expr = 'none' THEN
            q := format(
                $h$
                UPDATE %1$I.%2$I AS s
                SET normalized_hash = system.pipeline_staging_content_hash(
                    s.external_id,
                    s.normalized_data,
                    NULL::geometry
                )
                WHERE s.source_snapshot_id = ANY ($1::bigint[])
                  AND s.normalized_hash IS NULL
                $h$,
                v_staging_schema,
                cfg.target_table
            );
        ELSIF v_geom_expr = 'point' THEN
            q := format(
                $h$
                UPDATE %1$I.%2$I AS s
                SET normalized_hash = system.pipeline_staging_content_hash(
                    s.external_id,
                    s.normalized_data,
                    s.point_geom
                )
                WHERE s.source_snapshot_id = ANY ($1::bigint[])
                  AND s.normalized_hash IS NULL
                $h$,
                v_staging_schema,
                cfg.target_table
            );
        ELSIF v_geom_expr = 'geom' THEN
            q := format(
                $h$
                UPDATE %1$I.%2$I AS s
                SET normalized_hash = system.pipeline_staging_content_hash(
                    s.external_id,
                    s.normalized_data,
                    s.geom
                )
                WHERE s.source_snapshot_id = ANY ($1::bigint[])
                  AND s.normalized_hash IS NULL
                $h$,
                v_staging_schema,
                cfg.target_table
            );
        ELSE
            q := format(
                $h$
                UPDATE %1$I.%2$I AS s
                SET normalized_hash = system.pipeline_staging_content_hash(
                    s.external_id,
                    s.normalized_data,
                    coalesce(s.geom, s.point_geom)
                )
                WHERE s.source_snapshot_id = ANY ($1::bigint[])
                  AND s.normalized_hash IS NULL
                $h$,
                v_staging_schema,
                cfg.target_table
            );
        END IF;

        EXECUTE q USING v_snap_ids;

        q := format(
            'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
            v_staging_schema,
            cfg.target_table
        );
        EXECUTE q INTO v_current_count USING ctx.current_snapshot_id;

        IF ctx.previous_snapshot_id IS NULL THEN
            v_previous_count := 0;
        ELSE
            EXECUTE q INTO v_previous_count USING ctx.previous_snapshot_id;
        END IF;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        VALUES
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), 'current_rows', v_current_count, 'PASS', NULL),
            (cfg.entity_family, format('%s.%s', v_staging_schema, cfg.target_table), 'previous_rows', v_previous_count, 'PASS', NULL);

        IF v_current_count = 0 AND v_previous_count = 0 THEN
            INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
            VALUES (
                cfg.entity_family,
                format('%s.%s', v_staging_schema, cfg.target_table),
                'skipped_empty_family',
                0,
                'PASS',
                'No current or previous rows; no diff_run created.'
            );
            CONTINUE;
        END IF;

        INSERT INTO system.system_diff_runs (
            previous_snapshot_id,
            current_snapshot_id,
            entity_family,
            status,
            started_at,
            summary
        )
        VALUES (
            ctx.previous_snapshot_id,
            ctx.current_snapshot_id,
            cfg.entity_family,
            'running',
            now(),
            jsonb_build_object(
                'comparison_type', 'snapshot_vs_snapshot',
                'compare_mode', 'identity_key_normalized_hash',
                'first_snapshot', ctx.is_first_snapshot,
                'current_snapshot_id', ctx.current_snapshot_id,
                'previous_snapshot_id', ctx.previous_snapshot_id,
                'current_snapshot_version', ctx.current_snapshot_version,
                'previous_snapshot_version', ctx.previous_snapshot_version,
                'region_code', ctx.region_code,
                'target_table', format('%s.%s', v_staging_schema, cfg.target_table)
            )
        )
        RETURNING id INTO v_diff_run_id;

        INSERT INTO stage06_diff_runs (entity_family, target_table, diff_run_id, current_rows, previous_rows)
        VALUES (
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            v_diff_run_id,
            v_current_count,
            v_previous_count
        );

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = cfg.target_table
              AND column_name = 'confidence_score'
        ) INTO v_has_confidence;

        IF v_has_confidence THEN
            v_confidence_expr := 'CASE WHEN paired.c_id IS NULL THEN coalesce(paired.p_confidence_score, 50.0000) ELSE coalesce(paired.c_confidence_score, 50.0000) END';
        ELSE
            v_confidence_expr := '50.0000';
        END IF;

        IF ctx.previous_snapshot_id IS NULL THEN
            q := format(
                $q$
                INSERT INTO system.system_diff_items (
                    diff_run_id,
                    entity_family,
                    diff_type,
                    external_id,
                    local_entity_id,
                    before_data,
                    after_data,
                    confidence_score,
                    auto_action,
                    review_status,
                    created_at
                )
                SELECT
                    $1,
                    %L,
                    'new',
                    c.external_id,
                    c.id,
                    NULL,
                    to_jsonb(c),
                    %s,
                    'insert_candidate',
                    'pending',
                    now()
                FROM %I.%I AS c
                WHERE c.source_snapshot_id = $2
                $q$,
                cfg.entity_family,
                CASE WHEN v_has_confidence THEN 'coalesce(c.confidence_score, 50.0000)' ELSE '50.0000' END,
                v_staging_schema,
                cfg.target_table
            );
            EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id;
        ELSE
            q := format(
                $q$
                WITH current_rows AS (
                    SELECT DISTINCT ON (system.pipeline_osm_identity_key(external_id))
                        *,
                        system.pipeline_osm_identity_key(external_id) AS identity_key
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $2
                      AND system.pipeline_osm_identity_key(external_id) IS NOT NULL
                    ORDER BY system.pipeline_osm_identity_key(external_id), id
                ),
                previous_rows AS (
                    SELECT DISTINCT ON (system.pipeline_osm_identity_key(external_id))
                        *,
                        system.pipeline_osm_identity_key(external_id) AS identity_key
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $3
                      AND system.pipeline_osm_identity_key(external_id) IS NOT NULL
                    ORDER BY system.pipeline_osm_identity_key(external_id), id
                ),
                paired AS (
                    SELECT
                        c.id AS c_id,
                        p.id AS p_id,
                        coalesce(c.external_id, p.external_id) AS external_id,
                        %3$s AS c_confidence_score,
                        %4$s AS p_confidence_score,
                        to_jsonb(c) AS current_data,
                        to_jsonb(p) AS previous_data,
                        CASE
                            WHEN c.id IS NULL THEN 'deleted_candidate'
                            WHEN p.id IS NULL THEN 'new'
                            WHEN coalesce(c.normalized_hash, '') IS DISTINCT FROM coalesce(p.normalized_hash, '')
                                THEN 'changed'
                            ELSE 'unchanged'
                        END AS diff_type
                    FROM current_rows AS c
                    FULL OUTER JOIN previous_rows AS p
                        ON p.identity_key = c.identity_key
                )
                INSERT INTO system.system_diff_items (
                    diff_run_id,
                    entity_family,
                    diff_type,
                    external_id,
                    local_entity_id,
                    before_data,
                    after_data,
                    confidence_score,
                    auto_action,
                    review_status,
                    created_at
                )
                SELECT
                    $1,
                    %5$L,
                    paired.diff_type,
                    paired.external_id,
                    CASE
                        WHEN paired.diff_type = 'deleted_candidate' THEN paired.p_id
                        ELSE paired.c_id
                    END,
                    CASE WHEN paired.diff_type = 'new' THEN NULL ELSE paired.previous_data END,
                    CASE WHEN paired.diff_type = 'deleted_candidate' THEN NULL ELSE paired.current_data END,
                    %6$s,
                    CASE
                        WHEN paired.diff_type = 'new' THEN 'insert_candidate'
                        WHEN paired.diff_type = 'changed' AND %7$L::boolean THEN 'needs_review'
                        WHEN paired.diff_type = 'changed' THEN 'update_candidate'
                        WHEN paired.diff_type = 'deleted_candidate' THEN 'needs_review'
                        ELSE 'ignore_unchanged'
                    END,
                    CASE
                        WHEN paired.diff_type = 'unchanged' THEN 'ignored'
                        ELSE 'pending'
                    END,
                    now()
                FROM paired
                $q$,
                v_staging_schema,
                cfg.target_table,
                CASE WHEN v_has_confidence THEN 'c.confidence_score' ELSE 'NULL::numeric' END,
                CASE WHEN v_has_confidence THEN 'p.confidence_score' ELSE 'NULL::numeric' END,
                cfg.entity_family,
                v_confidence_expr,
                cfg.admin_needs_review
            );
            EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id, ctx.previous_snapshot_id;
        END IF;

        -- Write source_status onto current staging rows (valid candidates must have one).
        q := format(
            $w$
            UPDATE %1$I.%2$I AS s
            SET source_status = system.pipeline_map_diff_to_source_status(item.diff_type)
            FROM system.system_diff_items AS item
            WHERE item.diff_run_id = $1
              AND item.diff_type IN ('new', 'changed', 'unchanged')
              AND item.local_entity_id = s.id
              AND s.source_snapshot_id = $2
            $w$,
            v_staging_schema,
            cfg.target_table
        );
        EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id;
        GET DIAGNOSTICS v_written = ROW_COUNT;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        VALUES (
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            'source_status_written',
            v_written,
            'PASS',
            'Current-row source_status updated from F1 hash compare.'
        );

        UPDATE system.system_diff_runs AS run
        SET
            status = 'completed',
            finished_at = now(),
            summary = run.summary
                || jsonb_build_object(
                    'counts_by_diff_type',
                    coalesce((
                        SELECT jsonb_object_agg(counts.diff_type, counts.value_n)
                        FROM (
                            SELECT item.diff_type, count(*)::bigint AS value_n
                            FROM system.system_diff_items AS item
                            WHERE item.diff_run_id = v_diff_run_id
                            GROUP BY item.diff_type
                        ) AS counts
                    ), '{}'::jsonb),
                    'counts_by_source_status',
                    coalesce((
                        SELECT jsonb_object_agg(
                            system.pipeline_map_diff_to_source_status(counts.diff_type),
                            counts.value_n
                        )
                        FROM (
                            SELECT item.diff_type, count(*)::bigint AS value_n
                            FROM system.system_diff_items AS item
                            WHERE item.diff_run_id = v_diff_run_id
                            GROUP BY item.diff_type
                        ) AS counts
                    ), '{}'::jsonb),
                    'total_items',
                    (
                        SELECT count(*)::bigint
                        FROM system.system_diff_items AS item
                        WHERE item.diff_run_id = v_diff_run_id
                    ),
                    'source_status_written',
                    v_written
                )
        WHERE run.id = v_diff_run_id;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        SELECT
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            item.diff_type,
            count(*)::bigint,
            'PASS',
            'F1 snapshot-vs-snapshot diff items written (identity + normalized_hash).'
        FROM system.system_diff_items AS item
        WHERE item.diff_run_id = v_diff_run_id
        GROUP BY item.diff_type;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        SELECT
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            system.pipeline_map_diff_to_source_status(item.diff_type),
            count(*)::bigint,
            'PASS',
            'Mapped source_* status counts.'
        FROM system.system_diff_items AS item
        WHERE item.diff_run_id = v_diff_run_id
        GROUP BY system.pipeline_map_diff_to_source_status(item.diff_type);
    END LOOP;
END
$stage06_create_diffs$;
