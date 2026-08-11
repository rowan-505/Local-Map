-- =============================================================================
-- Stage 06 F1 core: identity_key + normalized_hash compare + source_status writeback.
-- Included from 06_diff_current_vs_previous.sql inside an open transaction.
--
-- Performance notes (buildings / large families):
--   - Diff payloads strip geometry columns (geom already in normalized_hash).
--   - Inserts run in id-range chunks with RAISE NOTICE progress: N/M (P%).
--   - First snapshot OR empty previous uses the fast "all new" path (no FULL JOIN).
--   - source_status writeback avoids joining millions of staging rows to diff_items
--     when every current row is source_new.
-- =============================================================================

CREATE OR REPLACE FUNCTION system.pipeline_staging_diff_payload(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    -- Keep attribute payload; drop heavy PostGIS columns (geometry is hashed separately).
    SELECT jsonb_strip_nulls(
        coalesce(p_row, '{}'::jsonb)
        - 'geom'
        - 'point_geom'
        - 'centroid'
        - 'footprint_geom'
        - 'geom_multi'
        - 'entrance_geom'
    );
$$;

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
    v_chunk_size bigint;
    v_min_id bigint;
    v_max_id bigint;
    v_lo bigint;
    v_hi bigint;
    v_done bigint;
    v_batch bigint;
    v_pct numeric;
    v_t0 timestamptz;
    v_elapsed_s numeric;
    v_eta_s numeric;
    v_use_all_new boolean;
    q text;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage06_params AS p;

    SELECT *
    INTO STRICT ctx
    FROM stage06_context;

    -- Chunk size: env-like GUC via custom setting, else 50k.
    BEGIN
        v_chunk_size := nullif(current_setting('coremap.stage06_chunk_size', true), '')::bigint;
    EXCEPTION WHEN OTHERS THEN
        v_chunk_size := NULL;
    END;
    IF v_chunk_size IS NULL OR v_chunk_size < 1000 THEN
        v_chunk_size := 50000;
    END IF;

    IF ctx.previous_snapshot_id IS NULL THEN
        v_snap_ids := ARRAY[ctx.current_snapshot_id];
    ELSE
        v_snap_ids := ARRAY[ctx.current_snapshot_id, ctx.previous_snapshot_id];
    END IF;

    FOR cfg IN SELECT * FROM stage06_family_config LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, cfg.target_table)) IS NULL THEN
            CONTINUE;
        END IF;

        RAISE NOTICE 'progress: 0/100 (0.00%%) stage06 family=% start', cfg.entity_family;

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
        RAISE NOTICE 'progress: 0/100 (0.00%%) stage06 family=% hash_backfill', cfg.entity_family;
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

        -- Fast path: no previous rows means every current row is "new"
        -- (even if a previous snapshot id exists for the region).
        v_use_all_new := (ctx.previous_snapshot_id IS NULL OR v_previous_count = 0);

        INSERT INTO system.system_diff_runs (
            previous_snapshot_id,
            current_snapshot_id,
            entity_family,
            status,
            started_at,
            summary
        )
        VALUES (
            CASE WHEN v_use_all_new THEN NULL ELSE ctx.previous_snapshot_id END,
            ctx.current_snapshot_id,
            cfg.entity_family,
            'running',
            now(),
            jsonb_build_object(
                'comparison_type', 'snapshot_vs_snapshot',
                'compare_mode', 'identity_key_normalized_hash',
                'first_snapshot', ctx.is_first_snapshot,
                'all_new_fast_path', v_use_all_new,
                'payload_mode', 'slim_no_geom',
                'chunk_size', v_chunk_size,
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

        v_t0 := clock_timestamp();
        v_done := 0;

        IF v_use_all_new THEN
            -- Chunked insert: all current rows as diff_type=new (slim payload).
            q := format(
                'SELECT coalesce(min(id),0), coalesce(max(id),-1) FROM %I.%I WHERE source_snapshot_id = $1',
                v_staging_schema, cfg.target_table
            );
            EXECUTE q INTO v_min_id, v_max_id USING ctx.current_snapshot_id;

            v_lo := v_min_id;
            WHILE v_lo <= v_max_id LOOP
                v_hi := v_lo + v_chunk_size - 1;

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
                        system.pipeline_staging_diff_payload(to_jsonb(c)),
                        %s,
                        'insert_candidate',
                        'pending',
                        now()
                    FROM %I.%I AS c
                    WHERE c.source_snapshot_id = $2
                      AND c.id BETWEEN $3 AND $4
                    $q$,
                    cfg.entity_family,
                    CASE WHEN v_has_confidence THEN 'coalesce(c.confidence_score, 50.0000)' ELSE '50.0000' END,
                    v_staging_schema,
                    cfg.target_table
                );
                EXECUTE q USING v_diff_run_id, ctx.current_snapshot_id, v_lo, v_hi;
                GET DIAGNOSTICS v_batch = ROW_COUNT;
                v_done := v_done + v_batch;

                v_elapsed_s := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0));
                IF v_current_count > 0 THEN
                    v_pct := round(100.0 * v_done / v_current_count, 2);
                ELSE
                    v_pct := 100;
                END IF;
                IF v_done > 0 AND v_elapsed_s > 0 AND v_done < v_current_count THEN
                    v_eta_s := (v_elapsed_s * (v_current_count - v_done)) / v_done;
                ELSE
                    v_eta_s := 0;
                END IF;

                RAISE NOTICE 'progress: %/% (%)%% stage06 family=% insert_new chunk=%-% batch=% eta_s=%',
                    v_done, v_current_count, v_pct, cfg.entity_family, v_lo, v_hi, v_batch, round(v_eta_s)::bigint;

                v_lo := v_hi + 1;
            END LOOP;

            -- Fast source_status: every current row is source_new (no join to diff_items).
            RAISE NOTICE 'progress: %/% (%)%% stage06 family=% source_status_writeback_fast',
                v_done, v_current_count, 99.50, cfg.entity_family;
            q := format(
                $w$
                UPDATE %1$I.%2$I AS s
                SET source_status = 'source_new'
                WHERE s.source_snapshot_id = $1
                $w$,
                v_staging_schema,
                cfg.target_table
            );
            EXECUTE q USING ctx.current_snapshot_id;
            GET DIAGNOSTICS v_written = ROW_COUNT;
        ELSE
            -- Compare path: key-only pairing (no to_jsonb in CTE), then slim payload insert.
            RAISE NOTICE 'progress: 0/% (0.00%%) stage06 family=% compare_keys',
                greatest(v_current_count, v_previous_count), cfg.entity_family;

            EXECUTE 'DROP TABLE IF EXISTS stage06_paired_keys';
            q := format(
                $q$
                CREATE TEMP TABLE stage06_paired_keys ON COMMIT DROP AS
                WITH current_rows AS (
                    SELECT DISTINCT ON (system.pipeline_osm_identity_key(external_id))
                        id AS c_id,
                        external_id AS c_external_id,
                        normalized_hash AS c_hash,
                        %3$s AS c_confidence_score,
                        system.pipeline_osm_identity_key(external_id) AS identity_key
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $1
                      AND system.pipeline_osm_identity_key(external_id) IS NOT NULL
                    ORDER BY system.pipeline_osm_identity_key(external_id), id
                ),
                previous_rows AS (
                    SELECT DISTINCT ON (system.pipeline_osm_identity_key(external_id))
                        id AS p_id,
                        external_id AS p_external_id,
                        normalized_hash AS p_hash,
                        %4$s AS p_confidence_score,
                        system.pipeline_osm_identity_key(external_id) AS identity_key
                    FROM %1$I.%2$I
                    WHERE source_snapshot_id = $2
                      AND system.pipeline_osm_identity_key(external_id) IS NOT NULL
                    ORDER BY system.pipeline_osm_identity_key(external_id), id
                )
                SELECT
                    c.c_id,
                    p.p_id,
                    coalesce(c.c_external_id, p.p_external_id) AS external_id,
                    c.c_confidence_score,
                    p.p_confidence_score,
                    CASE
                        WHEN c.c_id IS NULL THEN 'deleted_candidate'
                        WHEN p.p_id IS NULL THEN 'new'
                        WHEN coalesce(c.c_hash, '') IS DISTINCT FROM coalesce(p.p_hash, '')
                            THEN 'changed'
                        ELSE 'unchanged'
                    END AS diff_type
                FROM current_rows AS c
                FULL OUTER JOIN previous_rows AS p
                    ON p.identity_key = c.identity_key
                $q$,
                v_staging_schema,
                cfg.target_table,
                CASE WHEN v_has_confidence THEN 'confidence_score' ELSE 'NULL::numeric' END,
                CASE WHEN v_has_confidence THEN 'confidence_score' ELSE 'NULL::numeric' END
            );
            EXECUTE q USING ctx.current_snapshot_id, ctx.previous_snapshot_id;

            EXECUTE 'CREATE INDEX ON stage06_paired_keys (c_id)';
            EXECUTE 'CREATE INDEX ON stage06_paired_keys (p_id)';
            EXECUTE 'ANALYZE stage06_paired_keys';

            SELECT count(*)::bigint INTO v_current_count FROM stage06_paired_keys;
            -- Reuse v_current_count as total paired rows for progress.
            SELECT coalesce(min(COALESCE(c_id, p_id)), 0), coalesce(max(COALESCE(c_id, p_id)), -1)
            INTO v_min_id, v_max_id
            FROM stage06_paired_keys;

            -- Prefer chunking by ordinal via ctid ranges is awkward; use row_number batches.
            EXECUTE 'DROP TABLE IF EXISTS stage06_paired_numbered';
            CREATE TEMP TABLE stage06_paired_numbered ON COMMIT DROP AS
            SELECT row_number() OVER (ORDER BY coalesce(c_id, p_id), coalesce(p_id, c_id)) AS rn, *
            FROM stage06_paired_keys;
            CREATE INDEX ON stage06_paired_numbered (rn);
            ANALYZE stage06_paired_numbered;

            SELECT count(*)::bigint INTO v_current_count FROM stage06_paired_numbered;
            v_lo := 1;
            WHILE v_lo <= v_current_count LOOP
                v_hi := least(v_lo + v_chunk_size - 1, v_current_count);

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
                        %1$L,
                        paired.diff_type,
                        paired.external_id,
                        CASE
                            WHEN paired.diff_type = 'deleted_candidate' THEN paired.p_id
                            ELSE paired.c_id
                        END,
                        CASE
                            WHEN paired.diff_type = 'new' THEN NULL
                            ELSE system.pipeline_staging_diff_payload(to_jsonb(p))
                        END,
                        CASE
                            WHEN paired.diff_type = 'deleted_candidate' THEN NULL
                            ELSE system.pipeline_staging_diff_payload(to_jsonb(c))
                        END,
                        %2$s,
                        CASE
                            WHEN paired.diff_type = 'new' THEN 'insert_candidate'
                            WHEN paired.diff_type = 'changed' AND %3$L::boolean THEN 'needs_review'
                            WHEN paired.diff_type = 'changed' THEN 'update_candidate'
                            WHEN paired.diff_type = 'deleted_candidate' THEN 'needs_review'
                            ELSE 'ignore_unchanged'
                        END,
                        CASE
                            WHEN paired.diff_type = 'unchanged' THEN 'ignored'
                            ELSE 'pending'
                        END,
                        now()
                    FROM stage06_paired_numbered AS paired
                    LEFT JOIN %4$I.%5$I AS c
                        ON c.id = paired.c_id
                    LEFT JOIN %4$I.%5$I AS p
                        ON p.id = paired.p_id
                    WHERE paired.rn BETWEEN $2 AND $3
                    $q$,
                    cfg.entity_family,
                    CASE
                        WHEN v_has_confidence THEN
                            'CASE WHEN paired.c_id IS NULL THEN coalesce(paired.p_confidence_score, 50.0000) ELSE coalesce(paired.c_confidence_score, 50.0000) END'
                        ELSE '50.0000'
                    END,
                    cfg.admin_needs_review,
                    v_staging_schema,
                    cfg.target_table
                );
                EXECUTE q USING v_diff_run_id, v_lo, v_hi;
                GET DIAGNOSTICS v_batch = ROW_COUNT;
                v_done := v_done + v_batch;

                v_elapsed_s := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0));
                IF v_current_count > 0 THEN
                    v_pct := round(100.0 * v_done / v_current_count, 2);
                ELSE
                    v_pct := 100;
                END IF;
                IF v_done > 0 AND v_elapsed_s > 0 AND v_done < v_current_count THEN
                    v_eta_s := (v_elapsed_s * (v_current_count - v_done)) / v_done;
                ELSE
                    v_eta_s := 0;
                END IF;

                RAISE NOTICE 'progress: %/% (%)%% stage06 family=% insert_compare rn=%-% batch=% eta_s=%',
                    v_done, v_current_count, v_pct, cfg.entity_family, v_lo, v_hi, v_batch, round(v_eta_s)::bigint;

                v_lo := v_hi + 1;
            END LOOP;

            -- Chunked source_status writeback for current rows only.
            RAISE NOTICE 'progress: %/% (%)%% stage06 family=% source_status_writeback',
                v_done, v_current_count, 99.00, cfg.entity_family;
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
        END IF;

        INSERT INTO stage06_report (entity_family, target_table, diff_type, value_n, status, note)
        VALUES (
            cfg.entity_family,
            format('%s.%s', v_staging_schema, cfg.target_table),
            'source_status_written',
            v_written,
            'PASS',
            CASE
                WHEN v_use_all_new THEN 'Fast path: all current rows set to source_new.'
                ELSE 'Current-row source_status updated from F1 hash compare.'
            END
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

        RAISE NOTICE 'progress: %/% (100.00%%) stage06 family=% done items=% written=%',
            v_done, v_done, cfg.entity_family, v_done, v_written;
    END LOOP;
END
$stage06_create_diffs$;
