-- =============================================================================
-- Final import classification helpers (local only).
-- See docs/osm-pipeline-import-classification.md for thresholds and auto fields.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.pipeline_is_osm_derived(
    p_external_id text,
    p_source_refs jsonb DEFAULT NULL,
    p_source_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        system.pipeline_osm_identity_key(p_external_id) IS NOT NULL
        OR coalesce(p_source_refs, '{}'::jsonb)::text ILIKE '%osm%'
        OR coalesce(p_source_type, '') ILIKE '%osm%';
$$;

CREATE OR REPLACE FUNCTION system.pipeline_auto_update_fields(p_family text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_family, '')))
        WHEN 'places' THEN ARRAY[
            'canonical_name', 'primary_name', 'display_name', 'name',
            'class_code', 'category_id', 'place_class_id',
            'point_geom', 'admin_area_id'
        ]
        WHEN 'buildings' THEN ARRAY[
            'canonical_name', 'name', 'class_code', 'building_type_id',
            'geom', 'centroid', 'admin_area_id'
        ]
        WHEN 'roads' THEN ARRAY[
            'canonical_name', 'class_code', 'road_class_id', 'road_class',
            'geom', 'is_oneway', 'surface', 'access', 'vehicle',
            'motor_vehicle', 'foot', 'bicycle', 'bus'
        ]
        WHEN 'admin_areas' THEN ARRAY['canonical_name']
        WHEN 'landuse' THEN ARRAY[
            'canonical_name', 'name', 'class_code', 'geom', 'centroid', 'admin_area_id'
        ]
        WHEN 'water_polygons' THEN ARRAY[
            'canonical_name', 'name', 'class_code', 'geom'
        ]
        WHEN 'water_lines' THEN ARRAY[
            'canonical_name', 'name', 'class_code', 'geom'
        ]
        WHEN 'routing_barriers' THEN ARRAY[]::text[]
        ELSE ARRAY['canonical_name', 'name', 'class_code', 'geom', 'point_geom']
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_duplicate_threshold_m(p_family text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_family, '')))
        WHEN 'places' THEN 30
        WHEN 'buildings' THEN 10
        WHEN 'roads' THEN NULL
        WHEN 'admin_areas' THEN 22.3
        WHEN 'landuse' THEN 5
        WHEN 'water_polygons' THEN 5
        WHEN 'water_lines' THEN 10
        WHEN 'routing_barriers' THEN 10
        ELSE 15
    END;
$$;

-- Settlement helpers (type-aware place duplicate radii + final-action map).
\ir pipeline_settlements.sql

CREATE OR REPLACE FUNCTION system.pipeline_decide_import_class(
    p_family text,
    p_validation_status text,
    p_f2_result text,
    p_f2_auto_action text,
    p_source_matched boolean,
    p_spatial_matched boolean,
    p_name_matched boolean,
    p_fallback_matched boolean,
    p_prod_manual_override boolean,
    p_prod_is_verified boolean,
    p_content_changed boolean,
    p_only_auto_fields_changed boolean,
    p_osm_derived_prod boolean
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_family text := lower(btrim(coalesce(p_family, '')));
    v_val text := lower(btrim(coalesce(p_validation_status, '')));
    v_f2 text := lower(btrim(coalesce(p_f2_result, '')));
    v_act text := lower(btrim(coalesce(p_f2_auto_action, '')));
    v_source boolean := coalesce(p_source_matched, false);
    v_spatial boolean := coalesce(p_spatial_matched, false);
    v_fallback boolean := coalesce(p_fallback_matched, false);
    v_changed boolean := coalesce(p_content_changed, false);
    v_auto_ok boolean := coalesce(p_only_auto_fields_changed, true);
    v_osm boolean := coalesce(p_osm_derived_prod, false);
    v_manual boolean := coalesce(p_prod_manual_override, false)
                     OR v_act = 'protect_manual'
                     OR v_f2 = 'manual_protected';
    v_verified boolean := coalesce(p_prod_is_verified, false);
    v_no_match boolean := v_f2 = 'prod_no_match' OR v_act = 'insert_candidate';
    v_non_identity_hit boolean := NOT v_source AND (v_spatial OR v_fallback) AND v_family <> 'roads';
BEGIN
    IF v_val IN ('invalid', 'blocked', 'failed') THEN
        RETURN 'invalid';
    END IF;

    -- No F2 prod row: new, unless a non-identity spatial/fallback hit slipped in.
    IF v_no_match THEN
        IF v_non_identity_hit THEN
            RETURN 'duplicate';
        END IF;
        RETURN 'safe_new';
    END IF;

    -- Protection / verified before duplicate when a prod candidate was selected.
    IF v_manual THEN
        IF NOT v_changed THEN
            RETURN 'unchanged';
        END IF;
        RETURN 'manual_protected';
    END IF;

    IF v_verified AND v_changed THEN
        RETURN 'verified_conflict';
    END IF;

    IF v_act = 'possible_duplicate' OR v_f2 = 'possible_duplicate' OR v_non_identity_hit THEN
        RETURN 'duplicate';
    END IF;

    IF NOT v_changed THEN
        RETURN 'unchanged';
    END IF;

    IF v_act = 'ignore_unchanged' THEN
        RETURN 'unchanged';
    END IF;

    IF v_family = 'routing_barriers' THEN
        RETURN 'conflict';
    END IF;

    IF v_source OR v_act IN ('update_candidate', 'needs_review')
       OR v_f2 IN ('prod_match', 'prod_conflict', 'needs_review') THEN
        IF v_osm AND v_auto_ok THEN
            RETURN 'safe_update';
        END IF;
        RETURN 'conflict';
    END IF;

    RETURN 'conflict';
END;
$$;
