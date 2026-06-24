-- =============================================================================
-- Stage 15: entity_coverage_report (read-only)
-- Import-review entity coverage metrics for local staging (+ optional import_review).
--
-- Scope:
--   - Read-only (temporary helper tables only).
--   - Does not modify staging, raw, core, import_review, prod_mirror, or Supabase data.
--   - Does not promote or upload anything.
--
-- Implementation priority (for operators — align with docs/import-review/entity-coverage-matrix.md):
--   P0 DONE  — buildings (full review + promotion path)
--   P1 NEXT  — places (review UI exists; add Stage J/K + promotion)
--   P2 THEN  — landuse, water_lines, water_polygons (map layers, lower risk)
--   P3 THEN  — bus_stops (+ names)
--   P4 LATER — roads (review exists; defer promotion — routing graph risk)
--   P5+      — admin_areas, addresses, bus_routes, routing_* (highest complexity)
--
-- Input psql variables:
--   snapshot_version (required)
--   region_code optional (reported; warns when it differs from snapshot metadata)
--   staging_schema optional (default staging)
--   import_review_schema optional (default import_review; skipped with warning if absent)
--   package_name optional (uses latest package for snapshot when blank)
--   review_batch_id optional (adds import_review batch-scoped counts when present)
--   entity_families optional (filters manifest sections; default all)
--
-- Example:
--   cd tools/data-pipeline/local-osm
--   PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v snapshot_version="$SNAPSHOT_VERSION" \
--     -f ./15_entity_coverage_report.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?import_review_schema}
\else
\set import_review_schema 'import_review'
\endif
\if :{?region_code}
\else
\set region_code ''
\endif
\if :{?package_name}
\else
\set package_name ''
\endif
\if :{?review_batch_id}
\else
\set review_batch_id ''
\endif
\if :{?entity_family}
\else
\set entity_family ''
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage15_params (
    snapshot_version text NOT NULL,
    region_code text,
    staging_schema text NOT NULL,
    import_review_schema text NOT NULL,
    package_name text,
    review_batch_id bigint,
    entity_family_filter text
) ON COMMIT DROP;

TRUNCATE stage15_params;

INSERT INTO stage15_params (
    snapshot_version,
    region_code,
    staging_schema,
    import_review_schema,
    package_name,
    review_batch_id,
    entity_family_filter
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    NULLIF(btrim(:'region_code'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'import_review_schema'), ''), 'import_review'),
    NULLIF(btrim(:'package_name'), ''),
    CASE
        WHEN btrim(:'review_batch_id') ~ '^[0-9]+$' THEN btrim(:'review_batch_id')::bigint
        ELSE NULL
    END,
    CASE
        WHEN lower(btrim(coalesce(:'entity_families', 'all'))) IN ('', 'all', '*') THEN
            NULLIF(btrim(:'entity_family'), '')
        ELSE btrim(:'entity_families')
    END
);

DO $stage15_params$
BEGIN
    IF (SELECT snapshot_version IS NULL FROM stage15_params LIMIT 1) THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
END
$stage15_params$;

CREATE TEMP TABLE IF NOT EXISTS stage15_context (
    snapshot_id bigint NOT NULL PRIMARY KEY,
    snapshot_version text NOT NULL,
    snapshot_region_code text,
    requested_region_code text,
    staging_schema text NOT NULL,
    import_review_schema text NOT NULL,
    import_review_schema_exists boolean NOT NULL DEFAULT false,
    package_name text,
    review_batch_id bigint,
    entity_family_filter text
) ON COMMIT DROP;

TRUNCATE stage15_context;

DO $stage15_resolve$
DECLARE
    v_n integer;
    v_ir_exists boolean;
BEGIN
    SELECT count(*)::integer
    INTO v_n
    FROM system.system_source_snapshots AS s
    INNER JOIN stage15_params AS p
        ON p.snapshot_version = s.snapshot_version;

    IF v_n = 0 THEN
        RAISE EXCEPTION
            'snapshot_version "%" not found in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage15_params LIMIT 1);
    END IF;

    IF v_n > 1 THEN
        RAISE EXCEPTION
            'snapshot_version "%" is ambiguous (% rows) in system.system_source_snapshots',
            (SELECT snapshot_version FROM stage15_params LIMIT 1),
            v_n;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.schemata AS sch
        INNER JOIN stage15_params AS p
            ON sch.schema_name = p.import_review_schema
    )
    INTO v_ir_exists;

    INSERT INTO stage15_context (
        snapshot_id,
        snapshot_version,
        snapshot_region_code,
        requested_region_code,
        staging_schema,
        import_review_schema,
        import_review_schema_exists,
        package_name,
        review_batch_id,
        entity_family_filter
    )
    SELECT
        s.id,
        s.snapshot_version,
        s.region_code,
        p.region_code,
        p.staging_schema,
        p.import_review_schema,
        v_ir_exists,
        p.package_name,
        p.review_batch_id,
        p.entity_family_filter
    FROM system.system_source_snapshots AS s
    INNER JOIN stage15_params AS p
        ON p.snapshot_version = s.snapshot_version;

END
$stage15_resolve$;

