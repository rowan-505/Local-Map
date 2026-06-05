-- =============================================================================
-- Stage I / Stage 09: create_review_views
-- CREATE OR REPLACE views over staging candidates for local review (no writes).
--
-- Scope:
--   - Local DB only; no core promotion, prod_mirror changes, Supabase, or
--     staging row updates.
--   - Views are not filtered to a single snapshot_version; join snapshots for
--     snapshot_version when lineage exists.
--   - Includes human review columns when present on the base table (migration
--     005_prepare_review_workflow or equivalent): review_decision, reviewed_by,
--     reviewed_at, review_note, alongside review_status.
--   - Those four columns are appended after updated_at so CREATE OR REPLACE VIEW
--     does not reorder existing view columns (PostgreSQL rejects mid-list inserts
--     as implicit renames).
--   - confidence_score follows the underlying table (0–100 scale, production-aligned).
--
-- Input psql variables:
--   staging_schema optional, defaults to staging
--   system_schema optional, defaults to system
--   entity_families optional; default all (see pipeline_entity_families.sql)
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?system_schema}
\else
\set system_schema 'system'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage09_params (
    staging_schema text NOT NULL,
    system_schema text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_params;

INSERT INTO stage09_params (staging_schema, system_schema)
VALUES (
    coalesce(nullif(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(nullif(btrim(:'system_schema'), ''), 'system')
);

CREATE TEMP TABLE IF NOT EXISTS stage09_manifest (
    sort_order integer NOT NULL,
    entity_family text NOT NULL,
    base_table text NOT NULL,
    nc_suffix text NOT NULL,
    rv_middle text NOT NULL,
    required_min boolean NOT NULL,
    include_manual_views boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_manifest;

INSERT INTO stage09_manifest (
    sort_order,
    entity_family,
    base_table,
    nc_suffix,
    rv_middle,
    required_min,
    include_manual_views
)
VALUES
    (10, 'places', 'staging_place_candidates', 'place_candidates', 'place', true, true),
    (20, 'roads', 'staging_road_candidates', 'road_candidates', 'road', true, true),
    (30, 'buildings', 'staging_building_candidates', 'building_candidates', 'building', true, true),
    (40, 'landuse', 'staging_landuse_candidates', 'landuse_candidates', 'landuse', false, true),
    (50, 'water_lines', 'staging_water_line_candidates', 'water_line_candidates', 'water_line', false, false),
    (60, 'water_polygons', 'staging_water_polygon_candidates', 'water_polygon_candidates', 'water_polygon', false, false),
    (70, 'admin_areas', 'staging_admin_area_candidates', 'admin_area_candidates', 'admin_area', false, false),
    (80, 'bus_stops', 'staging_bus_stop_candidates', 'bus_stop_candidates', 'bus_stop', false, false),
    (90, 'addresses', 'staging_address_candidates', 'address_candidates', 'address', false, false),
    (100, 'routing_barriers', 'staging_routing_barrier_candidates', 'routing_barrier_candidates', 'routing_barrier', false, false);

\ir pipeline_entity_families.sql

DELETE FROM stage09_manifest AS m
WHERE NOT pg_temp.pipeline_entity_family_enabled(m.entity_family);

CREATE TEMP TABLE IF NOT EXISTS stage09_created_views (
    view_schema text NOT NULL,
    view_name text NOT NULL,
    PRIMARY KEY (view_schema, view_name)
) ON COMMIT DROP;

TRUNCATE stage09_created_views;

CREATE TEMP TABLE IF NOT EXISTS stage09_skipped (
    entity_family text NOT NULL,
    base_table text NOT NULL,
    reason text NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_skipped;

CREATE TEMP TABLE IF NOT EXISTS stage09_family_summary (
    entity_family text NOT NULL,
    base_table text NOT NULL,
    nc_view text NOT NULL,
    rv_view text,
    mn_view text,
    nc_view_created boolean NOT NULL,
    rv_view_created boolean NOT NULL,
    mn_view_created boolean NOT NULL
) ON COMMIT DROP;

TRUNCATE stage09_family_summary;

DO $stage09_build$
DECLARE
    p stage09_params%ROWTYPE;
    m stage09_manifest%ROWTYPE;
    v_reg oid;
    v_has_id boolean;
    v_has_snap_fk boolean;
    v_has_match boolean;
    v_has_snapshots boolean;
    v_col_exists boolean;
    v_select text;
    v_view_nc text;
    v_view_rv text;
    v_view_mn text;
    v_where_nc text := $w$ c.match_status IN ('new_auto', 'matched_auto_update', 'unchanged') $w$;
    v_where_rv text := $w$ c.match_status IN ('needs_review', 'conflict', 'duplicate_candidate', 'delete_candidate') $w$;
    v_where_mn text := $w$ c.match_status = 'manual_protected' $w$;
    v_order text[] := ARRAY[
        'external_id',
        'canonical_name',
        'name',
        'public_name',
        'source_entity_type',
        'class_code',
        'admin_level_id',
        'place_class_id',
        'poi_category_id',
        'road_class_id',
        'parent_candidate_id',
        'route_code',
        'match_status',
        'auto_action',
        'review_status',
        'confidence_score',
        'source_refs',
        'normalized_data',
        'point_geom',
        'footprint_geom',
        'centroid',
        'geom',
        'geom_multi',
        'length_m',
        'area_m2',
        'is_oneway',
        'raw_id',
        'created_at',
        'updated_at',
        'review_decision',
        'reviewed_by',
        'reviewed_at',
        'review_note'
    ];
    v_col text;
BEGIN
    SELECT *
    INTO STRICT p
    FROM stage09_params;

    SELECT to_regclass(format('%I.%I', p.system_schema, 'system_source_snapshots')) IS NOT NULL
    INTO v_has_snapshots;

    IF NOT v_has_snapshots THEN
        RAISE EXCEPTION 'system source snapshot table missing: %I.system_source_snapshots', p.system_schema;
    END IF;

    FOR m IN
        SELECT *
        FROM stage09_manifest
        ORDER BY sort_order
    LOOP
        v_view_mn := NULL;
        v_reg := to_regclass(format('%I.%I', p.staging_schema, m.base_table));

        IF v_reg IS NULL THEN
            INSERT INTO stage09_skipped (entity_family, base_table, reason)
            VALUES (
                m.entity_family,
                m.base_table,
                format('staging table does not exist: %I.%I', p.staging_schema, m.base_table)
            );

            IF m.required_min THEN
                RAISE EXCEPTION
                    'required staging table missing for Stage 09: %I.%I (entity_family=%)',
                    p.staging_schema,
                    m.base_table,
                    m.entity_family;
            END IF;

            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'source_snapshot_id'
        ),
        EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = p.staging_schema
              AND c.table_name = m.base_table
              AND c.column_name = 'match_status'
        )
        INTO v_has_id, v_has_snap_fk, v_has_match;

        IF NOT (v_has_id AND v_has_snap_fk AND v_has_match) THEN
            INSERT INTO stage09_skipped (entity_family, base_table, reason)
            VALUES (
                m.entity_family,
                m.base_table,
                'missing required column(s): id, source_snapshot_id, and/or match_status'
            );

            IF m.required_min THEN
                RAISE EXCEPTION
                    'required columns missing on %I.%I: need id, source_snapshot_id, match_status',
                    p.staging_schema,
                    m.base_table;
            END IF;

            CONTINUE;
        END IF;

        v_select := 'c.id AS candidate_id, c.source_snapshot_id, snap.snapshot_version AS snapshot_version';

        FOREACH v_col IN ARRAY v_order LOOP
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns AS c
                WHERE c.table_schema = p.staging_schema
                  AND c.table_name = m.base_table
                  AND c.column_name = v_col
            )
            INTO v_col_exists;

            IF v_col_exists THEN
                v_select := v_select || ', c.' || quote_ident(v_col);
            END IF;
        END LOOP;

        v_view_nc := 'v_no_conflict_' || m.nc_suffix;
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.%I AS
            SELECT %s
            FROM %I.%I AS c
            LEFT JOIN %I.%I AS snap
                ON snap.id = c.source_snapshot_id
            WHERE %s
            $sql$,
            p.staging_schema,
            v_view_nc,
            v_select,
            p.staging_schema,
            m.base_table,
            p.system_schema,
            'system_source_snapshots',
            v_where_nc
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, v_view_nc)
        ON CONFLICT DO NOTHING;

        v_view_rv := 'v_review_' || m.rv_middle || '_conflicts';
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.%I AS
            SELECT %s
            FROM %I.%I AS c
            LEFT JOIN %I.%I AS snap
                ON snap.id = c.source_snapshot_id
            WHERE %s
            $sql$,
            p.staging_schema,
            v_view_rv,
            v_select,
            p.staging_schema,
            m.base_table,
            p.system_schema,
            'system_source_snapshots',
            v_where_rv
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, v_view_rv)
        ON CONFLICT DO NOTHING;

        IF m.include_manual_views THEN
            v_view_mn :=
                'v_manual_protected_'
                || regexp_replace(m.nc_suffix, '_candidates$', '')
                || '_candidates';

            EXECUTE format(
                $sql$
                CREATE OR REPLACE VIEW %I.%I AS
                SELECT %s
                FROM %I.%I AS c
                LEFT JOIN %I.%I AS snap
                    ON snap.id = c.source_snapshot_id
                WHERE %s
                $sql$,
                p.staging_schema,
                v_view_mn,
                v_select,
                p.staging_schema,
                m.base_table,
                p.system_schema,
                'system_source_snapshots',
                v_where_mn
            );

            INSERT INTO stage09_created_views (view_schema, view_name)
            VALUES (p.staging_schema, v_view_mn)
            ON CONFLICT DO NOTHING;
        ELSE
            v_view_mn := NULL;
        END IF;

        INSERT INTO stage09_family_summary (
            entity_family,
            base_table,
            nc_view,
            rv_view,
            mn_view,
            nc_view_created,
            rv_view_created,
            mn_view_created
        )
        VALUES (
            m.entity_family,
            m.base_table,
            v_view_nc,
            v_view_rv,
            v_view_mn,
            true,
            true,
            v_view_mn IS NOT NULL
        );
    END LOOP;
