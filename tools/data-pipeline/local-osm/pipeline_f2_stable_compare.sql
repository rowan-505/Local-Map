-- =============================================================================
-- F2 stable comparison helpers (local only).
-- Meaningful field diffs for staging vs prod_mirror — not full-row to_jsonb.
-- See docs/osm-pipeline-import-classification.md and f2_unchanged repair report.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- ---------------------------------------------------------------------------
-- Text / name normalization
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION system.pipeline_norm_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(lower(btrim(coalesce(p_text, ''))), '');
$$;

-- Synthetic / generated labels that must not drive safe_update.
-- Includes CoreMap external_id-as-name forms:
--   osm:way:123 / osm:W:123 / road-123 / street-123 / Unnamed*
CREATE OR REPLACE FUNCTION system.pipeline_is_synthetic_name(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_text, '')), '') IS NULL THEN true
        WHEN btrim(p_text) ~* '^osm:(node|way|relation):[0-9]+$' THEN true
        -- Short OSM feature letter used in CoreMap external_id / generated labels
        WHEN btrim(p_text) ~* '^osm:[nwr]:[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^road-[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^street-[0-9]+$' THEN true
        WHEN btrim(p_text) ~* '^unnamed([ _]|$)' THEN true
        ELSE false
    END;
$$;

-- Meaningful name for comparison: null when either side is synthetic.
CREATE OR REPLACE FUNCTION system.pipeline_meaningful_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN system.pipeline_is_synthetic_name(p_text) THEN NULL
        ELSE system.pipeline_norm_text(p_text)
    END;
$$;

-- ---------------------------------------------------------------------------
-- Geometry normalization + hash + change detection
-- ---------------------------------------------------------------------------