-- Static manifest: one row per staging candidate table (22 rows).
CREATE TEMP TABLE IF NOT EXISTS stage15_manifest (
    sort_order integer NOT NULL,
    entity_family text NOT NULL,
    staging_table text NOT NULL PRIMARY KEY,
    import_review_table text NULL,
    core_targets text NOT NULL,
    child_tables text NULL,
    geometry_expected text NOT NULL,
    geometry_columns text NULL,
    required_ref text NULL,
    pipeline_jk text NOT NULL,
    impl_priority text NOT NULL,
    risk_level text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_manifest;

INSERT INTO stage15_manifest (
    sort_order,
    entity_family,
    staging_table,
    import_review_table,
    core_targets,
    child_tables,
    geometry_expected,
    geometry_columns,
    required_ref,
    pipeline_jk,
    impl_priority,
    risk_level
)
VALUES
    ( 1, 'places', 'staging_place_candidates', 'place_candidates',
      'core.core_places',
      'staging_place_name_candidates → core.core_place_names, core.core_place_sources, core.core_place_versions',
      'Point (+ optional footprint)', 'point_geom, footprint_geom',
      'ref.ref_place_classes, ref.ref_poi_categories',
      'implemented', 'P1-next', 'medium'),

    ( 2, 'place_names', 'staging_place_name_candidates', NULL,
      'core.core_place_names',
      'FK place_candidate_id',
      'none', NULL,
      'staging.staging_place_candidates',
      'none', 'P1-next', 'medium'),

    ( 3, 'buildings', 'staging_building_candidates', 'building_candidates',
      'core.core_map_buildings',
      NULL,
      'MultiPolygon', 'geom',
      'class_code (no ref FK)',
      'implemented', 'P0-done', 'low'),

    ( 4, 'landuse', 'staging_landuse_candidates', 'landuse_candidates',
      'core.core_map_landuse',
      NULL,
      'MultiPolygon', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 5, 'water_lines', 'staging_water_line_candidates', 'water_line_candidates',
      'core.core_map_water_lines',
      NULL,
      'MultiLineString', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 6, 'water_polygons', 'staging_water_polygon_candidates', 'water_polygon_candidates',
      'core.core_map_water_polygons',
      NULL,
      'MultiPolygon', 'geom',
      NULL,
      'placeholder', 'P2', 'low'),

    ( 7, 'roads', 'staging_road_candidates', 'road_candidates',
      'core.core_streets',
      'staging_road_name_candidates → core.core_street_names, core.core_street_versions',
      'MultiLineString', 'geom',
      'ref.ref_road_classes',
      'implemented', 'P4-later', 'high'),

    ( 8, 'road_names', 'staging_road_name_candidates', NULL,
      'core.core_street_names',
      'FK road_candidate_id',
      'none', NULL,
      'staging.staging_road_candidates',
      'none', 'P4-later', 'medium'),

    ( 9, 'admin_areas', 'staging_admin_area_candidates', 'admin_area_candidates',
      'core.core_admin_areas',
      'staging_admin_area_name_candidates → core.core_admin_area_names',
      'MultiPolygon + Point centroid', 'geom, centroid',
      'ref.ref_admin_levels; parent_candidate_id',
      'placeholder', 'P5', 'medium'),

    (10, 'admin_area_names', 'staging_admin_area_name_candidates', NULL,
      'core.core_admin_area_names',
      'FK admin_area_candidate_id',
      'none', NULL,
      'staging.staging_admin_area_candidates',
      'none', 'P5', 'medium'),

    (17, 'addresses', 'staging_address_candidates', 'address_candidates',
      'core.core_addresses, core.core_place_addresses',
      'staging_address_component_candidates → core.core_address_components',
      'Point (+ optional geom)', 'point_geom, geom',
      'ref.ref_address_component_types (core)',
      'placeholder', 'P5', 'medium'),

    (18, 'address_components', 'staging_address_component_candidates', NULL,
      'core.core_address_components',
      'FK address_candidate_id',
      'none', NULL,
      'staging.staging_address_candidates',
      'none', 'P5', 'medium'),

    (19, 'place_address_links', 'staging_place_address_link_candidates', 'place_address_links',
      'core.core_place_addresses',
      'FK place_candidate_id + address_candidate_id',
      'none', NULL,
      'staging place/address candidates',
      'implemented', 'P5', 'medium'),

    (20, 'routing_roads', 'staging_routing_road_candidates', NULL,
      'core.core_streets; routing.road_edges',
      'FK road_candidate_id',
      'LineString + MultiLineString', 'geom, geom_multi',
      'staging.staging_road_candidates',
      'none', 'P7', 'high'),

    (21, 'routing_turn_restrictions', 'staging_routing_turn_restriction_candidates', 'routing_turn_restriction_candidates',
      'routing.turn_restrictions',
      'relation external IDs only',
      'none', NULL,
      NULL,
      'none', 'P7', 'high'),

    (22, 'routing_barriers', 'staging_routing_barrier_candidates', 'routing_barrier_candidates',
      'core_routing_barriers (07 mirror only — no baseline core DDL)',
      NULL,
      'Point + optional Geometry', 'point_geom, geom',
      NULL,
      'placeholder', 'P7', 'high');

\ir pipeline_entity_families.sql

DELETE FROM stage15_manifest AS m
WHERE NOT pg_temp.pipeline_stage15_manifest_enabled(m.entity_family);

CREATE TEMP TABLE IF NOT EXISTS stage15_staging_row_counts (
    staging_table text NOT NULL,
    entity_family text NOT NULL,
    row_count bigint NOT NULL,
    table_exists boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_staging_row_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_data_quality_gaps (
    staging_table text NOT NULL,
    metric text NOT NULL,
    gap_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_data_quality_gaps;

CREATE TEMP TABLE IF NOT EXISTS stage15_status_counts (
    staging_table text NOT NULL,
    status_kind text NOT NULL,
    status_value text,
    row_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_status_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_import_review_counts (
    import_review_table text NOT NULL,
    entity_family text NOT NULL,
    row_count bigint NOT NULL,
    filtered_by_snapshot bigint NOT NULL,
    filtered_by_review_batch bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_import_review_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_warnings (
    warning_type text NOT NULL,
    entity_scope text NOT NULL,
    detail text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_warnings;

INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
SELECT
    'region_code_mismatch',
    coalesce(c.requested_region_code, '(blank)'),
    format(
        'requested region_code=%s differs from snapshot region_code=%s',
        c.requested_region_code,
        c.snapshot_region_code
    )
FROM stage15_context AS c
WHERE c.requested_region_code IS NOT NULL
  AND c.snapshot_region_code IS DISTINCT FROM c.requested_region_code;

CREATE TEMP TABLE IF NOT EXISTS stage15_classified_source_features (
    external_id text NOT NULL,
    source_table text NOT NULL,
    source_classification text NOT NULL,
    address_strength text,
    source_name text,
    source_type_hint text,
    source_category_hint text
) ON COMMIT DROP;

TRUNCATE stage15_classified_source_features;

CREATE TEMP TABLE IF NOT EXISTS stage15_classification_counts (
    source_classification text NOT NULL,
    source_feature_count bigint NOT NULL DEFAULT 0,
    place_candidate_count bigint NOT NULL DEFAULT 0,
    address_candidate_count bigint NOT NULL DEFAULT 0,
    place_address_link_count bigint NOT NULL DEFAULT 0
) ON COMMIT DROP;

TRUNCATE stage15_classification_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_poi_evidence (
    metric text NOT NULL,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'INFO',
    note text
) ON COMMIT DROP;

TRUNCATE stage15_poi_evidence;

CREATE TEMP TABLE IF NOT EXISTS stage15_address_evidence (
    metric text NOT NULL,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'INFO',
    note text
) ON COMMIT DROP;

TRUNCATE stage15_address_evidence;

CREATE TEMP TABLE IF NOT EXISTS stage15_address_component_type_counts (
    component_type_code text NOT NULL,
    row_count bigint NOT NULL
) ON COMMIT DROP;

TRUNCATE stage15_address_component_type_counts;

CREATE TEMP TABLE IF NOT EXISTS stage15_link_evidence (
    metric text NOT NULL,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'INFO',
    note text
) ON COMMIT DROP;

TRUNCATE stage15_link_evidence;

CREATE TEMP TABLE IF NOT EXISTS stage15_promotion_readiness (
    entity_family text NOT NULL,
    metric text NOT NULL,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'INFO',
    note text
) ON COMMIT DROP;

TRUNCATE stage15_promotion_readiness;

CREATE TEMP TABLE IF NOT EXISTS stage15_classification_quality_warnings (
    metric text NOT NULL,
    row_count bigint NOT NULL,
    status text NOT NULL DEFAULT 'INFO',
    detail text
) ON COMMIT DROP;

TRUNCATE stage15_classification_quality_warnings;

CREATE TEMP TABLE IF NOT EXISTS stage15_review_package_generation (
    entity_family text NOT NULL,
    staging_count bigint NOT NULL DEFAULT 0,
    package_item_count bigint NOT NULL DEFAULT 0,
    latest_package_name text,
    status text NOT NULL,
    note text
) ON COMMIT DROP;

TRUNCATE stage15_review_package_generation;

DO $stage15_dynamic$
DECLARE
    ctx stage15_context%ROWTYPE;
    r stage15_manifest%ROWTYPE;
    v_reg oid;
    v_has_snap boolean;
    v_has_source_refs boolean;
    v_has_normalized boolean;
    v_has_external_id boolean;
    v_has_match boolean;
    v_has_auto boolean;
    v_has_review boolean;
    v_geom_col text;
    v_geom_cols text[];
    v_ir_reg oid;
    v_ir_table text;
BEGIN
    SELECT * INTO STRICT ctx FROM stage15_context;

    IF NOT ctx.import_review_schema_exists THEN
        INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
        VALUES (
            'missing_schema',
            ctx.import_review_schema,
            'import_review schema not found on this connection; import_review counts skipped'
        );
    END IF;

    FOR r IN
        SELECT * FROM stage15_manifest ORDER BY sort_order
    LOOP
        v_reg := to_regclass(format('%I.%I', ctx.staging_schema, r.staging_table));

        IF v_reg IS NULL THEN
            INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
            VALUES ('missing_table', r.staging_table, format('table %I.%I not found', ctx.staging_schema, r.staging_table));

            INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
            VALUES (r.staging_table, r.entity_family, 0, false);

            CONTINUE;
        END IF;

        -- Row count for snapshot
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema
              AND table_name = r.staging_table
              AND column_name = 'source_snapshot_id'
        ) INTO v_has_snap;

        IF v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
                SELECT %L, %L, count(*)::bigint, true
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                $q$,
                r.staging_table,
                r.entity_family,
                ctx.staging_schema,
                r.staging_table,
                ctx.snapshot_id
            );
        ELSE
            EXECUTE format(
                $q$
                INSERT INTO stage15_staging_row_counts (staging_table, entity_family, row_count, table_exists)
                SELECT %L, %L, count(*)::bigint, true
                FROM %I.%I AS t
                $q$,
                r.staging_table,
                r.entity_family,
                ctx.staging_schema,
                r.staging_table
            );
        END IF;

        -- Column presence
        SELECT
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'source_refs'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'normalized_data'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'external_id'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'match_status'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'auto_action'),
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ctx.staging_schema AND table_name = r.staging_table AND column_name = 'review_status')
        INTO v_has_source_refs, v_has_normalized, v_has_external_id, v_has_match, v_has_auto, v_has_review;

        -- Data quality: source_refs empty
        IF v_has_source_refs AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_source_refs', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (
                      t.source_refs IS NULL
                      OR t.source_refs = '{}'::jsonb
                      OR t.source_refs = 'null'::jsonb
                  )
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_source_refs THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_source_refs', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_refs IS NULL OR t.source_refs = '{}'::jsonb OR t.source_refs = 'null'::jsonb
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: normalized_data empty
        IF v_has_normalized AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_normalized_data', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (
                      t.normalized_data IS NULL
                      OR t.normalized_data = '{}'::jsonb
                      OR t.normalized_data = 'null'::jsonb
                  )
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_normalized THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_normalized_data', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.normalized_data IS NULL OR t.normalized_data = '{}'::jsonb OR t.normalized_data = 'null'::jsonb
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: external_id missing
        IF v_has_external_id AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_external_id', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                  AND (t.external_id IS NULL OR btrim(t.external_id) = '')
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        ELSIF v_has_external_id THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                SELECT %L, 'missing_external_id', count(*)::bigint
                FROM %I.%I AS t
                WHERE t.external_id IS NULL OR btrim(t.external_id) = ''
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table
            );
        END IF;

        -- Data quality: missing geometry where expected
        IF r.geometry_columns IS NOT NULL AND btrim(r.geometry_columns) <> '' THEN
            v_geom_cols := string_to_array(replace(r.geometry_columns, ' ', ''), ',');

            FOREACH v_geom_col IN ARRAY v_geom_cols
            LOOP
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = ctx.staging_schema
                      AND table_name = r.staging_table
                      AND column_name = v_geom_col
                ) THEN
                    IF v_has_snap THEN
                        EXECUTE format(
                            $q$
                            INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                            SELECT %L, %L, count(*)::bigint
                            FROM %I.%I AS t
                            WHERE t.source_snapshot_id = %s
                              AND t.%I IS NULL
                            $q$,
                            r.staging_table,
                            format('missing_geometry_%s', v_geom_col),
                            ctx.staging_schema,
                            r.staging_table,
                            ctx.snapshot_id,
                            v_geom_col
                        );
                    ELSE
                        EXECUTE format(
                            $q$
                            INSERT INTO stage15_data_quality_gaps (staging_table, metric, gap_count)
                            SELECT %L, %L, count(*)::bigint
                            FROM %I.%I AS t
                            WHERE t.%I IS NULL
                            $q$,
                            r.staging_table,
                            format('missing_geometry_%s', v_geom_col),
                            ctx.staging_schema,
                            r.staging_table,
                            v_geom_col
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;

        -- review_status counts
        IF v_has_review AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'review_status', t.review_status, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.review_status
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- match_status counts
        IF v_has_match AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'match_status', t.match_status, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.match_status
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- auto_action counts
        IF v_has_auto AND v_has_snap THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_status_counts (staging_table, status_kind, status_value, row_count)
                SELECT %L, 'auto_action', t.auto_action, count(*)::bigint
                FROM %I.%I AS t
                WHERE t.source_snapshot_id = %s
                GROUP BY t.auto_action
                $q$,
                r.staging_table, ctx.staging_schema, r.staging_table, ctx.snapshot_id
            );
        END IF;

        -- import_review counts (optional schema)
        IF ctx.import_review_schema_exists AND r.import_review_table IS NOT NULL THEN
            v_ir_table := r.import_review_table;
            v_ir_reg := to_regclass(format('%I.%I', ctx.import_review_schema, v_ir_table));

            IF v_ir_reg IS NULL THEN
                INSERT INTO stage15_warnings (warning_type, entity_scope, detail)
                VALUES (
                    'missing_import_review_table',
                    v_ir_table,
                    format('expected %I.%I on this connection but table not found', ctx.import_review_schema, v_ir_table)
                );
            ELSE
                EXECUTE format(
                    $q$
                    INSERT INTO stage15_import_review_counts (
                        import_review_table,
                        entity_family,
                        row_count,
                        filtered_by_snapshot,
                        filtered_by_review_batch
                    )
                    SELECT
                        %L,
                        %L,
                        count(*)::bigint,
                        count(*) FILTER (
                            WHERE t.source_snapshot_version = %L
                        )::bigint,
                        count(*) FILTER (
                            WHERE %s
                        )::bigint
                    FROM %I.%I AS t
                    $q$,
                    v_ir_table,
                    r.entity_family,
                    ctx.snapshot_version,
                    CASE
                        WHEN ctx.review_batch_id IS NULL THEN 'false'
                        ELSE format('t.review_batch_id = %s', ctx.review_batch_id)
                    END,
                    ctx.import_review_schema,
                    v_ir_table
                );
            END IF;
        END IF;
    END LOOP;