END
$stage09_build$;

DO $stage09_typed_review_views$
DECLARE
    p stage09_params%ROWTYPE;
    v_has_places boolean;
    v_has_addresses boolean;
    v_has_links boolean;
BEGIN
    SELECT *
    INTO STRICT p
    FROM stage09_params;

    v_has_places := to_regclass(format('%I.staging_place_candidates', p.staging_schema)) IS NOT NULL;
    v_has_addresses := to_regclass(format('%I.staging_address_candidates', p.staging_schema)) IS NOT NULL;
    v_has_links := to_regclass(format('%I.staging_place_address_link_candidates', p.staging_schema)) IS NOT NULL;

    IF pg_temp.pipeline_entity_family_enabled('places') AND v_has_places THEN
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.review_places_v AS
            SELECT
                NULL::bigint AS review_batch_id,
                p.source_snapshot_id,
                snap.snapshot_version,
                snap.region_code,
                p.id AS candidate_id,
                p.external_id,
                p.source_entity_type,
                coalesce(to_jsonb(p)->>'source_name', p.canonical_name) AS source_name,
                coalesce(to_jsonb(p)->>'source_type_hint', p.class_code) AS source_type_hint,
                to_jsonb(p)->>'source_category_hint' AS source_category_hint,
                to_jsonb(p)->>'source_classification' AS source_classification,
                (to_jsonb(p)->>'has_place_evidence')::boolean AS has_place_evidence,
                (to_jsonb(p)->>'has_address_evidence')::boolean AS has_address_evidence,
                to_jsonb(p)->>'address_strength' AS address_strength,
                p.canonical_name,
                p.class_code,
                p.place_class_id,
                p.poi_category_id,
                p.admin_area_candidate_id,
                p.matched_core_place_id,
                p.match_status,
                p.auto_action,
                p.review_status,
                to_jsonb(p)->>'promotion_status' AS promotion_status,
                p.confidence_score,
                p.source_refs,
                p.normalized_data,
                CASE
                    WHEN p.point_geom IS NOT NULL THEN ST_AsGeoJSON(p.point_geom)::jsonb
                    ELSE NULL::jsonb
                END AS geometry_geojson,
                p.created_at,
                p.updated_at,
                to_jsonb(p)->>'review_decision' AS review_decision,
                to_jsonb(p)->>'review_note' AS review_note
            FROM %I.staging_place_candidates AS p
            LEFT JOIN %I.system_source_snapshots AS snap
                ON snap.id = p.source_snapshot_id
            WHERE coalesce(to_jsonb(p)->>'source_classification', '') IN ('place_only', 'place_with_address')
               OR coalesce((to_jsonb(p)->>'has_place_evidence')::boolean, false) IS TRUE
            $sql$,
            p.staging_schema,
            p.staging_schema,
            p.system_schema
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, 'review_places_v')
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO stage09_skipped (entity_family, base_table, reason)
        VALUES ('places_typed', 'staging_place_candidates', 'typed review view skipped; table missing');
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses') AND v_has_addresses THEN
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.review_addresses_v AS
            SELECT
                NULL::bigint AS review_batch_id,
                a.source_snapshot_id,
                snap.snapshot_version,
                snap.region_code,
                a.id AS candidate_id,
                a.external_id,
                a.source_feature_family,
                to_jsonb(a)->>'source_name' AS source_name,
                to_jsonb(a)->>'source_type_hint' AS source_type_hint,
                to_jsonb(a)->>'source_category_hint' AS source_category_hint,
                to_jsonb(a)->>'source_classification' AS source_classification,
                (to_jsonb(a)->>'has_place_evidence')::boolean AS has_place_evidence,
                (to_jsonb(a)->>'has_address_evidence')::boolean AS has_address_evidence,
                to_jsonb(a)->>'address_strength' AS address_strength,
                a.full_address,
                a.house_number,
                a.street_name,
                a.quarter,
                a.suburb,
                a.township,
                a.city,
                a.district,
                a.state_region,
                a.postcode,
                a.country,
                a.matched_core_address_id,
                a.matched_place_candidate_id,
                a.matched_building_candidate_id,
                a.matched_road_candidate_id,
                a.match_status,
                a.auto_action,
                a.review_status,
                to_jsonb(a)->>'validation_status' AS validation_status,
                to_jsonb(a)->>'promotion_status' AS promotion_status,
                a.confidence_score,
                a.source_refs,
                a.normalized_data,
                CASE
                    WHEN a.point_geom IS NOT NULL THEN ST_AsGeoJSON(a.point_geom)::jsonb
                    WHEN a.geom IS NOT NULL THEN ST_AsGeoJSON(a.geom)::jsonb
                    ELSE NULL::jsonb
                END AS geometry_geojson,
                a.created_at,
                a.updated_at,
                to_jsonb(a)->>'review_decision' AS review_decision,
                to_jsonb(a)->>'review_note' AS review_note
            FROM %I.staging_address_candidates AS a
            LEFT JOIN %I.system_source_snapshots AS snap
                ON snap.id = a.source_snapshot_id
            WHERE coalesce(to_jsonb(a)->>'source_classification', '') IN (
                'address_only',
                'place_with_address',
                'weak_address'
            )
               OR coalesce((to_jsonb(a)->>'has_address_evidence')::boolean, false) IS TRUE
            $sql$,
            p.staging_schema,
            p.staging_schema,
            p.system_schema
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, 'review_addresses_v')
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO stage09_skipped (entity_family, base_table, reason)
        VALUES ('addresses_typed', 'staging_address_candidates', 'typed review view skipped; table missing');
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links') AND v_has_links THEN
        EXECUTE format(
            $sql$
            CREATE OR REPLACE VIEW %I.review_place_address_links_v AS
            SELECT
                NULL::bigint AS review_batch_id,
                l.source_snapshot_id,
                snap.snapshot_version,
                snap.region_code,
                l.id AS candidate_id,
                l.external_id,
                l.place_candidate_id,
                place.external_id AS place_external_id,
                coalesce(to_jsonb(place)->>'source_name', place.canonical_name) AS source_name,
                coalesce(to_jsonb(place)->>'source_type_hint', place.class_code) AS source_type_hint,
                to_jsonb(place)->>'source_category_hint' AS source_category_hint,
                l.address_candidate_id,
                address.external_id AS address_external_id,
                l.relation_type,
                l.is_primary,
                l.source_classification,
                l.address_strength,
                l.match_status,
                l.auto_action,
                l.review_status,
                l.validation_status,
                l.promotion_status,
                l.confidence_score,
                l.source_refs,
                l.normalized_data,
                CASE
                    WHEN place.point_geom IS NOT NULL THEN ST_AsGeoJSON(place.point_geom)::jsonb
                    ELSE NULL::jsonb
                END AS place_geometry_geojson,
                CASE
                    WHEN address.point_geom IS NOT NULL THEN ST_AsGeoJSON(address.point_geom)::jsonb
                    WHEN address.geom IS NOT NULL THEN ST_AsGeoJSON(address.geom)::jsonb
                    ELSE NULL::jsonb
                END AS address_geometry_geojson,
                l.created_at,
                l.updated_at,
                to_jsonb(l)->>'review_decision' AS review_decision,
                to_jsonb(l)->>'review_note' AS review_note
            FROM %I.staging_place_address_link_candidates AS l
            LEFT JOIN %I.staging_place_candidates AS place
                ON place.id = l.place_candidate_id
            LEFT JOIN %I.staging_address_candidates AS address
                ON address.id = l.address_candidate_id
            LEFT JOIN %I.system_source_snapshots AS snap
                ON snap.id = l.source_snapshot_id
            $sql$,
            p.staging_schema,
            p.staging_schema,
            p.staging_schema,
            p.staging_schema,
            p.system_schema
        );

        INSERT INTO stage09_created_views (view_schema, view_name)
        VALUES (p.staging_schema, 'review_place_address_links_v')
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO stage09_skipped (entity_family, base_table, reason)
        VALUES ('place_address_links_typed', 'staging_place_address_link_candidates', 'typed review view skipped; table missing');
    END IF;
