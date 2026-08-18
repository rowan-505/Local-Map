-- =============================================================================
-- Stage 05: raw_to_staging (E2 foundation)
-- Shared raw -> staging context, readiness checks, and extraction conventions.
--
-- This file now includes point-based Stage E extraction. It does not touch core
-- and does not touch Supabase.
--
-- Staging refresh policy (current snapshot only):
--   1. DELETE enabled-family staging rows for this source_snapshot_id
--      (see pipeline_stage05_reset.sql; children deleted before parents)
--   2. INSERT regenerated candidates from raw
--   3. Write deterministic normalized_hash + fingerprints
-- Previous-snapshot staging rows are preserved for F1 comparison.
-- Manual review data lives only in Supabase import_review, not local staging.
--
-- Existing UPDATE / ON CONFLICT / NOT EXISTS insert guards remain as safety
-- nets, but after the snapshot reset they normally insert a full fresh set.
--
-- Input psql variables:
--   snapshot_version
--   raw_schema     optional, defaults to raw
--   staging_schema optional, defaults to staging
--   entity_families optional; default all (see pipeline_entity_families.sql)
--     admin_areas  → admin area + admin area name staging only
--     roads        → road + road name (+ routing_road when routing_roads selected) only
--     all          → full Stage 05 extraction (current behavior)
--   Unselected families skip DDL prep, extraction blocks, and final counts.
--
-- Reusable extraction patterns for later Stage E insert blocks:
--   external_id = system.pipeline_osm_external_id(osm_feature_type, osm_id)
--     → canonical osm:node:<id> | osm:way:<id> | osm:relation:<id>
--     (see pipeline_source_identity.sql; legacy osm:N|W|R matched in Stage 07)
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
--
-- Building names (normalized_data.names): Stage 05 calls
-- system.pipeline_extract_building_names(tags). That function is defined in
-- Supabase migration 153 (153_building_names_canonical_my_en_und.sql). Apply
-- migration 153 on the local DB before running Stage 05 for buildings;
-- this file does not duplicate the function.
--
-- Source feature classification:
--   Raw OSM rows remain untouched. Stage 05 derives classification metadata from
--   raw tags into staging rows only. A single source feature can produce a place
--   candidate, an address candidate, and a place-address-link candidate.
--   Address components are built only from address tags; source names never become
--   address components.
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
\if :{?entity_families}
\else
\set entity_families 'all'
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

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql
\ir pipeline_tmp_import_mode.sql
\ir pipeline_settlements.sql
\ir pipeline_osm_category_normalize.sql
-- pipeline_township_assignment.sql retired: required local core.* and local admin IDs.
-- Township assign for IR uses Stage 08c + pipeline_prod_admin_assign.sql (prod_mirror).

CREATE TEMP TABLE IF NOT EXISTS stage05_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    boundary_id bigint,
    boundary_mode text NOT NULL
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
        boundary_id,
        boundary_mode
    )
    SELECT
        snapshot.id,
        snapshot.snapshot_version,
        snapshot.region_code,
        snapshot.boundary_id,
        CASE
            WHEN snapshot.boundary_id IS NULL THEN 'WHOLE_REGION'
            ELSE 'CLIPPED'
        END
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
    ctx.boundary_id,
    ctx.boundary_mode
FROM stage05_context AS ctx;

-- Delete current-snapshot staging for enabled families, then regenerate below.
-- Previous snapshots are not touched. Prefer delete+regenerate over upsert.
\ir pipeline_stage05_reset.sql

DO $stage05_raw_counts$
DECLARE
    v_raw_schema text;
    v_source_snapshot_id bigint;
    v_import_mode text;
    q text;
    v_count bigint;
    v_total bigint := 0;