END
$stage15_dynamic$;

DO $stage15_classification_health$
DECLARE
    ctx stage15_context%ROWTYPE;
    v_schema text;
    v_has_places boolean;
    v_has_addresses boolean;
    v_has_components boolean;
    v_has_links boolean;
    v_has_packages boolean;
    v_has_package_items boolean;
    v_latest_package_id bigint;
    v_latest_package_name text;
    v_duplicate_count bigint := 0;
    v_tmp_count bigint := 0;
BEGIN
    SELECT * INTO STRICT ctx FROM stage15_context;
    v_schema := ctx.staging_schema;

    v_has_places := to_regclass(format('%I.staging_place_candidates', v_schema)) IS NOT NULL;
    v_has_addresses := to_regclass(format('%I.staging_address_candidates', v_schema)) IS NOT NULL;
    v_has_components := to_regclass(format('%I.staging_address_component_candidates', v_schema)) IS NOT NULL;
    v_has_links := to_regclass(format('%I.staging_place_address_link_candidates', v_schema)) IS NOT NULL;
    v_has_packages := to_regclass('system.system_remote_review_packages') IS NOT NULL;
    v_has_package_items := to_regclass('system.system_remote_review_package_items') IS NOT NULL;

    IF v_has_places THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_classified_source_features (
                external_id, source_table, source_classification, address_strength,
                source_name, source_type_hint, source_category_hint
            )
            SELECT
                p.external_id,
                'staging_place_candidates',
                coalesce(nullif(to_jsonb(p) ->> 'source_classification', ''), 'unclassified'),
                nullif(to_jsonb(p) ->> 'address_strength', ''),
                coalesce(nullif(to_jsonb(p) ->> 'source_name', ''), nullif(p.normalized_data ->> 'source_name', ''), nullif(p.canonical_name, '')),
                coalesce(nullif(to_jsonb(p) ->> 'source_type_hint', ''), nullif(p.normalized_data ->> 'source_type_hint', '')),
                coalesce(nullif(to_jsonb(p) ->> 'source_category_hint', ''), nullif(p.normalized_data ->> 'source_category_hint', ''))
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
              AND nullif(trim(p.external_id), '') IS NOT NULL
            $q$,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
        VALUES
            ('places', 'likely_ready', 0, 'SKIP', 'staging_place_candidates missing'),
            ('places', 'warning_count', 0, 'SKIP', 'staging_place_candidates missing'),
            ('places', 'blocked_count', 0, 'SKIP', 'staging_place_candidates missing');
    END IF;

    IF v_has_addresses THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_classified_source_features (
                external_id, source_table, source_classification, address_strength,
                source_name, source_type_hint, source_category_hint
            )
            SELECT
                a.external_id,
                'staging_address_candidates',
                coalesce(nullif(to_jsonb(a) ->> 'source_classification', ''), 'unclassified'),
                nullif(to_jsonb(a) ->> 'address_strength', ''),
                coalesce(nullif(to_jsonb(a) ->> 'source_name', ''), nullif(a.normalized_data ->> 'source_name', '')),
                coalesce(nullif(to_jsonb(a) ->> 'source_type_hint', ''), nullif(a.normalized_data ->> 'source_type_hint', '')),
                coalesce(nullif(to_jsonb(a) ->> 'source_category_hint', ''), nullif(a.normalized_data ->> 'source_category_hint', ''))
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
              AND nullif(trim(a.external_id), '') IS NOT NULL
            $q$,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
        VALUES
            ('addresses', 'likely_ready', 0, 'SKIP', 'staging_address_candidates missing'),
            ('addresses', 'warning_count', 0, 'SKIP', 'staging_address_candidates missing'),
            ('addresses', 'blocked_count', 0, 'SKIP', 'staging_address_candidates missing');
    END IF;

    IF v_has_links THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_classified_source_features (
                external_id, source_table, source_classification, address_strength,
                source_name, source_type_hint, source_category_hint
            )
            SELECT
                l.external_id,
                'staging_place_address_link_candidates',
                coalesce(nullif(l.source_classification, ''), 'unclassified'),
                nullif(l.address_strength, ''),
                nullif(l.normalized_data ->> 'source_name', ''),
                nullif(l.normalized_data ->> 'source_type_hint', ''),
                nullif(l.normalized_data ->> 'source_category_hint', '')
            FROM %I.staging_place_address_link_candidates AS l
            WHERE l.source_snapshot_id = %s
              AND nullif(trim(l.external_id), '') IS NOT NULL
            $q$,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
        VALUES
            ('place_address_links', 'likely_ready', 0, 'SKIP', 'staging_place_address_link_candidates missing'),
            ('place_address_links', 'warning_count', 0, 'SKIP', 'staging_place_address_link_candidates missing'),
            ('place_address_links', 'blocked_count', 0, 'SKIP', 'staging_place_address_link_candidates missing');
    END IF;

    INSERT INTO stage15_classification_counts (
        source_classification, source_feature_count, place_candidate_count,
        address_candidate_count, place_address_link_count
    )
    SELECT
        cls.source_classification,
        count(DISTINCT sf.external_id)::bigint AS source_feature_count,
        count(*) FILTER (WHERE sf.source_table = 'staging_place_candidates')::bigint AS place_candidate_count,
        count(*) FILTER (WHERE sf.source_table = 'staging_address_candidates')::bigint AS address_candidate_count,
        count(*) FILTER (WHERE sf.source_table = 'staging_place_address_link_candidates')::bigint AS place_address_link_count
    FROM (
        VALUES
            ('place_only'),
            ('address_only'),
            ('place_with_address'),
            ('weak_address'),
            ('ignore'),
            ('unclassified')
    ) AS cls(source_classification)
    LEFT JOIN stage15_classified_source_features AS sf
        ON sf.source_classification = cls.source_classification
    GROUP BY cls.source_classification;

    INSERT INTO stage15_poi_evidence (metric, row_count, status, note)
    SELECT
        'source_features_with_name_and_poi_tag',
        count(DISTINCT external_id)::bigint,
        'INFO',
        'Distinct source external_id with name plus POI/category evidence'
    FROM stage15_classified_source_features
    WHERE nullif(trim(source_name), '') IS NOT NULL
      AND (
          nullif(trim(source_type_hint), '') IS NOT NULL
          OR nullif(trim(source_category_hint), '') IS NOT NULL
          OR source_classification IN ('place_only', 'place_with_address')
      );

    IF v_has_places THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_poi_evidence (metric, row_count, status, note)
            SELECT 'place_candidates_created', count(*)::bigint, 'INFO', NULL
            FROM %I.staging_place_candidates
            WHERE source_snapshot_id = %s
            UNION ALL
            SELECT
                'place_candidates_missing_category',
                count(*) FILTER (
                    WHERE (to_jsonb(p) ->> 'poi_category_id') IS NULL
                      AND (to_jsonb(p) ->> 'category_id') IS NULL
                      AND (to_jsonb(p) ->> 'source_category_hint') IS NULL
                )::bigint,
                CASE
                    WHEN count(*) FILTER (
                        WHERE (to_jsonb(p) ->> 'poi_category_id') IS NULL
                          AND (to_jsonb(p) ->> 'category_id') IS NULL
                          AND (to_jsonb(p) ->> 'source_category_hint') IS NULL
                    ) > 0 THEN 'WARN'
                    ELSE 'PASS'
                END,
                'Category can come from source_category_hint or mapped category ids'
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
            UNION ALL
            SELECT
                'place_candidates_missing_geometry',
                count(*) FILTER (WHERE p.point_geom IS NULL)::bigint,
                CASE WHEN count(*) FILTER (WHERE p.point_geom IS NULL) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Places need point_geom for review and promotion'
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_poi_evidence (metric, row_count, status, note)
        VALUES
            ('place_candidates_created', 0, 'SKIP', 'staging_place_candidates missing'),
            ('place_candidates_missing_category', 0, 'SKIP', 'staging_place_candidates missing'),
            ('place_candidates_missing_geometry', 0, 'SKIP', 'staging_place_candidates missing');
    END IF;

    IF v_has_addresses THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_address_evidence (metric, row_count, status, note)
            SELECT 'address_candidates_created', count(*)::bigint, 'INFO', NULL
            FROM %I.staging_address_candidates
            WHERE source_snapshot_id = %s
            UNION ALL
            SELECT 'weak_addresses', count(*) FILTER (WHERE to_jsonb(a) ->> 'address_strength' = 'weak')::bigint, 'INFO', NULL
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            UNION ALL
            SELECT 'strong_full_addresses', count(*) FILTER (WHERE to_jsonb(a) ->> 'address_strength' IN ('strong', 'full'))::bigint, 'INFO', NULL
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            UNION ALL
            SELECT
                'address_candidates_missing_point_geom',
                count(*) FILTER (WHERE a.point_geom IS NULL)::bigint,
                CASE WHEN count(*) FILTER (WHERE a.point_geom IS NULL) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Addresses need point_geom for admin/street matching and promotion'
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_address_evidence (metric, row_count, status, note)
        VALUES
            ('address_candidates_created', 0, 'SKIP', 'staging_address_candidates missing'),
            ('weak_addresses', 0, 'SKIP', 'staging_address_candidates missing'),
            ('strong_full_addresses', 0, 'SKIP', 'staging_address_candidates missing'),
            ('address_candidates_missing_point_geom', 0, 'SKIP', 'staging_address_candidates missing');
    END IF;

    IF v_has_components THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_address_component_type_counts (component_type_code, row_count)
            SELECT lower(trim(component_type_code)), count(*)::bigint
            FROM %I.staging_address_component_candidates AS c
            WHERE source_snapshot_id = %s
              AND NOT (
                  to_jsonb(c) ? 'is_deleted'
                  AND to_jsonb(c) ->> 'is_deleted' = 'true'
              )
            GROUP BY lower(trim(component_type_code))
            $q$,
            v_schema,
            ctx.snapshot_id
        );

        IF v_has_addresses THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_address_evidence (metric, row_count, status, note)
                SELECT
                    'address_candidates_with_only_city_country',
                    count(*)::bigint,
                    CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'PASS' END,
                    'Address candidates whose components contain only city/country'
                FROM %I.staging_address_candidates AS a
                WHERE a.source_snapshot_id = %s
                  AND EXISTS (
                      SELECT 1
                      FROM %I.staging_address_component_candidates AS c
                      WHERE c.source_snapshot_id = a.source_snapshot_id
                        AND c.address_candidate_id = a.id
                        AND lower(trim(c.component_type_code)) IN ('city', 'country')
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM %I.staging_address_component_candidates AS c
                      WHERE c.source_snapshot_id = a.source_snapshot_id
                        AND c.address_candidate_id = a.id
                        AND lower(trim(c.component_type_code)) NOT IN ('city', 'country')
                  )
                $q$,
                v_schema,
                ctx.snapshot_id,
                v_schema,
                v_schema
            );
        END IF;
    ELSE
        INSERT INTO stage15_address_evidence (metric, row_count, status, note)
        VALUES ('address_candidates_with_only_city_country', 0, 'SKIP', 'staging_address_component_candidates missing');
    END IF;

    IF v_has_links THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_link_evidence (metric, row_count, status, note)
            SELECT 'place_address_links_created', count(*)::bigint, 'INFO', NULL
            FROM %I.staging_place_address_link_candidates
            WHERE source_snapshot_id = %s
            UNION ALL
            SELECT
                'links_missing_place_candidate',
                count(*) FILTER (WHERE l.place_candidate_id IS NULL OR p.id IS NULL)::bigint,
                CASE WHEN count(*) FILTER (WHERE l.place_candidate_id IS NULL OR p.id IS NULL) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Link rows should resolve to a staged place candidate'
            FROM %I.staging_place_address_link_candidates AS l
            LEFT JOIN %I.staging_place_candidates AS p
                ON p.id = l.place_candidate_id
            WHERE l.source_snapshot_id = %s
            UNION ALL
            SELECT
                'links_missing_address_candidate',
                count(*) FILTER (WHERE l.address_candidate_id IS NULL OR a.id IS NULL)::bigint,
                CASE WHEN count(*) FILTER (WHERE l.address_candidate_id IS NULL OR a.id IS NULL) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Link rows should resolve to a staged address candidate'
            FROM %I.staging_place_address_link_candidates AS l
            LEFT JOIN %I.staging_address_candidates AS a
                ON a.id = l.address_candidate_id
            WHERE l.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            v_schema,
            ctx.snapshot_id
        );
    ELSE
        INSERT INTO stage15_link_evidence (metric, row_count, status, note)
        VALUES
            ('place_address_links_created', 0, 'SKIP', 'staging_place_address_link_candidates missing'),
            ('links_missing_place_candidate', 0, 'SKIP', 'staging_place_address_link_candidates missing'),
            ('links_missing_address_candidate', 0, 'SKIP', 'staging_place_address_link_candidates missing');
    END IF;

    INSERT INTO stage15_link_evidence (metric, row_count, status, note)
    SELECT
        'place_with_address_rows_without_link',
        count(DISTINCT sf.external_id)::bigint,
        CASE WHEN count(DISTINCT sf.external_id) > 0 THEN 'WARN' ELSE 'PASS' END,
        'Distinct place_with_address source features not represented by a staged place-address link'
    FROM stage15_classified_source_features AS sf
    WHERE sf.source_classification = 'place_with_address'
      AND NOT EXISTS (
          SELECT 1
          FROM stage15_classified_source_features AS link_sf
          WHERE link_sf.source_table = 'staging_place_address_link_candidates'
            AND link_sf.external_id = sf.external_id
      );

    IF v_has_places THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
            SELECT
                'places',
                'likely_ready',
                count(*) FILTER (
                    WHERE coalesce(to_jsonb(p) ->> 'validation_status', 'valid') IN ('valid', 'valid_with_warnings', 'passed', 'warnings')
                      AND coalesce(to_jsonb(p) ->> 'promotion_status', 'not_ready') <> 'promoted'
                      AND p.point_geom IS NOT NULL
                      AND nullif(trim(coalesce(p.canonical_name, p.normalized_data ->> 'source_name', p.normalized_data ->> 'name')), '') IS NOT NULL
                      AND (
                          (to_jsonb(p) ->> 'poi_category_id') IS NOT NULL
                          OR (to_jsonb(p) ->> 'category_id') IS NOT NULL
                          OR (to_jsonb(p) ->> 'source_category_hint') IS NOT NULL
                      )
                )::bigint,
                'INFO',
                'Heuristic only; API validation remains source of truth'
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
            UNION ALL
            SELECT 'places', 'blocked_count',
                count(*) FILTER (WHERE coalesce(to_jsonb(p) ->> 'validation_status', '') IN ('blocked', 'failed'))::bigint,
                'INFO', NULL
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
            UNION ALL
            SELECT 'places', 'warning_count',
                count(*) FILTER (WHERE coalesce(to_jsonb(p) ->> 'validation_status', '') IN ('valid_with_warnings', 'warnings'))::bigint,
                'INFO', NULL
            FROM %I.staging_place_candidates AS p
            WHERE p.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );
    END IF;

    IF v_has_addresses THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
            SELECT
                'addresses',
                'likely_ready',
                count(*) FILTER (
                    WHERE coalesce(to_jsonb(a) ->> 'address_strength', '') IN ('partial', 'strong', 'full')
                      AND coalesce(to_jsonb(a) ->> 'validation_status', 'valid') IN ('valid', 'valid_with_warnings', 'passed', 'warnings')
                      AND coalesce(to_jsonb(a) ->> 'promotion_status', 'not_ready') <> 'promoted'
                      AND a.point_geom IS NOT NULL
                )::bigint,
                'INFO',
                'Heuristic only; API validation remains source of truth'
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            UNION ALL
            SELECT 'addresses', 'blocked_count',
                count(*) FILTER (
                    WHERE coalesce(to_jsonb(a) ->> 'validation_status', '') IN ('blocked', 'failed')
                       OR coalesce(to_jsonb(a) ->> 'address_strength', '') IN ('none', 'weak')
                )::bigint,
                'INFO', NULL
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            UNION ALL
            SELECT 'addresses', 'warning_count',
                count(*) FILTER (
                    WHERE coalesce(to_jsonb(a) ->> 'validation_status', '') IN ('valid_with_warnings', 'warnings')
                       OR coalesce(to_jsonb(a) ->> 'address_strength', '') = 'partial'
                )::bigint,
                'INFO', NULL
            FROM %I.staging_address_candidates AS a
            WHERE a.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );
    END IF;

    IF v_has_links THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_promotion_readiness (entity_family, metric, row_count, status, note)
            SELECT
                'place_address_links',
                'likely_ready',
                count(*) FILTER (
                    WHERE coalesce(l.validation_status, 'valid') IN ('valid', 'valid_with_warnings', 'passed', 'warnings')
                      AND coalesce(l.promotion_status, 'not_ready') <> 'promoted'
                      AND l.place_candidate_id IS NOT NULL
                      AND l.address_candidate_id IS NOT NULL
                )::bigint,
                'INFO',
                'Heuristic only; core-side promotion still requires both promoted core rows'
            FROM %I.staging_place_address_link_candidates AS l
            WHERE l.source_snapshot_id = %s
            UNION ALL
            SELECT 'place_address_links', 'blocked_count',
                count(*) FILTER (WHERE coalesce(l.validation_status, '') IN ('blocked', 'failed'))::bigint,
                'INFO', NULL
            FROM %I.staging_place_address_link_candidates AS l
            WHERE l.source_snapshot_id = %s
            UNION ALL
            SELECT 'place_address_links', 'warning_count',
                count(*) FILTER (WHERE coalesce(l.validation_status, '') IN ('valid_with_warnings', 'warnings'))::bigint,
                'INFO', NULL
            FROM %I.staging_place_address_link_candidates AS l
            WHERE l.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );
    END IF;

    IF v_has_components THEN
        EXECUTE format(
            $q$
            INSERT INTO stage15_classification_quality_warnings (metric, row_count, status, detail)
            SELECT
                'invalid_language_code',
                count(*) FILTER (
                    WHERE lower(trim(coalesce(c.language_code, ''))) NOT IN ('en', 'my', 'und')
                )::bigint,
                CASE WHEN count(*) FILTER (
                    WHERE lower(trim(coalesce(c.language_code, ''))) NOT IN ('en', 'my', 'und')
                ) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Allowed staging language codes: en, my, mm, und'
            FROM %I.staging_address_component_candidates AS c
            WHERE c.source_snapshot_id = %s
            UNION ALL
            SELECT
                'invalid_component_type_code',
                count(*) FILTER (
                    WHERE lower(trim(coalesce(c.component_type_code, ''))) NOT IN (
                        'house_number', 'unit', 'unit_number', 'floor', 'room',
                        'street', 'road', 'quarter', 'ward', 'village', 'village_tract',
                        'block', 'suburb', 'town', 'city', 'township', 'district',
                        'region', 'state_region', 'postcode', 'postal_code', 'plus_code',
                        'country', 'building', 'entrance'
                    )
                )::bigint,
                CASE WHEN count(*) FILTER (
                    WHERE lower(trim(coalesce(c.component_type_code, ''))) NOT IN (
                        'house_number', 'unit', 'unit_number', 'floor', 'room',
                        'street', 'road', 'quarter', 'ward', 'village', 'village_tract',
                        'block', 'suburb', 'town', 'city', 'township', 'district',
                        'region', 'state_region', 'postcode', 'postal_code', 'plus_code',
                        'country', 'building', 'entrance'
                    )
                ) > 0 THEN 'WARN' ELSE 'PASS' END,
                'Unexpected address component types should be mapped before promotion'
            FROM %I.staging_address_component_candidates AS c
            WHERE c.source_snapshot_id = %s
            $q$,
            v_schema,
            ctx.snapshot_id,
            v_schema,
            ctx.snapshot_id
        );

        IF v_has_addresses THEN
            EXECUTE format(
                $q$
                INSERT INTO stage15_classification_quality_warnings (metric, row_count, status, detail)
                SELECT
                    'source_name_stored_as_address_component',
                    count(*)::bigint,
                    CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'PASS' END,
                    'Source/POI names must stay on place candidates, not address components'
                FROM %I.staging_address_component_candidates AS c
                INNER JOIN %I.staging_address_candidates AS a
                    ON a.id = c.address_candidate_id
                   AND a.source_snapshot_id = c.source_snapshot_id
                WHERE c.source_snapshot_id = %s
                  AND (
                      lower(trim(c.component_type_code)) IN ('name', 'source_name', 'place_name')
                      OR (
                          nullif(trim(coalesce(to_jsonb(a) ->> 'source_name', a.normalized_data ->> 'source_name')), '') IS NOT NULL
                          AND trim(c.component_value) = trim(coalesce(to_jsonb(a) ->> 'source_name', a.normalized_data ->> 'source_name'))
                      )
                  )
                $q$,
                v_schema,
                v_schema,
                ctx.snapshot_id
            );
        END IF;
    ELSE
        INSERT INTO stage15_classification_quality_warnings (metric, row_count, status, detail)
        VALUES
            ('invalid_language_code', 0, 'SKIP', 'staging_address_component_candidates missing'),
            ('invalid_component_type_code', 0, 'SKIP', 'staging_address_component_candidates missing'),
            ('source_name_stored_as_address_component', 0, 'SKIP', 'staging_address_component_candidates missing');
    END IF;

    IF v_has_places THEN
        EXECUTE format(
            $q$
            SELECT coalesce(count(*), 0)::bigint
            FROM (
                SELECT external_id
                FROM %I.staging_place_candidates
                WHERE source_snapshot_id = %s
                  AND nullif(trim(external_id), '') IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            ) AS dup
            $q$,
            v_schema,
            ctx.snapshot_id
        )
        INTO v_duplicate_count;
    END IF;

    IF v_has_addresses THEN
        EXECUTE format(
            $q$
            SELECT coalesce(count(*), 0)::bigint
            FROM (
                SELECT external_id
                FROM %I.staging_address_candidates
                WHERE source_snapshot_id = %s
                  AND nullif(trim(external_id), '') IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            ) AS dup
            $q$,
            v_schema,
            ctx.snapshot_id
        )
        INTO v_tmp_count;
        v_duplicate_count := v_duplicate_count + v_tmp_count;
    END IF;

    IF v_has_links THEN
        EXECUTE format(
            $q$
            SELECT coalesce(count(*), 0)::bigint
            FROM (
                SELECT external_id
                FROM %I.staging_place_address_link_candidates
                WHERE source_snapshot_id = %s
                  AND nullif(trim(external_id), '') IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            ) AS dup
            $q$,
            v_schema,
            ctx.snapshot_id
        )
        INTO v_tmp_count;
        v_duplicate_count := v_duplicate_count + v_tmp_count;
    END IF;

    INSERT INTO stage15_classification_quality_warnings (metric, row_count, status, detail)
    VALUES (
        'duplicate_external_id_in_same_review_batch',
        v_duplicate_count,
        CASE WHEN v_duplicate_count > 0 THEN 'WARN' ELSE 'PASS' END,
        'Local staging duplicate external_id groups for classified place/address/link families'
    );

    IF v_has_packages AND v_has_package_items THEN
        IF ctx.package_name IS NOT NULL THEN
            SELECT p.id, p.package_name
            INTO v_latest_package_id, v_latest_package_name
            FROM system.system_remote_review_packages AS p
            WHERE p.package_name = ctx.package_name
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT 1;
        ELSE
            SELECT p.id, p.package_name
            INTO v_latest_package_id, v_latest_package_name
            FROM system.system_remote_review_packages AS p
            WHERE p.snapshot_version = ctx.snapshot_version
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_has_package_items THEN
        INSERT INTO stage15_review_package_generation (
            entity_family, staging_count, package_item_count, latest_package_name, status, note
        )
        SELECT
            fam.entity_family,
            coalesce(rc.row_count, 0)::bigint AS staging_count,
            coalesce(pkg.package_item_count, 0)::bigint AS package_item_count,
            v_latest_package_name,
            CASE
                WHEN v_latest_package_id IS NULL THEN 'SKIP'
                WHEN coalesce(rc.row_count, 0) = 0 AND coalesce(pkg.package_item_count, 0) = 0 THEN 'SKIP'
                WHEN coalesce(rc.row_count, 0) > 0 AND coalesce(pkg.package_item_count, 0) = 0 THEN 'FAIL'
                WHEN coalesce(pkg.package_item_count, 0) < coalesce(rc.row_count, 0) THEN 'WARN'
                ELSE 'PASS'
            END,
            CASE
                WHEN v_latest_package_id IS NULL AND ctx.package_name IS NOT NULL THEN 'No Stage 11 package found for requested package_name'
                WHEN v_latest_package_id IS NULL THEN 'No Stage 11 package found for this snapshot_version'
                WHEN coalesce(pkg.package_item_count, 0) < coalesce(rc.row_count, 0) THEN 'Package may be filtered or capped; compare max_rows_per_family/entity_family settings'
                ELSE NULL
            END
        FROM (
            VALUES
                ('places'),
                ('addresses'),
                ('address_components'),
                ('place_address_links')
        ) AS fam(entity_family)
        LEFT JOIN stage15_staging_row_counts AS rc
            ON rc.entity_family = fam.entity_family
        LEFT JOIN LATERAL (
            SELECT count(*)::bigint AS package_item_count
            FROM system.system_remote_review_package_items AS i
            WHERE v_latest_package_id IS NOT NULL
              AND i.package_id = v_latest_package_id
              AND i.entity_family = fam.entity_family
        ) AS pkg ON true;
    ELSE
        INSERT INTO stage15_review_package_generation (
            entity_family, staging_count, package_item_count, latest_package_name, status, note
        )
        SELECT
            fam.entity_family,
            coalesce(rc.row_count, 0)::bigint,
            0::bigint,
            NULL::text,
            'SKIP',
            'system.system_remote_review_package_items not found'
        FROM (
            VALUES
                ('places'),
                ('addresses'),
                ('address_components'),
                ('place_address_links')
        ) AS fam(entity_family)
        LEFT JOIN stage15_staging_row_counts AS rc
            ON rc.entity_family = fam.entity_family;
    END IF;