-- Collapse Multi* → simple when possible; Force2D; snap to ~1.1 cm at equator.
-- Documented serialization tolerance: MultiLineString vs LineString with equal
-- coordinates is unchanged; SnapToGrid(1e-7°) absorbs tiny WKB noise.
CREATE OR REPLACE FUNCTION system.pipeline_stable_geom(p_geom geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL OR ST_IsEmpty(p_geom) THEN NULL
        ELSE ST_SnapToGrid(
            ST_Force2D(
                CASE
                    WHEN GeometryType(p_geom) IN ('MULTILINESTRING', 'MULTILINESTRINGM', 'MULTILINESTRINGZ')
                        THEN COALESCE(ST_LineMerge(p_geom), p_geom)
                    WHEN GeometryType(p_geom) IN ('MULTIPOLYGON', 'MULTIPOLYGONM', 'MULTIPOLYGONZ')
                         AND ST_NumGeometries(p_geom) = 1
                        THEN ST_GeometryN(p_geom, 1)
                    WHEN GeometryType(p_geom) IN ('MULTIPOINT', 'MULTIPOINTM', 'MULTIPOINTZ')
                         AND ST_NumGeometries(p_geom) = 1
                        THEN ST_GeometryN(p_geom, 1)
                    ELSE p_geom
                END
            ),
            0.0000001
        )
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_stable_geometry_hash(p_geom geometry)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN system.pipeline_stable_geom(p_geom) IS NULL THEN NULL
        ELSE md5(encode(ST_AsBinary(system.pipeline_stable_geom(p_geom)), 'hex'))
    END;
$$;

-- True when geometries differ beyond documented tolerance.
-- Equal after stable normalize → unchanged.
-- Else Hausdorff < 1e-7 degrees (~0.01 m) → unchanged (tiny serialization noise).
-- Else → changed.
CREATE OR REPLACE FUNCTION system.pipeline_geometry_meaningfully_changed(
    p_a geometry,
    p_b geometry
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_a IS NULL AND p_b IS NULL THEN false
        WHEN p_a IS NULL OR p_b IS NULL THEN true
        WHEN system.pipeline_stable_geometry_hash(p_a)
             IS NOT DISTINCT FROM system.pipeline_stable_geometry_hash(p_b) THEN false
        WHEN ST_Equals(
                system.pipeline_stable_geom(p_a),
                system.pipeline_stable_geom(p_b)
             ) THEN false
        WHEN ST_HausdorffDistance(
                system.pipeline_stable_geom(p_a),
                system.pipeline_stable_geom(p_b)
             ) < 0.0000001 THEN false
        ELSE true
    END;
$$;

-- Deterministic JSON fingerprint (keys already fixed by jsonb_build_object order).
CREATE OR REPLACE FUNCTION system.pipeline_stable_json_hash(p_obj jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(coalesce(jsonb_strip_nulls(coalesce(p_obj, '{}'::jsonb))::text, '{}'));
$$;

-- ---------------------------------------------------------------------------
-- Roads: stable comparison payload + changed flag
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION system.pipeline_resolve_road_class_id(
    p_road_class_id bigint,
    p_class_code text
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    -- Prefer code → id when code is present (avoids cross-DB id drift).
    SELECT coalesce(
        (
            SELECT rc.id
            FROM ref.ref_road_classes AS rc
            WHERE system.pipeline_norm_text(rc.code) = system.pipeline_norm_text(p_class_code)
            ORDER BY rc.id
            LIMIT 1
        ),
        p_road_class_id
    );
$$;

-- Stable class fingerprint: prefer normalized class code; fall back to resolved id.
CREATE OR REPLACE FUNCTION system.pipeline_f2_road_class_fingerprint(
    p_road_class_id bigint,
    p_class_code text
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN system.pipeline_norm_text(p_class_code) IS NOT NULL THEN
            jsonb_build_object('road_class', system.pipeline_norm_text(p_class_code))
        WHEN system.pipeline_resolve_road_class_id(p_road_class_id, p_class_code) IS NOT NULL THEN
            jsonb_build_object(
                'road_class_id',
                system.pipeline_resolve_road_class_id(p_road_class_id, p_class_code)
            )
        ELSE '{}'::jsonb
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_f2_roads_staging_payload(
    p_canonical_name text,
    p_class_code text,
    p_road_class_id bigint,
    p_geom geometry,
    p_admin_area_id bigint,
    p_is_oneway boolean,
    p_surface text,
    p_bridge text,
    p_tunnel text,
    p_layer text,
    p_include_optional_attrs boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_strip_nulls(
        jsonb_build_object(
            'name', system.pipeline_meaningful_name(p_canonical_name),
            'geom_hash', system.pipeline_stable_geometry_hash(p_geom),
            'admin_area_id', p_admin_area_id,
            'is_oneway', CASE WHEN p_include_optional_attrs THEN p_is_oneway ELSE NULL END,
            'surface', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_surface) ELSE NULL END,
            'bridge', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_bridge) ELSE NULL END,
            'tunnel', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_tunnel) ELSE NULL END,
            'layer', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_layer) ELSE NULL END,
            'deleted', false
        ) || system.pipeline_f2_road_class_fingerprint(p_road_class_id, p_class_code)
    );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_f2_roads_prod_payload(
    p_canonical_name text,
    p_road_class text,
    p_road_class_id bigint,
    p_geom geometry,
    p_admin_area_id bigint,
    p_is_oneway boolean,
    p_surface text,
    p_bridge text,
    p_tunnel text,
    p_layer text,
    p_deleted_at timestamptz,
    p_include_optional_attrs boolean DEFAULT false,
    p_compare_admin boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_strip_nulls(
        jsonb_build_object(
            'name', system.pipeline_meaningful_name(p_canonical_name),
            'geom_hash', system.pipeline_stable_geometry_hash(p_geom),
            'admin_area_id', CASE WHEN p_compare_admin THEN p_admin_area_id ELSE NULL END,
            'is_oneway', CASE WHEN p_include_optional_attrs THEN p_is_oneway ELSE NULL END,
            'surface', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_surface) ELSE NULL END,
            'bridge', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_bridge) ELSE NULL END,
            'tunnel', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_tunnel) ELSE NULL END,
            'layer', CASE WHEN p_include_optional_attrs THEN system.pipeline_norm_text(p_layer) ELSE NULL END,
            'deleted', (p_deleted_at IS NOT NULL)
        ) || system.pipeline_f2_road_class_fingerprint(p_road_class_id, p_road_class)
    );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_f2_roads_changed(
    p_staging jsonb,
    p_prod jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT system.pipeline_stable_json_hash(p_staging)
           IS DISTINCT FROM system.pipeline_stable_json_hash(p_prod);
$$;

-- Field-level diff object for diagnostics / f2_comparison.
CREATE OR REPLACE FUNCTION system.pipeline_f2_payload_field_diffs(
    p_staging jsonb,
    p_prod jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(
        (
            SELECT jsonb_object_agg(k, jsonb_build_object('staging', s.val, 'prod', p.val))
            FROM (
                SELECT key AS k FROM jsonb_object_keys(coalesce(p_staging, '{}'::jsonb)) AS key
                UNION
                SELECT key FROM jsonb_object_keys(coalesce(p_prod, '{}'::jsonb)) AS key
            ) AS keys
            LEFT JOIN LATERAL (SELECT p_staging -> keys.k AS val) AS s ON true
            LEFT JOIN LATERAL (SELECT p_prod -> keys.k AS val) AS p ON true
            WHERE s.val IS DISTINCT FROM p.val
        ),
        '{}'::jsonb
    );
$$;

-- ---------------------------------------------------------------------------
-- Places: stable comparison payload
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION system.pipeline_f2_places_staging_payload(
    p_canonical_name text,
    p_category_id bigint,
    p_point_geom geometry,
    p_admin_area_id bigint
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'name', system.pipeline_meaningful_name(p_canonical_name),
        -- Only include category when staging actually resolved one.
        'category_id', p_category_id,
        'geom_hash', system.pipeline_stable_geometry_hash(p_point_geom),
        'admin_area_id', p_admin_area_id,
        'deleted', false
    ));
$$;

CREATE OR REPLACE FUNCTION system.pipeline_f2_places_prod_payload(
    p_primary_name text,
    p_display_name text,
    p_category_id bigint,
    p_point_geom geometry,
    p_admin_area_id bigint,
    p_deleted_at timestamptz,
    p_compare_category boolean DEFAULT true,
    p_compare_admin boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'name', coalesce(
            system.pipeline_meaningful_name(p_primary_name),
            system.pipeline_meaningful_name(p_display_name)
        ),
        'category_id', CASE WHEN p_compare_category THEN p_category_id ELSE NULL END,
        'geom_hash', system.pipeline_stable_geometry_hash(p_point_geom),
        'admin_area_id', CASE WHEN p_compare_admin THEN p_admin_area_id ELSE NULL END,
        'deleted', (p_deleted_at IS NOT NULL)
    ));
$$;

CREATE OR REPLACE FUNCTION system.pipeline_f2_places_changed(
    p_staging jsonb,
    p_prod jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_stable_json_hash(p_staging)
           IS DISTINCT FROM system.pipeline_stable_json_hash(p_prod);
$$;

COMMENT ON FUNCTION system.pipeline_stable_geom(geometry) IS
    'F2 geometry normalize: Force2D, LineMerge MultiLineString, SnapToGrid(1e-7°).';
COMMENT ON FUNCTION system.pipeline_geometry_meaningfully_changed(geometry, geometry) IS
    'F2 geometry change: false when stable-equal or Hausdorff < 1e-7°.';
COMMENT ON FUNCTION system.pipeline_is_synthetic_name(text) IS
    'True for osm:way:N / road-N / empty — excluded from F2 name diffs.';
