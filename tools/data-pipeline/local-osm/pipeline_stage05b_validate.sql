-- =============================================================================
-- Stage 05b: technical validation for normalized staging candidates.
--
-- Sets on each primary candidate row:
--   validation_status  = valid | warning | invalid
--   validation_notes   = jsonb array of check codes
--   geometry_hash      = optional geom fingerprint
--   source_status      column ensured (filled later by Stage 06)
--
-- Invalid rows stay local — Stage J must exclude validation_status = 'invalid'.
-- Warning rows may continue for active families (optional-name / optional-class).
--
-- Include after pipeline_stage05_hash_metrics.sql (normalized_hash filled).
-- =============================================================================

\ir pipeline_candidate_validation.sql

DO $stage05b_validate$
DECLARE
    v_staging_schema text;
    v_source_snapshot_id bigint;
    r record;
    v_has_point boolean;
    v_has_geom boolean;
    v_geom_expr text;
    v_class_id_expr text;
    v_class_code_expr text;
    v_name_expr text;
    v_admin_level_expr text;
    v_sql text;
    v_updated bigint;
BEGIN
    SELECT p.staging_schema, c.source_snapshot_id
    INTO v_staging_schema, v_source_snapshot_id
    FROM stage05_params AS p
    CROSS JOIN stage05_context AS c;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('roads', 'road', 'staging_road_candidates'),
                ('places', 'place', 'staging_place_candidates'),
                ('buildings', 'building', 'staging_building_candidates'),
                ('landuse', 'landuse', 'staging_landuse_candidates'),
                ('water_lines', 'water_line', 'staging_water_line_candidates'),
                ('water_polygons', 'water_polygon', 'staging_water_polygon_candidates'),
                ('admin_areas', 'admin_area', 'staging_admin_area_candidates'),
                ('routing_barriers', 'routing_barrier', 'staging_routing_barrier_candidates')
        ) AS t(entity_family, stage05_key, table_name)
    LOOP
        IF NOT pg_temp.pipeline_stage05_extraction_enabled(r.stage05_key) THEN
            CONTINUE;
        END IF;

        IF to_regclass(format('%I.%I', v_staging_schema, r.table_name)) IS NULL THEN
            INSERT INTO stage05_report
            VALUES (
                'candidate_validation',
                r.stage05_key,
                format('%s.%s', v_staging_schema, r.table_name),
                'table_missing',
                0,
                'WARN',
                'Validation skipped; staging table missing.'
            );
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS validation_status text NULL',
            v_staging_schema, r.table_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS validation_notes jsonb NULL',
            v_staging_schema, r.table_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS source_status text NULL',
            v_staging_schema, r.table_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS geometry_hash text NULL',
            v_staging_schema, r.table_name
        );

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'point_geom'
        ) INTO v_has_point;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'geom'
        ) INTO v_has_geom;

        IF r.entity_family = 'places' THEN
            v_geom_expr := 's2.point_geom';
        ELSIF r.entity_family = 'routing_barriers' THEN
            v_geom_expr := 'coalesce(s2.geom, s2.point_geom)';
        ELSIF v_has_geom AND v_has_point THEN
            v_geom_expr := 'coalesce(s2.geom, s2.point_geom)';
        ELSIF v_has_point THEN
            v_geom_expr := 's2.point_geom';
        ELSE
            v_geom_expr := 's2.geom';
        END IF;

        IF r.entity_family = 'roads' AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'road_class_id'
        ) THEN
            v_class_id_expr := 's2.road_class_id';
        ELSIF r.entity_family = 'places' AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'place_class_id'
        ) THEN
            v_class_id_expr := 's2.place_class_id';
        ELSE
            v_class_id_expr := 'NULL::bigint';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'class_code'
        ) THEN
            v_class_code_expr := 's2.class_code';
        ELSE
            v_class_code_expr := 'NULL::text';
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'canonical_name'
        ) THEN
            v_name_expr := 's2.canonical_name';
        ELSE
            v_name_expr := 'NULL::text';
        END IF;

        IF r.entity_family = 'admin_areas' AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'admin_level_id'
        ) THEN
            v_admin_level_expr := 's2.admin_level_id';
        ELSE
            v_admin_level_expr := 'NULL::bigint';
        END IF;

        v_sql := format(
            $u$
            UPDATE %1$I.%2$I AS s
            SET
                geometry_hash = v.geometry_hash,
                validation_status = v.validation_status,
                validation_notes = v.validation_notes
            FROM (
                SELECT
                    s2.id,
                    system.pipeline_geometry_hash(%3$s) AS geometry_hash,
                    (v_result.result ->> 'status') AS validation_status,
                    (v_result.result -> 'notes') AS validation_notes
                FROM %1$I.%2$I AS s2
                CROSS JOIN LATERAL (
                    SELECT system.pipeline_validate_candidate(
                        %4$L,
                        s2.external_id,
                        s2.normalized_data,
                        %3$s,
                        %5$s,
                        %6$s,
                        %7$s,
                        %8$s
                    ) AS result
                ) AS v_result
                WHERE s2.source_snapshot_id = $1
            ) AS v
            WHERE s.id = v.id
            $u$,
            v_staging_schema,
            r.table_name,
            v_geom_expr,
            r.entity_family,
            v_class_code_expr,
            v_class_id_expr,
            v_name_expr,
            v_admin_level_expr
        );

        EXECUTE v_sql USING v_source_snapshot_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        INSERT INTO stage05_report
        VALUES (
            'candidate_validation',
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'validated_rows',
            v_updated,
            'PASS',
            NULL
        );

        EXECUTE format(
            $m$
            INSERT INTO stage05_report
            SELECT
                'candidate_validation',
                %L,
                %L,
                'validation_' || coalesce(validation_status, 'null'),
                count(*)::bigint,
                'PASS',
                NULL
            FROM %I.%I
            WHERE source_snapshot_id = $1
            GROUP BY validation_status
            $m$,
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            v_staging_schema,
            r.table_name
        ) USING v_source_snapshot_id;
    END LOOP;
END
$stage05b_validate$;