END
$stage15_classification_health$;

-- =============================================================================
-- Output sections (read results top-to-bottom)
-- =============================================================================

SELECT
    'stage15_context' AS section,
    c.snapshot_id,
    c.snapshot_version,
    c.snapshot_region_code,
    c.requested_region_code,
    c.staging_schema,
    c.import_review_schema,
    c.import_review_schema_exists,
    c.package_name,
    c.review_batch_id,
    c.entity_family_filter
FROM stage15_context AS c;

SELECT
    'stage15_entity_manifest' AS section,
    m.sort_order,
    m.entity_family,
    format('%I.%I', (SELECT staging_schema FROM stage15_context LIMIT 1), m.staging_table) AS local_staging_table,
    CASE
        WHEN m.import_review_table IS NULL THEN '—'
        ELSE format('%I.%I', (SELECT import_review_schema FROM stage15_context LIMIT 1), m.import_review_table)
    END AS import_review_table,
    m.core_targets,
    m.child_tables,
    m.geometry_expected,
    m.required_ref,
    m.pipeline_jk,
    m.impl_priority,
    m.risk_level
FROM stage15_manifest AS m
ORDER BY m.sort_order;

SELECT
    'stage15_staging_row_counts' AS section,
    rc.entity_family,
    rc.staging_table,
    rc.table_exists,
    rc.row_count