END
$stage09_typed_review_views$;

DO $stage09_typed_counts$
DECLARE
    p stage09_params%ROWTYPE;
    v_sql text;
BEGIN
    SELECT *
    INTO STRICT p
    FROM stage09_params;

    CREATE TEMP TABLE IF NOT EXISTS stage09_typed_view_counts (
        entity_family text,
        row_count bigint
    ) ON COMMIT DROP;

    TRUNCATE stage09_typed_view_counts;

    IF pg_temp.pipeline_entity_family_enabled('places')
       AND to_regclass(format('%I.review_places_v', p.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            'INSERT INTO stage09_typed_view_counts SELECT ''places'', count(*)::bigint FROM %I.review_places_v',
            p.staging_schema
        );
        EXECUTE v_sql;
    END IF;

    IF pg_temp.pipeline_entity_family_enabled('addresses')
       AND to_regclass(format('%I.review_addresses_v', p.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            'INSERT INTO stage09_typed_view_counts SELECT ''addresses'', count(*)::bigint FROM %I.review_addresses_v',
            p.staging_schema
        );
        EXECUTE v_sql;
    END IF;

    IF pg_temp.pipeline_stage11_family_enabled('place_address_links')
       AND to_regclass(format('%I.review_place_address_links_v', p.staging_schema)) IS NOT NULL THEN
        v_sql := format(
            'INSERT INTO stage09_typed_view_counts SELECT ''place_address_links'', count(*)::bigint FROM %I.review_place_address_links_v',
            p.staging_schema
        );
        EXECUTE v_sql;
    END IF;
END
$stage09_typed_counts$;

SELECT
    'stage09_family_summary' AS section,
    entity_family,
    base_table,
    nc_view,
    rv_view,
    mn_view,
    nc_view_created,
    rv_view_created,
    mn_view_created
FROM stage09_family_summary
ORDER BY entity_family;

SELECT
    'stage09_created_or_replaced_views' AS section,
    format('%I.%I', view_schema, view_name) AS full_view_name
FROM stage09_created_views
ORDER BY full_view_name;

SELECT
    'stage09_skipped_tables' AS section,
    entity_family,
    base_table,
    reason
FROM stage09_skipped
ORDER BY entity_family;

SELECT
    'stage09_expected_counts_by_entity_family' AS section,
    entity_family,
    row_count
FROM stage09_typed_view_counts
ORDER BY entity_family;

COMMIT;
