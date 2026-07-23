-- =============================================================================
-- Remote-review conflict package helpers (human-decision IR upload only).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- Classes that go to import_review (human decision).
CREATE OR REPLACE FUNCTION system.pipeline_ir_conflict_classes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[
        'duplicate',
        'conflict',
        'manual_protected',
        'verified_conflict',
        'possible_delete'
    ]::text[];
$$;

-- Classes that go to direct core load (not IR).
-- pmtiles_only is never a direct-core class.
CREATE OR REPLACE FUNCTION system.pipeline_direct_core_classes()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY['safe_new', 'safe_update']::text[];
$$;

-- Basemap-only class: stays local / tiles; never Import Review.
CREATE OR REPLACE FUNCTION system.pipeline_is_pmtiles_only_class(p_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_class, ''))) = 'pmtiles_only';
$$;

CREATE OR REPLACE FUNCTION system.pipeline_is_ir_conflict_class(p_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_class, ''))) = ANY (system.pipeline_ir_conflict_classes());
$$;

-- Map final import_class → legacy match_status values used by dashboard/IR.
CREATE OR REPLACE FUNCTION system.pipeline_import_class_to_match_status(p_class text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_class, '')))
        WHEN 'duplicate' THEN 'duplicate'
        WHEN 'conflict' THEN 'conflict'
        WHEN 'manual_protected' THEN 'manual_protected'
        WHEN 'verified_conflict' THEN 'verified_conflict'
        WHEN 'possible_delete' THEN 'possible_delete'
        ELSE 'conflict'
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_import_class_to_auto_action(p_class text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_class, '')))
        WHEN 'duplicate' THEN 'possible_duplicate'
        WHEN 'conflict' THEN 'needs_review'
        WHEN 'manual_protected' THEN 'protect_manual'
        WHEN 'verified_conflict' THEN 'needs_review'
        WHEN 'possible_delete' THEN 'delete_candidate'
        ELSE 'needs_review'
    END;
$$;

-- Compact core snapshot for reviewer comparison (no huge geometries/json dumps).
CREATE OR REPLACE FUNCTION system.pipeline_compact_core_snapshot(p_core jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_core IS NULL OR p_core = '{}'::jsonb THEN NULL
        ELSE jsonb_strip_nulls(jsonb_build_object(
            'id', p_core->'id',
            'public_id', p_core->'public_id',
            'external_id', p_core->'external_id',
            'primary_name', coalesce(p_core->'primary_name', p_core->'canonical_name', p_core->'name'),
            'display_name', p_core->'display_name',
            'category_id', p_core->'category_id',
            'admin_area_id', p_core->'admin_area_id',
            'is_verified', p_core->'is_verified',
            'verification_status', p_core->'verification_status',
            'manual_override', p_core->'manual_override',
            'lat', coalesce(p_core->'lat', p_core->'point_geom'->'coordinates'->1),
            'lng', coalesce(p_core->'lng', p_core->'point_geom'->'coordinates'->0),
            'source_refs', p_core->'source_refs'
        ))
    END;
$$;

-- Compact imported values for places-shaped rows (from staging jsonb projection).
CREATE OR REPLACE FUNCTION system.pipeline_compact_imported_place_values(p_row jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'external_id', p_row->'external_id',
        'primary_name', coalesce(p_row->'primary_name', p_row->'canonical_name'),
        'display_name', p_row->'display_name',
        'category_id', coalesce(p_row->'category_id', p_row->'poi_category_id'),
        'place_class_id', p_row->'place_class_id',
        'admin_area_id', p_row->'admin_area_id',
        'lat', p_row->'lat',
        'lng', p_row->'lng',
        'class_code', p_row->'class_code',
        'confidence_score', p_row->'confidence_score',
        'source_hash', coalesce(p_row->'source_hash', p_row->'normalized_hash')
    ));
$$;

CREATE OR REPLACE FUNCTION system.pipeline_conflict_difference_summary(
    p_imported jsonb,
    p_core jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_fields text[] := ARRAY[]::text[];
    v_key text;
    v_keys text[] := ARRAY[
        'primary_name', 'display_name', 'category_id', 'admin_area_id', 'lat', 'lng', 'external_id'
    ];
BEGIN
    IF p_core IS NULL OR p_core = '{}'::jsonb THEN
        RETURN jsonb_build_object('kind', 'no_core_match', 'fields', '[]'::jsonb);
    END IF;

    FOREACH v_key IN ARRAY v_keys LOOP
        IF (p_imported ->> v_key) IS DISTINCT FROM (p_core ->> v_key)
           AND NOT (
               v_key IN ('primary_name', 'display_name')
               AND coalesce(p_imported ->> v_key, p_imported ->> 'canonical_name')
                   IS NOT DISTINCT FROM coalesce(p_core ->> v_key, p_core ->> 'canonical_name', p_core ->> 'name')
           )
        THEN
            v_fields := array_append(v_fields, v_key);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'kind', 'field_diff',
        'fields', to_jsonb(v_fields),
        'field_count', coalesce(cardinality(v_fields), 0)
    );
END;
$$;