FROM stage15_staging_row_counts AS rc
ORDER BY (
    SELECT sort_order FROM stage15_manifest AS m WHERE m.staging_table = rc.staging_table
);

SELECT
    'stage15_source_feature_classification_counts' AS section,
    c.source_classification,
    c.source_feature_count,
    c.place_candidate_count,
    c.address_candidate_count,
    c.place_address_link_count
FROM stage15_classification_counts AS c
ORDER BY CASE c.source_classification
    WHEN 'place_only' THEN 1
    WHEN 'address_only' THEN 2
    WHEN 'place_with_address' THEN 3
    WHEN 'weak_address' THEN 4
    WHEN 'ignore' THEN 5
    ELSE 6
END;

SELECT
    'stage15_poi_evidence' AS section,
    e.metric,
    e.row_count,
    e.status,
    e.note
FROM stage15_poi_evidence AS e
ORDER BY CASE e.metric
    WHEN 'source_features_with_name_and_poi_tag' THEN 1
    WHEN 'place_candidates_created' THEN 2
    WHEN 'place_candidates_missing_category' THEN 3
    WHEN 'place_candidates_missing_geometry' THEN 4
    ELSE 99
END;

SELECT
    'stage15_address_evidence' AS section,
    e.metric,
    e.row_count,
    e.status,
    e.note
