-- =============================================================================
-- Prod mirror 03: refresh_prod_mirror (slim family columns)
--
-- Copies only comparison fields from supabase_fdw → prod_mirror.
-- Does not copy large unused normalized_data / history blobs.
-- Does not modify Supabase, local core, raw, or staging.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?source_project_ref}
\else
\set source_project_ref ''
\endif
\if :{?source_host}
\else
\set source_host ''
\endif
\if :{?source_database}
\else
\set source_database ''
\endif
\if :{?source_user}
\else
\set source_user ''
\endif

BEGIN;

\ir pipeline_prod_mirror_helpers.sql

CREATE TEMP TABLE prod_mirror_table_manifest (
    table_name text PRIMARY KEY,
    family_group text NOT NULL,
    required_for_f2 boolean NOT NULL DEFAULT false,
    strongly_recommended boolean NOT NULL DEFAULT false,
    wanted_columns text[] NOT NULL,
    geom_column text,
    name_columns text[] NOT NULL DEFAULT ARRAY[]::text[],
    class_columns text[] NOT NULL DEFAULT ARRAY[]::text[],
    has_manual_override boolean NOT NULL DEFAULT false,
    has_is_verified boolean NOT NULL DEFAULT true,
    has_verification_status boolean NOT NULL DEFAULT true,
    has_deleted_at boolean NOT NULL DEFAULT true,
    has_external_id boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

-- Explicit family field lists (intersected with live FDW columns at runtime).
-- normalized_data intentionally omitted (large; not required for F2 identity/protection).
INSERT INTO prod_mirror_table_manifest (
    table_name, family_group, required_for_f2, strongly_recommended,
    wanted_columns, geom_column, name_columns, class_columns,
    has_manual_override, has_is_verified, has_verification_status, has_deleted_at, has_external_id
)
VALUES
    (
        'core_places', 'places', true, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_type_id', 'source_refs',
            'primary_name', 'display_name', 'category_id', 'admin_area_id',
            'point_geom', 'footprint_geom',
            'is_verified', 'verification_status', 'deleted_at', 'updated_at', 'created_at'
        ],
        'point_geom',
        ARRAY['primary_name', 'display_name'],
        ARRAY['category_id'],
        false, true, true, true, true
    ),
    (
        'core_streets', 'roads', true, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_type_id', 'source_refs',
            'canonical_name', 'road_class_id', 'road_class', 'admin_area_id', 'geom',
            'manual_override', 'is_verified', 'verification_status',
            'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['canonical_name'],
        ARRAY['road_class_id', 'road_class'],
        true, true, true, true, true
    ),
    (
        'core_buildings', 'buildings', true, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_refs',
            'name', 'building_type_id', 'admin_area_id', 'geom', 'centroid',
            'is_verified', 'verification_status', 'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['name'],
        ARRAY['building_type_id'],
        false, true, true, true, true
    ),
    (
        'core_admin_areas', 'admin_areas', false, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_type_id', 'source_refs',
            'canonical_name', 'admin_level_id', 'geom', 'centroid',
            'is_verified', 'verification_status', 'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['canonical_name'],
        ARRAY['admin_level_id'],
        false, true, true, true, true
    ),
    (
        'core_land_areas', 'landuse', false, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_refs',
            'name', 'land_area_class_id', 'admin_area_id', 'geom', 'centroid',
            'manual_override', 'is_verified', 'verification_status',
            'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['name'],
        ARRAY['land_area_class_id'],
        true, true, true, true, true
    ),
    (
        'core_water_lines', 'water_lines', false, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_refs',
            'name', 'water_class_id', 'geom',
            'is_verified', 'verification_status', 'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['name'],
        ARRAY['water_class_id'],
        false, true, true, true, true
    ),
    (
        'core_water_polygons', 'water_polygons', false, true,
        ARRAY[
            'id', 'public_id', 'external_id', 'source_refs',
            'name', 'water_class_id', 'geom',
            'is_verified', 'verification_status', 'deleted_at', 'updated_at', 'created_at'
        ],
        'geom',
        ARRAY['name'],
        ARRAY['water_class_id'],
        false, true, true, true, true
    ),
    (
        'core_addresses', 'addresses', false, true,
        ARRAY[
            'id', 'public_id', 'source_type_id', 'source_refs',
            'full_address', 'street_id', 'admin_area_id', 'point_geom', 'geom',
            'manual_override', 'is_verified', 'verification_status',
            'deleted_at', 'updated_at', 'created_at'
        ],
        'point_geom',
        ARRAY['full_address'],
        ARRAY[]::text[],
        true, true, true, true, false
    ),
    (
        'core_place_names', 'places', false, true,
        ARRAY['id', 'place_id', 'name', 'language_code', 'name_type', 'is_primary'],
        NULL, ARRAY['name'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'core_street_names', 'roads', false, true,
        ARRAY['id', 'street_id', 'name', 'language_code', 'name_type', 'is_primary'],
        NULL, ARRAY['name'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'core_admin_area_names', 'admin_areas', false, true,
        ARRAY['id', 'admin_area_id', 'name', 'language_code', 'name_type', 'is_primary'],
        NULL, ARRAY['name'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'core_place_sources', 'places', false, false,
        ARRAY['id', 'place_id', 'source_type_id', 'external_id'],
        NULL, ARRAY[]::text[], ARRAY[]::text[],
        false, false, false, false, true
    ),
    (
        'core_address_components', 'addresses', false, false,
        ARRAY[
            'id', 'address_id', 'component_type_id', 'component_value',
            'language_code', 'source_refs', 'updated_at', 'created_at'
        ],
        NULL, ARRAY['component_value'], ARRAY['component_type_id'],
        false, false, false, false, false
    ),
    (
        'ref_source_types', 'ref', false, false,
        ARRAY['id', 'code', 'name', 'description'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'ref_poi_categories', 'ref', false, false,
        ARRAY['id', 'code', 'name', 'parent_id'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'ref_road_classes', 'ref', false, false,
        ARRAY['id', 'code', 'name'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'ref_admin_levels', 'ref', false, false,
        ARRAY['id', 'code', 'name', 'level_rank'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'ref_address_component_types', 'ref', false, false,
        ARRAY['id', 'code', 'name'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'ref_building_types', 'ref', false, false,
        ARRAY['id', 'code', 'name'],
        NULL, ARRAY['name', 'code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'system_source_registry', 'system', false, false,
        ARRAY['id', 'source_code', 'name', 'source_type', 'is_active', 'updated_at', 'created_at'],
        NULL, ARRAY['name', 'source_code'], ARRAY[]::text[],
        false, false, false, false, false
    ),
    (
        'system_source_snapshots', 'system', false, false,
        ARRAY[
            'id', 'source_registry_id', 'snapshot_version', 'region_code',
            'captured_at', 'status', 'updated_at', 'created_at'
        ],
        NULL, ARRAY['snapshot_version'], ARRAY[]::text[],
        false, false, false, false, false
    );

CREATE TEMP TABLE prod_mirror_refresh_report (
    table_name text,
    family_group text,
    live_count bigint,
    mirror_count bigint,
    column_count int,
    status text,
    note text
) ON COMMIT DROP;

CREATE TEMP TABLE prod_mirror_count_json (
    table_name text PRIMARY KEY,
    live_count bigint,
    mirror_count bigint
) ON COMMIT DROP;

CREATE TEMP TABLE prod_mirror_source_params (
    source_project_ref text,
    source_host text,
    source_database text,
    source_user text
) ON COMMIT DROP;

INSERT INTO prod_mirror_source_params (
    source_project_ref,
    source_host,
    source_database,
    source_user
)
VALUES (
    NULLIF(btrim(:'source_project_ref'), ''),
    NULLIF(btrim(:'source_host'), ''),
    NULLIF(btrim(:'source_database'), ''),
    NULLIF(btrim(:'source_user'), '')
);

\ir pipeline_prod_mirror_refresh_do.sql

SELECT
    'prod_mirror_refresh' AS section,
    table_name,
    family_group,
    live_count,
    mirror_count,
    column_count,
    status,
    note
FROM prod_mirror_refresh_report
ORDER BY
    CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    table_name;

SELECT
    'prod_mirror_meta' AS section,
    refreshed_at,
    source_project_ref,
    source_host,
    source_database,
    refresh_mode,
    table_counts,
    notes
FROM prod_mirror.mirror_meta
WHERE id = 1;

COMMIT;
