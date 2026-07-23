-- =============================================================================
-- Shared candidate validation helpers (local staging only).
--
-- validation_status: valid | warning | invalid
-- source_status:     source_new | source_changed | source_unchanged | source_missing
--
-- Invalid records must stay local (Stage J must exclude them).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

\ir pipeline_settlements.sql

-- Approximate Myanmar mainland + islands bounding box (WGS84).
CREATE OR REPLACE FUNCTION system.pipeline_geom_in_myanmar_bounds(p_geom geometry)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL THEN false
        ELSE ST_Intersects(
            ST_SetSRID(ST_MakeEnvelope(92.1, 9.5, 101.2, 28.6), 4326),
            ST_SetSRID(p_geom, 4326)
        )
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_geometry_hash(p_geom geometry)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL THEN NULL
        ELSE md5(encode(ST_AsBinary(ST_SnapToGrid(ST_Force2D(p_geom), 0.0000001)), 'hex'))
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_map_diff_to_source_status(p_diff_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_diff_type, '')))
        WHEN 'new' THEN 'source_new'
        WHEN 'changed' THEN 'source_changed'
        WHEN 'unchanged' THEN 'source_unchanged'
        WHEN 'deleted_candidate' THEN 'source_missing'
        WHEN 'source_new' THEN 'source_new'
        WHEN 'source_changed' THEN 'source_changed'
        WHEN 'source_unchanged' THEN 'source_unchanged'
        WHEN 'source_missing' THEN 'source_missing'
        ELSE NULL
    END;
$$;