FROM stage15_address_evidence AS e
ORDER BY CASE e.metric
    WHEN 'address_candidates_created' THEN 1
    WHEN 'weak_addresses' THEN 2
    WHEN 'strong_full_addresses' THEN 3
    WHEN 'address_candidates_missing_point_geom' THEN 4
    WHEN 'address_candidates_with_only_city_country' THEN 5
    ELSE 99
END;

SELECT
    'stage15_address_components_by_type' AS section,
    component_type_code,
    row_count
FROM stage15_address_component_type_counts
ORDER BY row_count DESC, component_type_code;

SELECT
    'stage15_link_evidence' AS section,
    e.metric,
    e.row_count,
    e.status,
    e.note
FROM stage15_link_evidence AS e
ORDER BY CASE e.metric
    WHEN 'place_address_links_created' THEN 1
    WHEN 'place_with_address_rows_without_link' THEN 2
    WHEN 'links_missing_place_candidate' THEN 3
    WHEN 'links_missing_address_candidate' THEN 4
    ELSE 99
END;

SELECT
    'stage15_promotion_readiness' AS section,
    r.entity_family,
    r.metric,
    r.row_count,
    r.status,
    r.note
FROM stage15_promotion_readiness AS r
ORDER BY CASE r.entity_family
    WHEN 'places' THEN 1
    WHEN 'addresses' THEN 2
    WHEN 'place_address_links' THEN 3
    ELSE 99