BEGIN
    SELECT p.raw_schema
    INTO v_raw_schema
    FROM stage05_params AS p;

    SELECT ctx.source_snapshot_id
    INTO v_source_snapshot_id
    FROM stage05_context AS ctx;

    SELECT mode.import_mode
    INTO v_import_mode
    FROM _pipeline_tmp_import_mode AS mode;

    IF to_regclass(format('%I.raw_osm_points', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_points does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_lines', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_lines does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_polygons', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_polygons does not exist', v_raw_schema;
    END IF;

    IF v_import_mode IN ('full', 'roads_only') THEN
        q := format(
            'select count(*)::bigint from %I.raw_osm_lines where source_snapshot_id = $1',
            v_raw_schema
        );
        EXECUTE q INTO v_count USING v_source_snapshot_id;
        v_total := v_total + coalesce(v_count, 0);

        INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
        VALUES ('raw_counts', 'lines', format('%s.raw_osm_lines', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);
    END IF;

    IF v_import_mode IN ('full', 'admin_areas_only') THEN
        q := format(
            'select count(*)::bigint from %I.raw_osm_polygons where source_snapshot_id = $1',
            v_raw_schema
        );
        EXECUTE q INTO v_count USING v_source_snapshot_id;
        v_total := v_total + coalesce(v_count, 0);

        INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
        VALUES ('raw_counts', 'polygons', format('%s.raw_osm_polygons', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);
    END IF;

    IF v_import_mode = 'full' THEN
        q := format(
            'select count(*)::bigint from %I.raw_osm_points where source_snapshot_id = $1',
            v_raw_schema
        );
        EXECUTE q INTO v_count USING v_source_snapshot_id;
        v_total := v_total + coalesce(v_count, 0);

        INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
        VALUES ('raw_counts', 'points', format('%s.raw_osm_points', v_raw_schema), 'rows_for_snapshot', v_count, 'PASS', NULL);
    END IF;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'no raw OSM rows found for source_snapshot_id % (import_mode=%)', v_source_snapshot_id, v_import_mode;
    END IF;
END
$stage05_raw_counts$;

WITH required_targets(entity_family, table_name) AS (
    VALUES
        ('place', 'staging_place_candidates'),
        ('place_name', 'staging_place_name_candidates'),
        ('place_address_link', 'staging_place_address_link_candidates'),
        ('road', 'staging_road_candidates'),
        ('road_name', 'staging_road_name_candidates'),
        ('building', 'staging_building_candidates'),
        ('landuse', 'staging_landuse_candidates'),
        ('protected_area', 'staging_protected_area_candidates'),
        ('water_line', 'staging_water_line_candidates'),
        ('coastline', 'staging_coastline_candidates'),
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
   AND tables.table_type = 'BASE TABLE'
WHERE pg_temp.pipeline_stage05_extraction_enabled(targets.entity_family);

DO $stage05_prepare_classification_targets$
DECLARE
    v_staging_schema text;
BEGIN
    SELECT p.staging_schema
    INTO v_staging_schema
    FROM stage05_params AS p;

    -- Staging-only metadata columns. These mirror the remote review classification
    -- shape while keeping raw.raw_osm_* as immutable source truth.
    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.staging_place_candidates', v_staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_place_candidates
                ADD COLUMN IF NOT EXISTS source_classification text null,
                ADD COLUMN IF NOT EXISTS has_place_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS has_address_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS address_strength text null,
                ADD COLUMN IF NOT EXISTS source_name text null,
                ADD COLUMN IF NOT EXISTS source_type_hint text null,
                ADD COLUMN IF NOT EXISTS source_category_hint text null',
            v_staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_candidates_source_classification_idx
                ON %I.staging_place_candidates (source_classification)',
            v_staging_schema
        );
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.staging_address_candidates', v_staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_address_candidates
                ADD COLUMN IF NOT EXISTS source_classification text null,
                ADD COLUMN IF NOT EXISTS has_place_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS has_address_evidence boolean not null default false,
                ADD COLUMN IF NOT EXISTS address_strength text null,
                ADD COLUMN IF NOT EXISTS source_name text null,
                ADD COLUMN IF NOT EXISTS source_type_hint text null,
                ADD COLUMN IF NOT EXISTS source_category_hint text null',
            v_staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_address_candidates_source_classification_idx
                ON %I.staging_address_candidates (source_classification)',
            v_staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_address_candidates_address_strength_idx
                ON %I.staging_address_candidates (address_strength)',
            v_staging_schema
        );
    END IF;

    -- Link candidates are local staging rows only. They are keyed by the same
    -- snapshot + external_id lineage as places/addresses, but in their own family.
    IF pg_temp.pipeline_stage05_extraction_enabled('place_address_link')
       AND to_regclass(format('%I.staging_place_candidates', v_staging_schema)) IS NOT NULL
       AND to_regclass(format('%I.staging_address_candidates', v_staging_schema)) IS NOT NULL THEN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I.staging_place_address_link_candidates (
                id bigint generated by default as identity primary key,
                source_snapshot_id bigint not null references system.system_source_snapshots(id),
                external_id text not null,
                place_candidate_id bigint null references %I.staging_place_candidates(id) on delete cascade,
                address_candidate_id bigint null references %I.staging_address_candidates(id) on delete cascade,
                relation_type text not null default ''located_at'',
                is_primary boolean not null default true,
                source_classification text not null,
                address_strength text not null,
                confidence_score numeric(6,2) null,
                match_status text not null default ''new_candidate'',
                auto_action text null,
                review_status text not null default ''pending'',
                source_refs jsonb not null default ''{}''::jsonb,
                normalized_data jsonb not null default ''{}''::jsonb,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )',
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE format(
            'CREATE UNIQUE INDEX IF NOT EXISTS staging_place_address_link_candidates_uq
                ON %I.staging_place_address_link_candidates (source_snapshot_id, external_id)',
            v_staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_address_link_candidates_place_idx
                ON %I.staging_place_address_link_candidates (place_candidate_id)',
            v_staging_schema
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS staging_place_address_link_candidates_address_idx
                ON %I.staging_place_address_link_candidates (address_candidate_id)',
            v_staging_schema
        );

        UPDATE stage05_report
        SET value_n = 1,
            status = 'PASS',
            note = NULL
        WHERE section = 'target_readiness'
          AND entity_family = 'place_address_link';
    END IF;
END
$stage05_prepare_classification_targets$;

DROP TABLE IF EXISTS stage05_source_feature_classification;
CREATE TEMP TABLE stage05_source_feature_classification (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    raw_table text NOT NULL,
    raw_id bigint NOT NULL,
    source_feature_family text NOT NULL,
    osm_id text NOT NULL,
    osm_feature_type text NOT NULL,
    external_id text NOT NULL,
    tags jsonb NOT NULL,
    geom geometry(Geometry, 4326),
    point_geom geometry(Point, 4326),
    source_classification text NOT NULL,
    has_place_evidence boolean NOT NULL,
    has_address_evidence boolean NOT NULL,
    address_strength text NOT NULL,
    source_name text,
    source_type_hint text,
    source_category_hint text,
    house_number text,
    street_name text,
    quarter text,
    suburb text,
    township text,
    city text,
    district text,
    state_region text,
    postcode text,
    country text,
    full_address text,
    address_component_count integer NOT NULL
) ON COMMIT DROP;

TRUNCATE stage05_source_feature_classification;

-- Classification rules:
--   place evidence = real name tag plus a POI/category tag.
--   address evidence = addr:* tags or address_components metadata.
--   address_strength:
--     none    -> no address evidence
--     weak    -> address evidence exists but only one weak/locality signal
--     partial -> at least two address components, or street + city/postcode
--     strong  -> house number + street
--     full    -> addr:full, or house number + street + city/postcode/country
--   source_classification:
--     place_with_address -> place evidence + partial/strong/full address
--     place_only         -> place evidence without useful address
--     address_only       -> useful address without place evidence
--     weak_address       -> weak address without place evidence
--     ignore             -> neither place nor address evidence
DO $stage05_classify_source_features$
DECLARE
    v_raw_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    q text;
    v_count bigint;
BEGIN
    SELECT p.raw_schema
    INTO v_raw_schema
    FROM stage05_params AS p;

    SELECT c.source_snapshot_id, c.snapshot_version, c.region_code
    INTO v_source_snapshot_id, v_snapshot_version, v_region_code
    FROM stage05_context AS c;

    IF NOT pg_temp.pipeline_entity_family_enabled_any(ARRAY['places', 'addresses', 'place_address_links']) THEN
        INSERT INTO stage05_report VALUES (
            'source_classification', 'all', 'stage05_source_feature_classification',
            'skipped_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes place/address classification.'
        );
        RETURN;
    END IF;

    q := format(
        $q$
        WITH raw_features AS (
            SELECT
                'raw_osm_points'::text AS raw_table,
                'point'::text AS source_feature_family,
                raw.id AS raw_id,
                raw.osm_id,
                raw.osm_feature_type,
                coalesce(raw.tags, '{}'::jsonb) AS tags,
                raw.geom::geometry(Geometry, 4326) AS geom,
                raw.geom::geometry(Point, 4326) AS point_geom
            FROM %I.raw_osm_points AS raw
            WHERE raw.source_snapshot_id = $1
              AND raw.geom IS NOT NULL
            UNION ALL
            SELECT
                'raw_osm_lines'::text,
                'line'::text,
                raw.id,
                raw.osm_id,
                raw.osm_feature_type,
                coalesce(raw.tags, '{}'::jsonb),
                raw.geom::geometry(Geometry, 4326),
                ST_PointOnSurface(raw.geom)::geometry(Point, 4326)
            FROM %I.raw_osm_lines AS raw
            WHERE raw.source_snapshot_id = $1
              AND raw.geom IS NOT NULL
            UNION ALL
            SELECT
                'raw_osm_polygons'::text,
                'polygon'::text,
                raw.id,
                raw.osm_id,
                raw.osm_feature_type,
                coalesce(raw.tags, '{}'::jsonb),
                raw.geom::geometry(Geometry, 4326),
                ST_PointOnSurface(raw.geom)::geometry(Point, 4326)
            FROM %I.raw_osm_polygons AS raw
            WHERE raw.source_snapshot_id = $1
              AND raw.geom IS NOT NULL
        ),
        extracted AS (
            SELECT
                rf.*,
                system.pipeline_osm_external_id(rf.osm_feature_type, rf.osm_id) AS external_id,
                CASE
                    WHEN system.pipeline_is_settlement_place(rf.tags->>'place')
                        THEN system.pipeline_settlement_canonical_name(rf.tags)
                    ELSE nullif(btrim(coalesce(
                        rf.tags->>'name',
                        rf.tags->>'name:en',
                        rf.tags->>'name:my',
                        rf.tags->>'name:mm',
                        rf.tags->>'name:my-MM',
                        ''
                    )), '')
                END AS source_name,
                nullif(btrim(coalesce(
                    CASE
                        WHEN system.pipeline_is_settlement_place(rf.tags->>'place')
                            THEN system.pipeline_normalize_settlement_place(rf.tags->>'place')
                        ELSE NULL
                    END,
                    rf.tags->>'amenity',
                    rf.tags->>'shop',
                    rf.tags->>'tourism',
                    rf.tags->>'leisure',
                    rf.tags->>'office',
                    rf.tags->>'healthcare',
                    rf.tags->>'public_transport',
                    rf.tags->>'religion',
                    rf.tags->>'social_facility',
                    rf.tags->>'education',
                    rf.tags->>'school',
                    CASE WHEN rf.tags ? 'building' THEN 'building' END,
                    ''
                )), '') AS source_type_hint,
                CASE
                    WHEN system.pipeline_is_settlement_place(rf.tags->>'place') THEN 'settlement'
                    WHEN rf.tags->>'amenity' = 'school' OR rf.tags ?| array['education','school'] THEN 'education'
                    WHEN rf.tags ? 'amenity' THEN 'amenity'
                    WHEN rf.tags ? 'shop' THEN 'shop'
                    WHEN rf.tags ? 'tourism' THEN 'tourism'
                    WHEN rf.tags ? 'leisure' THEN 'leisure'
                    WHEN rf.tags ? 'office' THEN 'office'
                    WHEN rf.tags ? 'healthcare' THEN 'healthcare'
                    WHEN rf.tags ? 'public_transport' THEN 'public_transport'
                    WHEN rf.tags ? 'religion' THEN 'religion'
                    WHEN rf.tags ? 'social_facility' THEN 'social_facility'
                    WHEN rf.tags ? 'building' THEN 'building'
                    ELSE NULL
                END AS source_category_hint,
                nullif(btrim(rf.tags->>'addr:housenumber'), '') AS house_number,
                nullif(btrim(rf.tags->>'addr:street'), '') AS street_name,
                nullif(btrim(rf.tags->>'addr:quarter'), '') AS quarter,
                nullif(btrim(rf.tags->>'addr:suburb'), '') AS suburb,
                nullif(btrim(rf.tags->>'addr:township'), '') AS township,
                nullif(btrim(rf.tags->>'addr:city'), '') AS city,
                nullif(btrim(rf.tags->>'addr:district'), '') AS district,
                nullif(btrim(rf.tags->>'addr:state'), '') AS state_region,
                nullif(btrim(rf.tags->>'addr:postcode'), '') AS postcode,
                nullif(btrim(rf.tags->>'addr:country'), '') AS country,
                nullif(btrim(rf.tags->>'addr:full'), '') AS full_address,
                (
                    SELECT count(*)::integer
                    FROM jsonb_object_keys(rf.tags) AS k(key)
                    WHERE k.key LIKE 'addr:%%'
                      AND nullif(btrim(rf.tags->>k.key), '') IS NOT NULL
                ) AS address_component_count
            FROM raw_features AS rf
        ),
        evidence AS (
            SELECT
                e.*,
                system.pipeline_is_settlement_place(e.tags->>'place') AS has_settlement_evidence,
                (
                    system.pipeline_is_settlement_place(e.tags->>'place')
                    OR (
                        e.source_name IS NOT NULL
                        AND e.source_type_hint IS NOT NULL
                        AND (
                            e.tags ?| array[
                                'amenity','shop','tourism','leisure','office','healthcare',
                                'public_transport','religion','building','social_facility',
                                'education','school'
                            ]
                            OR e.tags->>'amenity' = 'school'
                        )
                    )
                ) AS has_place_evidence,
                (
                    e.address_component_count > 0
                    OR e.tags ? 'address_components'
                ) AS has_address_evidence
            FROM extracted AS e
        ),
        classified AS (
            SELECT
                ev.*,
                CASE
                    WHEN NOT ev.has_address_evidence THEN 'none'
                    WHEN ev.full_address IS NOT NULL
                         OR (
                             ev.house_number IS NOT NULL
                             AND ev.street_name IS NOT NULL
                             AND (ev.city IS NOT NULL OR ev.postcode IS NOT NULL OR ev.country IS NOT NULL)
                         ) THEN 'full'
                    WHEN ev.house_number IS NOT NULL AND ev.street_name IS NOT NULL THEN 'strong'
                    WHEN (ev.street_name IS NOT NULL AND (ev.city IS NOT NULL OR ev.postcode IS NOT NULL))
                         OR ev.address_component_count >= 2 THEN 'partial'
                    ELSE 'weak'
                END AS address_strength
            FROM evidence AS ev
        )
        INSERT INTO stage05_source_feature_classification (
            source_snapshot_id, snapshot_version, region_code, raw_table, raw_id,
            source_feature_family, osm_id, osm_feature_type, external_id, tags,
            geom, point_geom, source_classification, has_place_evidence,
            has_address_evidence, address_strength, source_name, source_type_hint,
            source_category_hint, house_number, street_name, quarter, suburb,
            township, city, district, state_region, postcode, country,
            full_address, address_component_count
        )
        SELECT
            $1,
            $2,
            $3,
            c.raw_table,
            c.raw_id,
            c.source_feature_family,
            c.osm_id,
            c.osm_feature_type,
            c.external_id,
            c.tags,
            c.geom,
            c.point_geom,
            CASE
                WHEN c.has_place_evidence
                     AND c.address_strength IN ('partial', 'strong', 'full') THEN 'place_with_address'
                WHEN c.has_place_evidence THEN 'place_only'
                WHEN c.address_strength IN ('partial', 'strong', 'full') THEN 'address_only'
                WHEN c.address_strength = 'weak' THEN 'weak_address'
                ELSE 'ignore'
            END,
            c.has_place_evidence,
            c.has_address_evidence,
            c.address_strength,
            c.source_name,
            c.source_type_hint,
            c.source_category_hint,
            c.house_number,
            c.street_name,
            c.quarter,
            c.suburb,
            c.township,
            c.city,
            c.district,
            c.state_region,
            c.postcode,
            c.country,
            c.full_address,
            c.address_component_count
        FROM classified AS c
        $q$,
        v_raw_schema,
        v_raw_schema,
        v_raw_schema
    );
    EXECUTE q USING v_source_snapshot_id, v_snapshot_version, v_region_code;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- National runs join this temp table by external_id. Without indexes the
    -- place-name / address extract paths can take many hours (full scans).
    CREATE INDEX stage05_sfc_external_id_idx
        ON stage05_source_feature_classification (source_snapshot_id, external_id);
    CREATE INDEX stage05_sfc_place_evidence_idx
        ON stage05_source_feature_classification (source_snapshot_id)
        WHERE has_place_evidence;
    ANALYZE stage05_source_feature_classification;

    INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
    VALUES (
        'source_classification',
        'source_features',
        'stage05_source_feature_classification',
        'classified_rows',
        v_count,
        'PASS',
        'Classified raw points, lines, and polygons from tags without modifying raw tables.'
    );
END
$stage05_classify_source_features$;

DO $stage05_point_extraction$
DECLARE
    v_raw_schema text;
    v_staging_schema text;
    v_source_snapshot_id bigint;
    v_snapshot_version text;
    v_region_code text;
    v_place_class_id bigint;
    v_settlement_place_class_id bigint;
    v_available bigint;
    v_inserted bigint;
    q text;

    has_place boolean;
    has_place_name boolean;
    has_bus_stop boolean;
    has_bus_stop_name boolean;
    has_address boolean;
    has_address_component boolean;
    has_place_address_link boolean;
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
    has_place_address_link := to_regclass(format('%I.staging_place_address_link_candidates', v_staging_schema)) IS NOT NULL;
    has_search_name := to_regclass(format('%I.staging_search_name_candidates', v_staging_schema)) IS NOT NULL;
    has_search_address := to_regclass(format('%I.staging_search_address_candidates', v_staging_schema)) IS NOT NULL;
    has_barrier := to_regclass(format('%I.staging_routing_barrier_candidates', v_staging_schema)) IS NOT NULL;

    IF NOT pg_temp.pipeline_stage05_extraction_any_enabled(ARRAY[
        'place', 'place_name', 'bus_stop', 'bus_stop_name', 'address', 'address_component',
        'place_address_link', 'search_name', 'search_address', 'routing_barrier'
    ]) THEN
        INSERT INTO stage05_report VALUES (
            'point_extraction', 'all', NULL, 'skipped', 0, 'SKIP',
            'ENTITY_FAMILIES filter excludes all point-based staging families.'
        );
        RETURN;
    END IF;

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

    -- Prefer explicit settlement class when present; fall back to landmark/poi.
    SELECT pc.id
    INTO v_settlement_place_class_id
    FROM ref.ref_place_classes AS pc
    ORDER BY CASE pc.code
        WHEN 'settlement' THEN 1
        WHEN 'landmark' THEN 2
        WHEN 'poi' THEN 3
        ELSE 100
    END, pc.id
    LIMIT 1;

    -- ---------------------------------------------------------------------
    -- A. Place candidates from classified source features.
    -- Place evidence = POI (named amenity/shop/…) OR settlement (place=*).
    -- Settlements map to settlement categories and prefer Myanmar names.
    -- ---------------------------------------------------------------------
    SELECT count(*)::bigint
    INTO v_available
    FROM stage05_source_feature_classification AS cls
    WHERE cls.source_snapshot_id = v_source_snapshot_id
      AND cls.has_place_evidence;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('place') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes places.');
    ELSIF NOT has_place THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped place candidate extraction.');
    ELSIF v_place_class_id IS NULL THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'ref.ref_place_classes has no rows; skipped place candidate extraction because place_class_id is required.');
    ELSE
        RAISE NOTICE 'stage05_point_extraction: place candidates — available_rows=% (admin deferred to Stage 08c prod_mirror)', v_available;
        q := format(
            $q$
            WITH src AS (
                SELECT
                    cls.*,
                    system.pipeline_is_settlement_place(cls.tags->>'place') AS is_settlement,
                    system.pipeline_normalize_settlement_place(cls.tags->>'place') AS settlement_place,
                    -- Do NOT assign local core admin IDs here. Stage 08c writes
                    -- production township ids from prod_mirror into normalized_data.admin_area_id.
                    NULL::bigint AS admin_area_id,
                    cat.id AS settlement_category_id
                FROM stage05_source_feature_classification AS cls
                LEFT JOIN ref.ref_poi_categories AS cat
                    ON cat.code = system.pipeline_settlement_category_code(cls.tags->>'place')
                WHERE cls.source_snapshot_id = $1
                  AND cls.has_place_evidence
                  AND cls.point_geom IS NOT NULL
                  -- staging_place_candidates.canonical_name is NOT NULL;
                  -- settlements without names are skipped (required-name policy).
                  AND nullif(btrim(cls.source_name), '') IS NOT NULL
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
                    poi_category_id,
                    point_geom,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    source_classification,
                    has_place_evidence,
                    has_address_evidence,
                    address_strength,
                    source_name,
                    source_type_hint,
                    source_category_hint,
                    normalized_data,
                    source_refs
                )
                SELECT
                    $1,
                    src.raw_id,
                    CASE src.source_feature_family
                        WHEN 'point' THEN 'osm_point'
                        WHEN 'line' THEN 'osm_line'
                        WHEN 'polygon' THEN 'osm_polygon'
                        ELSE 'osm'
                    END,
                    src.external_id,
                    src.source_name,
                    CASE
                        WHEN src.is_settlement THEN src.settlement_place
                        ELSE src.source_type_hint
                    END,
                    CASE
                        WHEN src.is_settlement THEN coalesce($5, $2)
                        ELSE $2
                    END,
                    CASE WHEN src.is_settlement THEN src.settlement_category_id ELSE NULL END,
                    src.point_geom,
                    CASE
                        WHEN src.is_settlement AND src.source_name IS NOT NULL THEN 65
                        WHEN src.is_settlement THEN 40
                        WHEN src.source_classification = 'place_with_address' THEN 85
                        ELSE 50
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    CASE
                        WHEN src.is_settlement THEN 'settlement'
                        ELSE src.source_classification
                    END,
                    src.has_place_evidence,
                    src.has_address_evidence,
                    src.address_strength,
                    src.source_name,
                    CASE
                        WHEN src.is_settlement THEN src.settlement_place
                        ELSE src.source_type_hint
                    END,
                    CASE
                        WHEN src.is_settlement THEN 'settlement'
                        ELSE src.source_category_hint
                    END,
                    jsonb_strip_nulls(jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'source_classification', CASE WHEN src.is_settlement THEN 'settlement' ELSE src.source_classification END,
                        'has_place_evidence', src.has_place_evidence,
                        'has_address_evidence', src.has_address_evidence,
                        'address_strength', src.address_strength,
                        'source_name', src.source_name,
                        'source_type_hint', CASE WHEN src.is_settlement THEN src.settlement_place ELSE src.source_type_hint END,
                        'source_category_hint', CASE WHEN src.is_settlement THEN 'settlement' ELSE src.source_category_hint END,
                        'is_settlement', src.is_settlement,
                        'settlement_place', src.settlement_place,
                        'myanmar_name', system.pipeline_settlement_myanmar_name(src.tags),
                        'english_name', system.pipeline_settlement_english_name(src.tags),
                        'duplicate_threshold_m', system.pipeline_places_duplicate_threshold_m(
                            CASE WHEN src.is_settlement THEN src.settlement_place ELSE src.source_type_hint END
                        ),
                        'selected_fields', jsonb_strip_nulls(jsonb_build_object(
                            'place', src.tags->>'place',
                            'population', src.tags->>'population',
                            'name', src.tags->>'name',
                            'name:my', src.tags->>'name:my',
                            'name:mm', src.tags->>'name:mm',
                            'name:en', src.tags->>'name:en',
                            'alt_name', src.tags->>'alt_name',
                            'old_name', src.tags->>'old_name',
                            'official_name', src.tags->>'official_name',
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
                        'generated_fallback_label', NULL
                    )),
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $3,
                        'region_code', $4,
                        'raw_table', src.raw_table,
                        'raw_id', src.raw_id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type,
                        'source_classification', CASE WHEN src.is_settlement THEN 'settlement' ELSE src.source_classification END,
                        'external_id', src.external_id,
                        'place', src.tags->>'place',
                        'population', src.tags->>'population'
                    )
                FROM src
                -- Stage 05 reset already deleted this snapshot's place rows.
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING
            v_source_snapshot_id,
            v_place_class_id,
            v_snapshot_version,
            v_region_code,
            v_settlement_place_class_id;
        INSERT INTO stage05_report VALUES ('point_extraction', 'place', format('%s.staging_place_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Place name candidates: real OSM name tags only.
    -- Do not insert fake names into name candidate tables.
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('place_name') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_name', format('%s.staging_place_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes places.');
    ELSIF has_place AND has_place_name THEN
        -- Stage 05 reset already deleted this snapshot's place_name rows, so skip the
        -- per-row NOT EXISTS anti-join (that was an earlier multi-hour bottleneck).
        -- Read tags from place.normalized_data (already stored at place insert). Do NOT
        -- join stage05_source_feature_classification here — that join scanned the full
        -- national classification temp table and ran for many hours.
        RAISE NOTICE 'stage05_point_extraction: place name candidates — inserting from staging places';
        q := format(
            $q$
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
                    'raw_table', names.raw_table,
                    'raw_id', names.raw_id,
                    'osm_id', names.osm_id,
                    'osm_feature_type', names.osm_feature_type,
                    'source_tag', names.source_tag
                ),
                jsonb_build_object('source_tag', names.source_tag)
            FROM (
                SELECT DISTINCT ON (
                    place.id,
                    n.language_code,
                    n.name_type,
                    n.name
                )
                    place.id AS place_candidate_id,
                    place.external_id,
                    place.source_refs->>'raw_table' AS raw_table,
                    nullif(place.source_refs->>'raw_id', '')::bigint AS raw_id,
                    place.source_refs->>'osm_id' AS osm_id,
                    place.source_refs->>'osm_feature_type' AS osm_feature_type,
                    n.source_tag,
                    n.name,
                    n.language_code,
                    n.name_type,
                    n.is_primary,
                    n.search_weight
                FROM %I.staging_place_candidates AS place
                CROSS JOIN LATERAL (
                    SELECT coalesce(place.normalized_data->'tags', '{}'::jsonb) AS tags
                ) AS t
                CROSS JOIN LATERAL (
                    VALUES
                        ('name', t.tags->>'name', 'und', 'official', true, 100),
                        ('name:en', t.tags->>'name:en', 'en', 'official', true, 100),
                        ('name:my', t.tags->>'name:my', 'my', 'official', true, 100),
                        ('name:mm', t.tags->>'name:mm', 'my', 'official', true, 100),
                        ('name:my-MM', t.tags->>'name:my-MM', 'my', 'official', true, 100),
                        ('official_name', t.tags->>'official_name', 'und', 'official', false, 90),
                        ('alt_name', t.tags->>'alt_name', 'und', 'alternate', false, 80),
                        ('old_name', t.tags->>'old_name', 'und', 'old', false, 60),
                        ('short_name', t.tags->>'short_name', 'und', 'short', false, 90)
                ) AS n(source_tag, name, language_code, name_type, is_primary, search_weight)
                WHERE place.source_snapshot_id = $1
                  AND n.name IS NOT NULL
                  AND btrim(n.name) <> ''
                ORDER BY
                    place.id,
                    n.language_code,
                    n.name_type,
                    n.name,
                    n.search_weight DESC,
                    n.source_tag
            ) AS names
            $q$,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q USING v_source_snapshot_id, v_snapshot_version;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        RAISE NOTICE 'stage05_point_extraction: place name candidates done — inserted=%', coalesce(v_inserted, 0);
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('bus_stop') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop', format('%s.staging_bus_stop_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes bus_stops.');
    ELSIF has_bus_stop THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'name:en', ''),
                        nullif(raw.tags->>'name:my', ''),
                        nullif(raw.tags->>'name:mm', ''),
                        nullif(raw.tags->>'name:my-MM', ''),
                        nullif(raw.tags->>'operator', ''),
                        nullif(raw.tags->>'network', ''),
                        system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id)
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
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('bus_stop_name') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'bus_stop_name', format('%s.staging_bus_stop_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes bus_stops.');
    ELSIF has_bus_stop AND has_bus_stop_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.tags,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
    -- E. Address candidates from classified source features.
    -- Address evidence is addr:* or address_components. Source names remain
    -- metadata only and are never copied into address components.
    -- ---------------------------------------------------------------------
    SELECT count(*)::bigint
    INTO v_available
    FROM stage05_source_feature_classification AS cls
    WHERE cls.source_snapshot_id = v_source_snapshot_id
      AND cls.has_address_evidence;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('address') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes addresses.');
    ELSIF has_address THEN
        q := format(
            $q$
            WITH src AS (
                SELECT *
                FROM stage05_source_feature_classification AS cls
                WHERE cls.source_snapshot_id = $1
                  AND cls.has_address_evidence
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
                    source_classification,
                    has_place_evidence,
                    has_address_evidence,
                    address_strength,
                    source_name,
                    source_type_hint,
                    source_category_hint,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    src.raw_table,
                    src.raw_id,
                    src.external_id,
                    src.source_feature_family,
                    src.full_address,
                    src.house_number,
                    src.street_name,
                    src.quarter,
                    src.suburb,
                    src.township,
                    src.city,
                    src.district,
                    src.state_region,
                    src.postcode,
                    coalesce(src.country, 'MM'),
                    src.point_geom,
                    src.geom,
                    CASE src.address_strength
                        WHEN 'full' THEN 85
                        WHEN 'strong' THEN 75
                        WHEN 'partial' THEN 60
                        WHEN 'weak' THEN 35
                        ELSE 0
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    src.source_classification,
                    src.has_place_evidence,
                    src.has_address_evidence,
                    src.address_strength,
                    src.source_name,
                    src.source_type_hint,
                    src.source_category_hint,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', src.raw_table,
                        'raw_id', src.raw_id,
                        'osm_id', src.osm_id,
                        'osm_feature_type', src.osm_feature_type,
                        'source_classification', src.source_classification,
                        'address_strength', src.address_strength
                    ),
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'source_classification', src.source_classification,
                        'has_place_evidence', src.has_place_evidence,
                        'has_address_evidence', src.has_address_evidence,
                        'address_strength', src.address_strength,
                        'source_name', src.source_name,
                        'source_type_hint', src.source_type_hint,
                        'source_category_hint', src.source_category_hint,
                        'address_component_count', src.address_component_count
                    )
                FROM src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
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
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('address_component') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes addresses.');
    ELSIF has_address AND has_address_component THEN
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
        INSERT INTO stage05_report VALUES ('point_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Components generated only from real addr:* fields and MM default country; source names are excluded.');
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Address or address-component target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- G. Place-address link candidates.
    -- Links are staged only when the same source feature has place evidence and
    -- a useful address (partial/strong/full). Weak addresses can still create an
    -- address candidate for review, but no link is staged yet.
    -- ---------------------------------------------------------------------
    SELECT count(*)::bigint
    INTO v_available
    FROM stage05_source_feature_classification AS cls
    WHERE cls.source_snapshot_id = v_source_snapshot_id
      AND cls.has_place_evidence
      AND cls.address_strength IN ('partial', 'strong', 'full');

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('place_address_link') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_address_link', format('%s.staging_place_address_link_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes place_address_links.');
    ELSIF has_place_address_link THEN
        q := format(
            $q$
            WITH link_src AS (
                SELECT
                    cls.*,
                    place.id AS place_candidate_id,
                    address.id AS address_candidate_id
                FROM stage05_source_feature_classification AS cls
                INNER JOIN %I.staging_place_candidates AS place
                    ON place.source_snapshot_id = $1
                   AND place.external_id = cls.external_id
                INNER JOIN %I.staging_address_candidates AS address
                    ON address.source_snapshot_id = $1
                   AND address.external_id = cls.external_id
                WHERE cls.source_snapshot_id = $1
                  AND cls.has_place_evidence
                  AND cls.address_strength IN ('partial', 'strong', 'full')
            ),
            inserted AS (
                INSERT INTO %I.staging_place_address_link_candidates (
                    source_snapshot_id,
                    external_id,
                    place_candidate_id,
                    address_candidate_id,
                    relation_type,
                    is_primary,
                    source_classification,
                    address_strength,
                    confidence_score,
                    match_status,
                    auto_action,
                    review_status,
                    source_refs,
                    normalized_data
                )
                SELECT
                    $1,
                    link_src.external_id,
                    link_src.place_candidate_id,
                    link_src.address_candidate_id,
                    'located_at',
                    true,
                    link_src.source_classification,
                    link_src.address_strength,
                    CASE link_src.address_strength
                        WHEN 'full' THEN 85
                        WHEN 'strong' THEN 75
                        WHEN 'partial' THEN 60
                        ELSE 0
                    END,
                    'new_candidate',
                    NULL,
                    'pending',
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', link_src.raw_table,
                        'raw_id', link_src.raw_id,
                        'osm_id', link_src.osm_id,
                        'osm_feature_type', link_src.osm_feature_type,
                        'source_classification', link_src.source_classification,
                        'address_strength', link_src.address_strength
                    ),
                    jsonb_build_object(
                        'source', 'stage05_raw_to_staging',
                        'source_classification', link_src.source_classification,
                        'address_strength', link_src.address_strength,
                        'source_name', link_src.source_name,
                        'source_type_hint', link_src.source_type_hint,
                        'source_category_hint', link_src.source_category_hint
                    )
                FROM link_src
                ON CONFLICT (source_snapshot_id, external_id) DO NOTHING
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_address_link', format('%s.staging_place_address_link_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('point_extraction', 'place_address_link', format('%s.staging_place_address_link_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped place-address link extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- H. Search name candidates from point places and bus stops
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('search_name') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes search_name sources.');
    ELSIF has_search_name THEN
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
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('search_address') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'search_address', format('%s.staging_search_address_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes addresses.');
    ELSIF has_address AND has_search_address THEN
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('routing_barrier') THEN
        INSERT INTO stage05_report VALUES ('point_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes routing_barriers.');
    ELSIF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
    v_updated bigint;
    q text;
    v_line_extraction_started_at timestamptz := clock_timestamp();

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

    IF NOT pg_temp.pipeline_stage05_extraction_any_enabled(ARRAY[
        'road', 'road_name', 'routing_road', 'water_line', 'coastline', 'search_name', 'routing_barrier'
    ]) THEN
        INSERT INTO stage05_report VALUES (
            'line_extraction', 'all', NULL, 'skipped', 0, 'SKIP',
            'ENTITY_FAMILIES filter excludes all line-based staging families.'
        );
        RETURN;
    END IF;

    RAISE NOTICE 'stage05_line_extraction: starting at %', v_line_extraction_started_at;

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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('road') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes roads.');
    ELSIF has_road THEN
        RAISE NOTICE 'stage05_line_extraction: road candidates — upserting % highway rows into %', v_available, format('%I.staging_road_candidates', v_staging_schema);

        q := format(
            $q$
            WITH raw_rows AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.geom,
                    ST_Length(raw.geom::geography) AS length_m,
                    coalesce(raw.tags, '{}'::jsonb) AS tags,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    coalesce(
                        nullif(btrim(raw.tags->>'name:my'), ''),
                        nullif(btrim(raw.tags->>'name'), ''),
                        nullif(btrim(raw.tags->>'name:en'), ''),
                        nullif(btrim(raw.tags->>'name:mm'), ''),
                        nullif(btrim(raw.tags->>'name:my-MM'), '')
                    ) AS real_name,
                    CASE lower(btrim(raw.tags->>'highway'))
                        WHEN 'motorway' THEN 'motorway'
                        WHEN 'trunk' THEN 'trunk'
                        WHEN 'primary' THEN 'primary'
                        WHEN 'secondary' THEN 'secondary'
                        WHEN 'tertiary' THEN 'tertiary'
                        WHEN 'residential' THEN 'residential'
                        WHEN 'service' THEN 'service'
                        WHEN 'track' THEN 'track'
                        WHEN 'path' THEN 'path'
                        WHEN 'footway' THEN 'path'
                        WHEN 'steps' THEN 'path'
                        WHEN 'pedestrian' THEN 'path'
                        WHEN 'unclassified' THEN 'unclassified'
                        WHEN 'road' THEN 'unclassified'
                        WHEN 'construction' THEN 'unclassified'
                        WHEN 'proposed' THEN 'unclassified'
                        ELSE 'unclassified'
                    END AS road_class_code,
                    CASE
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('yes', 'true', '1') THEN true
                        WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('no', 'false', '0') THEN false
                        WHEN raw.tags->>'junction' = 'roundabout' THEN true
                        ELSE false
                    END AS is_oneway,
                    CASE
                        WHEN lower(btrim(raw.tags->>'highway')) IN ('construction', 'proposed') THEN 60::numeric
                        WHEN lower(btrim(raw.tags->>'highway')) IN (
                            'motorway', 'trunk', 'primary', 'secondary', 'tertiary'
                        ) THEN 80::numeric
                        WHEN lower(btrim(raw.tags->>'highway')) IN ('service', 'track', 'path') THEN 55::numeric
                        WHEN coalesce(
                            raw.tags->>'name',
                            raw.tags->>'name:en',
                            raw.tags->>'name:my',
                            raw.tags->>'name:mm',
                            raw.tags->>'name:my-MM'
                        ) IS NOT NULL THEN 80::numeric
                        ELSE 65::numeric
                    END AS confidence_score
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'highway'
            ),
            src AS (
                SELECT
                    r.*,
                    coalesce(r.real_name, r.external_id) AS canonical_name,
                    rc.id AS road_class_id,
                    jsonb_strip_nulls(jsonb_build_object(
                        'tags', r.tags,
                        'highway', r.tags->>'highway',
                        'road_class', r.road_class_code,
                        'surface', r.tags->>'surface',
                        'bridge', r.tags->>'bridge',
                        'tunnel', r.tags->>'tunnel',
                        'layer', r.tags->>'layer',
                        'generated_label', CASE WHEN r.real_name IS NULL THEN r.external_id ELSE NULL END,
                        'routing', jsonb_strip_nulls(jsonb_build_object(
                            'access', r.tags->>'access',
                            'vehicle', r.tags->>'vehicle',
                            'motor_vehicle', r.tags->>'motor_vehicle',
                            'foot', r.tags->>'foot',
                            'bicycle', r.tags->>'bicycle',
                            'bus', r.tags->>'bus',
                            'hgv', r.tags->>'hgv',
                            'maxspeed', r.tags->>'maxspeed',
                            'lanes', r.tags->>'lanes',
                            'width', r.tags->>'width',
                            'smoothness', r.tags->>'smoothness',
                            'tracktype', r.tags->>'tracktype',
                            'service', r.tags->>'service',
                            'junction', r.tags->>'junction'
                        ))
                    )) AS normalized_data,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_lines',
                        'raw_id', r.raw_id,
                        'osm_id', r.osm_id,
                        'osm_feature_type', r.osm_feature_type
                    ) AS source_refs
                FROM raw_rows AS r
                LEFT JOIN ref.ref_road_classes AS rc
                    ON rc.code = r.road_class_code
            ),
            updated AS (
                UPDATE %I.staging_road_candidates AS t
                SET
                    raw_id = s.raw_id,
                    canonical_name = s.canonical_name,
                    road_class_id = s.road_class_id,
                    class_code = s.road_class_code,
                    geom = s.geom,
                    is_oneway = s.is_oneway,
                    length_m = s.length_m,
                    confidence_score = s.confidence_score,
                    normalized_data = s.normalized_data,
                    source_refs = s.source_refs,
                    updated_at = now()
                FROM src AS s
                WHERE t.source_snapshot_id = $1
                  AND t.external_id = s.external_id
                RETURNING 1
            ),
            inserted AS (
                INSERT INTO %I.staging_road_candidates (
                    source_snapshot_id,
                    raw_id,
                    external_id,
                    canonical_name,
                    road_class_id,
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
                    s.raw_id,
                    s.external_id,
                    s.canonical_name,
                    s.road_class_id,
                    s.road_class_code,
                    s.geom,
                    s.is_oneway,
                    s.length_m,
                    s.confidence_score,
                    'new_candidate',
                    NULL,
                    'pending',
                    s.normalized_data,
                    s.source_refs
                FROM src AS s
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM %I.staging_road_candidates AS existing
                    WHERE existing.source_snapshot_id = $1
                      AND existing.external_id = s.external_id
                )
                RETURNING 1
            )
            SELECT
                (SELECT count(*)::bigint FROM updated),
                (SELECT count(*)::bigint FROM inserted)
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_updated, v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        RAISE NOTICE 'stage05_line_extraction: road candidates done — updated=%, inserted=%, elapsed=%',
            coalesce(v_updated, 0), coalesce(v_inserted, 0), clock_timestamp() - v_line_extraction_started_at;

        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'updated_rows', coalesce(v_updated, 0), 'PASS', format('available_rows=%s', v_available));
        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'inserted_rows', coalesce(v_inserted, 0), 'PASS', format('available_rows=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'road', format('%s.staging_road_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped road extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- B. Road name candidates: real name/ref tags only; no generated names.
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('road_name') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'road_name', format('%s.staging_road_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes roads.');
    ELSIF has_road AND has_road_name THEN
        RAISE NOTICE 'stage05_line_extraction: road name candidates — extracting from staging roads';

        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    raw.tags,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
        RAISE NOTICE 'stage05_line_extraction: road name candidates done — inserted=%', coalesce(v_inserted, 0);
        INSERT INTO stage05_report VALUES ('line_extraction', 'road_name', format('%s.staging_road_name_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', 'Real OSM road name/ref tags only.');
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'road_name', format('%s.staging_road_name_candidates', v_staging_schema), 'inserted_rows', 0, 'WARN', 'Road or road-name target table missing; skipped.');
    END IF;

    -- ---------------------------------------------------------------------
    -- C. Routing road candidates (future graph derivation, not final edges).
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('routing_road') THEN
        RAISE NOTICE 'stage05_line_extraction: routing road candidates skipped (ENTITY_FAMILIES excludes routing_roads)';
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_road', format('%s.staging_routing_road_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes routing_roads.');
    ELSIF has_routing_road THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
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
    -- D0. Coastline candidates (natural=coastline; before waterway lines).
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_lines
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND system.pipeline_is_coastline_tags(tags)
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('coastline') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'coastline', format('%s.staging_coastline_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes coastlines.');
    ELSIF to_regclass(format('%I.staging_coastline_candidates', v_staging_schema)) IS NOT NULL THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_coastline_tags(raw.tags)
            ),
            inserted AS (
                INSERT INTO %I.staging_coastline_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, nullif(btrim(src.tags->>'name'), ''), 'coastline',
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'natural', src.tags->>'natural',
                        'name', src.tags->>'name',
                        'name_en', nullif(btrim(src.tags->>'name:en'), ''),
                        'name_mm', nullif(btrim(coalesce(src.tags->>'name:my', src.tags->>'name:mm', src.tags->>'name:my-MM')), '')
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
                    CASE WHEN src.tags ? 'name' THEN 75 ELSE 70 END,
                    'new_candidate', NULL, 'pending', src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_coastline_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema, v_staging_schema, v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'coastline', format('%s.staging_coastline_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('raw_candidates=%s', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'coastline', format('%s.staging_coastline_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; apply local migration 016.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D. Water line candidates (waterway=*; exclude coastline).
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_lines
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND tags ? 'waterway'
          AND NOT system.pipeline_is_coastline_tags(tags)
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('water_line') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'water_line', format('%s.staging_water_line_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes water_lines.');
    ELSIF has_water_line THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_water_line_candidates ADD COLUMN IF NOT EXISTS water_class_id bigint',
            v_staging_schema
        );

        IF to_regclass(format('%I.staging_osm_unmapped_tags', v_staging_schema)) IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %I.staging_osm_unmapped_tags WHERE source_snapshot_id = $1 AND entity_family = ''water_lines''',
                v_staging_schema
            ) USING v_source_snapshot_id;
            q := format(
                $q$
                INSERT INTO %I.staging_osm_unmapped_tags (
                    source_snapshot_id, entity_family, osm_feature_type, osm_id, external_id,
                    tag_key, tag_value, reason, tags
                )
                SELECT
                    $1, 'water_lines', raw.osm_feature_type, NULLIF(btrim(raw.osm_id), '')::bigint,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id),
                    'waterway', raw.tags->>'waterway', 'unmapped_water_class', coalesce(raw.tags, '{}'::jsonb)
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'waterway'
                  AND NOT system.pipeline_is_coastline_tags(raw.tags)
                  AND system.pipeline_normalize_water_class(raw.tags, 'line') IS NULL
                $q$,
                v_staging_schema, v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            INSERT INTO stage05_report VALUES ('normalization', 'water_line', format('%s.staging_osm_unmapped_tags', v_staging_schema), 'unmapped_rows', v_inserted, 'PASS', format('raw_candidates=%s', v_available));
        END IF;

        q := format(
            $q$
            WITH raw_src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    system.pipeline_normalize_water_class(raw.tags, 'line') AS class_code
                FROM %I.raw_osm_lines AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags ? 'waterway'
                  AND NOT system.pipeline_is_coastline_tags(raw.tags)
            ),
            src AS (
                SELECT r.*, wc.id AS water_class_id
                FROM raw_src AS r
                INNER JOIN ref.ref_water_classes AS wc
                    ON wc.code = r.class_code AND wc.is_active
                WHERE r.class_code IS NOT NULL
            ),
            inserted AS (
                INSERT INTO %I.staging_water_line_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code, water_class_id,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, nullif(src.tags->>'name', ''), src.class_code, src.water_class_id,
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'waterway', src.tags->>'waterway',
                        'water_class', src.class_code,
                        'name', src.tags->>'name',
                        'name_en', nullif(btrim(src.tags->>'name:en'), ''),
                        'name_mm', nullif(btrim(coalesce(src.tags->>'name:my', src.tags->>'name:mm', src.tags->>'name:my-MM')), ''),
                        'tunnel', src.tags->>'tunnel',
                        'intermittent', src.tags->>'intermittent'
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3,
                        'raw_table', 'raw_osm_lines', 'raw_id', src.id,
                        'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type
                    ),
                    CASE WHEN src.tags ? 'name' THEN 75 ELSE 60 END,
                    'new_candidate', NULL, 'pending', src.geom
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_water_line_candidates AS existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema, v_staging_schema, v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('line_extraction', 'water_line', format('%s.staging_water_line_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('raw_candidates=%s normalized_via=ref.ref_water_classes', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('line_extraction', 'water_line', format('%s.staging_water_line_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped water line extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- E. Search name candidates from road names and water line names.
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('search_name') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes search_name sources.');
    ELSIF has_search_name THEN
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('routing_barrier') THEN
        INSERT INTO stage05_report VALUES ('line_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes routing_barriers.');
    ELSIF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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

    IF NOT pg_temp.pipeline_stage05_extraction_any_enabled(ARRAY[
        'bus_route', 'bus_route_name', 'bus_route_variant', 'bus_route_stop'
    ]) THEN
        INSERT INTO stage05_report VALUES (
            'bus_route_extraction', 'all', NULL, 'skipped', 0, 'SKIP',
            'ENTITY_FAMILIES filter excludes all bus-route staging families.'
        );
        RETURN;
    END IF;

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
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    coalesce(
                        nullif(raw.tags->>'name', ''),
                        nullif(raw.tags->>'ref', ''),
                        nullif(concat_ws(' - ', nullif(raw.tags->>'from', ''), nullif(raw.tags->>'to', '')), ''),
                        system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id)
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
                   AND stop.external_id = system.pipeline_osm_external_id(
                        coalesce(route_members.member_type, 'node'),
                        route_members.member_ref
                   )
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
    v_updated bigint;
    q text;

    has_building boolean;
    has_address boolean;
    has_address_component boolean;
    has_landuse boolean;
    has_protected_area boolean;
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
    has_protected_area := to_regclass(format('%I.staging_protected_area_candidates', v_staging_schema)) IS NOT NULL;
    has_water_polygon := to_regclass(format('%I.staging_water_polygon_candidates', v_staging_schema)) IS NOT NULL;
    has_admin_area := to_regclass(format('%I.staging_admin_area_candidates', v_staging_schema)) IS NOT NULL;
    has_admin_area_name := to_regclass(format('%I.staging_admin_area_name_candidates', v_staging_schema)) IS NOT NULL;
    has_search_name := to_regclass(format('%I.staging_search_name_candidates', v_staging_schema)) IS NOT NULL;
    has_barrier := to_regclass(format('%I.staging_routing_barrier_candidates', v_staging_schema)) IS NOT NULL;

    IF NOT pg_temp.pipeline_stage05_extraction_any_enabled(ARRAY[
        'building', 'address', 'address_component', 'landuse', 'protected_area',
        'water_polygon', 'admin_area', 'admin_area_name', 'search_name', 'routing_barrier'
    ]) THEN
        INSERT INTO stage05_report VALUES (
            'polygon_extraction', 'all', NULL, 'skipped', 0, 'SKIP',
            'ENTITY_FAMILIES filter excludes all polygon-based staging families.'
        );
        RETURN;
    END IF;

    -- ---------------------------------------------------------------------
    -- A. Building candidates
    -- ---------------------------------------------------------------------
    q := format(
        'SELECT count(*)::bigint FROM %I.raw_osm_polygons WHERE source_snapshot_id = $1 AND geom IS NOT NULL AND tags ? ''building''',
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('building') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'building', format('%s.staging_building_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes buildings.');
    ELSIF has_building THEN
        q := format(
            $q$
            WITH src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
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
                    CASE lower(btrim(coalesce(nullif(src.tags->>'building', ''), 'yes')))
                        WHEN 'yes' THEN 'unknown'
                        WHEN 'building' THEN 'unknown'
                        WHEN 'house' THEN 'residential'
                        WHEN 'apartment' THEN 'residential'
                        WHEN 'apartments' THEN 'residential'
                        WHEN 'dormitory' THEN 'residential'
                        WHEN 'townhouse' THEN 'residential'
                        WHEN 'villa' THEN 'residential'
                        WHEN 'office' THEN 'commercial'
                        WHEN 'retail' THEN 'commercial'
                        WHEN 'shopping_mall' THEN 'commercial'
                        WHEN 'supermarket' THEN 'commercial'
                        WHEN 'market' THEN 'commercial'
                        WHEN 'hotel' THEN 'commercial'
                        WHEN 'restaurant_building' THEN 'commercial'
                        WHEN 'restaurant' THEN 'commercial'
                        WHEN 'cafe' THEN 'commercial'
                        WHEN 'shop' THEN 'commercial'
                        WHEN 'showroom' THEN 'commercial'
                        WHEN 'school' THEN 'education'
                        WHEN 'university' THEN 'education'
                        WHEN 'library' THEN 'education'
                        WHEN 'training_center' THEN 'education'
                        WHEN 'hospital' THEN 'healthcare'
                        WHEN 'clinic' THEN 'healthcare'
                        WHEN 'pharmacy_building' THEN 'healthcare'
                        WHEN 'laboratory' THEN 'healthcare'
                        WHEN 'health_center' THEN 'healthcare'
                        WHEN 'government_office' THEN 'government_civic'
                        WHEN 'township_office' THEN 'government_civic'
                        WHEN 'courthouse' THEN 'government_civic'
                        WHEN 'police_station' THEN 'government_civic'
                        WHEN 'fire_station' THEN 'government_civic'
                        WHEN 'post_office' THEN 'government_civic'
                        WHEN 'community_center' THEN 'government_civic'
                        WHEN 'pagoda' THEN 'religious'
                        WHEN 'monastery' THEN 'religious'
                        WHEN 'church' THEN 'religious'
                        WHEN 'mosque' THEN 'religious'
                        WHEN 'temple' THEN 'religious'
                        WHEN 'religious_complex' THEN 'religious'
                        WHEN 'factory' THEN 'industrial'
                        WHEN 'workshop' THEN 'industrial'
                        WHEN 'processing_plant' THEN 'industrial'
                        WHEN 'warehouse' THEN 'warehouse_storage'
                        WHEN 'bus_terminal' THEN 'transport'
                        WHEN 'train_station' THEN 'transport'
                        WHEN 'ferry_terminal' THEN 'transport'
                        WHEN 'airport_terminal' THEN 'transport'
                        WHEN 'parking_structure' THEN 'transport'
                        WHEN 'depot' THEN 'transport'
                        WHEN 'farm_building' THEN 'agriculture'
                        WHEN 'barn' THEN 'agriculture'
                        WHEN 'greenhouse' THEN 'agriculture'
                        WHEN 'livestock_structure' THEN 'agriculture'
                        WHEN 'recreation_entertainment' THEN 'recreation'
                        WHEN 'stadium' THEN 'recreation'
                        WHEN 'cinema' THEN 'recreation'
                        WHEN 'gym' THEN 'recreation'
                        WHEN 'recreation_center' THEN 'recreation'
                        WHEN 'telecom' THEN 'utility_infrastructure'
                        WHEN 'water_facility' THEN 'utility_infrastructure'
                        WHEN 'electrical_substation' THEN 'utility_infrastructure'
                        WHEN 'sewage_facility' THEN 'utility_infrastructure'
                        WHEN 'waste_management' THEN 'utility_infrastructure'
                        WHEN 'military' THEN 'military_restricted'
                        WHEN 'checkpoint' THEN 'military_restricted'
                        WHEN 'restricted_facility' THEN 'military_restricted'
                        WHEN 'mixed_use_lowrise' THEN 'mixed_use'
                        WHEN 'mixed_use_highrise' THEN 'mixed_use'
                        WHEN 'integrated_complex' THEN 'mixed_use'
                        WHEN 'temporary_structure' THEN 'temporary_informal'
                        WHEN 'kiosk' THEN 'temporary_informal'
                        WHEN 'market_stall' THEN 'temporary_informal'
                        WHEN 'informal_structure' THEN 'temporary_informal'
                        WHEN 'generic_building' THEN 'unknown'
                        WHEN 'unclassified' THEN 'unknown'
                        WHEN 'residential' THEN 'residential'
                        WHEN 'commercial' THEN 'commercial'
                        WHEN 'mixed_use' THEN 'mixed_use'
                        WHEN 'education' THEN 'education'
                        WHEN 'healthcare' THEN 'healthcare'
                        WHEN 'government_civic' THEN 'government_civic'
                        WHEN 'religious' THEN 'religious'
                        WHEN 'industrial' THEN 'industrial'
                        WHEN 'warehouse_storage' THEN 'warehouse_storage'
                        WHEN 'transport' THEN 'transport'
                        WHEN 'utility_infrastructure' THEN 'utility_infrastructure'
                        WHEN 'agriculture' THEN 'agriculture'
                        WHEN 'recreation' THEN 'recreation'
                        WHEN 'military_restricted' THEN 'military_restricted'
                        WHEN 'temporary_informal' THEN 'temporary_informal'
                        WHEN 'unknown' THEN 'unknown'
                        ELSE 'unknown'
                    END,
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'names', system.pipeline_extract_building_names(coalesce(src.tags, '{}'::jsonb)),
                        'source_building_tag', nullif(btrim(src.tags->>'building'), ''),
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('address') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address', format('%s.staging_address_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes addresses.');
    ELSIF has_address THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('address_component') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'address_component', format('%s.staging_address_component_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes addresses.');
    ELSIF has_address AND has_address_component THEN
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
    -- D. Landuse / landcover / wetland candidates (normalized → CoreMap CODE)
    -- Route priority: wetland → landuse → natural surface → leisure.
    -- Water polygons are excluded (handled in section E).
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND system.pipeline_is_land_area_candidate_tags(tags)
          AND NOT system.pipeline_is_water_polygon_candidate_tags(tags)
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('landuse') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'landuse', format('%s.staging_landuse_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes landuse.');
    ELSIF has_landuse THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_landuse_candidates ADD COLUMN IF NOT EXISTS land_area_class_id bigint',
            v_staging_schema
        );

        IF to_regclass(format('%I.staging_osm_unmapped_tags', v_staging_schema)) IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %I.staging_osm_unmapped_tags WHERE source_snapshot_id = $1 AND entity_family = ''landuse''',
                v_staging_schema
            ) USING v_source_snapshot_id;
            q := format(
                $q$
                INSERT INTO %I.staging_osm_unmapped_tags (
                    source_snapshot_id, entity_family, osm_feature_type, osm_id, external_id,
                    tag_key, tag_value, reason, tags
                )
                SELECT
                    $1, 'landuse', raw.osm_feature_type, NULLIF(btrim(raw.osm_id), '')::bigint,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id),
                    CASE
                        WHEN raw.tags ? 'landuse' THEN 'landuse'
                        WHEN lower(coalesce(raw.tags->>'natural', '')) = 'wetland' THEN 'natural'
                        WHEN raw.tags ? 'natural' THEN 'natural'
                        WHEN raw.tags ? 'leisure' THEN 'leisure'
                        WHEN raw.tags ? 'amenity' THEN 'amenity'
                        ELSE 'tags'
                    END,
                    CASE
                        WHEN raw.tags ? 'landuse' THEN raw.tags->>'landuse'
                        WHEN lower(coalesce(raw.tags->>'natural', '')) = 'wetland'
                            THEN coalesce(raw.tags->>'wetland', 'wetland')
                        WHEN raw.tags ? 'natural' THEN raw.tags->>'natural'
                        WHEN raw.tags ? 'leisure' THEN raw.tags->>'leisure'
                        WHEN raw.tags ? 'amenity' THEN raw.tags->>'amenity'
                        ELSE NULL
                    END,
                    'unmapped_land_area_class',
                    coalesce(raw.tags, '{}'::jsonb)
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_land_area_candidate_tags(raw.tags)
                  AND NOT system.pipeline_is_water_polygon_candidate_tags(raw.tags)
                  AND system.pipeline_normalize_land_area_class(raw.tags) IS NULL
                $q$,
                v_staging_schema, v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            INSERT INTO stage05_report VALUES ('normalization', 'landuse', format('%s.staging_osm_unmapped_tags', v_staging_schema), 'unmapped_rows', v_inserted, 'PASS', format('raw_candidates=%s', v_available));
        END IF;

        q := format(
            $q$
            WITH raw_src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    system.pipeline_normalize_land_area_class(raw.tags) AS class_code
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_land_area_candidate_tags(raw.tags)
                  AND NOT system.pipeline_is_water_polygon_candidate_tags(raw.tags)
            ),
            src AS (
                SELECT
                    r.*,
                    lac.id AS land_area_class_id,
                    CASE
                        WHEN nullif(btrim(r.tags->>'name'), '') IS NULL THEN NULL
                        WHEN lower(btrim(r.tags->>'name')) = lower(btrim(r.class_code)) THEN NULL
                        WHEN lower(btrim(r.tags->>'name')) IN (
                            'residential', 'industrial', 'commercial', 'retail', 'farmland', 'paddy',
                            'orchard', 'aquaculture', 'farmyard', 'education', 'healthcare', 'religious',
                            'cemetery', 'military', 'transport', 'construction', 'park', 'recreation_ground',
                            'forest', 'grassland', 'grass', 'vacant', 'other', 'wood', 'wetland',
                            'marsh', 'swamp', 'scrub', 'heath', 'sand', 'beach', 'bare_rock', 'mud'
                        ) THEN NULL
                        ELSE nullif(btrim(r.tags->>'name'), '')
                    END AS real_name
                FROM raw_src AS r
                INNER JOIN ref.ref_land_area_classes AS lac
                    ON lac.code = r.class_code AND lac.is_active
                WHERE r.class_code IS NOT NULL
            ),
            inserted AS (
                INSERT INTO %I.staging_landuse_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code, land_area_class_id,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, src.real_name, src.class_code, src.land_area_class_id,
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'landuse', src.tags->>'landuse',
                        'natural', src.tags->>'natural',
                        'wetland', src.tags->>'wetland',
                        'leisure', src.tags->>'leisure',
                        'amenity', src.tags->>'amenity',
                        'land_area_class', src.class_code,
                        'name', src.real_name,
                        'name_en', nullif(btrim(src.tags->>'name:en'), ''),
                        'name_mm', nullif(btrim(coalesce(src.tags->>'name:my', src.tags->>'name:mm', src.tags->>'name:my-MM')), '')
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3,
                        'raw_table', 'raw_osm_polygons', 'raw_id', src.id,
                        'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type
                    ),
                    CASE WHEN src.real_name IS NOT NULL THEN 75 ELSE 60 END,
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
            v_raw_schema, v_staging_schema, v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'landuse', format('%s.staging_landuse_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('raw_candidates=%s normalized_via=ref.ref_land_area_classes', v_available));

        EXECUTE format(
            $q$
            INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
            SELECT 'normalization', 'landuse', %L, 'class_' || class_code, count(*)::bigint, 'PASS', NULL
            FROM %I.staging_landuse_candidates
            WHERE source_snapshot_id = $1
            GROUP BY class_code
            $q$,
            format('%s.staging_landuse_candidates', v_staging_schema),
            v_staging_schema
        ) USING v_source_snapshot_id;
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'landuse', format('%s.staging_landuse_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped landuse extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- D2. Protected-area overlay candidates (boundary / leisure=nature_reserve)
    -- One OSM identity → one staging row (dedupe by external_id).
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND system.pipeline_is_protected_area_candidate_tags(tags)
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('protected_area') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'protected_area', format('%s.staging_protected_area_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes protected_areas.');
    ELSIF has_protected_area THEN
        IF to_regclass(format('%I.staging_osm_unmapped_tags', v_staging_schema)) IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %I.staging_osm_unmapped_tags WHERE source_snapshot_id = $1 AND entity_family = ''protected_areas''',
                v_staging_schema
            ) USING v_source_snapshot_id;
            q := format(
                $q$
                INSERT INTO %I.staging_osm_unmapped_tags (
                    source_snapshot_id, entity_family, osm_feature_type, osm_id, external_id,
                    tag_key, tag_value, reason, tags
                )
                SELECT
                    $1, 'protected_areas', raw.osm_feature_type, NULLIF(btrim(raw.osm_id), '')::bigint,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id),
                    CASE
                        WHEN raw.tags ? 'boundary' THEN 'boundary'
                        WHEN raw.tags ? 'leisure' THEN 'leisure'
                        WHEN raw.tags ? 'protect_class' THEN 'protect_class'
                        WHEN raw.tags ? 'designation' THEN 'designation'
                        WHEN raw.tags ? 'protection_title' THEN 'protection_title'
                        ELSE 'tags'
                    END,
                    CASE
                        WHEN raw.tags ? 'boundary' THEN raw.tags->>'boundary'
                        WHEN raw.tags ? 'leisure' THEN raw.tags->>'leisure'
                        WHEN raw.tags ? 'protect_class' THEN raw.tags->>'protect_class'
                        WHEN raw.tags ? 'designation' THEN raw.tags->>'designation'
                        WHEN raw.tags ? 'protection_title' THEN raw.tags->>'protection_title'
                        ELSE NULL
                    END,
                    'unmapped_protected_area_class',
                    coalesce(raw.tags, '{}'::jsonb)
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_protected_area_candidate_tags(raw.tags)
                  AND system.pipeline_normalize_protected_area_class(raw.tags) IS NULL
                $q$,
                v_staging_schema, v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            INSERT INTO stage05_report VALUES ('normalization', 'protected_area', format('%s.staging_osm_unmapped_tags', v_staging_schema), 'unmapped_rows', v_inserted, 'PASS', format('raw_candidates=%s', v_available));
        END IF;

        q := format(
            $q$
            WITH raw_src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    system.pipeline_normalize_protected_area_class(raw.tags) AS class_code,
                    system.pipeline_normalize_protected_area_geom(raw.geom) AS geom_mp
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_protected_area_candidate_tags(raw.tags)
            ),
            ranked AS (
                SELECT
                    r.*,
                    row_number() OVER (
                        PARTITION BY r.external_id
                        ORDER BY
                            CASE WHEN r.geom_mp IS NOT NULL THEN 0 ELSE 1 END,
                            ST_Area(r.geom_mp::geography) DESC NULLS LAST,
                            r.id
                    ) AS rn
                FROM raw_src AS r
            ),
            src AS (
                SELECT
                    r.*,
                    pac.id AS protected_area_class_id,
                    nullif(btrim(r.tags->>'name'), '') AS name_und,
                    nullif(btrim(r.tags->>'name:en'), '') AS name_en,
                    nullif(btrim(coalesce(r.tags->>'name:my', r.tags->>'name:mm', r.tags->>'name:my-MM')), '') AS name_mm
                FROM ranked AS r
                INNER JOIN ref.ref_protected_area_classes AS pac
                    ON pac.code = r.class_code AND pac.is_active
                WHERE r.class_code IS NOT NULL
                  AND r.geom_mp IS NOT NULL
                  AND r.rn = 1
            ),
            inserted AS (
                INSERT INTO %I.staging_protected_area_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code,
                    protected_area_class_id, normalized_data, source_refs, confidence_score,
                    match_status, auto_action, review_status, geom, centroid, area_m2,
                    eligible_for_core, core_selection_reason
                )
                SELECT
                    $1, src.id, src.external_id,
                    coalesce(src.name_en, src.name_mm, src.name_und),
                    src.class_code, src.protected_area_class_id,
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'boundary', src.tags->>'boundary',
                        'leisure', src.tags->>'leisure',
                        'protect_class', src.tags->>'protect_class',
                        'protection_title', src.tags->>'protection_title',
                        'designation', src.tags->>'designation',
                        'operator', src.tags->>'operator',
                        'ownership', src.tags->>'ownership',
                        'access', src.tags->>'access',
                        'website', src.tags->>'website',
                        'wikidata', src.tags->>'wikidata',
                        'wikipedia', src.tags->>'wikipedia',
                        'protected_area_class', src.class_code,
                        'name', coalesce(src.name_en, src.name_mm, src.name_und),
                        'name_en', src.name_en,
                        'name_mm', src.name_mm,
                        'name_und', src.name_und,
                        'names', (
                            SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.language_code, n.name), '[]'::jsonb)
                            FROM (
                                SELECT DISTINCT ON (lower(x.name), x.language_code)
                                    x.name, x.language_code, x.source_tag, x.name_type, x.is_primary
                                FROM (
                                    VALUES
                                        (src.name_und, 'und', 'name', 'official', true),
                                        (src.name_en, 'en', 'name:en', 'official', true),
                                        (src.name_mm, 'my', 'name:my', 'official', true)
                                ) AS x(name, language_code, source_tag, name_type, is_primary)
                                WHERE x.name IS NOT NULL AND btrim(x.name) <> ''
                                ORDER BY lower(x.name), x.language_code, x.source_tag
                            ) n
                        )
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3,
                        'raw_table', 'raw_osm_polygons', 'raw_id', src.id,
                        'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type,
                        'external_id', src.external_id
                    ),
                    CASE WHEN coalesce(src.name_en, src.name_mm, src.name_und) IS NOT NULL THEN 80 ELSE 65 END,
                    'new_candidate', NULL, 'pending',
                    src.geom_mp,
                    ST_PointOnSurface(src.geom_mp)::geometry(Point, 4326),
                    ST_Area(src.geom_mp::geography)::numeric,
                    true,
                    'protected_area_overlay'
                FROM src
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_protected_area_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = src.external_id
                )
                RETURNING 1
            )
            SELECT count(*)::bigint FROM inserted
            $q$,
            v_raw_schema, v_staging_schema, v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'protected_area', format('%s.staging_protected_area_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('raw_candidates=%s unique_normalized_via=ref.ref_protected_area_classes', v_available));

        -- Report subtype signals for class=other (do NOT invent new ref classes).
        IF to_regclass(format('%I.staging_osm_unmapped_tags', v_staging_schema)) IS NOT NULL THEN
            q := format(
                $q$
                INSERT INTO %I.staging_osm_unmapped_tags (
                    source_snapshot_id, entity_family, osm_feature_type, osm_id, external_id,
                    tag_key, tag_value, reason, tags
                )
                SELECT
                    s.source_snapshot_id,
                    'protected_areas',
                    s.source_refs->>'osm_feature_type',
                    NULLIF(btrim(s.source_refs->>'osm_id'), '')::bigint,
                    s.external_id,
                    kv.tag_key,
                    kv.tag_value,
                    'unmapped_protected_area_subtype',
                    coalesce(s.normalized_data->'tags', '{}'::jsonb)
                FROM %I.staging_protected_area_candidates AS s
                CROSS JOIN LATERAL (
                    VALUES
                        ('protect_class', nullif(btrim(s.normalized_data->>'protect_class'), '')),
                        ('designation', nullif(btrim(s.normalized_data->>'designation'), '')),
                        ('protection_title', nullif(btrim(s.normalized_data->>'protection_title'), ''))
                ) AS kv(tag_key, tag_value)
                WHERE s.source_snapshot_id = $1
                  AND s.class_code = 'other'
                  AND kv.tag_value IS NOT NULL
                $q$,
                v_staging_schema, v_staging_schema
            );
            EXECUTE q USING v_source_snapshot_id;
            GET DIAGNOSTICS v_available = ROW_COUNT;
            INSERT INTO stage05_report VALUES ('normalization', 'protected_area', format('%s.staging_osm_unmapped_tags', v_staging_schema), 'other_subtype_signals', v_available, 'PASS', 'class=other protect_class/designation/protection_title retained; no auto ref add');
        END IF;

        EXECUTE format(
            $q$
            INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
            SELECT 'normalization', 'protected_area', %L, 'class_' || class_code, count(*)::bigint, 'PASS', NULL
            FROM %I.staging_protected_area_candidates
            WHERE source_snapshot_id = $1
            GROUP BY class_code
            $q$,
            format('%s.staging_protected_area_candidates', v_staging_schema),
            v_staging_schema
        ) USING v_source_snapshot_id;
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'protected_area', format('%s.staging_protected_area_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; apply local migration 017.');
    END IF;

    -- ---------------------------------------------------------------------
    -- E. Water polygon candidates (natural=water / water=* / riverbank)
    -- ---------------------------------------------------------------------
    q := format(
        $q$
        SELECT count(*)::bigint FROM %I.raw_osm_polygons
        WHERE source_snapshot_id = $1 AND geom IS NOT NULL
          AND system.pipeline_is_water_polygon_candidate_tags(tags)
        $q$,
        v_raw_schema
    );
    EXECUTE q INTO v_available USING v_source_snapshot_id;

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('water_polygon') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'water_polygon', format('%s.staging_water_polygon_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes water_polygons.');
    ELSIF has_water_polygon THEN
        EXECUTE format(
            'ALTER TABLE %I.staging_water_polygon_candidates ADD COLUMN IF NOT EXISTS water_class_id bigint',
            v_staging_schema
        );

        IF to_regclass(format('%I.staging_osm_unmapped_tags', v_staging_schema)) IS NOT NULL THEN
            EXECUTE format(
                'DELETE FROM %I.staging_osm_unmapped_tags WHERE source_snapshot_id = $1 AND entity_family = ''water_polygons''',
                v_staging_schema
            ) USING v_source_snapshot_id;
            q := format(
                $q$
                INSERT INTO %I.staging_osm_unmapped_tags (
                    source_snapshot_id, entity_family, osm_feature_type, osm_id, external_id,
                    tag_key, tag_value, reason, tags
                )
                SELECT
                    $1, 'water_polygons', raw.osm_feature_type, NULLIF(btrim(raw.osm_id), '')::bigint,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id),
                    CASE
                        WHEN raw.tags ? 'water' THEN 'water'
                        WHEN lower(coalesce(raw.tags->>'natural', '')) = 'water' THEN 'natural'
                        ELSE 'waterway'
                    END,
                    coalesce(raw.tags->>'water', raw.tags->>'natural', raw.tags->>'waterway'),
                    'unmapped_water_class',
                    coalesce(raw.tags, '{}'::jsonb)
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_water_polygon_candidate_tags(raw.tags)
                  AND system.pipeline_normalize_water_class(raw.tags, 'polygon') IS NULL
                $q$,
                v_staging_schema, v_raw_schema
            );
            EXECUTE q USING v_source_snapshot_id;
            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            INSERT INTO stage05_report VALUES ('normalization', 'water_polygon', format('%s.staging_osm_unmapped_tags', v_staging_schema), 'unmapped_rows', v_inserted, 'PASS', format('raw_candidates=%s', v_available));
        END IF;

        q := format(
            $q$
            WITH raw_src AS (
                SELECT
                    raw.*,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    system.pipeline_normalize_water_class(raw.tags, 'polygon') AS class_code
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND system.pipeline_is_water_polygon_candidate_tags(raw.tags)
            ),
            src AS (
                SELECT r.*, wc.id AS water_class_id
                FROM raw_src AS r
                INNER JOIN ref.ref_water_classes AS wc
                    ON wc.code = r.class_code AND wc.is_active
                WHERE r.class_code IS NOT NULL
            ),
            inserted AS (
                INSERT INTO %I.staging_water_polygon_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code, water_class_id,
                    normalized_data, source_refs, confidence_score, match_status, auto_action, review_status, geom
                )
                SELECT
                    $1, src.id, src.external_id, nullif(src.tags->>'name', ''), src.class_code, src.water_class_id,
                    jsonb_build_object(
                        'tags', coalesce(src.tags, '{}'::jsonb),
                        'natural', src.tags->>'natural',
                        'water', src.tags->>'water',
                        'waterway', src.tags->>'waterway',
                        'water_class', src.class_code,
                        'intermittent', src.tags->>'intermittent',
                        'name', src.tags->>'name',
                        'name_en', nullif(btrim(src.tags->>'name:en'), ''),
                        'name_mm', nullif(btrim(coalesce(src.tags->>'name:my', src.tags->>'name:mm', src.tags->>'name:my-MM')), '')
                    ),
                    jsonb_build_object(
                        'source_snapshot_id', $1, 'snapshot_version', $2, 'region_code', $3,
                        'raw_table', 'raw_osm_polygons', 'raw_id', src.id,
                        'osm_id', src.osm_id, 'osm_feature_type', src.osm_feature_type
                    ),
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
            v_raw_schema, v_staging_schema, v_staging_schema
        );
        EXECUTE q INTO v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'water_polygon', format('%s.staging_water_polygon_candidates', v_staging_schema), 'inserted_rows', v_inserted, 'PASS', format('raw_candidates=%s normalized_via=ref.ref_water_classes', v_available));

        EXECUTE format(
            $q$
            INSERT INTO stage05_report (section, entity_family, target_table, metric, value_n, status, note)
            SELECT 'normalization', 'water_polygon', %L, 'class_' || class_code, count(*)::bigint, 'PASS', NULL
            FROM %I.staging_water_polygon_candidates
            WHERE source_snapshot_id = $1
            GROUP BY class_code
            $q$,
            format('%s.staging_water_polygon_candidates', v_staging_schema),
            v_staging_schema
        ) USING v_source_snapshot_id;
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('admin_area') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes admin_areas.');
    ELSIF has_admin_area THEN
        q := format(
            $q$
            WITH raw_rows AS (
                SELECT
                    raw.id AS raw_id,
                    raw.osm_id,
                    raw.osm_feature_type,
                    coalesce(raw.tags, '{}'::jsonb) AS tags,
                    raw.geom,
                    system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id,
                    coalesce(
                        nullif(btrim(raw.tags->>'name:my'), ''),
                        nullif(btrim(raw.tags->>'name'), ''),
                        nullif(btrim(raw.tags->>'name:en'), ''),
                        nullif(btrim(raw.tags->>'name:mm'), ''),
                        nullif(btrim(raw.tags->>'name:my-MM'), ''),
                        nullif(btrim(raw.tags->>'official_name'), '')
                    ) AS real_name,
                    nullif(btrim(raw.tags->>'admin_level'), '') AS admin_level_tag
                FROM %I.raw_osm_polygons AS raw
                WHERE raw.source_snapshot_id = $1
                  AND raw.geom IS NOT NULL
                  AND raw.tags->>'boundary' = 'administrative'
            ),
            osm_parsed AS (
                SELECT
                    r.*,
                    (
                        SELECT max(btrim(part.part_value)::integer)
                        FROM unnest(string_to_array(coalesce(r.admin_level_tag, ''), ';')) AS part(part_value)
                        WHERE btrim(part.part_value) ~ '^[0-9]+$'
                    ) AS osm_admin_level
                FROM raw_rows AS r
            ),
            level_resolved AS (
                SELECT
                    p.*,
                    CASE p.osm_admin_level
                        WHEN 2 THEN 'country'
                        WHEN 4 THEN 'state_region'
                        WHEN 5 THEN 'district'
                        WHEN 6 THEN 'township'
                        WHEN 7 THEN 'ward_village_tract'
                        WHEN 8 THEN 'ward_village_tract'
                        WHEN 9 THEN 'ward_village_tract'
                        WHEN 10 THEN 'ward_village_tract'
                        ELSE NULL
                    END AS osm_level_code,
                    CASE
                        WHEN p.real_name ~ 'ခရိုင်'
                          OR p.real_name ~* '\mDistrict\M' THEN 'district'
                        WHEN p.real_name ~ 'မြို့နယ်'
                          OR p.real_name ~* '\mTownship\M' THEN 'township'
                        WHEN p.real_name ~ 'ရပ်ကွက်'
                          OR p.real_name ~ 'ကျေးရွာအုပ်စု'
                          OR p.real_name ~* '\mWard\M'
                          OR p.real_name ~* 'Village Tract' THEN 'ward_village_tract'
                        ELSE NULL
                    END AS semantic_level_code
                FROM osm_parsed AS p
            ),
            mapped AS (
                SELECT
                    lr.*,
                    coalesce(lr.semantic_level_code, lr.osm_level_code) AS resolved_level_code,
                    levels.id AS admin_level_id,
                    levels.code AS mapped_admin_level_code,
                    jsonb_strip_nulls(jsonb_build_object(
                        'tags', lr.tags,
                        'admin_level', lr.admin_level_tag,
                        'osm_admin_level', lr.osm_admin_level::text,
                        'osm_level_code', lr.osm_level_code,
                        'semantic_level_code', lr.semantic_level_code,
                        'mapped_admin_level_code', levels.code,
                        'level_correction_applied',
                        (lr.semantic_level_code IS NOT NULL
                         AND lr.semantic_level_code IS DISTINCT FROM lr.osm_level_code),
                        'boundary', lr.tags->>'boundary',
                        'place', lr.tags->>'place',
                        'population', lr.tags->>'population',
                        'wikidata', lr.tags->>'wikidata',
                        'wikipedia', lr.tags->>'wikipedia',
                        'official_name', lr.tags->>'official_name',
                        'alt_name', lr.tags->>'alt_name',
                        'area_m2', ST_Area(lr.geom::geography)
                    )) AS normalized_data,
                    jsonb_build_object(
                        'source_snapshot_id', $1,
                        'snapshot_version', $2,
                        'region_code', $3,
                        'raw_table', 'raw_osm_polygons',
                        'raw_id', lr.raw_id,
                        'osm_id', lr.osm_id,
                        'osm_feature_type', lr.osm_feature_type
                    ) AS source_refs
                FROM level_resolved AS lr
                LEFT JOIN ref.ref_admin_levels AS levels
                    ON levels.code = coalesce(lr.semantic_level_code, lr.osm_level_code)
                WHERE lr.real_name IS NOT NULL
                  AND levels.id IS NOT NULL
            ),
            updated AS (
                UPDATE %I.staging_admin_area_candidates AS t
                SET
                    raw_id = m.raw_id,
                    canonical_name = m.real_name,
                    class_code = m.mapped_admin_level_code,
                    admin_level_id = m.admin_level_id,
                    geom = m.geom,
                    centroid = ST_PointOnSurface(m.geom),
                    confidence_score = 80,
                    normalized_data = m.normalized_data,
                    source_refs = m.source_refs,
                    updated_at = now()
                FROM mapped AS m
                WHERE t.source_snapshot_id = $1
                  AND t.external_id = m.external_id
                RETURNING 1
            ),
            inserted AS (
                INSERT INTO %I.staging_admin_area_candidates (
                    source_snapshot_id, raw_id, external_id, canonical_name, class_code, admin_level_id,
                    geom, centroid, confidence_score, match_status, auto_action, review_status,
                    normalized_data, source_refs
                )
                SELECT
                    $1, m.raw_id, m.external_id, m.real_name, m.mapped_admin_level_code, m.admin_level_id,
                    m.geom, ST_PointOnSurface(m.geom),
                    80, 'new_candidate', NULL, 'pending',
                    m.normalized_data, m.source_refs
                FROM mapped AS m
                WHERE NOT EXISTS (
                    SELECT 1 FROM %I.staging_admin_area_candidates existing
                    WHERE existing.source_snapshot_id = $1 AND existing.external_id = m.external_id
                )
                RETURNING 1
            )
            SELECT
                (SELECT count(*)::bigint FROM updated),
                (SELECT count(*)::bigint FROM inserted)
            $q$,
            v_raw_schema,
            v_staging_schema,
            v_staging_schema,
            v_staging_schema
        );
        EXECUTE q INTO v_updated, v_inserted USING v_source_snapshot_id, v_snapshot_version, v_region_code;

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

        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'updated_rows', coalesce(v_updated, 0), 'PASS', format('available_rows=%s; OSM admin levels mapped to country/state_region/district/township/ward_village_tract', v_available));
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'inserted_rows', coalesce(v_inserted, 0), 'PASS', format('available_rows=%s; skipped rows without real name or resolvable admin level', v_available));
    ELSE
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area', format('%s.staging_admin_area_candidates', v_staging_schema), 'available_rows', v_available, 'WARN', 'Target table missing; skipped admin area extraction.');
    END IF;

    -- ---------------------------------------------------------------------
    -- G. Admin area names
    -- ---------------------------------------------------------------------
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('admin_area_name') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'admin_area_name', format('%s.staging_admin_area_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes admin_areas.');
    ELSIF has_admin_area AND has_admin_area_name THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.id raw_id, raw.osm_id, raw.osm_feature_type, raw.tags,
                       system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
    IF NOT pg_temp.pipeline_stage05_extraction_enabled('search_name') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'search_name', format('%s.staging_search_name_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes search_name sources.');
    ELSIF has_search_name THEN
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

        IF pg_temp.pipeline_stage05_extraction_enabled('admin_area')
           AND has_admin_area AND has_admin_area_name THEN
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

    IF NOT pg_temp.pipeline_stage05_extraction_enabled('routing_barrier') THEN
        INSERT INTO stage05_report VALUES ('polygon_extraction', 'routing_barrier', format('%s.staging_routing_barrier_candidates', v_staging_schema), 'inserted_rows', 0, 'SKIP', 'ENTITY_FAMILIES filter excludes routing_barriers.');
    ELSIF has_barrier THEN
        q := format(
            $q$
            WITH src AS (
                SELECT raw.*, system.pipeline_osm_external_id(raw.osm_feature_type, raw.osm_id) AS external_id
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
                ('place_address_link', 'staging_place_address_link_candidates'),
                ('road', 'staging_road_candidates'),
                ('road_name', 'staging_road_name_candidates'),
                ('routing_road', 'staging_routing_road_candidates'),
                ('building', 'staging_building_candidates'),
                ('address', 'staging_address_candidates'),
                ('address_component', 'staging_address_component_candidates'),
                ('landuse', 'staging_landuse_candidates'),
                ('water_line', 'staging_water_line_candidates'),
                ('coastline', 'staging_coastline_candidates'),
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
        IF NOT pg_temp.pipeline_stage05_extraction_enabled(target.entity_family) THEN
            CONTINUE;
        END IF;

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

\ir pipeline_stage05_hash_metrics.sql
\ir pipeline_stage05b_validate.sql
\ir pipeline_stage05c_core_pmtiles_selection.sql

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
        WHEN 'staging_reset' THEN 2
        WHEN 'target_readiness' THEN 3
        WHEN 'source_classification' THEN 4
        WHEN 'point_extraction' THEN 5
        WHEN 'line_extraction' THEN 6
        WHEN 'bus_route_extraction' THEN 7
        WHEN 'polygon_extraction' THEN 8
        WHEN 'staging_hash' THEN 9
        WHEN 'candidate_validation' THEN 10
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
WHERE pg_temp.pipeline_stage05_extraction_enabled(entity_family)
ORDER BY
    CASE entity_family
        WHEN 'place' THEN 1
        WHEN 'place_name' THEN 2
        WHEN 'place_address_link' THEN 3
        WHEN 'road' THEN 4
        WHEN 'road_name' THEN 5
        WHEN 'routing_road' THEN 6
        WHEN 'building' THEN 7
        WHEN 'address' THEN 8
        WHEN 'address_component' THEN 9
        WHEN 'landuse' THEN 10
        WHEN 'water_line' THEN 11
        WHEN 'water_polygon' THEN 12
        WHEN 'admin_area' THEN 13
        WHEN 'admin_area_name' THEN 14
        WHEN 'bus_stop' THEN 15
        WHEN 'bus_stop_name' THEN 16
        WHEN 'bus_route' THEN 17
        WHEN 'bus_route_name' THEN 18
        WHEN 'bus_route_variant' THEN 19
        WHEN 'bus_route_stop' THEN 20
        WHEN 'search_name' THEN 21
        WHEN 'search_address' THEN 22
        WHEN 'routing_barrier' THEN 23
        ELSE 99
    END;

-- Inserted/updated counts for selected ENTITY_FAMILIES only.
SELECT
    'stage05_upsert_counts' AS output_type,
    section,
    entity_family,
    target_table,
    metric,
    value_n,
    status,
    note
FROM stage05_report
WHERE metric IN ('inserted_rows', 'updated_rows')
  AND pg_temp.pipeline_stage05_extraction_enabled(entity_family)
ORDER BY
    CASE section
        WHEN 'point_extraction' THEN 1
        WHEN 'line_extraction' THEN 2
        WHEN 'bus_route_extraction' THEN 3
        WHEN 'polygon_extraction' THEN 4
        ELSE 99
    END,
    entity_family,
    CASE metric WHEN 'updated_rows' THEN 1 WHEN 'inserted_rows' THEN 2 ELSE 99 END;

-- Verification: count classified raw source features by final classification.
SELECT
    'stage05_source_classification_counts' AS section,
    source_classification,
    count(*)::bigint AS row_count
FROM stage05_source_feature_classification
WHERE pg_temp.pipeline_entity_family_enabled_any(ARRAY['places', 'addresses', 'place_address_links'])
GROUP BY source_classification
ORDER BY source_classification;

-- Verification: candidate counts requested by the split place/address/link flow.
SELECT
    'stage05_classified_candidate_counts' AS section,
    metric,
    row_count
FROM (
    SELECT
        'place_candidate_count'::text AS metric,
        coalesce((
            SELECT row_count
            FROM stage05_final_target_counts
            WHERE entity_family = 'place'
        ), 0)::bigint AS row_count,
        1 AS sort_order
    WHERE pg_temp.pipeline_stage05_extraction_enabled('place')
    UNION ALL
    SELECT
        'address_candidate_count',
        coalesce((
            SELECT row_count
            FROM stage05_final_target_counts
            WHERE entity_family = 'address'
        ), 0)::bigint,
        2
    WHERE pg_temp.pipeline_stage05_extraction_enabled('address')
    UNION ALL
    SELECT
        'place_address_link_count',
        coalesce((
            SELECT row_count
            FROM stage05_final_target_counts
            WHERE entity_family = 'place_address_link'
        ), 0)::bigint,
        3
    WHERE pg_temp.pipeline_stage05_extraction_enabled('place_address_link')
    UNION ALL
    SELECT
        'weak_address_count',
        w.row_count,
        4
    FROM (
        SELECT count(*)::bigint AS row_count
        FROM stage05_source_feature_classification
        WHERE address_strength = 'weak'
    ) AS w
    WHERE pg_temp.pipeline_entity_family_enabled_any(ARRAY['places', 'addresses', 'place_address_links'])
) AS counts
ORDER BY sort_order;

SELECT
    'stage05_summary' AS section,
    (SELECT coalesce(sum(value_n), 0) FROM stage05_report WHERE section = 'raw_counts') AS raw_rows_for_snapshot,
    (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'PASS' AND pg_temp.pipeline_stage05_extraction_enabled(entity_family)) AS pass_count,
    (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'WARN' AND pg_temp.pipeline_stage05_extraction_enabled(entity_family))
      + (SELECT count(*) FROM stage05_report WHERE status = 'WARN' AND (entity_family = 'all' OR pg_temp.pipeline_stage05_extraction_enabled(entity_family))) AS warn_count,
    (SELECT count(*) FROM stage05_report WHERE status = 'FAIL') AS fail_count,
    (SELECT coalesce(sum(value_n), 0) FROM stage05_report WHERE metric IN ('inserted_rows', 'updated_rows') AND pg_temp.pipeline_stage05_extraction_enabled(entity_family)) AS selected_upsert_rows,
    CASE
        WHEN (SELECT count(*) FROM stage05_report WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN (SELECT count(*) FROM stage05_final_target_counts WHERE status = 'WARN' AND pg_temp.pipeline_stage05_extraction_enabled(entity_family)) > 0
          OR (SELECT count(*) FROM stage05_report WHERE status = 'WARN' AND (entity_family = 'all' OR pg_temp.pipeline_stage05_extraction_enabled(entity_family))) > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status
;

COMMIT;
