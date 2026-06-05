-- =============================================================================
-- Stable ENTITY_FAMILIES helpers (system schema).
-- Idempotent — safe to run before every pipeline stage via \ir.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.pipeline_entity_family_registry()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[
        'places',
        'roads',
        'buildings',
        'landuse',
        'water_lines',
        'water_polygons',
        'admin_areas',
        'bus_stops',
        'bus_routes',
        'bus_route_variants',
        'bus_route_stops',
        'addresses',
        'address_components',
        'place_address_links',
        'routing_barriers',
        'routing_roads',
        'routing_turn_restrictions'
    ]::text[];
$$;

CREATE OR REPLACE FUNCTION system.pipeline_normalize_entity_families(p_entity_families text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(nullif(btrim(p_entity_families), ''), 'all')));
$$;

CREATE OR REPLACE FUNCTION system.pipeline_entity_families_is_all(p_entity_families text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_normalize_entity_families(p_entity_families) IN ('all', '*');
$$;

CREATE OR REPLACE FUNCTION system.pipeline_selected_entity_families(p_entity_families text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_raw text;
    v_part text;
    v_parts text[];
    v_selected text[] := ARRAY[]::text[];
    v_unknown text[] := ARRAY[]::text[];
    v_registry text[];
BEGIN
    v_raw := system.pipeline_normalize_entity_families(p_entity_families);

    IF v_raw IN ('all', '*') THEN
        RETURN ARRAY[]::text[];
    END IF;

    v_registry := system.pipeline_entity_family_registry();
    v_parts := string_to_array(regexp_replace(v_raw, '\s+', '', 'g'), ',');

    FOREACH v_part IN ARRAY v_parts LOOP
        IF v_part = '' THEN
            CONTINUE;
        END IF;

        IF v_part = ANY (v_registry) THEN
            IF NOT v_part = ANY (v_selected) THEN
                v_selected := array_append(v_selected, v_part);
            END IF;
        ELSE
            IF NOT v_part = ANY (v_unknown) THEN
                v_unknown := array_append(v_unknown, v_part);
            END IF;
        END IF;
    END LOOP;

    IF array_length(v_unknown, 1) IS NOT NULL THEN
        RAISE EXCEPTION
            'unsupported ENTITY_FAMILIES slug(s): %. Allowed: %',
            array_to_string(v_unknown, ', '),
            (
                SELECT string_agg(r, ', ' ORDER BY r)
                FROM unnest(v_registry) AS u(r)
            );
    END IF;

    IF array_length(v_selected, 1) IS NULL THEN
        RAISE EXCEPTION
            'ENTITY_FAMILIES resolved to an empty set after parsing "%". Use "all" or at least one supported slug.',
            v_raw;
    END IF;

    RETURN v_selected;
END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_family_enabled(p_entity_families text, p_family text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_entity_families_is_all(p_entity_families)
        OR lower(btrim(p_family)) = ANY (system.pipeline_selected_entity_families(p_entity_families));
$$;

CREATE OR REPLACE FUNCTION system.pipeline_family_enabled_any(
    p_entity_families text,
    p_families text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_entity_families_is_all(p_entity_families)
        OR EXISTS (
            SELECT 1
            FROM unnest(p_families) AS f(family)
            WHERE system.pipeline_family_enabled(p_entity_families, f.family)
        );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_stage11_family_enabled(
    p_entity_families text,
    p_family text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(p_family))
        WHEN 'address_components' THEN
            system.pipeline_family_enabled(p_entity_families, 'address_components')
            OR system.pipeline_family_enabled(p_entity_families, 'addresses')
        WHEN 'place_address_links' THEN
            system.pipeline_family_enabled(p_entity_families, 'place_address_links')
            OR (
                system.pipeline_family_enabled(p_entity_families, 'places')
                AND system.pipeline_family_enabled(p_entity_families, 'addresses')
            )
        ELSE system.pipeline_family_enabled(p_entity_families, p_family)
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_stage05_extraction_enabled(
    p_entity_families text,
    p_stage05_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(p_stage05_key))
        WHEN 'place' THEN system.pipeline_family_enabled(p_entity_families, 'places')
        WHEN 'place_name' THEN system.pipeline_family_enabled(p_entity_families, 'places')
        WHEN 'bus_stop' THEN system.pipeline_family_enabled(p_entity_families, 'bus_stops')
        WHEN 'bus_stop_name' THEN system.pipeline_family_enabled(p_entity_families, 'bus_stops')
        WHEN 'address' THEN system.pipeline_family_enabled(p_entity_families, 'addresses')
        WHEN 'address_component' THEN system.pipeline_family_enabled(p_entity_families, 'addresses')
        WHEN 'place_address_link' THEN
            system.pipeline_family_enabled(p_entity_families, 'place_address_links')
            OR (
                system.pipeline_family_enabled(p_entity_families, 'places')
                AND system.pipeline_family_enabled(p_entity_families, 'addresses')
            )
        WHEN 'search_name' THEN system.pipeline_family_enabled_any(
            p_entity_families,
            ARRAY['places', 'bus_stops', 'roads', 'water_lines']
        )
        WHEN 'search_address' THEN system.pipeline_family_enabled(p_entity_families, 'addresses')
        WHEN 'routing_barrier' THEN system.pipeline_family_enabled(p_entity_families, 'routing_barriers')
        WHEN 'road' THEN system.pipeline_family_enabled(p_entity_families, 'roads')
        WHEN 'road_name' THEN system.pipeline_family_enabled(p_entity_families, 'roads')
        WHEN 'routing_road' THEN system.pipeline_family_enabled(p_entity_families, 'routing_roads')
        WHEN 'water_line' THEN system.pipeline_family_enabled(p_entity_families, 'water_lines')
        WHEN 'bus_route' THEN system.pipeline_family_enabled(p_entity_families, 'bus_routes')
        WHEN 'bus_route_name' THEN system.pipeline_family_enabled(p_entity_families, 'bus_routes')
        WHEN 'bus_route_variant' THEN system.pipeline_family_enabled_any(
            p_entity_families,
            ARRAY['bus_routes', 'bus_route_variants']
        )
        WHEN 'bus_route_stop' THEN system.pipeline_family_enabled_any(
            p_entity_families,
            ARRAY['bus_routes', 'bus_route_stops']
        )
        WHEN 'building' THEN system.pipeline_family_enabled(p_entity_families, 'buildings')
        WHEN 'landuse' THEN system.pipeline_family_enabled(p_entity_families, 'landuse')
        WHEN 'water_polygon' THEN system.pipeline_family_enabled(p_entity_families, 'water_polygons')
        WHEN 'admin_area' THEN system.pipeline_family_enabled(p_entity_families, 'admin_areas')
        WHEN 'admin_area_name' THEN system.pipeline_family_enabled(p_entity_families, 'admin_areas')
        WHEN 'routing_turn_restriction' THEN system.pipeline_family_enabled(p_entity_families, 'routing_turn_restrictions')
        ELSE system.pipeline_family_enabled(p_entity_families, p_stage05_key)
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_stage05_extraction_any_enabled(
    p_entity_families text,
    p_stage05_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_entity_families_is_all(p_entity_families)
        OR EXISTS (
            SELECT 1
            FROM unnest(p_stage05_keys) AS k(stage05_key)
            WHERE system.pipeline_stage05_extraction_enabled(p_entity_families, k.stage05_key)
        );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_stage15_manifest_enabled(
    p_entity_families text,
    p_manifest_family text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(p_manifest_family))
        WHEN 'place_names' THEN system.pipeline_family_enabled(p_entity_families, 'places')
        WHEN 'road_names' THEN system.pipeline_family_enabled(p_entity_families, 'roads')
        WHEN 'admin_area_names' THEN system.pipeline_family_enabled(p_entity_families, 'admin_areas')
        WHEN 'bus_stop_names' THEN system.pipeline_family_enabled(p_entity_families, 'bus_stops')
        WHEN 'bus_route_names' THEN system.pipeline_family_enabled(p_entity_families, 'bus_routes')
        WHEN 'address_components' THEN system.pipeline_family_enabled(p_entity_families, 'addresses')
        WHEN 'place_address_links' THEN system.pipeline_stage11_family_enabled(p_entity_families, 'place_address_links')
        ELSE system.pipeline_family_enabled(p_entity_families, p_manifest_family)
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_validate_entity_families(p_entity_families text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    PERFORM system.pipeline_selected_entity_families(p_entity_families);
    RETURN system.pipeline_normalize_entity_families(p_entity_families);
END;
$$;