END,
CASE r.metric
    WHEN 'likely_ready' THEN 1
    WHEN 'warning_count' THEN 2
    WHEN 'blocked_count' THEN 3
    ELSE 99
END;

SELECT
    'stage15_data_quality_warnings_classification' AS section,
    w.metric,
    w.row_count,
    w.status,
    w.detail
FROM stage15_classification_quality_warnings AS w
ORDER BY CASE w.metric
    WHEN 'source_name_stored_as_address_component' THEN 1
    WHEN 'invalid_language_code' THEN 2
    WHEN 'invalid_component_type_code' THEN 3
    WHEN 'duplicate_external_id_in_same_review_batch' THEN 4
    ELSE 99
END;

SELECT
    'stage15_review_package_generation' AS section,
    g.entity_family,
    g.staging_count,
    g.package_item_count,
    g.latest_package_name,
    g.status,
    g.note
FROM stage15_review_package_generation AS g
ORDER BY CASE g.entity_family
    WHEN 'places' THEN 1
    WHEN 'addresses' THEN 2
    WHEN 'address_components' THEN 3
    WHEN 'place_address_links' THEN 4
    ELSE 99
END;

SELECT
    'stage15_data_quality_gaps' AS section,
    g.staging_table,
    g.metric,
    g.gap_count,
    rc.row_count AS snapshot_row_count,
    CASE
        WHEN rc.row_count = 0 THEN NULL
        ELSE round(100.0 * g.gap_count / rc.row_count, 2)
    END AS gap_pct