-- Family-aware technical validation.
-- Returns jsonb: { "status": "valid|warning|invalid", "notes": ["..."] }
CREATE OR REPLACE FUNCTION system.pipeline_validate_candidate(
    p_family text,
    p_external_id text,
    p_normalized_data jsonb,
    p_geom geometry,
    p_class_code text DEFAULT NULL,
    p_class_id bigint DEFAULT NULL,
    p_canonical_name text DEFAULT NULL,
    p_admin_level_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_family text := lower(btrim(coalesce(p_family, '')));
    v_notes text[] := ARRAY[]::text[];
    v_invalid boolean := false;
    v_warning boolean := false;
    v_gtype text;
    v_identity text;
    v_expect_line boolean := false;
    v_expect_poly boolean := false;
    v_expect_point boolean := false;
    v_require_class boolean := false;
    v_require_name boolean := false;
    v_require_admin_level boolean := false;
    v_allow_missing_name_as_warning boolean := true;
BEGIN
    v_identity := system.pipeline_osm_identity_key(p_external_id);
    IF v_identity IS NULL
       OR system.pipeline_osm_classify_identity(p_external_id) <> 'canonical_long' THEN
        v_notes := array_append(v_notes, 'canonical_external_identity_missing_or_invalid');
        v_invalid := true;
    END IF;

    CASE v_family
        WHEN 'roads', 'water_lines', 'routing_roads' THEN
            v_expect_line := true;
            v_require_class := (v_family = 'roads');
        WHEN 'buildings', 'landuse', 'water_polygons', 'admin_areas' THEN
            v_expect_poly := true;
            v_require_class := (v_family IN ('landuse'));
            v_require_name := (v_family = 'admin_areas');
            v_require_admin_level := (v_family = 'admin_areas');
        WHEN 'places' THEN
            v_expect_point := true;
            v_require_class := true;
            -- Settlements: name is required (missing_required_name → invalid).
            IF system.pipeline_settlement_requires_name(p_class_code) THEN
                v_require_name := true;
                v_allow_missing_name_as_warning := false;
            END IF;
            -- Unknown place=* leaf that slipped through mapping.
            IF nullif(btrim(coalesce(p_normalized_data->>'source_category_hint', '')), '') = 'settlement'
               AND NOT system.pipeline_is_settlement_place(p_class_code) THEN
                v_notes := array_append(v_notes, 'unsupported_type');
                v_invalid := true;
            END IF;
        WHEN 'routing_barriers' THEN
            -- Barriers may be points or linear obstacles.
            NULL;
        ELSE
            -- Unknown family: only identity + optional geom checks.
            NULL;
    END CASE;

    IF v_family = 'routing_barriers' THEN
        IF p_geom IS NULL THEN
            v_notes := array_append(v_notes, 'geometry_missing');
            v_invalid := true;
        ELSE
            IF NOT ST_IsValid(p_geom) THEN
                v_notes := array_append(v_notes, 'geometry_invalid');
                v_invalid := true;
            END IF;
            v_gtype := GeometryType(p_geom);
            IF v_gtype NOT IN ('POINT', 'MULTIPOINT', 'LINESTRING', 'MULTILINESTRING') THEN
                v_notes := array_append(v_notes, 'geometry_type_mismatch_barrier');
                v_invalid := true;
            END IF;
            IF NOT system.pipeline_geom_in_myanmar_bounds(p_geom) THEN
                v_notes := array_append(v_notes, 'geometry_outside_myanmar_bounds');
                v_invalid := true;
            END IF;
        END IF;
    ELSIF v_expect_line OR v_expect_poly OR v_expect_point THEN
        IF p_geom IS NULL THEN
            v_notes := array_append(v_notes, 'geometry_missing');
            v_invalid := true;
        ELSE
            IF NOT ST_IsValid(p_geom) THEN
                v_notes := array_append(v_notes, 'geometry_invalid');
                v_invalid := true;
            END IF;

            v_gtype := GeometryType(p_geom);
            IF v_expect_line AND v_gtype NOT IN ('LINESTRING', 'MULTILINESTRING') THEN
                v_notes := array_append(v_notes, 'geometry_type_mismatch_line');
                v_invalid := true;
            ELSIF v_expect_poly AND v_gtype NOT IN ('POLYGON', 'MULTIPOLYGON') THEN
                v_notes := array_append(v_notes, 'geometry_type_mismatch_polygon');
                v_invalid := true;
            ELSIF v_expect_point AND v_gtype NOT IN ('POINT', 'MULTIPOINT') THEN
                v_notes := array_append(v_notes, 'geometry_type_mismatch_point');
                v_invalid := true;
            END IF;

            IF NOT system.pipeline_geom_in_myanmar_bounds(p_geom) THEN
                v_notes := array_append(v_notes, 'geometry_outside_myanmar_bounds');
                v_invalid := true;
            END IF;
        END IF;
    END IF;

    IF v_require_class AND p_class_id IS NULL AND nullif(btrim(p_class_code), '') IS NULL THEN
        v_notes := array_append(v_notes, 'category_or_class_mapping_missing');
        v_invalid := true;
    ELSIF NOT v_require_class
          AND p_class_id IS NULL
          AND nullif(btrim(p_class_code), '') IS NULL
          AND v_family IN ('buildings', 'water_lines', 'water_polygons', 'routing_barriers') THEN
        v_notes := array_append(v_notes, 'category_or_class_mapping_missing');
        v_warning := true;
    END IF;

    IF v_require_admin_level AND p_admin_level_id IS NULL THEN
        v_notes := array_append(v_notes, 'admin_level_mapping_missing');
        v_invalid := true;
    END IF;

    IF v_require_name AND nullif(btrim(p_canonical_name), '') IS NULL THEN
        IF system.pipeline_settlement_requires_name(p_class_code) THEN
            v_notes := array_append(v_notes, 'missing_required_name');
        ELSE
            v_notes := array_append(v_notes, 'required_name_missing');
        END IF;
        v_invalid := true;
    ELSIF v_allow_missing_name_as_warning
          AND v_family IN ('roads', 'places', 'buildings', 'landuse', 'water_lines', 'water_polygons')
          AND nullif(btrim(p_canonical_name), '') IS NULL THEN
        v_notes := array_append(v_notes, 'optional_name_missing');
        v_warning := true;
    END IF;

    -- Settlement admin assignment: required types without covering admin → invalid.
    IF v_family = 'places'
       AND system.pipeline_settlement_requires_admin(p_class_code)
       AND coalesce(p_normalized_data->>'admin_area_id', '') = ''
       AND coalesce(p_normalized_data->>'core_admin_area_id', '') = ''
       AND coalesce(p_normalized_data->>'admin_area_candidate_id', '') = '' THEN
        v_notes := array_append(v_notes, 'outside_admin');
        v_invalid := true;
    END IF;

    -- Source fields needed for loading.
    IF coalesce(p_normalized_data, '{}'::jsonb) = '{}'::jsonb
       AND v_family IN ('roads', 'places', 'buildings', 'admin_areas', 'landuse') THEN
        v_notes := array_append(v_notes, 'normalized_data_empty');
        v_warning := true;
    END IF;

    RETURN jsonb_build_object(
        'status', CASE
            WHEN v_invalid THEN 'invalid'
            WHEN v_warning THEN 'warning'
            ELSE 'valid'
        END,
        'notes', to_jsonb(v_notes)
    );
END;
$$;
