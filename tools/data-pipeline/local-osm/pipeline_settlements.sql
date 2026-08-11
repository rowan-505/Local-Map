-- =============================================================================
-- Settlement extraction helpers for local staging and classification.
-- OSM place=* → staging place candidates (later promote to Supabase core.core_places).
-- Admin spatial helpers below read prod_mirror only (local core schema is not used).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- Supported settlement place values (British spelling preferred for neighbourhood).
CREATE OR REPLACE FUNCTION system.pipeline_settlement_place_values()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[
        'city',
        'town',
        'village',
        'hamlet',
        'suburb',
        'quarter',
        'neighbourhood',
        'locality'
    ]::text[];
$$;

CREATE OR REPLACE FUNCTION system.pipeline_is_settlement_place(p_place text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_place, ''))) = ANY (system.pipeline_settlement_place_values())
        OR lower(btrim(coalesce(p_place, ''))) = 'neighborhood';
$$;

CREATE OR REPLACE FUNCTION system.pipeline_normalize_settlement_place(p_place text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_place, '')))
        WHEN 'neighborhood' THEN 'neighbourhood'
        ELSE nullif(lower(btrim(coalesce(p_place, ''))), '')
    END;
$$;

-- Category code in ref.ref_poi_categories (leaf under settlement).
CREATE OR REPLACE FUNCTION system.pipeline_settlement_category_code(p_place text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN system.pipeline_is_settlement_place(p_place)
            THEN system.pipeline_normalize_settlement_place(p_place)
        ELSE NULL
    END;
$$;

-- All supported settlement types require a real name.
CREATE OR REPLACE FUNCTION system.pipeline_settlement_requires_name(p_place text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_is_settlement_place(p_place);
$$;

-- Type-specific duplicate radii (metres).
CREATE OR REPLACE FUNCTION system.pipeline_settlement_duplicate_threshold_m(p_place text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE system.pipeline_normalize_settlement_place(p_place)
        WHEN 'city' THEN 500
        WHEN 'town' THEN 300
        WHEN 'village' THEN 100
        WHEN 'hamlet' THEN 75
        WHEN 'suburb' THEN 150
        WHEN 'quarter' THEN 80
        WHEN 'neighbourhood' THEN 50
        WHEN 'locality' THEN 100
        ELSE NULL
    END;
$$;

-- Places family: settlement radii when class_code is a settlement type, else 30 m.
CREATE OR REPLACE FUNCTION system.pipeline_places_duplicate_threshold_m(p_class_code text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(
        system.pipeline_settlement_duplicate_threshold_m(p_class_code),
        30::numeric
    );
$$;

-- Neighbourhood / quarter need denser matching + stronger admin/name gates.
CREATE OR REPLACE FUNCTION system.pipeline_settlement_requires_admin(p_place text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_normalize_settlement_place(p_place) IN (
        'neighbourhood', 'quarter', 'suburb', 'city', 'town', 'village', 'hamlet', 'locality'
    );
$$;

-- Locality meaning is uncertain → prefer human review for new rows.
CREATE OR REPLACE FUNCTION system.pipeline_settlement_force_review(p_place text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_normalize_settlement_place(p_place) = 'locality';
$$;

-- Map pipeline import_class → pilot final action vocabulary.
CREATE OR REPLACE FUNCTION system.pipeline_import_class_to_final_action(p_import_class text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_import_class, '')))
        WHEN 'safe_new' THEN 'safe_insert'
        WHEN 'safe_update' THEN 'safe_update'
        WHEN 'unchanged' THEN 'skip'
        WHEN 'pmtiles_only' THEN 'skip'
        WHEN 'invalid' THEN 'invalid'
        WHEN 'duplicate' THEN 'send_to_review'
        WHEN 'conflict' THEN 'send_to_review'
        WHEN 'manual_protected' THEN 'send_to_review'
        WHEN 'verified_conflict' THEN 'send_to_review'
        WHEN 'possible_delete' THEN 'send_to_review'
        ELSE 'send_to_review'
    END;
$$;

-- Map import_class / validation notes → review reason codes.
CREATE OR REPLACE FUNCTION system.pipeline_settlement_review_reason(
    p_import_class text,
    p_validation_notes jsonb DEFAULT NULL,
    p_class_code text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_class text := lower(btrim(coalesce(p_import_class, '')));
    v_notes text := coalesce(p_validation_notes::text, '');
BEGIN
    IF v_notes ILIKE '%required_name_missing%' OR v_notes ILIKE '%missing_required_name%' THEN
        RETURN 'missing_required_name';
    END IF;
    IF v_notes ILIKE '%outside_admin%' OR v_notes ILIKE '%admin_assignment_missing%' THEN
        RETURN 'outside_admin';
    END IF;
    IF v_notes ILIKE '%unsupported_type%' OR v_notes ILIKE '%unsupported_settlement%' THEN
        RETURN 'unsupported_type';
    END IF;
    IF v_notes ILIKE '%category_or_class_mapping_missing%' OR v_notes ILIKE '%category_conflict%' THEN
        RETURN 'category_conflict';
    END IF;
    IF v_notes ILIKE '%geometry_%' THEN
        RETURN 'geometry_conflict';
    END IF;

    IF v_class = 'manual_protected' THEN
        RETURN 'manual_protected';
    END IF;
    IF v_class = 'verified_conflict' THEN
        RETURN 'verified_conflict';
    END IF;
    IF v_class = 'duplicate' THEN
        RETURN 'possible_duplicate';
    END IF;
    IF v_class IN ('conflict', 'duplicate') THEN
        RETURN 'possible_duplicate';
    END IF;
    IF v_class = 'invalid' THEN
        RETURN 'unsupported_type';
    END IF;
    RETURN NULL;
END;
$$;

-- Preferred display / canonical name for settlements (Myanmar first).
CREATE OR REPLACE FUNCTION system.pipeline_settlement_canonical_name(p_tags jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(coalesce(
        p_tags->>'name:my',
        p_tags->>'name:mm',
        p_tags->>'name:my-MM',
        p_tags->>'name',
        p_tags->>'official_name',
        p_tags->>'name:en',
        p_tags->>'alt_name',
        ''
    )), '');
$$;

CREATE OR REPLACE FUNCTION system.pipeline_settlement_english_name(p_tags jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(coalesce(
        p_tags->>'name:en',
        CASE
            WHEN p_tags->>'name' ~ '[A-Za-z]' THEN p_tags->>'name'
            ELSE NULL
        END,
        ''
    )), '');
$$;

CREATE OR REPLACE FUNCTION system.pipeline_settlement_myanmar_name(p_tags jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(coalesce(
        p_tags->>'name:my',
        p_tags->>'name:mm',
        p_tags->>'name:my-MM',
        CASE
            WHEN p_tags->>'name' ~ '[\u1000-\u109F]' THEN p_tags->>'name'
            ELSE NULL
        END,
        ''
    )), '');
$$;

-- Smallest covering ward/town/township for a point (production IDs via prod_mirror).
-- Prefer finest level (ward > town > township), then smallest planar area.
-- Main Stage 05 path leaves admin_area_id NULL; Stage 08c assigns township via
-- system.pipeline_find_township_for_*_prod. This helper is for diagnostics/reports.
CREATE OR REPLACE FUNCTION system.pipeline_assign_admin_area_for_point(p_geom geometry)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
    SELECT aa.id
    FROM prod_mirror.core_admin_areas AS aa
    JOIN prod_mirror.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.deleted_at IS NULL
      AND aa.geom IS NOT NULL
      AND al.code IN ('ward_village_tract', 'town', 'township')
      AND p_geom IS NOT NULL
      AND ST_Covers(aa.geom, ST_SetSRID(p_geom, 4326))
    ORDER BY
        CASE al.code
            WHEN 'ward_village_tract' THEN 3
            WHEN 'town' THEN 2
            WHEN 'township' THEN 1
            ELSE 0
        END DESC,
        ST_Area(aa.geom) ASC,
        aa.id
    LIMIT 1;
$$;

-- Final settlement-aware import class (locality → review when would be safe_new).
-- p_skip_admin_gate: Stage 08b sets true so Stage 08c can assign prod township ids
-- before Stage 08d enforces the admin-required → conflict rule.
CREATE OR REPLACE FUNCTION system.pipeline_decide_settlement_import_class(
    p_base_class text,
    p_class_code text,
    p_validation_status text DEFAULT NULL,
    p_admin_area_id bigint DEFAULT NULL,
    p_skip_admin_gate boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_base text := lower(btrim(coalesce(p_base_class, '')));
    v_place text := system.pipeline_normalize_settlement_place(p_class_code);
    v_val text := lower(btrim(coalesce(p_validation_status, '')));
BEGIN
    IF NOT system.pipeline_is_settlement_place(p_class_code) THEN
        RETURN v_base;
    END IF;

    IF v_val IN ('invalid', 'blocked', 'failed') OR v_base = 'invalid' THEN
        RETURN 'invalid';
    END IF;

    IF NOT coalesce(p_skip_admin_gate, false)
       AND system.pipeline_settlement_requires_admin(p_class_code)
       AND p_admin_area_id IS NULL
       AND v_base IN ('safe_new', 'safe_update', 'unchanged') THEN
        RETURN 'conflict';
    END IF;

    IF system.pipeline_settlement_force_review(p_class_code)
       AND v_base = 'safe_new' THEN
        RETURN 'conflict';
    END IF;

    -- Neighbourhood/quarter: denser area — keep spatial duplicates as review (already duplicate).
    RETURN v_base;
END;
$$;