FROM stage15_data_quality_gaps AS g
LEFT JOIN stage15_staging_row_counts AS rc
    ON rc.staging_table = g.staging_table
ORDER BY g.staging_table, g.metric;

SELECT
    'stage15_review_status_counts' AS section,
    sc.staging_table,
    sc.status_value AS review_status,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'review_status'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_match_status_counts' AS section,
    sc.staging_table,
    sc.status_value AS match_status,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'match_status'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_auto_action_counts' AS section,
    sc.staging_table,
    sc.status_value AS auto_action,
    sc.row_count
FROM stage15_status_counts AS sc
WHERE sc.status_kind = 'auto_action'
ORDER BY sc.staging_table, sc.status_value NULLS FIRST;

SELECT
    'stage15_import_review_row_counts' AS section,
    ir.import_review_table,
    ir.entity_family,
    ir.row_count AS total_rows,
    ir.filtered_by_snapshot AS rows_for_snapshot_version,
    ir.filtered_by_review_batch AS rows_for_review_batch_id
FROM stage15_import_review_counts AS ir
ORDER BY ir.import_review_table;

SELECT
    'stage15_warnings' AS section,
    w.warning_type,
    w.entity_scope,
    w.detail
FROM stage15_warnings AS w
ORDER BY w.warning_type, w.entity_scope;

-- Compact coverage join (manifest + local counts + top gaps)
SELECT
    'stage15_coverage_summary' AS section,
    m.impl_priority,
    m.entity_family,
    m.staging_table,
    coalesce(rc.row_count, 0) AS local_row_count,
    coalesce(m.import_review_table, '—') AS import_review_table,
    coalesce(ir.filtered_by_snapshot, 0) AS import_review_snapshot_rows,
    coalesce(ir.filtered_by_review_batch, 0) AS import_review_batch_rows,
    m.pipeline_jk,
    m.risk_level
FROM stage15_manifest AS m
LEFT JOIN stage15_staging_row_counts AS rc
    ON rc.staging_table = m.staging_table
LEFT JOIN stage15_import_review_counts AS ir
    ON ir.import_review_table = m.import_review_table
ORDER BY m.sort_order;

COMMIT;
