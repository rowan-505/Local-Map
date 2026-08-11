-- =============================================================================
-- Stage 05 shared helpers: snapshot staging reset + deterministic content hash.
--
-- Include from 05_raw_to_staging.sql AFTER:
--   - pipeline_entity_families.sql wrappers
--   - pipeline_source_identity.sql
--   - stage05_context is populated
--   - stage05_report exists
--
-- Lifecycle:
--   raw (immutable)
--   → DELETE current-snapshot staging for enabled families (children first)
--   → regenerate from raw (Stage 05 insert blocks)
--   → previous-snapshot staging remains untouched
--
-- Prefer delete+regenerate over upsert so stale normalized values cannot remain.
-- Upsert paths left in Stage 05 become no-ops after this reset (documented).
--
-- HARD RULE: this reset never touches basemap_source.* .
-- basemap_source.buildings is the persistent national building archive for
-- PMTiles export after temporary staging.staging_building_candidates rows are
-- cleaned. Do not add basemap_source tables to the delete list below.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.pipeline_staging_content_hash(
    p_external_id text,
    p_normalized_data jsonb,
    p_geom geometry DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(
        coalesce(nullif(btrim(p_external_id), ''), '')
        || E'\n'
        || coalesce(p_normalized_data, '{}'::jsonb)::text
        || E'\n'
        || CASE
            WHEN p_geom IS NULL THEN ''
            ELSE encode(
                ST_AsBinary(ST_SnapToGrid(ST_Force2D(p_geom), 0.0000001)),
                'hex'
            )
        END
    );
$$;

DO $stage05_reset$
DECLARE
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    r record;
    v_before bigint;
    v_deleted bigint;
    v_other_before bigint;
    v_sql text;
    v_has_col boolean;
BEGIN
    SELECT
        p.staging_schema,
        c.source_snapshot_id,
        c.snapshot_version
    INTO
        v_staging_schema,
        v_source_snapshot_id,
        v_snapshot_version
    FROM stage05_params AS p
    CROSS JOIN stage05_context AS c
    LIMIT 1;

    IF v_source_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'stage05_reset: stage05_context.source_snapshot_id is missing';
    END IF;

    -- Count other-snapshot rows before reset (must stay unchanged).
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
    EXECUTE v_sql INTO v_other_before USING v_source_snapshot_id;

    INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
    VALUES (
        'staging_reset',
        'all',
        v_staging_schema,
        'other_snapshot_rows_before',
        v_other_before,
        'PASS',
        format('snapshot_version=%s id=%s', v_snapshot_version, v_source_snapshot_id)
    );

    -- delete_order: children before parents (FK-safe).
    FOR r IN
        SELECT *
        FROM (
            VALUES
                (10, 'place_address_link', 'staging_place_address_link_candidates'),
                (20, 'place_name', 'staging_place_name_candidates'),
                (30, 'address_component', 'staging_address_component_candidates'),
                (40, 'search_name', 'staging_search_name_candidates'),
                (50, 'search_address', 'staging_search_address_candidates'),
                (60, 'road_name', 'staging_road_name_candidates'),
                (70, 'admin_area_name', 'staging_admin_area_name_candidates'),
                (80, 'bus_stop_name', 'staging_bus_stop_name_candidates'),
                (90, 'bus_route_name', 'staging_bus_route_name_candidates'),
                (100, 'bus_route_stop', 'staging_bus_route_stop_candidates'),
                (110, 'bus_route_variant', 'staging_bus_route_variant_candidates'),
                (120, 'routing_road', 'staging_routing_road_candidates'),
                (130, 'routing_turn_restriction', 'staging_routing_turn_restriction_candidates'),
                (200, 'place', 'staging_place_candidates'),
                (210, 'address', 'staging_address_candidates'),
                (220, 'road', 'staging_road_candidates'),
                (230, 'building', 'staging_building_candidates'),
                (240, 'landuse', 'staging_landuse_candidates'),
                (250, 'water_line', 'staging_water_line_candidates'),
                (260, 'water_polygon', 'staging_water_polygon_candidates'),
                (270, 'admin_area', 'staging_admin_area_candidates'),
                (280, 'bus_stop', 'staging_bus_stop_candidates'),
                (290, 'bus_route', 'staging_bus_route_candidates'),
                (300, 'routing_barrier', 'staging_routing_barrier_candidates')
        ) AS t(delete_order, stage05_key, table_name)
        ORDER BY delete_order
    LOOP
        IF NOT pg_temp.pipeline_stage05_extraction_enabled(r.stage05_key) THEN
            CONTINUE;
        END IF;

        IF to_regclass(format('%I.%I', v_staging_schema, r.table_name)) IS NULL THEN
            INSERT INTO stage05_report VALUES (
                'staging_reset', r.stage05_key,
                format('%s.%s', v_staging_schema, r.table_name),
                'deleted_rows', 0, 'SKIP', 'table missing'
            );
            CONTINUE;
        END IF;

        -- Minimal schema addition for deterministic verification hashes.
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = v_staging_schema
              AND c.table_name = r.table_name
              AND c.column_name = 'normalized_hash'
        ) INTO v_has_col;

        IF NOT v_has_col THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS normalized_hash text NULL',
                v_staging_schema,
                r.table_name
            );
        END IF;

        EXECUTE format(
            'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
            v_staging_schema,
            r.table_name
        ) INTO v_before USING v_source_snapshot_id;

        EXECUTE format(
            'DELETE FROM %I.%I WHERE source_snapshot_id = $1',
            v_staging_schema,
            r.table_name
        ) USING v_source_snapshot_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        INSERT INTO stage05_report (
            section, entity_family, target_table, metric, value_n, status, note
        ) VALUES (
            'staging_reset',
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'before_delete_count',
            v_before,
            'PASS',
            NULL
        );

        INSERT INTO stage05_report (
            section, entity_family, target_table, metric, value_n, status, note
        ) VALUES (
            'staging_reset',
            r.stage05_key,
            format('%s.%s', v_staging_schema, r.table_name),
            'deleted_rows',
            v_deleted,
            'PASS',
            'delete+regenerate for current snapshot only'
        );
    END LOOP;

    RAISE NOTICE 'stage05_reset: deleted current-snapshot staging for enabled families (snapshot_id=%)',
        v_source_snapshot_id;
END
$stage05_reset$;
