-- =============================================================================
-- Stage 05c: assign core vs PMTiles selection fields (local only).
--
-- Sets on buildings / landuse / water_* staging rows:
--   eligible_for_core boolean
--   core_selection_reason text
--   pmtiles_only_reason text
--
-- Requires stage05_params + stage05_context (included from Stage 05),
-- or standalone vars: snapshot_version, staging_schema.
-- =============================================================================

\ir pipeline_core_pmtiles_selection.sql

DO $stage05c_core_pmtiles$
DECLARE
    v_staging_schema text;
    v_source_snapshot_id bigint;
    r record;
    v_sql text;
    v_updated bigint;
    v_has_geom boolean;
    v_geom_expr text;
    v_link_expr text;
BEGIN
    SELECT p.staging_schema, c.source_snapshot_id
    INTO v_staging_schema, v_source_snapshot_id
    FROM stage05_params AS p
    CROSS JOIN stage05_context AS c;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('buildings', 'building', 'staging_building_candidates'),
                ('landuse', 'landuse', 'staging_landuse_candidates'),
                ('water_lines', 'water_line', 'staging_water_line_candidates'),
                ('water_polygons', 'water_polygon', 'staging_water_polygon_candidates')
        ) AS t(entity_family, stage05_key, table_name)
    LOOP
        IF NOT pg_temp.pipeline_stage05_extraction_enabled(r.stage05_key) THEN
            INSERT INTO stage05_report VALUES (
                'core_pmtiles_selection', r.stage05_key,
                format('%s.%s', v_staging_schema, r.table_name),
                'skipped', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes family.'
            );
            CONTINUE;
        END IF;

        IF to_regclass(format('%I.%I', v_staging_schema, r.table_name)) IS NULL THEN
            INSERT INTO stage05_report VALUES (
                'core_pmtiles_selection', r.stage05_key,
                format('%s.%s', v_staging_schema, r.table_name),
                'table_missing', 0, 'WARN', 'Staging table missing; selection skipped.'
            );
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS eligible_for_core boolean NULL',
            v_staging_schema, r.table_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS core_selection_reason text NULL',
            v_staging_schema, r.table_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS pmtiles_only_reason text NULL',
            v_staging_schema, r.table_name
        );

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema
              AND table_name = r.table_name
              AND column_name = 'geom'
        ) INTO v_has_geom;

        IF r.entity_family = 'buildings' AND v_has_geom THEN
            v_link_expr := 'system.pipeline_building_linked_to_important_place(s.geom, s.canonical_name)';
        ELSE
            v_link_expr := 'false';
        END IF;

        v_sql := format(
            $u$
            UPDATE %1$I.%2$I AS s
            SET
                eligible_for_core = (sel.result->>'eligible_for_core')::boolean,
                core_selection_reason = nullif(sel.result->>'core_selection_reason', ''),
                pmtiles_only_reason = nullif(sel.result->>'pmtiles_only_reason', '')
            FROM (
                SELECT
                    s2.id,
                    system.pipeline_select_core_vs_pmtiles(
                        %3$L,
                        s2.canonical_name,
                        s2.class_code,
                        s2.normalized_data,
                        %4$s
                    ) AS result
                FROM %1$I.%2$I AS s2
                WHERE s2.source_snapshot_id = $1
            ) AS sel
            WHERE s.id = sel.id
            $u$,
            v_staging_schema,
            r.table_name,
            r.entity_family,
            CASE
                WHEN r.entity_family = 'buildings' AND v_has_geom THEN
                    'system.pipeline_building_linked_to_important_place(s2.geom, s2.canonical_name)'
                ELSE
                    'false'
            END
        );

        EXECUTE v_sql USING v_source_snapshot_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        INSERT INTO stage05_report VALUES (
            'core_pmtiles_selection', r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'selected_rows', v_updated, 'PASS', NULL
        );

        EXECUTE format(
            $m$
            INSERT INTO stage05_report
            SELECT
                'core_pmtiles_selection',
                %L,
                %L,
                CASE
                    WHEN eligible_for_core THEN 'core_eligible'
                    WHEN eligible_for_core IS FALSE THEN 'pmtiles_only'
                    ELSE 'selection_unset'
                END,
                count(*)::bigint,
                'PASS',
                NULL
            FROM %I.%I
            WHERE source_snapshot_id = $1
            GROUP BY 4
            $m$,
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            v_staging_schema,
            r.table_name
        ) USING v_source_snapshot_id;

        EXECUTE format(
            $m$
            INSERT INTO stage05_report
            SELECT
                'core_pmtiles_selection',
                %L,
                %L,
                'reason_' || coalesce(core_selection_reason, pmtiles_only_reason, 'none'),
                count(*)::bigint,
                'PASS',
                NULL
            FROM %I.%I
            WHERE source_snapshot_id = $1
            GROUP BY 4
            $m$,
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            v_staging_schema,
            r.table_name
        ) USING v_source_snapshot_id;
    END LOOP;
END
$stage05c_core_pmtiles$;

SELECT
    'stage05c_core_pmtiles_selection' AS section,
    entity_family,
    metric,
    value_n,
    status,
    note
FROM stage05_report
WHERE section = 'core_pmtiles_selection'
ORDER BY entity_family, metric;
