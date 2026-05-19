-- =============================================================================
-- Stage 05: raw_to_staging (E2 foundation)
-- Shared raw -> staging context, readiness checks, and extraction conventions.
--
-- This file now includes point-based Stage E extraction. It does not touch core
-- and does not touch Supabase.
--
-- Input psql variables:
--   snapshot_version
--   raw_schema     optional, defaults to raw
--   staging_schema optional, defaults to staging
--
-- Reusable extraction patterns for later Stage E insert blocks:
--   external_id = 'osm:' || osm_feature_type || ':' || osm_id
--   source_refs = jsonb_build_object(
--       'source_snapshot_id', source_snapshot_id,
--       'snapshot_version', snapshot_version,
--       'raw_table', '<raw table name>',
--       'raw_id', raw.id,
--       'osm_id', raw.osm_id,
--       'osm_feature_type', raw.osm_feature_type
--   )
--   normalized_data = jsonb_build_object(
--       'tags', coalesce(raw.tags, '{}'::jsonb),
--       'geometry_type', GeometryType(raw.geom)
--   )
--
-- Real OSM name extraction only:
--   Use OSM name tags such as name, name:my, name:en, official_name, alt_name,
--   short_name, old_name, route names, stop names, etc.
--   Do not insert fake names into name candidate tables.
--   Generated fallback labels may only go into normalized_data.
--
-- Candidate confidence_score (and similar staging scores) use a 0–100 scale to
-- match Supabase production core — not fractional 0–1.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage05_params (
    snapshot_version text NOT NULL,
    raw_schema text NOT NULL,
    staging_schema text NOT NULL
);

TRUNCATE stage05_params;

INSERT INTO stage05_params (
    snapshot_version,
    raw_schema,
    staging_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw'),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE IF NOT EXISTS stage05_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    boundary_id bigint
);

TRUNCATE stage05_context;

CREATE TEMP TABLE IF NOT EXISTS stage05_report (
    section text,
    entity_family text,
    target_table text,
    metric text,
    value_n bigint,
    status text,
    note text
);

TRUNCATE stage05_report;

CREATE TEMP TABLE IF NOT EXISTS stage05_final_target_counts (
    entity_family text,
    target_table text,
    row_count bigint,
    status text,
    note text
);

TRUNCATE stage05_final_target_counts;

DO $stage05_context$
DECLARE
    v_snapshot_version text;
BEGIN
    SELECT p.snapshot_version
    INTO v_snapshot_version
    FROM stage05_params AS p;

    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    INSERT INTO stage05_context (
        source_snapshot_id,
        snapshot_version,
        region_code,
        boundary_id
    )
    SELECT
        snapshot.id,
        snapshot.snapshot_version,
        snapshot.region_code,
        snapshot.boundary_id
    FROM system.system_source_snapshots AS snapshot
    WHERE snapshot.snapshot_version = v_snapshot_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', v_snapshot_version;
    END IF;
END
$stage05_context$;

SELECT
    'stage05_snapshot_context' AS section,
    ctx.source_snapshot_id,
    ctx.snapshot_version,
    ctx.region_code,
    ctx.boundary_id
FROM stage05_context AS ctx;

DO $stage05_raw_counts$
DECLARE
    v_raw_schema text;
    v_source_snapshot_id bigint;
    q text;
    v_count bigint;
    v_total bigint;
