-- =============================================================================
-- Stage 05 post-pass: fill normalized_hash + emit fingerprints / after metrics.
-- Include at end of 05_raw_to_staging.sql (before final SELECTs).
-- =============================================================================

DO $stage05_hash_metrics$
DECLARE
    v_staging_schema text;
    v_source_snapshot_id bigint;
    r record;
    v_after bigint;
    v_dup bigint;
    v_null_ext bigint;
    v_fingerprint text;
    v_geom_expr text;
    v_sql text;
    v_has_geom boolean;
    v_has_point_geom boolean;
    v_has_external boolean;
    v_has_normalized boolean;
    v_has_hash boolean;
    v_other_after bigint;
BEGIN
    SELECT p.staging_schema, c.source_snapshot_id
    INTO v_staging_schema, v_source_snapshot_id
    FROM stage05_params AS p
    CROSS JOIN stage05_context AS c
    LIMIT 1;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('place', 'staging_place_candidates'),
                ('place_name', 'staging_place_name_candidates'),
                ('road', 'staging_road_candidates'),
                ('road_name', 'staging_road_name_candidates'),
                ('building', 'staging_building_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_line', 'staging_water_line_candidates'),
                ('water_polygon', 'staging_water_polygon_candidates'),
                ('admin_area', 'staging_admin_area_candidates'),
                ('admin_area_name', 'staging_admin_area_name_candidates'),
                ('routing_barrier', 'staging_routing_barrier_candidates'),
                ('address', 'staging_address_candidates'),
                ('place_address_link', 'staging_place_address_link_candidates')
        ) AS t(stage05_key, table_name)
    LOOP
        IF NOT pg_temp.pipeline_stage05_extraction_enabled(r.stage05_key) THEN
            CONTINUE;
        END IF;

        IF to_regclass(format('%I.%I', v_staging_schema, r.table_name)) IS NULL THEN
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema AND c.table_name = r.table_name AND c.column_name = 'normalized_hash'
        ) INTO v_has_hash;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema AND c.table_name = r.table_name AND c.column_name = 'external_id'
        ) INTO v_has_external;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema AND c.table_name = r.table_name AND c.column_name = 'normalized_data'
        ) INTO v_has_normalized;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema AND c.table_name = r.table_name AND c.column_name = 'geom'
        ) INTO v_has_geom;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema AND c.table_name = r.table_name AND c.column_name = 'point_geom'
        ) INTO v_has_point_geom;

        IF NOT v_has_hash THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS normalized_hash text NULL',
                v_staging_schema, r.table_name
            );
            v_has_hash := true;
        END IF;

        IF v_has_external AND v_has_normalized THEN
            v_geom_expr := CASE
                WHEN v_has_geom AND v_has_point_geom THEN 'coalesce(geom, point_geom)'
                WHEN v_has_geom THEN 'geom'
                WHEN v_has_point_geom THEN 'point_geom'
                ELSE 'NULL::geometry'
            END;

            v_sql := format(
                'UPDATE %I.%I AS t
                 SET normalized_hash = system.pipeline_staging_content_hash(
                     t.external_id,
                     t.normalized_data,
                     %s
                 )
                 WHERE t.source_snapshot_id = $1',
                v_staging_schema,
                r.table_name,
                v_geom_expr
            );
            EXECUTE v_sql USING v_source_snapshot_id;
        END IF;

        EXECUTE format(
            'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
            v_staging_schema, r.table_name
        ) INTO v_after USING v_source_snapshot_id;

        IF v_has_external THEN
            -- Name tables intentionally share parent external_id across many rows.
            IF r.stage05_key LIKE '%\_name' ESCAPE '\' THEN
                v_dup := 0;
            ELSE
                EXECUTE format(
                    $q$
                    SELECT count(*)::bigint
                    FROM (
                        SELECT external_id
                        FROM %I.%I
                        WHERE source_snapshot_id = $1
                          AND nullif(btrim(external_id), '') IS NOT NULL
                        GROUP BY external_id
                        HAVING count(*) > 1
                    ) d
                    $q$,
                    v_staging_schema, r.table_name
                ) INTO v_dup USING v_source_snapshot_id;
            END IF;

            EXECUTE format(
                'SELECT count(*)::bigint FROM %I.%I
                 WHERE source_snapshot_id = $1
                   AND nullif(btrim(external_id), '''') IS NULL',
                v_staging_schema, r.table_name
            ) INTO v_null_ext USING v_source_snapshot_id;

            EXECUTE format(
                $q$
                SELECT md5(coalesce(string_agg(x.pair, E'\n' ORDER BY x.pair), ''))
                FROM (
                    SELECT (external_id || '=' || coalesce(normalized_hash, '')) AS pair
                    FROM %I.%I
                    WHERE source_snapshot_id = $1
                ) AS x
                $q$,
                v_staging_schema, r.table_name
            ) INTO v_fingerprint USING v_source_snapshot_id;
        ELSE
            v_dup := 0;
            v_null_ext := 0;
            v_fingerprint := NULL;
        END IF;

        INSERT INTO stage05_report VALUES (
            'staging_hash', r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'after_insert_count', v_after, 'PASS', NULL
        );
        INSERT INTO stage05_report VALUES (
            'staging_hash', r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'duplicate_external_id_groups', v_dup,
            CASE WHEN v_dup = 0 THEN 'PASS' ELSE 'FAIL' END,
            NULL
        );
        INSERT INTO stage05_report VALUES (
            'staging_hash', r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'null_external_id_count', v_null_ext, 'PASS', NULL
        );

        IF v_fingerprint IS NOT NULL THEN
            INSERT INTO stage05_report VALUES (
                'staging_hash', r.stage05_key,
                format('%s.%s', v_staging_schema, r.table_name),
                'fingerprint', NULL, 'PASS', v_fingerprint
            );
        END IF;
    END LOOP;

    v_sql := format(
        $q$
        SELECT coalesce(sum(cnt), 0)
        FROM (
            SELECT count(*)::bigint AS cnt FROM %1$I.staging_road_candidates
            WHERE source_snapshot_id IS DISTINCT FROM $1
            UNION ALL
            SELECT count(*)::bigint FROM %1$I.staging_place_candidates
            WHERE source_snapshot_id IS DISTINCT FROM $1
            UNION ALL
            SELECT count(*)::bigint FROM %1$I.staging_admin_area_candidates
            WHERE source_snapshot_id IS DISTINCT FROM $1
            UNION ALL
            SELECT count(*)::bigint FROM %1$I.staging_building_candidates
            WHERE source_snapshot_id IS DISTINCT FROM $1
        ) AS x
        $q$,
        v_staging_schema
    );
    EXECUTE v_sql INTO v_other_after USING v_source_snapshot_id;

    INSERT INTO stage05_report VALUES (
        'staging_reset', 'all', v_staging_schema,
        'other_snapshot_rows_after', v_other_after, 'PASS', NULL
    );

    IF EXISTS (
        SELECT 1
        FROM stage05_report a
        JOIN stage05_report b
          ON a.section = 'staging_reset'
         AND a.metric = 'other_snapshot_rows_before'
         AND b.section = 'staging_reset'
         AND b.metric = 'other_snapshot_rows_after'
        WHERE a.value_n IS DISTINCT FROM b.value_n
    ) THEN
        RAISE EXCEPTION 'stage05_reset: other-snapshot staging row counts changed';
    END IF;
END
$stage05_hash_metrics$;