BEGIN
    SELECT p.raw_schema
    INTO v_raw_schema
    FROM stage05_params AS p;

    SELECT ctx.source_snapshot_id
    INTO v_source_snapshot_id
    FROM stage05_context AS ctx;

    IF to_regclass(format('%I.raw_osm_points', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_points does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_lines', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_lines does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_polygons', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_polygons does not exist', v_raw_schema;
    END IF;

    q := format(
        'select count(*)::bigint from %I.raw_osm_points where source_snapshot_id = $1',
        v_raw_schema
    );
    EXECUTE q INTO v_count USING v_source_snapshot_id;
    v_total := coalesce(v_count, 0);

    INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
    VALUES ('raw_counts', 'points', format('%s.raw_osm_points', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);

    q := format(
        'select count(*)::bigint from %I.raw_osm_lines where source_snapshot_id = $1',
        v_raw_schema
    );
    EXECUTE q INTO v_count USING v_source_snapshot_id;
    v_total := v_total + coalesce(v_count, 0);

    INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
    VALUES ('raw_counts', 'lines', format('%s.raw_osm_lines', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);

    q := format(
        'select count(*)::bigint from %I.raw_osm_polygons where source_snapshot_id = $1',
        v_raw_schema
    );
    EXECUTE q INTO v_count USING v_source_snapshot_id;
    v_total := v_total + coalesce(v_count, 0);

    INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
    VALUES ('raw_counts', 'polygons', format('%s.raw_osm_polygons', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);

    IF v_total = 0 THEN
        RAISE EXCEPTION 'no raw OSM rows found for source_snapshot_id %', v_source_snapshot_id;
    END IF;
END
$stage05_raw_counts$;

WITH required_targets(entity_family, table_name) AS (
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
        ('bus_stop', 'staging_bus_stop_candidates'),
        ('bus_stop_name', 'staging_bus_stop_name_candidates'),
        ('bus_route', 'staging_bus_route_candidates'),
        ('bus_route_name', 'staging_bus_route_name_candidates'),
        ('address', 'staging_address_candidates'),
        ('address_component', 'staging_address_component_candidates'),
        ('search_name', 'staging_search_name_candidates'),
        ('search_address', 'staging_search_address_candidates'),
        ('routing_road', 'staging_routing_road_candidates'),
        ('routing_turn_restriction', 'staging_routing_turn_restriction_candidates'),
        ('routing_barrier', 'staging_routing_barrier_candidates'),
        ('bus_route_variant', 'staging_bus_route_variant_candidates'),
        ('bus_route_stop', 'staging_bus_route_stop_candidates')
)
INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
SELECT
    'target_readiness',
    targets.entity_family,
    format('%s.%s', params.staging_schema, targets.table_name),
    'table_exists',
    CASE WHEN tables.table_name IS NULL THEN 0 ELSE 1 END,
    CASE WHEN tables.table_name IS NULL THEN 'WARN' ELSE 'PASS' END,
    CASE
        WHEN tables.table_name IS NULL THEN 'Stage E target table is missing; apply local Stage E readiness migrations before entity inserts.'
        ELSE NULL
    END
FROM required_targets AS targets
CROSS JOIN stage05_params AS params
LEFT JOIN information_schema.tables AS tables
    ON tables.table_schema = params.staging_schema
   AND tables.table_name = targets.table_name
   AND tables.table_type = 'BASE TABLE';

DO $stage05_point_extraction$
DECLARE
    v_raw_schema text;
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    v_place_class_id bigint;
    v_available bigint;
    v_inserted bigint;
    q text;

    has_place boolean;
    has_place_name boolean;
    has_bus_stop boolean;
    has_bus_stop_name boolean;
    has_address boolean;
    has_address_component boolean;
    has_search_name boolean;
    has_search_address boolean;
    has_barrier boolean;
BEGIN
    SELECT p.raw_schema, p.staging_schema
    INTO v_raw_schema, v_staging_schema
    FROM stage05_params AS p;

    SELECT c.source_snapshot_id, c.snapshot_version, c.region_code
    INTO v_source_snapshot_id, v_snapshot_version, v_region_code
    FROM stage05_context AS c;

    has_place := to_regclass(format('%I.staging_place_candidates', v_staging_schema)) IS NOT NULL;
    has_place_name := to_regclass(format('%I.staging_place_name_candidates', v_staging_schema)) IS NOT NULL;
    has_bus_stop := to_regclass(format('%I.staging_bus_stop_candidates', v_staging_schema)) IS NOT NULL;
    has_bus_stop_name := to_regclass(format('%I.staging_bus_stop_name_candidates', v_staging_schema)) IS NOT NULL;
    has_address := to_regclass(format('%I.staging_address_candidates', v_staging_schema)) IS NOT NULL;
    has_address_component := to_regclass(format('%I.staging_address_component_candidates', v_staging_schema)) IS NOT NULL;
    has_search_name := to_regclass(format('%I.staging_search_name_candidates', v_staging_schema)) IS NOT NULL;
    has_search_address := to_regclass(format('%I.staging_search_address_candidates', v_staging_schema)) IS NOT NULL;
    has_barrier := to_regclass(format('%I.staging_routing_barrier_candidates', v_staging_schema)) IS NOT NULL;

    SELECT pc.id
    INTO v_place_class_id
    FROM ref.ref_place_classes AS pc
    ORDER BY CASE pc.code
        WHEN 'poi' THEN 1
        WHEN 'place' THEN 2
        WHEN 'other' THEN 3
        WHEN 'unknown' THEN 4
        ELSE 100
    END, pc.id
    LIMIT 1;

    -- ---------------------------------------------------------------------
    -- A. Place candidates from useful points
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_points AS raw
        WHERE raw.source_snapshot_id = $1
          AND (
              raw.tags ?| array['amenity','shop','tourism','office','healthcare','leisure','public_transport','railway','name','brand','operator']
              OR raw.tags->>'highway' = 'bus_stop'
              OR raw.tags->>'bus' = 'yes'
          )
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT has_place THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped place candidate extraction.');
    ELSIF v_place_class_id IS NULL THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'ref.ref_place_classes has no rows; skipped place candidate extraction because place_class_id is required.');
    ELSE
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'name:en', ''),
                        nullif(raw.tags->>'name:my', ''),
                        nullif(raw.tags->>'name:mm', ''),
                        nullif(raw.tags->>'name:my-MM', ''),
                        nullif(raw.tags->>'brand', ''),
                        nullif(raw.tags->>'operator', ''),
                        'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text
                    ) AS canonical_name,
                    coalesce(
                        nullif(raw.tags->>'amenity', ''),
                        nullif(raw.tags->>'shop', ''),
                        nullif(raw.tags->>'tourism', ''),
                        nullif(raw.tags->>'office', ''),
                        nullif(raw.tags->>'healthcare', ''),
                        nullif(raw.tags->>'leisure', ''),
                        nullif(raw.tags->>'public_transport', ''),
                        nullif(raw.tags->>'railway', ''),
                        nullif(raw.tags->>'highway', ''),
                        'point'
                    ) AS class_code
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags ?| array['amenity','shop','tourism','office','healthcare','leisure','public_transport','railway','name','brand','operator']
                      OR raw.tags->>'highway' = 'bus_stop'
                      OR raw.tags->>'bus' = 'yes'
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_place_candidates (
                    source_snapshot_id,
                    raw_id,
                    source_entity_type,
                    external_id,
                    canonical_name,
                    class_code,
                    place_class_id,
                    point_geom,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    normalized_data,
                    source_refs
                )
                SELECT
                    $1,
                    src.id,
                    'osm_point',
                    src.external_id,
                    src.canonical_name,
                    src.class_code,
                    $2,
                    src.geom,
                    CASE
                        WHEN src.tags ?| array['amenity','shop','tourism','office','healthcare','leisure','public_transport','railway','brand','operator'] THEN 75
                        ELSE 50
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'selected_fields', jsonb_strip_nulls(jsonb_build_object(
                            'amenity', src.tags->>'amenity',
                            'shop', src.tags->>'shop',
                            'tourism', src.tags->>'tourism',
                            'office', src.tags->>'office',
                            'healthcare', src.tags->>'healthcare',
                            'leisure', src.tags->>'leisure',
                            'public_transport', src.tags->>'public_transport',
                            'railway', src.tags->>'railway',
                            'highway', src.tags->>'highway',
                            'bus', src.tags->>'bus',
                            'brand', src.tags->>'brand',
                            'operator', src.tags->>'operator',
                            'phone', coalesce(src.tags->>'phone', src.tags->>'contact:phone'),
                            'website', coalesce(src.tags->>'website', src.tags->>'contact:website'),
                            'opening_hours', src.tags->>'opening_hours'
                        )),
                        'generated_fallback_label', CASE
                            WHEN src.tags ?| array['name','name:en','name:my','name:mm','name:my-MM','brand','operator'] THEN NULL
                            ELSE src.external_id
                        END
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $3,
                        'region_code', $4,
                        'raw_table', 'raw_osm_points',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    )
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_place_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_place_class_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Place name candidates: real OSM name tags only.
    -- Do not insert fake names into name candidate tables.
    -- ---------------------------------------------------------------------
    IF has_place AND has_place_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.tags,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags ?| array['amenity','shop','tourism','office','healthcare','leisure','public_transport','railway','name','brand','operator']
                      OR raw.tags->>'highway' = 'bus_stop'
                      OR raw.tags->>'bus' = 'yes'
                  )
            ),
            names AS (
                SELECT
                    place.id AS place_candidate_id,
                    src.external_id,
                    src.raw_id,
                    src.osm_id,
                    src.osm_feature_type,
                    n.source_tag,
                    n.name,
                    n.language_code,
                    n.name_type,
                    n.is_primary,
                    n.search_weight
                FROM src
                JOIN %I.staging_place_candidates AS place
                    ON place.source_snapshot_id = $1
                   AND place.external_id = src.external_id
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', src.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', src.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', src.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', src.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', src.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('official_name', src.tags->>'official_name', 'und', 'official', false, 90),
                        ('alt_name', src.tags->>'alt_name', 'und', 'alternate', false, 80),
                        ('old_name', src.tags->>'old_name', 'und', 'old', false, 60),
                        ('short_name', src.tags->>'short_name', 'und', 'short', false, 90)
                ) AS n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE n.name IS NOT NULL
                  AND btrim(n.name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_place_name_candidates (
                    source_snapshot_id,
                    place_candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary,
                    search_weight,
                    source_tag,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    names.place_candidate_id,
                    names.external_id,
                    names.name,
                    names.language_code,
                    NULL,
                    names.name_type,
                    names.is_primary,
                    names.search_weight,
                    names.source_tag,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'raw_table', 'raw_osm_points',
                        'raw_id', names.raw_id,
                        'osm_id', names.osm_id,
                        'osm_feature_type', names.osm_feature_type,
                        'source_tag', names.source_tag
                    ),
                    jsonb_build_object('source_tag', names.source_tag)
                FROM names
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_place_name_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.place_candidate_id = names.place_candidate_id
                      AND existing.language_code IS NOT DISTINCT FROM names.language_code
                      AND existing.name_type = names.name_type
                      AND existing.name = names.name
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version;
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_name', format('%s.staging_place_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM name tags only; no generated fallback labels inserted.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_name', format('%s.staging_place_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Place or place-name target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- C. Bus stop candidates
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_points AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND (
              raw.tags->>'highway' = 'bus_stop'
              OR raw.tags->>'public_transport' IN ('platform', 'stop_position')
              OR raw.tags->>'bus' = 'yes'
          )
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_bus_stop THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'name:en', ''),
                        nullif(raw.tags->>'name:my', ''),
                        nullif(raw.tags->>'name:mm', ''),
                        nullif(raw.tags->>'name:my-MM', ''),
                        nullif(raw.tags->>'operator', ''),
                        nullif(raw.tags->>'network', ''),
                        'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text
                    ) AS canonical_name
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags->>'highway' = 'bus_stop'
                      OR raw.tags->>'public_transport' IN ('platform', 'stop_position')
                      OR raw.tags->>'bus' = 'yes'
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_stop_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    class_code,
                    point_geom,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    normalized_data,
                    source_refs
                )
                SELECT
                    $1,
                    src.id,
                    src.external_id,
                    src.canonical_name,
                    coalesce(nullif(src.tags->>'public_transport', ''), nullif(src.tags->>'highway', ''), 'bus_stop'),
                    src.geom,
                    70,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'operator', src.tags->>'operator',
                        'network', src.tags->>'network',
                        'shelter', src.tags->>'shelter',
                        'bench', src.tags->>'bench',
                        'generated_fallback_label', CASE
                            WHEN src.tags ?| array['name','name:en','name:my','name:mm','name:my-MM','operator','network'] THEN NULL
                            ELSE src.external_id
                        END
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_points',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    )
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_bus_stop_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop', format('%s.staging_bus_stop_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop', format('%s.staging_bus_stop_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped bus stop extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D. Bus stop name candidates: real OSM name tags only.
    -- ---------------------------------------------------------------------
    IF has_bus_stop AND has_bus_stop_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.tags,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags->>'highway' = 'bus_stop'
                      OR raw.tags->>'public_transport' IN ('platform', 'stop_position')
                      OR raw.tags->>'bus' = 'yes'
                  )
            ),
            names AS (
                SELECT
                    stop.id AS bus_stop_candidate_id,
                    src.external_id,
                    src.raw_id,
                    src.osm_id,
                    src.osm_feature_type,
                    n.source_tag,
                    n.name,
                    n.language_code,
                    n.name_type,
                    n.is_primary,
                    n.search_weight
                FROM src
                JOIN %I.staging_bus_stop_candidates AS stop
                    ON stop.source_snapshot_id = $1
                   AND stop.external_id = src.external_id
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', src.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', src.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', src.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', src.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', src.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('official_name', src.tags->>'official_name', 'und', 'official', false, 90),
                        ('alt_name', src.tags->>'alt_name', 'und', 'alternate', false, 80),
                        ('old_name', src.tags->>'old_name', 'und', 'old', false, 60),
                        ('short_name', src.tags->>'short_name', 'und', 'short', false, 90)
                ) AS n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE n.name IS NOT NULL
                  AND btrim(n.name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_stop_name_candidates (
                    source_snapshot_id,
                    bus_stop_candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary,
                    search_weight,
                    source_tag,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    names.bus_stop_candidate_id,
                    names.external_id,
                    names.name,
                    names.language_code,
                    NULL,
                    names.name_type,
                    names.is_primary,
                    names.search_weight,
                    names.source_tag,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'raw_table', 'raw_osm_points',
                        'raw_id', names.raw_id,
                        'osm_id', names.osm_id,
                        'osm_feature_type', names.osm_feature_type,
                        'source_tag', names.source_tag
                    ),
                    jsonb_build_object('source_tag', names.source_tag)
                FROM names
                ON CONFLICT (source_snapshot_id, bus_stop_candidate_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version;
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop_name', format('%s.staging_bus_stop_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM name tags only; no generated fallback labels inserted.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop_name', format('%s.staging_bus_stop_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Bus stop or bus-stop-name target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- E. Address candidates from points
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_points AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND (
              raw.tags ?| array['addr:housenumber','addr:street','addr:quarter','addr:suburb','addr:city','addr:township','addr:district','addr:state','addr:postcode','addr:full']
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_object_keys(raw.tags) AS k(key)
                  WHERE k.key LIKE 'addr:%%'
              )
          )
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_address THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags ?| array['addr:housenumber','addr:street','addr:quarter','addr:suburb','addr:city','addr:township','addr:district','addr:state','addr:postcode','addr:full']
                      OR EXISTS (
                          SELECT 1
                          FROM jsonb_object_keys(raw.tags) AS k(key)
                          WHERE k.key LIKE 'addr:%%'
                      )
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_address_candidates (
                    source_snapshot_id,
                    raw_table,
                    raw_id,
                    external_id,
                    source_feature_family,
                    full_address,
                    house_number,
                    street_name,
                    quarter,
                    suburb,
                    township,
                    city,
                    district,
                    state_region,
                    postcode,
                    country,
                    point_geom,
                    geom,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    'raw_osm_points',
                    src.id,
                    src.external_id,
                    'point',
                    src.tags->>'addr:full',
                    src.tags->>'addr:housenumber',
                    src.tags->>'addr:street',
                    src.tags->>'addr:quarter',
                    src.tags->>'addr:suburb',
                    src.tags->>'addr:township',
                    src.tags->>'addr:city',
                    src.tags->>'addr:district',
                    src.tags->>'addr:state',
                    src.tags->>'addr:postcode',
                    coalesce(NULLIF(src.tags->>'addr:country', ''), 'MM'),
                    src.geom,
                    src.geom,
                    65,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_points',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb))
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('point_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped address extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- F. Address component candidates
    -- ---------------------------------------------------------------------
    IF has_address AND has_address_component THEN
        q := format(
            $q$
            WITH address_src AS (
                SELECT
                    address.id AS address_candidate_id,
                    address.source_snapshot_id,
                    address.external_id,
                    address.source_refs,
                    address.house_number,
                    address.street_name,
                    address.quarter,
                    address.suburb,
                    address.township,
                    address.city,
                    address.district,
                    address.state_region,
                    address.postcode,
                    address.country
                FROM %I.staging_address_candidates AS address
                WHERE address.source_snapshot_id = $1
                  AND address.source_feature_family = 'point'
            ),
            components AS (
                SELECT
                    address_src.address_candidate_id,
                    address_src.source_snapshot_id,
                    comp.component_type_code,
                    comp.component_value,
                    comp.sort_order,
                    address_src.source_refs
                FROM address_src
                CROSS JOIN LATERAL (
                    VALUES
                        ('house_number', address_src.house_number, 10),
                        ('street', address_src.street_name, 20),
                        ('quarter', address_src.quarter, 30),
                        ('suburb', address_src.suburb, 40),
                        ('township', address_src.township, 50),
                        ('city', address_src.city, 60),
                        ('district', address_src.district, 70),
                        ('state_region', address_src.state_region, 80),
                        ('postcode', address_src.postcode, 90),
                        ('country', coalesce(address_src.country, 'MM'), 100)
                ) AS comp(component_type_code, component_value, sort_order)
                WHERE comp.component_value IS NOT NULL
                  AND btrim(comp.component_value) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_address_component_candidates (
                    source_snapshot_id,
                    address_candidate_id,
                    component_type_code,
                    component_value,
                    language_code,
                    source_tag,
                    sort_order,
                    source_refs,
                    normalized_data
                )
                SELECT
                    components.source_snapshot_id,
                    components.address_candidate_id,
                    components.component_type_code,
                    components.component_value,
                    'und',
                    CASE
                        WHEN components.component_type_code = 'house_number' THEN 'addr:housenumber'
                        WHEN components.component_type_code = 'street' THEN 'addr:street'
                        WHEN components.component_type_code = 'state_region' THEN 'addr:state'
                        ELSE 'addr:' || components.component_type_code
                    END,
                    components.sort_order,
                    components.source_refs,
                    jsonb_build_object('component_type_code', components.component_type_code)
                FROM components
                ON CONFLICT (address_candidate_id, component_type_code, language_code, component_value) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('point_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Components generated only from real addr:* fields and MM default country.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Address or address-component target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- G. Search name candidates from point places and bus stops
    -- ---------------------------------------------------------------------
    IF has_search_name THEN
        q := format(
            $q$
            WITH candidate_names AS (
                SELECT
                    'place'::text AS entity_family,
                    place.id AS candidate_id,
                    place.external_id,
                    names.name,
                    names.language_code,
                    names.script_code,
                    names.name_type,
                    names.search_weight,
                    place.point_geom::geometry(Geometry, 4326) AS geom,
                    names.source_refs,
                    names.normalized_data
                FROM %I.staging_place_name_candidates AS names
                JOIN %I.staging_place_candidates AS place
                    ON place.id = names.place_candidate_id
                WHERE names.source_snapshot_id = $1
                UNION ALL
                SELECT
                    'bus_stop'::text AS entity_family,
                    stop.id AS candidate_id,
                    stop.external_id,
                    names.name,
                    names.language_code,
                    names.script_code,
                    names.name_type,
                    names.search_weight,
                    stop.point_geom::geometry(Geometry, 4326) AS geom,
                    names.source_refs,
                    names.normalized_data
                FROM %I.staging_bus_stop_name_candidates AS names
                JOIN %I.staging_bus_stop_candidates AS stop
                    ON stop.id = names.bus_stop_candidate_id
                WHERE names.source_snapshot_id = $1
            ),
            inserted AS (
                INSERT INTO %I.staging_search_name_candidates (
                    source_snapshot_id,
                    entity_family,
                    candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    search_weight,
                    tokens,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    candidate_names.entity_family,
                    candidate_names.candidate_id,
                    candidate_names.external_id,
                    candidate_names.name,
                    coalesce(candidate_names.language_code, 'und'),
                    candidate_names.script_code,
                    candidate_names.name_type,
                    coalesce(candidate_names.search_weight::integer, 100),
                    jsonb_build_object('raw', candidate_names.name),
                    candidate_names.source_refs,
                    candidate_names.normalized_data || jsonb_build_object('entity_family', candidate_names.entity_family)
                FROM candidate_names
                ON CONFLICT (source_snapshot_id, entity_family, external_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Search names from real place and bus stop name candidates.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Target table missing; skipped search name extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- H. Search address candidates
    -- ---------------------------------------------------------------------
    IF has_address AND has_search_address THEN
        q := format(
            $q$
            WITH address_text AS (
                SELECT
                    address.id AS address_candidate_id,
                    address.external_id,
                    coalesce(
                        nullif(address.full_address, ''),
                        nullif(concat_ws(', ',
                            nullif(address.house_number, ''),
                            nullif(address.street_name, ''),
                            nullif(address.quarter, ''),
                            nullif(address.suburb, ''),
                            nullif(address.township, ''),
                            nullif(address.city, ''),
                            nullif(address.district, ''),
                            nullif(address.state_region, ''),
                            nullif(address.postcode, ''),
                            nullif(address.country, '')
                        ), '')
                    ) AS search_text,
                    address.source_refs,
                    address.normalized_data
                FROM %I.staging_address_candidates AS address
                WHERE address.source_snapshot_id = $1
                  AND address.source_feature_family = 'point'
            ),
            inserted AS (
                INSERT INTO %I.staging_search_address_candidates (
                    source_snapshot_id,
                    address_candidate_id,
                    external_id,
                    search_text,
                    language_code,
                    tokens,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    address_text.address_candidate_id,
                    address_text.external_id,
                    address_text.search_text,
                    'und',
                    jsonb_build_object('raw', address_text.search_text),
                    address_text.source_refs,
                    address_text.normalized_data
                FROM address_text
                WHERE address_text.search_text IS NOT NULL
                  AND btrim(address_text.search_text) <> ''
                ON CONFLICT (source_snapshot_id, external_id, language_code, search_text) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_address', format('%s.staging_search_address_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Search text uses addr:full or real address components.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_address', format('%s.staging_search_address_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Address or search-address target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- I. Routing barrier candidates
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_points AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND (
              raw.tags ?| array['barrier','access']
              OR raw.tags->>'barrier' IN ('bollard', 'gate', 'block')
          )
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_points AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags ?| array['barrier','access']
                      OR raw.tags->>'barrier' IN ('bollard', 'gate', 'block')
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_routing_barrier_candidates (
                    source_snapshot_id,
                    raw_table,
                    raw_id,
                    external_id,
                    barrier_type,
                    access_tags,
                    point_geom,
                    geom,
                    source_refs,
                    normalized_data,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status
                )
                SELECT
                    $1,
                    'raw_osm_points',
                    src.id,
                    src.external_id,
                    src.tags->>'barrier',
                    jsonb_strip_nulls(jsonb_build_object(
                        'access', src.tags->>'access',
                        'foot', src.tags->>'foot',
                        'bicycle', src.tags->>'bicycle',
                        'motor_vehicle', src.tags->>'motor_vehicle',
                        'vehicle', src.tags->>'vehicle'
                    )),
                    src.geom,
                    src.geom,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_points',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb)),
                    60,
                    'new_candidate',
                    NULL,
                    'pending'
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('point_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped routing barrier extraction.');
    END IF;
END
$stage05_point_extraction$;

DO $stage05_line_extraction$
DECLARE
    v_raw_schema text;
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    v_available bigint;
    v_inserted bigint;
    q text;

    has_road boolean;
    has_road_name boolean;
    has_routing_road boolean;
    has_water_line boolean;
    has_search_name boolean;
    has_barrier boolean;
BEGIN
    SELECT p.raw_schema, p.staging_schema
    INTO v_raw_schema, v_staging_schema
    FROM stage05_params AS p;

    SELECT c.source_snapshot_id, c.snapshot_version, c.region_code
    INTO v_source_snapshot_id, v_snapshot_version, v_region_code
    FROM stage05_context AS c;

    has_road := to_regclass(format('%I.staging_road_candidates', v_staging_schema)) IS NOT NULL;
    has_road_name := to_regclass(format('%I.staging_road_name_candidates', v_staging_schema)) IS NOT NULL;
    has_routing_road := to_regclass(format('%I.staging_routing_road_candidates', v_staging_schema)) IS NOT NULL;
    has_water_line := to_regclass(format('%I.staging_water_line_candidates', v_staging_schema)) IS NOT NULL;
    has_search_name := to_regclass(format('%I.staging_search_name_candidates', v_staging_schema)) IS NOT NULL;
    has_barrier := to_regclass(format('%I.staging_routing_barrier_candidates', v_staging_schema)) IS NOT NULL;

    -- ---------------------------------------------------------------------
    -- A. Road candidates from highway lines.
    -- No fake real names: generated fallback identifiers are stored in
    -- normalized_data.generated_label only. canonical_name uses real names when
    -- present; for older NOT NULL schemas, external_id is used as a technical
    -- placeholder, not as a name candidate.
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_lines AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND raw.tags ? 'highway'
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_road THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'name:en', ''),
                        nullif(raw.tags->>'name:my', ''),
                        nullif(raw.tags->>'name:mm', ''),
                        nullif(raw.tags->>'name:my-MM', '')
                    ) AS real_name,
                    raw.tags->>'highway' AS road_class_code,
                    CASE
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('yes', 'true', '1') OR raw.tags->>'junction' = 'roundabout' THEN true
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('no', 'false', '0') THEN false
                        ELSE NULL
                    END AS is_oneway,
                    CASE
                        WHEN raw.tags->>'highway' IN ('service', 'track', 'path') THEN 55
                        WHEN coalesce(raw.tags->>'name', raw.tags->>'name:en', raw.tags->>'name:my', raw.tags->>'name:mm', raw.tags->>'name:my-MM') IS NOT NULL THEN 80
                        ELSE 65
                    END AS confidence_score
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'highway'
            ),
            inserted AS (
                INSERT INTO %I.staging_road_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    class_code,
                    geom,
                    is_oneway,
                    length_m,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    normalized_data,
                    source_refs
                )
                SELECT
                    $1,
                    src.id,
                    src.external_id,
                    coalesce(src.real_name, src.external_id),
                    src.road_class_code,
                    src.geom,
                    src.is_oneway,
                    ST_Length(src.geom::geography),
                    src.confidence_score,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'generated_label', CASE WHEN src.real_name IS NULL THEN src.external_id ELSE NULL END,
                        'routing', jsonb_strip_nulls(jsonb_build_object(
                            'access', src.tags->>'access',
                            'vehicle', src.tags->>'vehicle',
                            'motor_vehicle', src.tags->>'motor_vehicle',
                            'foot', src.tags->>'foot',
                            'bicycle', src.tags->>'bicycle',
                            'bus', src.tags->>'bus',
                            'hgv', src.tags->>'hgv',
                            'maxspeed', src.tags->>'maxspeed',
                            'lanes', src.tags->>'lanes',
                            'width', src.tags->>'width',
                            'surface', src.tags->>'surface',
                            'smoothness', src.tags->>'smoothness',
                            'tracktype', src.tags->>'tracktype',
                            'service', src.tags->>'service',
                            'bridge', src.tags->>'bridge',
                            'tunnel', src.tags->>'tunnel',
                            'layer', src.tags->>'layer',
                            'junction', src.tags->>'junction'
                        ))
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    )
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_road_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped road extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Road name candidates: real name/ref tags only; no generated names.
    -- ---------------------------------------------------------------------
    IF has_road AND has_road_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.tags,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'highway'
            ),
            names AS (
                SELECT
                    road.id AS road_candidate_id,
                    src.external_id,
                    src.raw_id,
                    src.osm_id,
                    src.osm_feature_type,
                    n.source_tag,
                    n.name,
                    n.language_code,
                    n.name_type,
                    n.is_primary,
                    n.search_weight
                FROM src
                JOIN %I.staging_road_candidates AS road
                    ON road.source_snapshot_id = $1
                   AND road.external_id = src.external_id
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', src.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', src.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', src.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', src.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', src.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('official_name', src.tags->>'official_name', 'und', 'official', false, 90),
                        ('alt_name', src.tags->>'alt_name', 'und', 'alternate', false, 80),
                        ('old_name', src.tags->>'old_name', 'und', 'old', false, 60),
                        ('short_name', src.tags->>'short_name', 'und', 'short', false, 90),
                        ('ref', src.tags->>'ref', 'und', 'ref', false, 80)
                ) AS n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE n.name IS NOT NULL
                  AND btrim(n.name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_road_name_candidates (
                    source_snapshot_id,
                    road_candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary,
                    search_weight,
                    source_tag,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    names.road_candidate_id,
                    names.external_id,
                    names.name,
                    names.language_code,
                    NULL,
                    names.name_type,
                    names.is_primary,
                    names.search_weight,
                    names.source_tag,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', names.raw_id,
                        'osm_id', names.osm_id,
                        'osm_feature_type', names.osm_feature_type,
                        'source_tag', names.source_tag
                    ),
                    jsonb_build_object('source_tag', names.source_tag)
                FROM names
                ON CONFLICT (source_snapshot_id, road_candidate_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version;
        INSERT INTO stage05_report VALUES ('line_extraction', 'road_name', format('%s.staging_road_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM road name/ref tags only.');
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'road_name', format('%s.staging_road_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Road or road-name target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- C. Routing road candidates (future graph derivation, not final edges).
    -- ---------------------------------------------------------------------
    IF has_routing_road THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    raw.tags->>'highway' AS road_class_code,
                    CASE
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('yes', 'true', '1') OR raw.tags->>'junction' = 'roundabout' THEN true
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('no', 'false', '0') THEN false
                        ELSE NULL
                    END AS is_oneway,
                    CASE WHEN raw.tags->>'maxspeed' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (raw.tags->>'maxspeed')::numeric ELSE NULL END AS maxspeed_kph,
                    CASE WHEN raw.tags->>'lanes' ~ '^[0-9]+$' THEN (raw.tags->>'lanes')::integer ELSE NULL END AS lanes,
                    CASE
                        WHEN raw.tags->>'highway' IN ('service', 'track', 'path') THEN 55
                        WHEN coalesce(raw.tags->>'name', raw.tags->>'name:en', raw.tags->>'name:my', raw.tags->>'name:mm', raw.tags->>'name:my-MM') IS NOT NULL THEN 80
                        ELSE 65
                    END AS confidence_score
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'highway'
            ),
            inserted AS (
                INSERT INTO %I.staging_routing_road_candidates (
                    source_snapshot_id,
                    road_candidate_id,
                    raw_id,
                    external_id,
                    road_class_code,
                    is_oneway,
                    maxspeed_kph,
                    lanes,
                    surface,
                    access_tags,
                    routing_tags,
                    geom_multi,
                    length_m,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    road.id,
                    src.id,
                    src.external_id,
                    src.road_class_code,
                    src.is_oneway,
                    src.maxspeed_kph,
                    src.lanes,
                    src.tags->>'surface',
                    jsonb_strip_nulls(jsonb_build_object(
                        'access', src.tags->>'access',
                        'vehicle', src.tags->>'vehicle',
                        'motor_vehicle', src.tags->>'motor_vehicle',
                        'foot', src.tags->>'foot',
                        'bicycle', src.tags->>'bicycle',
                        'bus', src.tags->>'bus',
                        'hgv', src.tags->>'hgv'
                    )),
                    jsonb_strip_nulls(jsonb_build_object(
                        'maxspeed', src.tags->>'maxspeed',
                        'lanes', src.tags->>'lanes',
                        'width', src.tags->>'width',
                        'surface', src.tags->>'surface',
                        'smoothness', src.tags->>'smoothness',
                        'tracktype', src.tags->>'tracktype',
                        'service', src.tags->>'service',
                        'bridge', src.tags->>'bridge',
                        'tunnel', src.tags->>'tunnel',
                        'layer', src.tags->>'layer',
                        'junction', src.tags->>'junction'
                    )),
                    src.geom,
                    ST_Length(src.geom::geography),
                    src.confidence_score,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb))
                FROM src
                LEFT JOIN %I.staging_road_candidates AS road
                    ON road.source_snapshot_id = $1
                   AND road.external_id = src.external_id
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_road', format('%s.staging_routing_road_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', NULL);
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_road', format('%s.staging_routing_road_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Target table missing; skipped routing road extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D. Water line candidates.
    -- ---------------------------------------------------------------------
    q := format(
        'SELECT count(*)::bigint FROM %I.raw_osm_lines WHERE source_snapshot_id = $1 AND geom IS NOT NULL AND tags ? ''waterway''',
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_water_line THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'waterway'
            ),
            inserted AS (
                INSERT INTO %I.staging_water_line_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    class_code,
                    normalized_data,
                    source_refs,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    geom
                )
                SELECT
                    $1,
                    src.id,
                    src.external_id,
                    nullif(src.tags->>'name', ''),
                    src.tags->>'waterway',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'waterway', src.tags->>'waterway',
                        'name', src.tags->>'name',
                        'tunnel', src.tags->>'tunnel',
                        'intermittent', src.tags->>'intermittent'
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    CASE WHEN src.tags ? 'name' THEN 75 ELSE 60 END,
                    'new_candidate',
                    NULL,
                    'pending',
                    src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_water_line_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'water_line', format('%s.staging_water_line_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'water_line', format('%s.staging_water_line_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped water line extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- E. Search name candidates from road names and water line names.
    -- ---------------------------------------------------------------------
    IF has_search_name THEN
        q := format(
            $q$
            WITH candidate_names AS (
                SELECT
                    'road'::text AS entity_family,
                    road.id AS candidate_id,
                    road.external_id,
                    names.name,
                    names.language_code,
                    names.script_code,
                    names.name_type,
                    names.search_weight,
                    names.source_refs,
                    names.normalized_data
                FROM %I.staging_road_name_candidates AS names
                JOIN %I.staging_road_candidates AS road
                    ON road.id = names.road_candidate_id
                WHERE names.source_snapshot_id = $1
                UNION ALL
                SELECT
                    'water_line'::text AS entity_family,
                    water.id AS candidate_id,
                    water.external_id,
                    water.canonical_name AS name,
                    'und'::text AS language_code,
                    NULL::text AS script_code,
                    'official'::text AS name_type,
                    70::integer AS search_weight,
                    water.source_refs,
                    water.normalized_data
                FROM %I.staging_water_line_candidates AS water
                WHERE water.source_snapshot_id = $1
                  AND water.canonical_name IS NOT NULL
                  AND btrim(water.canonical_name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_search_name_candidates (
                    source_snapshot_id,
                    entity_family,
                    candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    search_weight,
                    tokens,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    candidate_names.entity_family,
                    candidate_names.candidate_id,
                    candidate_names.external_id,
                    candidate_names.name,
                    coalesce(candidate_names.language_code, 'und'),
                    candidate_names.script_code,
                    candidate_names.name_type,
                    coalesce(candidate_names.search_weight::integer, 100),
                    jsonb_build_object('raw', candidate_names.name),
                    candidate_names.source_refs,
                    candidate_names.normalized_data || jsonb_build_object('entity_family', candidate_names.entity_family)
                FROM candidate_names
                ON CONFLICT (source_snapshot_id, entity_family, external_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('line_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Search names from real road and waterway names only.');
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Target table missing; skipped line search names.');
    END IF;

    -- ---------------------------------------------------------------------
    -- F. Line barrier candidates.
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_lines AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND (
              raw.tags ?| array['barrier','fence_type','access']
              OR raw.tags->>'barrier' IN ('fence', 'wall', 'hedge', 'gate', 'block')
          )
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags ?| array['barrier','fence_type','access']
                      OR raw.tags->>'barrier' IN ('fence', 'wall', 'hedge', 'gate', 'block')
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_routing_barrier_candidates (
                    source_snapshot_id,
                    raw_table,
                    raw_id,
                    external_id,
                    barrier_type,
                    access_tags,
                    point_geom,
                    geom,
                    source_refs,
                    normalized_data,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status
                )
                SELECT
                    $1,
                    'raw_osm_lines',
                    src.id,
                    src.external_id,
                    coalesce(src.tags->>'barrier', src.tags->>'fence_type'),
                    jsonb_strip_nulls(jsonb_build_object(
                        'access', src.tags->>'access',
                        'foot', src.tags->>'foot',
                        'bicycle', src.tags->>'bicycle',
                        'motor_vehicle', src.tags->>'motor_vehicle',
                        'vehicle', src.tags->>'vehicle'
                    )),
                    NULL,
                    src.geom,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb)),
                    60,
                    'new_candidate',
                    NULL,
                    'pending'
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped line barrier extraction.');
    END IF;
END
$stage05_line_extraction$;

DO $stage05_bus_route_extraction$
DECLARE
    v_raw_schema text;
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    v_available bigint;
    v_inserted bigint;
    v_skipped bigint;
    q text;

    has_bus_route boolean;
    has_bus_route_name boolean;
    has_bus_route_variant boolean;
    has_bus_route_stop boolean;
BEGIN
    SELECT p.raw_schema, p.staging_schema
    INTO v_raw_schema, v_staging_schema
    FROM stage05_params AS p;

    SELECT c.source_snapshot_id, c.snapshot_version, c.region_code
    INTO v_source_snapshot_id, v_snapshot_version, v_region_code
    FROM stage05_context AS c;

    has_bus_route := to_regclass(format('%I.staging_bus_route_candidates', v_staging_schema)) IS NOT NULL;
    has_bus_route_name := to_regclass(format('%I.staging_bus_route_name_candidates', v_staging_schema)) IS NOT NULL;
    has_bus_route_variant := to_regclass(format('%I.staging_bus_route_variant_candidates', v_staging_schema)) IS NOT NULL;
    has_bus_route_stop := to_regclass(format('%I.staging_bus_route_stop_candidates', v_staging_schema)) IS NOT NULL;

    -- ---------------------------------------------------------------------
    -- A. Bus route candidates.
    -- Only line rows can satisfy the current route-candidate geometry contract.
    -- Point/polygon route tags are reported below but not promoted into routes.
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_lines AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND (
              raw.tags->>'route' = 'bus'
              OR (raw.tags->>'type' = 'route' AND raw.tags->>'route' = 'bus')
              OR (raw.tags->>'public_transport' = 'route' AND raw.tags->>'bus' = 'yes')
          )
          AND GeometryType(ST_LineMerge(raw.geom)) = 'LINESTRING'
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_bus_route THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'ref', ''),
                        nullif(concat_ws(' - ', nullif(raw.tags->>'from', ''), nullif(raw.tags->>'to', '')), ''),
                        'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text
                    ) AS display_label
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND (
                      raw.tags->>'route' = 'bus'
                      OR (raw.tags->>'type' = 'route' AND raw.tags->>'route' = 'bus')
                      OR (raw.tags->>'public_transport' = 'route' AND raw.tags->>'bus' = 'yes')
                  )
                  AND GeometryType(ST_LineMerge(raw.geom)) = 'LINESTRING'
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_route_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    class_code,
                    route_code,
                    public_name,
                    geom,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    normalized_data,
                    source_refs
                )
                SELECT
                    $1,
                    src.id,
                    src.external_id,
                    src.display_label,
                    'bus',
                    coalesce(nullif(src.tags->>'ref', ''), src.external_id),
                    src.display_label,
                    ST_LineMerge(src.geom)::geometry(LineString, 4326),
                    CASE
                        WHEN src.osm_feature_type = 'relation' THEN 80
                        WHEN src.tags->>'type' = 'route' THEN 75
                        ELSE 60
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'route', src.tags->>'route',
                        'type', src.tags->>'type',
                        'ref', src.tags->>'ref',
                        'name', src.tags->>'name',
                        'from', src.tags->>'from',
                        'to', src.tags->>'to',
                        'operator', src.tags->>'operator',
                        'network', src.tags->>'network',
                        'public_transport', src.tags->>'public_transport',
                        'route_sequence_source', CASE
                            WHEN src.raw_payload ? 'members' THEN 'raw_payload.members'
                            ELSE NULL
                        END
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    )
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_bus_route_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                ON CONFLICT DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_bus_route_candidates' AND column_name = 'route_ref'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_bus_route_candidates AS route
                SET route_ref = raw.tags->>'ref'
                FROM %I.raw_osm_lines AS raw
                WHERE route.source_snapshot_id = $1
                  AND route.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.tags->>'ref' IS NOT NULL
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_bus_route_candidates' AND column_name = 'operator'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_bus_route_candidates AS route
                SET operator = raw.tags->>'operator'
                FROM %I.raw_osm_lines AS raw
                WHERE route.source_snapshot_id = $1
                  AND route.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.tags->>'operator' IS NOT NULL
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_bus_route_candidates' AND column_name = 'network'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_bus_route_candidates AS route
                SET network = raw.tags->>'network'
                FROM %I.raw_osm_lines AS raw
                WHERE route.source_snapshot_id = $1
                  AND route.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.tags->>'network' IS NOT NULL
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route', format('%s.staging_bus_route_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_line_routes=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route', format('%s.staging_bus_route_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped bus route extraction.');
    END IF;

    q := format(
        $q$
        SELECT count(*)::bigint
        FROM (
            SELECT id FROM %I.raw_osm_points
            WHERE source_snapshot_id = $1
              AND (tags->>'route' = 'bus' OR (tags->>'type' = 'route' AND tags->>'route' = 'bus') OR (tags->>'public_transport' = 'route' AND tags->>'bus' = 'yes'))
            UNION ALL
            SELECT id FROM %I.raw_osm_polygons
            WHERE source_snapshot_id = $1
              AND (tags->>'route' = 'bus' OR (tags->>'type' = 'route' AND tags->>'route' = 'bus') OR (tags->>'public_transport' = 'route' AND tags->>'bus' = 'yes'))
        ) AS unsupported_route_geometry
        $q$,
        v_raw_schema,
        v_raw_schema
    );
    EXECUTE q INTO v_skipped USING v_source_snapshot_id;

    IF v_skipped > 0 THEN
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route', 'raw.raw_osm_points/raw.raw_osm_polygons', 'skipped_rows', v_skipped, 'WARN', 'Route-tagged point/polygon rows found, but bus route candidates require usable line geometry; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Bus route names.
    -- Only real OSM name/ref tags are used. from/to remain in normalized_data.
    -- ---------------------------------------------------------------------
    IF has_bus_route AND has_bus_route_name THEN
        q := format(
            $q$
            WITH route_src AS (
                SELECT
                    route.id AS bus_route_candidate_id,
                    route.external_id,
                    route.source_refs,
                    route.normalized_data,
                    raw.tags,
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type
                FROM %I.staging_bus_route_candidates AS route
                JOIN %I.raw_osm_lines AS raw
                    ON raw.id = route.raw_id
                   AND raw.source_snapshot_id = route.source_snapshot_id
                WHERE route.source_snapshot_id = $1
            ),
            names AS (
                SELECT
                    route_src.*,
                    n.source_tag,
                    n.name,
                    n.language_code,
                    n.name_type,
                    n.is_primary,
                    n.search_weight
                FROM route_src
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', route_src.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', route_src.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', route_src.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', route_src.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', route_src.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('ref', route_src.tags->>'ref', 'und', 'ref', false, 95)
                ) AS n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE n.name IS NOT NULL AND btrim(n.name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_route_name_candidates (
                    source_snapshot_id,
                    bus_route_candidate_id,
                    external_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary,
                    search_weight,
                    source_tag,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    names.bus_route_candidate_id,
                    names.external_id,
                    names.name,
                    names.language_code,
                    NULL,
                    names.name_type,
                    names.is_primary,
                    names.search_weight,
                    names.source_tag,
                    names.source_refs || jsonb_build_object('source_tag', names.source_tag),
                    names.normalized_data || jsonb_build_object(
                        'source_tag', names.source_tag,
                        'from', names.tags->>'from',
                        'to', names.tags->>'to'
                    )
                FROM names
                ON CONFLICT (source_snapshot_id, bus_route_candidate_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route_name', format('%s.staging_bus_route_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM route name/ref tags only.');
    ELSE
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route_name', format('%s.staging_bus_route_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Bus route or bus-route-name target table missing; skipped route names.');
    END IF;

    -- ---------------------------------------------------------------------
    -- C. Bus route variants.
    -- Create a variant only when source route data has direction/from/to and
    -- a route geometry. No variant is invented from route identity alone.
    -- ---------------------------------------------------------------------
    IF has_bus_route AND has_bus_route_variant THEN
        q := format(
            $q$
            WITH route_src AS (
                SELECT
                    route.id AS bus_route_candidate_id,
                    route.external_id,
                    route.geom,
                    route.source_refs,
                    route.normalized_data,
                    raw.tags
                FROM %I.staging_bus_route_candidates AS route
                JOIN %I.raw_osm_lines AS raw
                    ON raw.id = route.raw_id
                   AND raw.source_snapshot_id = route.source_snapshot_id
                WHERE route.source_snapshot_id = $1
                  AND route.geom IS NOT NULL
                  AND (
                      nullif(raw.tags->>'from', '') IS NOT NULL
                      OR nullif(raw.tags->>'to', '') IS NOT NULL
                      OR nullif(raw.tags->>'direction', '') IS NOT NULL
                  )
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_route_variant_candidates (
                    source_snapshot_id,
                    bus_route_candidate_id,
                    external_id,
                    variant_code,
                    direction,
                    from_name,
                    to_name,
                    geom,
                    sequence_confidence,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    route_src.bus_route_candidate_id,
                    route_src.external_id || ':variant:' || coalesce(nullif(route_src.tags->>'direction', ''), nullif(route_src.tags->>'from', ''), 'default'),
                    coalesce(nullif(route_src.tags->>'ref', ''), route_src.external_id),
                    nullif(route_src.tags->>'direction', ''),
                    nullif(route_src.tags->>'from', ''),
                    nullif(route_src.tags->>'to', ''),
                    ST_Multi(route_src.geom)::geometry(MultiLineString, 4326),
                    0.30,
                    65,
                    'new_candidate',
                    NULL,
                    'pending',
                    route_src.source_refs,
                    route_src.normalized_data || jsonb_build_object(
                        'sequence_note', 'Route geometry exists, but relation member order is not available in current raw data.',
                        'from', route_src.tags->>'from',
                        'to', route_src.tags->>'to',
                        'direction', route_src.tags->>'direction'
                    )
                FROM route_src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route_variant', format('%s.staging_bus_route_variant_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Created only where from/to/direction and geometry are present; sequence confidence is low without member order.');
    ELSE
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route_variant', format('%s.staging_bus_route_variant_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Bus route or variant target table missing; skipped variants.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D. Bus route stop candidates.
    -- Current Stage 04 raw_payload stores tags/source metadata only. If future
    -- imports preserve ordered relation members in raw_payload.members, this
    -- block can create stop candidates from that real order. Otherwise it
    -- reports a WARN/TODO and creates no fake sequence.
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_lines AS raw
        WHERE raw.source_snapshot_id = $1
          AND (
              raw.tags->>'route' = 'bus'
              OR (raw.tags->>'type' = 'route' AND raw.tags->>'route' = 'bus')
          )
          AND raw.raw_payload ? 'members'
          AND jsonb_typeof(raw.raw_payload->'members') = 'array'
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_bus_route_stop AND has_bus_route_variant AND v_available > 0 THEN
        q := format(
            $q$
            WITH route_members AS (
                SELECT
                    variant.id AS bus_route_variant_candidate_id,
                    route.source_snapshot_id,
                    route.external_id AS route_external_id,
                    member.ord::integer AS stop_sequence,
                    member.value AS member_json,
                    coalesce(member.value->>'role', '') AS member_role,
                    member.value->>'type' AS member_type,
                    coalesce(member.value->>'ref', member.value->>'id') AS member_ref,
                    route.source_refs
                FROM %I.staging_bus_route_variant_candidates AS variant
                JOIN %I.staging_bus_route_candidates AS route
                    ON route.id = variant.bus_route_candidate_id
                JOIN %I.raw_osm_lines AS raw
                    ON raw.id = route.raw_id
                   AND raw.source_snapshot_id = route.source_snapshot_id
                CROSS JOIN LATERAL jsonb_array_elements(raw.raw_payload->'members') WITH ORDINALITY AS member(value, ord)
                WHERE route.source_snapshot_id = $1
                  AND raw.raw_payload ? 'members'
                  AND jsonb_typeof(raw.raw_payload->'members') = 'array'
                  AND coalesce(member.value->>'role', '') IN ('stop', 'platform', 'stop_entry_only', 'stop_exit_only', 'platform_entry_only', 'platform_exit_only')
            ),
            matched AS (
                SELECT
                    route_members.*,
                    stop.id AS bus_stop_candidate_id,
                    stop.point_geom
                FROM route_members
                LEFT JOIN %I.staging_bus_stop_candidates AS stop
                    ON stop.source_snapshot_id = route_members.source_snapshot_id
                   AND stop.external_id = 'osm:' || coalesce(route_members.member_type, 'node') || ':' || route_members.member_ref
                WHERE route_members.member_ref IS NOT NULL
            ),
            inserted AS (
                INSERT INTO %I.staging_bus_route_stop_candidates (
                    source_snapshot_id,
                    bus_route_variant_candidate_id,
                    bus_stop_candidate_id,
                    external_id,
                    stop_sequence,
                    role,
                    point_geom,
                    source_refs,
                    normalized_data,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status
                )
                SELECT
                    $1,
                    matched.bus_route_variant_candidate_id,
                    matched.bus_stop_candidate_id,
                    matched.route_external_id || ':stop:' || matched.stop_sequence::text || ':' || coalesce(matched.member_ref, 'unknown'),
                    matched.stop_sequence,
                    nullif(matched.member_role, ''),
                    matched.point_geom,
                    matched.source_refs || jsonb_build_object('relation_member_order', matched.stop_sequence),
                    jsonb_build_object('relation_member', matched.member_json),
                    CASE WHEN matched.bus_stop_candidate_id IS NOT NULL THEN 70 ELSE 45 END,
                    'new_candidate',
                    NULL,
                    'pending'
                FROM matched
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('bus_route_extraction', 'bus_route_stop', format('%s.staging_bus_route_stop_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Created only from ordered raw_payload.members relation data.');
    ELSE
        INSERT INTO stage05_report VALUES (
            'bus_route_extraction',
            'bus_route_stop',
            format('%s.staging_bus_route_stop_candidates', v_staging_schema),
            'skipped_rows',
            0,
            'WARN',
            CASE
                WHEN NOT has_bus_route_stop THEN 'Target table missing; skipped route stops.'
                WHEN NOT has_bus_route_variant THEN 'Variant target table missing; skipped route stops.'
                ELSE 'TODO: ordered relation stop/platform members are not available in current raw_payload; no route-stop sequence created.'
            END
        );
    END IF;
END
$stage05_bus_route_extraction$;

DO $stage05_polygon_extraction$
DECLARE
    v_raw_schema text;
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    v_available bigint;
    v_inserted bigint;
    q text;

    has_building boolean;
    has_address boolean;
    has_address_component boolean;
    has_landuse boolean;
    has_water_polygon boolean;
    has_admin_area boolean;
    has_admin_area_name boolean;
    has_search_name boolean;
    has_barrier boolean;
BEGIN
    SELECT p.raw_schema, p.staging_schema
    INTO v_raw_schema, v_staging_schema
    FROM stage05_params AS p;

    SELECT c.source_snapshot_id, c.snapshot_version, c.region_code
    INTO v_source_snapshot_id, v_snapshot_version, v_region_code
    FROM stage05_context AS c;

    has_building := to_regclass(format('%I.staging_building_candidates', v_staging_schema)) IS NOT NULL;
    has_address := to_regclass(format('%I.staging_address_candidates', v_staging_schema)) IS NOT NULL;
    has_address_component := to_regclass(format('%I.staging_address_component_candidates', v_staging_schema)) IS NOT NULL;
    has_landuse := to_regclass(format('%I.staging_landuse_candidates', v_staging_schema)) IS NOT NULL;
    has_water_polygon := to_regclass(format('%I.staging_water_polygon_candidates', v_staging_schema)) IS NOT NULL;
    has_admin_area := to_regclass(format('%I.staging_admin_area_candidates', v_staging_schema)) IS NOT NULL;
    has_admin_area_name := to_regclass(format('%I.staging_admin_area_name_candidates', v_staging_schema)) IS NOT NULL;
    has_search_name := to_regclass(format('%I.staging_search_name_candidates', v_staging_schema)) IS NOT NULL;
    has_barrier := to_regclass(format('%I.staging_routing_barrier_candidates', v_staging_schema)) IS NOT NULL;

    -- ---------------------------------------------------------------------
    -- A. Building candidates
    -- ---------------------------------------------------------------------
    q := format(
        'SELECT count(*)::bigint FROM %I.raw_osm_polygons WHERE source_snapshot_id = $1 AND geom IS NOT NULL AND tags ? ''building''',
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_building THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'name:en', ''),
                        nullif(raw.tags->>'name:my', ''),
                        nullif(raw.tags->>'name:mm', ''),
                        nullif(raw.tags->>'name:my-MM', '')
                    ) AS real_name
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'building'
            ),
            inserted AS (
                INSERT INTO %I.staging_building_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    class_code,
                    normalized_data,
                    source_refs,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    geom
                )
                SELECT
                    $1,
                    src.id,
                    src.external_id,
                    src.real_name,
                    coalesce(nullif(src.tags->>'building', ''), 'yes'),
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'address', jsonb_strip_nulls(jsonb_build_object(
                            'full_address', src.tags->>'addr:full',
                            'house_number', src.tags->>'addr:housenumber',
                            'street', src.tags->>'addr:street',
                            'quarter', src.tags->>'addr:quarter',
                            'suburb', src.tags->>'addr:suburb',
                            'city', src.tags->>'addr:city',
                            'township', src.tags->>'addr:township',
                            'district', src.tags->>'addr:district',
                            'state', src.tags->>'addr:state',
                            'postcode', src.tags->>'addr:postcode'
                        )),
                        'building', jsonb_strip_nulls(jsonb_build_object(
                            'building', src.tags->>'building',
                            'building_levels', CASE WHEN src.tags->>'building:levels' ~ '^[0-9]+(\.[0-9]+)?$' THEN (src.tags->>'building:levels')::numeric ELSE NULL END,
                            'height_m', CASE WHEN src.tags->>'height' ~ '^[0-9]+(\.[0-9]+)?$' THEN (src.tags->>'height')::numeric ELSE NULL END,
                            'height', src.tags->>'height',
                            'min_height', src.tags->>'min_height',
                            'roof_shape', src.tags->>'roof:shape',
                            'material', src.tags->>'material',
                            'area_m2', ST_Area(src.geom::geography),
                            'centroid_wkt', ST_AsText(ST_PointOnSurface(src.geom))
                        ))
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_polygons',
                        'raw_id', src.id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type
                    ),
                    CASE
                        WHEN src.real_name IS NOT NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(src.tags) AS k(key) WHERE k.key LIKE 'addr:%%') THEN 75
                        ELSE 65
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_building_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_building_candidates' AND column_name = 'centroid'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_building_candidates AS building
                SET centroid = ST_PointOnSurface(raw.geom)
                FROM %I.raw_osm_polygons AS raw
                WHERE building.source_snapshot_id = $1
                  AND building.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'building'
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_building_candidates' AND column_name = 'area_m2'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_building_candidates AS building
                SET area_m2 = ST_Area(raw.geom::geography)
                FROM %I.raw_osm_polygons AS raw
                WHERE building.source_snapshot_id = $1
                  AND building.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'building'
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_building_candidates' AND column_name = 'levels'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_building_candidates AS building
                SET levels = (raw.tags->>'building:levels')::numeric
                FROM %I.raw_osm_polygons AS raw
                WHERE building.source_snapshot_id = $1
                  AND building.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.tags->>'building:levels' ~ '^[0-9]+(\.[0-9]+)?$'
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_building_candidates' AND column_name = 'height_m'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_building_candidates AS building
                SET height_m = (raw.tags->>'height')::numeric
                FROM %I.raw_osm_polygons AS raw
                WHERE building.source_snapshot_id = $1
                  AND building.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.tags->>'height' ~ '^[0-9]+(\.[0-9]+)?$'
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        INSERT INTO stage05_report VALUES ('polygon_extraction', 'building', format('%s.staging_building_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'building', format('%s.staging_building_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped building extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Polygon address candidates
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_polygons AS raw
        WHERE raw.source_snapshot_id = $1
          AND raw.geom IS NOT NULL
          AND EXISTS (SELECT 1 FROM jsonb_object_keys(raw.tags) AS k(key) WHERE k.key LIKE 'addr:%%')
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_address THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, 'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND EXISTS (SELECT 1 FROM jsonb_object_keys(raw.tags) AS k(key) WHERE k.key LIKE 'addr:%%')
            ),
            inserted AS (
                INSERT INTO %I.staging_address_candidates (
                    source_snapshot_id, raw_table, raw_id, external_id, source_feature_family,
                    full_address, house_number, street_name, quarter, suburb, township, city,
                    district, state_region, postcode, country, point_geom, geom, confidence_score,
                    match_status, auto_action, review_status, source_refs, normalized_data
                )
                SELECT
                    $1, 'raw_osm_polygons', src.id, src.external_id, 'polygon',
                    src.tags->>'addr:full', src.tags->>'addr:housenumber', src.tags->>'addr:street',
                    src.tags->>'addr:quarter', src.tags->>'addr:suburb', src.tags->>'addr:township',
                    src.tags->>'addr:city', src.tags->>'addr:district', src.tags->>'addr:state',
                    src.tags->>'addr:postcode', coalesce(nullif(src.tags->>'addr:country', ''), 'MM'),
                    ST_PointOnSurface(src.geom), src.geom, 65,
                    'new_candidate', NULL, 'pending',
                    jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3, 'raw_table', 'raw_osm_polygons', 'raw_id', src.id, 'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb))
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped polygon address extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- C. Address component candidates for polygon addresses
    -- ---------------------------------------------------------------------
    IF has_address AND has_address_component THEN
        q := format(
            $q$
            WITH address_src AS (
                SELECT address.*
                FROM %I.staging_address_candidates AS address
                WHERE address.source_snapshot_id = $1
                  AND address.source_feature_family = 'polygon'
            ),
            components AS (
                SELECT address_src.id AS address_candidate_id, address_src.source_snapshot_id, comp.component_type_code, comp.component_value, comp.sort_order, address_src.source_refs
                FROM address_src
                CROSS JOIN LATERAL (
                    VALUES
                        ('house_number', address_src.house_number, 10),
                        ('street', address_src.street_name, 20),
                        ('quarter', address_src.quarter, 30),
                        ('suburb', address_src.suburb, 40),
                        ('township', address_src.township, 50),
                        ('city', address_src.city, 60),
                        ('district', address_src.district, 70),
                        ('state_region', address_src.state_region, 80),
                        ('postcode', address_src.postcode, 90),
                        ('country', coalesce(address_src.country, 'MM'), 100)
                ) AS comp(component_type_code, component_value, sort_order)
                WHERE comp.component_value IS NOT NULL AND btrim(comp.component_value) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_address_component_candidates (
                    source_snapshot_id, address_candidate_id, component_type_code, component_value,
                    language_code, source_tag, sort_order, source_refs, normalized_data
                )
                SELECT
                    components.source_snapshot_id, components.address_candidate_id, components.component_type_code,
                    components.component_value, 'und',
                    CASE
                        WHEN components.component_type_code = 'house_number' THEN 'addr:housenumber'
                        WHEN components.component_type_code = 'street' THEN 'addr:street'
                        WHEN components.component_type_code = 'state_region' THEN 'addr:state'
                        ELSE 'addr:' || components.component_type_code
                    END,
                    components.sort_order, components.source_refs,
                    jsonb_build_object('component_type_code', components.component_type_code)
                FROM components
                ON CONFLICT (address_candidate_id, component_type_code, language_code, component_value) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Components generated from polygon addr:* fields.');
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Address or address-component target table missing; skipped polygon components.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D. Landuse candidates
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND (tags ? 'landuse' OR tags->>'leisure' = 'park' OR tags->>'amenity' = 'grave_yard')
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_landuse THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, 'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                       coalesce(nullif(raw.tags->>'landuse',''), nullif(raw.tags->>'leisure',''), nullif(raw.tags->>'amenity','')) AS class_code
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1 AND raw.geom IS NOT NULL
                  AND (raw.tags ? 'landuse' OR raw.tags->>'leisure' = 'park' OR raw.tags->>'amenity' = 'grave_yard')
            ),
            inserted AS (
                INSERT INTO %I.staging_landuse_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, nullif(src.tags->>'name', ''), src.class_code,
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb), 'landuse', src.tags->>'landuse', 'leisure', src.tags->>'leisure', 'amenity', src.tags->>'amenity', 'name', src.tags->>'name'),
                    jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3, 'raw_table', 'raw_osm_polygons', 'raw_id', src.id, 'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type),
                    CASE WHEN src.tags ? 'name' THEN 75 ELSE 60 END,
                    'new_candidate', NULL, 'pending', src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_landuse_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'landuse', format('%s.staging_landuse_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'landuse', format('%s.staging_landuse_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped landuse extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- E. Water polygon candidates
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND (tags->>'natural' = 'water' OR tags ? 'water' OR tags->>'waterway' = 'riverbank')
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_water_polygon THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, 'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                       coalesce(nullif(raw.tags->>'water',''), nullif(raw.tags->>'natural',''), nullif(raw.tags->>'waterway','')) AS class_code
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1 AND raw.geom IS NOT NULL
                  AND (raw.tags->>'natural' = 'water' OR raw.tags ? 'water' OR raw.tags->>'waterway' = 'riverbank')
            ),
            inserted AS (
                INSERT INTO %I.staging_water_polygon_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, nullif(src.tags->>'name', ''), src.class_code,
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb), 'natural', src.tags->>'natural', 'water', src.tags->>'water', 'waterway', src.tags->>'waterway', 'intermittent', src.tags->>'intermittent', 'name', src.tags->>'name'),
                    jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3, 'raw_table', 'raw_osm_polygons', 'raw_id', src.id, 'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type),
                    CASE WHEN src.tags ? 'name' THEN 75 ELSE 60 END,
                    'new_candidate', NULL, 'pending', src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_water_polygon_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'water_polygon', format('%s.staging_water_polygon_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'water_polygon', format('%s.staging_water_polygon_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped water polygon extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- F. Admin area candidates
    -- ---------------------------------------------------------------------
    q := format(
        'SELECT count(*)::bigint FROM %I.raw_osm_polygons WHERE source_snapshot_id = $1 AND geom IS NOT NULL AND tags->>''boundary'' = ''administrative''',
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_admin_area THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, 'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id,
                       coalesce(nullif(raw.tags->>'name',''), nullif(raw.tags->>'name:en',''), nullif(raw.tags->>'name:my',''), nullif(raw.tags->>'name:mm',''), nullif(raw.tags->>'name:my-MM','')) AS real_name
                FROM %I.raw_osm_polygons raw
                WHERE raw.source_snapshot_id = $1 AND raw.geom IS NOT NULL AND raw.tags->>'boundary' = 'administrative'
            ),
            mapped AS (
                SELECT src.*, levels.id AS admin_level_id
                FROM src
                JOIN ref.ref_admin_levels levels
                  ON levels.code = src.tags->>'admin_level'
                  OR (src.tags->>'admin_level' ~ '^[0-9]+$' AND levels.rank = (src.tags->>'admin_level')::integer)
                WHERE src.real_name IS NOT NULL
            ),
            inserted AS (
                INSERT INTO %I.staging_admin_area_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code, admin_level_id,
                    geom, centroid, confidence_score, match_status, auto_action, review_status,
                    normalized_data, source_refs
                )
                SELECT
                    $1, mapped.id, mapped.external_id, mapped.real_name, mapped.tags->>'admin_level',
                    mapped.admin_level_id, mapped.geom, ST_PointOnSurface(mapped.geom),
                    80, 'new_candidate', NULL, 'pending',
                    jsonb_build_object('tags', coalesce(mapped.tags, '{}'::jsonb), 'admin_level', mapped.tags->>'admin_level', 'boundary', mapped.tags->>'boundary', 'place', mapped.tags->>'place', 'population', mapped.tags->>'population', 'wikidata', mapped.tags->>'wikidata', 'wikipedia', mapped.tags->>'wikipedia', 'area_m2', ST_Area(mapped.geom::geography)),
                    jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3, 'raw_table', 'raw_osm_polygons', 'raw_id', mapped.id, 'osm_id', mapped.osm_id, 'osm_feature_type', mapped.osm_feature_type)
                FROM mapped
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_admin_area_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = mapped.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = v_staging_schema AND table_name = 'staging_admin_area_candidates' AND column_name = 'area_m2'
        ) THEN
            q := format(
                $q$
                UPDATE %I.staging_admin_area_candidates AS admin_area
                SET area_m2 = ST_Area(raw.geom::geography)
                FROM %I.raw_osm_polygons AS raw
                WHERE admin_area.source_snapshot_id = $1
                  AND admin_area.raw_id = raw.id
                  AND raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags->>'boundary' = 'administrative'
                $q$,
                v_staging_schema,
                v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s; skipped rows without real name or matching ref_admin_levels', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped admin area extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- G. Admin area names
    -- ---------------------------------------------------------------------
    IF has_admin_area AND has_admin_area_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.id raw_id, raw.osm_id, raw.osm_feature_type, raw.tags,
                       'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_polygons raw
                WHERE raw.source_snapshot_id = $1 AND raw.geom IS NOT NULL AND raw.tags->>'boundary' = 'administrative'
            ),
            names AS (
                SELECT admin.id AS admin_area_candidate_id, src.external_id, src.raw_id, src.osm_id, src.osm_feature_type,
                       n.source_tag, n.name, n.language_code, n.name_type, n.is_primary, n.search_weight
                FROM src
                JOIN %I.staging_admin_area_candidates admin
                  ON admin.source_snapshot_id = $1 AND admin.external_id = src.external_id
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', src.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', src.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', src.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', src.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', src.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('official_name', src.tags->>'official_name', 'und', 'official', false, 90),
                        ('alt_name', src.tags->>'alt_name', 'und', 'alternate', false, 80),
                        ('old_name', src.tags->>'old_name', 'und', 'old', false, 60),
                        ('short_name', src.tags->>'short_name', 'und', 'short', false, 90)
                ) n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE n.name IS NOT NULL AND btrim(n.name) <> ''
            ),
            inserted AS (
                INSERT INTO %I.staging_admin_area_name_candidates (
                    source_snapshot_id, admin_area_candidate_id, external_id, name, language_code,
                    script_code, name_type, is_primary, search_weight, source_tag, source_refs, normalized_data
                )
                SELECT $1, names.admin_area_candidate_id, names.external_id, names.name, names.language_code,
                       NULL, names.name_type, names.is_primary, names.search_weight, names.source_tag,
                       jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'raw_table', 'raw_osm_polygons', 'raw_id', names.raw_id, 'osm_id', names.osm_id, 'osm_feature_type', names.osm_feature_type, 'source_tag', names.source_tag),
                       jsonb_build_object('source_tag', names.source_tag)
                FROM names
                ON CONFLICT (source_snapshot_id, admin_area_candidate_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area_name', format('%s.staging_admin_area_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM admin names only.');
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area_name', format('%s.staging_admin_area_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Admin area or admin-area-name target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- H. Search name candidates for polygon-derived entities
    -- ---------------------------------------------------------------------
    IF has_search_name THEN
        CREATE TEMP TABLE IF NOT EXISTS stage05_polygon_search_candidates (
            entity_family text NOT NULL,
            candidate_id bigint NOT NULL,
            external_id text NOT NULL,
            name text NOT NULL,
            language_code text NOT NULL,
            script_code text,
            name_type text NOT NULL,
            search_weight integer NOT NULL,
            source_refs jsonb NOT NULL,
            normalized_data jsonb NOT NULL
        ) ON COMMIT DROP;

        TRUNCATE stage05_polygon_search_candidates;

        IF has_building THEN
            q := format(
                $q$
                INSERT INTO stage05_polygon_search_candidates (
                    entity_family, candidate_id, external_id, name, language_code,
                    script_code, name_type, search_weight, source_refs, normalized_data
                )
                SELECT 'building', b.id, b.external_id, b.canonical_name, 'und', NULL,
                       'official', 80, b.source_refs, b.normalized_data
                FROM %I.staging_building_candidates AS b
                WHERE b.source_snapshot_id = $1
                  AND b.canonical_name IS NOT NULL
                  AND btrim(b.canonical_name) <> ''
                $q$,
                v_staging_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF has_landuse THEN
            q := format(
                $q$
                INSERT INTO stage05_polygon_search_candidates (
                    entity_family, candidate_id, external_id, name, language_code,
                    script_code, name_type, search_weight, source_refs, normalized_data
                )
                SELECT 'landuse', l.id, l.external_id, l.canonical_name, 'und', NULL,
                       'official', 60, l.source_refs, l.normalized_data
                FROM %I.staging_landuse_candidates AS l
                WHERE l.source_snapshot_id = $1
                  AND l.canonical_name IS NOT NULL
                  AND btrim(l.canonical_name) <> ''
                $q$,
                v_staging_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF has_water_polygon THEN
            q := format(
                $q$
                INSERT INTO stage05_polygon_search_candidates (
                    entity_family, candidate_id, external_id, name, language_code,
                    script_code, name_type, search_weight, source_refs, normalized_data
                )
                SELECT 'water_polygon', w.id, w.external_id, w.canonical_name, 'und', NULL,
                       'official', 60, w.source_refs, w.normalized_data
                FROM %I.staging_water_polygon_candidates AS w
                WHERE w.source_snapshot_id = $1
                  AND w.canonical_name IS NOT NULL
                  AND btrim(w.canonical_name) <> ''
                $q$,
                v_staging_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        IF has_admin_area AND has_admin_area_name THEN
            q := format(
                $q$
                INSERT INTO stage05_polygon_search_candidates (
                    entity_family, candidate_id, external_id, name, language_code,
                    script_code, name_type, search_weight, source_refs, normalized_data
                )
                SELECT 'admin_area', a.id, a.external_id, n.name, n.language_code,
                       n.script_code, n.name_type, n.search_weight, n.source_refs, n.normalized_data
                FROM %I.staging_admin_area_name_candidates AS n
                JOIN %I.staging_admin_area_candidates AS a
                    ON a.id = n.admin_area_candidate_id
                WHERE n.source_snapshot_id = $1
                $q$,
                v_staging_schema,
                v_staging_schema
            );
            EXECUTE q USING v_source_snapshot_id;
        END IF;

        q := format(
            $q$
            WITH inserted AS (
                INSERT INTO %I.staging_search_name_candidates (
                    source_snapshot_id, entity_family, candidate_id, external_id, name, language_code,
                    script_code, name_type, search_weight, tokens, source_refs, normalized_data
                )
                SELECT $1, entity_family, candidate_id, external_id, name, coalesce(language_code, 'und'),
                       script_code, name_type, search_weight, jsonb_build_object('raw', name),
                       source_refs, normalized_data || jsonb_build_object('entity_family', entity_family)
                FROM stage05_polygon_search_candidates
                ON CONFLICT (source_snapshot_id, entity_family, external_id, language_code, name_type, name) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Search names from real polygon-derived names only.');
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Target table missing; skipped polygon search names.');
    END IF;

    -- ---------------------------------------------------------------------
    -- I. Polygon routing barriers
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND (tags ?| array['barrier','fence_type','access'] OR tags->>'barrier' IN ('fence', 'wall', 'hedge', 'gate', 'block'))
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, 'osm:' || raw.osm_feature_type::text || ':' || raw.osm_id::text AS external_id
                FROM %I.raw_osm_polygons raw
                WHERE raw.source_snapshot_id = $1 AND raw.geom IS NOT NULL
                  AND (raw.tags ?| array['barrier','fence_type','access'] OR raw.tags->>'barrier' IN ('fence', 'wall', 'hedge', 'gate', 'block'))
            ),
            inserted AS (
                INSERT INTO %I.staging_routing_barrier_candidates (
                    source_snapshot_id, raw_table, raw_id, external_id, barrier_type, access_tags,
                    point_geom, geom, source_refs, normalized_data, confidence_score, match_status, auto_action, review_status
                )
                SELECT
                    $1, 'raw_osm_polygons', src.id, src.external_id, coalesce(src.tags->>'barrier', src.tags->>'fence_type'),
                    jsonb_strip_nulls(jsonb_build_object('access', src.tags->>'access', 'foot', src.tags->>'foot', 'bicycle', src.tags->>'bicycle', 'motor_vehicle', src.tags->>'motor_vehicle', 'vehicle', src.tags->>'vehicle')),
                    ST_PointOnSurface(src.geom), src.geom,
                    jsonb_build_object('source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3, 'raw_table', 'raw_osm_polygons', 'raw_id', src.id, 'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type),
                    jsonb_build_object('tags', coalesce(src.tags, '{}'::jsonb)),
                    60, 'new_candidate', NULL, 'pending'
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped polygon barrier extraction.');
    END IF;
END
$stage05_polygon_extraction$;

DO $stage05_final_counts$
DECLARE
    v_staging_schema text;
    v_source_snapshot_id bigint;
    target record;
    q text;
    v_count bigint;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage05_params AS p;

    SELECT ctx.source_snapshot_id
    INTO v_source_snapshot_id
    FROM stage05_context AS ctx;

    FOR target IN
        SELECT *
        FROM (
            VALUES
                ('place', 'staging_place_candidates'),
                ('place_name', 'staging_place_name_candidates'),
                ('road', 'staging_road_candidates'),
                ('road_name', 'staging_road_name_candidates'),
                ('routing_road', 'staging_routing_road_candidates'),
                ('building', 'staging_building_candidates'),
                ('address', 'staging_address_candidates'),
                ('address_component', 'staging_address_component_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_line', 'staging_water_line_candidates'),
                ('water_polygon', 'staging_water_polygon_candidates'),
                ('admin_area', 'staging_admin_area_candidates'),
                ('admin_area_name', 'staging_admin_area_name_candidates'),
                ('bus_stop', 'staging_bus_stop_candidates'),
                ('bus_stop_name', 'staging_bus_stop_name_candidates'),
                ('bus_route', 'staging_bus_route_candidates'),
                ('bus_route_name', 'staging_bus_route_name_candidates'),
                ('bus_route_variant', 'staging_bus_route_variant_candidates'),
                ('bus_route_stop', 'staging_bus_route_stop_candidates'),
                ('search_name', 'staging_search_name_candidates'),
                ('search_address', 'staging_search_address_candidates'),
                ('routing_barrier', 'staging_routing_barrier_candidates')
        ) AS targets(entity_family, table_name)
    LOOP
        IF to_regclass(format('%I.%I', v_staging_schema, target.table_name)) IS NULL THEN
            INSERT INTO stage05_final_target_counts (entity_family, target_table, row_count, status, note)
            VALUES (
                target.entity_family,
                format('%s.%s', v_staging_schema, target.table_name),
                NULL,
                'WARN',
                'Target table missing; extraction skipped for this family.'
            );
        ELSE
            q := format(
                'SELECT count(*)::bigint FROM %I.%I WHERE source_snapshot_id = $1',
                v_staging_schema,
                target.table_name
            );
            EXECUTE q INTO v_count USING v_source_snapshot_id;

            INSERT INTO stage05_final_target_counts (entity_family, target_table, row_count, status, note)
            VALUES (
                target.entity_family,
                format('%s.%s', v_staging_schema, target.table_name),
                v_count,
                'PASS',
                CASE
                    WHEN v_count = 0 THEN 'No rows for this source snapshot. This is valid when source data does not support this family.'
                    ELSE 'Rows present for this source snapshot.'
                END
            );
        END IF;
    END LOOP;

    UPDATE stage05_final_target_counts AS final_counts
    SET status = 'WARN',
        note = 'No route-stop sequence created: ordered relation stop/platform members are unavailable in current raw_payload.'
    WHERE final_counts.entity_family = 'bus_route_stop'
      AND final_counts.row_count = 0
      AND EXISTS (
          SELECT 1
          FROM stage05_report AS report
          WHERE report.section = 'bus_route_extraction'
            AND report.entity_family = 'bus_route_stop'
            AND report.status = 'WARN'
      );
END
$stage05_final_counts$;

SELECT
    'stage05_log' AS output_type,
    section,
    entity_family,
    target_table,
    metric,
    value_n,
    status,
    note
FROM stage05_report
ORDER BY
    CASE section
        WHEN 'raw_counts' THEN 1
        WHEN 'target_readiness' THEN 2
        WHEN 'point_extraction' THEN 3
        WHEN 'line_extraction' THEN 4
        WHEN 'bus_route_extraction' THEN 5
        WHEN 'polygon_extraction' THEN 6
        ELSE 99
    END,
    entity_family,
    target_table;

SELECT
    'stage05_final_target_counts' AS section,
    entity_family,
    target_table,
    row_count,
    status,
    note
FROM stage05_final_target_counts
ORDER BY
    CASE entity_family
        WHEN 'place' THEN 1
        WHEN 'place_name' THEN 2
        WHEN 'road' THEN 3
        WHEN 'road_name' THEN 4
        WHEN 'routing_road' THEN 5
        WHEN 'building' THEN 6
        WHEN 'address' THEN 7
        WHEN 'address_component' THEN 8
        WHEN 'landuse' THEN 9
        WHEN 'water_line' THEN 10
        WHEN 'water_polygon' THEN 11
        WHEN 'admin_area' THEN 12
        WHEN 'admin_area_name' THEN 13
        WHEN 'bus_stop' THEN 14
        WHEN 'bus_stop_name' THEN 15
        WHEN 'bus_route' THEN 16
        WHEN 'bus_route_name' THEN 17
        WHEN 'bus_route_variant' THEN 18
        WHEN 'bus_route_stop' THEN 19
        WHEN 'search_name' THEN 20
        WHEN 'search_address' THEN 21
        WHEN 'routing_barrier' THEN 22
        ELSE 99
    END;

SELECT
    'stage05_summary' AS section,
    (SELECT coalesce(sum(value_n), 0) FROM stage05_report WHERE section = 'raw_counts') AS raw_rows_for_snapshot,
    (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'PASS') AS pass_count,
    (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'WARN') + (SELECT count(*) FROM stage05_report WHERE status = 'WARN') AS warn_count,
    (SELECT count(*) FROM stage05_report WHERE status = 'FAIL') AS fail_count,
    CASE
        WHEN (SELECT count(*) FROM stage05_report WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'WARN') > 0
          OR (SELECT count(*) FROM stage05_report WHERE status = 'WARN') > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status
;

COMMIT;
