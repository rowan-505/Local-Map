-- =============================================================================
-- Core vs PMTiles selection (local staging).
-- Policy: docs/osm-core-vs-pmtiles-selection-policy.md
--
-- Families in scope: buildings, landuse, water_lines, water_polygons.
-- Other families are not filtered by this module.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.pipeline_has_real_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(coalesce(p_name, '')), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_tags_has_real_name(p_tags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_has_real_name(coalesce(
        p_tags->>'name',
        p_tags->>'name:my',
        p_tags->>'name:mm',
        p_tags->>'name:my-MM',
        p_tags->>'name:en',
        p_tags->>'official_name'
    ));
$$;

-- Important OSM amenity / building / tourism signals for buildings.
CREATE OR REPLACE FUNCTION system.pipeline_building_important_type(
    p_class_code text,
    p_tags jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'healthcare', 'hospital', 'clinic', 'doctors', 'dentist'
        )
          OR lower(btrim(coalesce(p_tags->>'amenity', ''))) IN (
            'hospital', 'clinic', 'doctors', 'dentist', 'health_post'
        )
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'hospital', 'clinic', 'health_center', 'pharmacy_building'
        )
            THEN 'hospital_or_clinic'

        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'education', 'school', 'university', 'college', 'kindergarten'
        )
          OR lower(btrim(coalesce(p_tags->>'amenity', ''))) IN (
            'school', 'university', 'college', 'kindergarten', 'language_school'
          )
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'school', 'university', 'college', 'kindergarten'
          )
            THEN 'school_or_university'

        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'government_civic', 'government', 'civic'
        )
          OR lower(btrim(coalesce(p_tags->>'office', ''))) IN ('government', 'administrative')
          OR lower(btrim(coalesce(p_tags->>'amenity', ''))) IN (
            'townhall', 'courthouse', 'police', 'fire_station', 'post_office', 'community_centre'
          )
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'government', 'government_office', 'township_office', 'courthouse',
            'police_station', 'fire_station', 'post_office', 'public'
          )
            THEN 'government_building'

        WHEN lower(btrim(coalesce(p_class_code, ''))) IN ('transport')
          OR lower(btrim(coalesce(p_tags->>'amenity', ''))) IN (
            'bus_station', 'ferry_terminal', 'taxi'
          )
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'train_station', 'transportation', 'bus_terminal', 'ferry_terminal',
            'airport_terminal', 'station'
          )
          OR lower(btrim(coalesce(p_tags->>'railway', ''))) IN ('station', 'halt')
          OR lower(btrim(coalesce(p_tags->>'aeroway', ''))) = 'terminal'
          OR lower(btrim(coalesce(p_tags->>'public_transport', ''))) = 'station'
            THEN 'station_or_terminal'

        WHEN lower(btrim(coalesce(p_tags->>'amenity', ''))) IN ('marketplace', 'market')
          OR lower(btrim(coalesce(p_tags->>'shop', ''))) IN ('mall', 'supermarket', 'marketplace')
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'market', 'retail', 'supermarket', 'shopping_mall'
          )
            THEN 'market'

        WHEN lower(btrim(coalesce(p_class_code, ''))) IN ('religious', 'recreation', 'landmark')
          OR lower(btrim(coalesce(p_tags->>'tourism', ''))) IN (
            'attraction', 'museum', 'viewpoint', 'zoo', 'theme_park'
          )
          OR lower(btrim(coalesce(p_tags->>'historic', ''))) IS NOT NULL
               AND lower(btrim(coalesce(p_tags->>'historic', ''))) NOT IN ('', 'no')
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'cathedral', 'chapel', 'church', 'mosque', 'temple', 'shrine',
            'monastery', 'pagoda', 'stadium', 'palace'
          )
            THEN 'important_landmark'

        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'commercial', 'mixed_use', 'utility_infrastructure'
        )
          OR lower(btrim(coalesce(p_tags->>'building', ''))) IN (
            'civic', 'public', 'office'
          )
            THEN 'important_public_building'

        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_landuse_ordinary_basemap(p_class_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_class_code, ''))) IN (
        'residential', 'farmland', 'farmyard', 'paddy', 'orchard', 'meadow',
        'grass', 'grassland', 'forest', 'wood', 'scrub', 'brownfield',
        'greenfield', 'construction', 'quarry', 'basin', 'reservoir',
        'industrial', 'retail', 'commercial', 'railway', 'highway',
        'garages', 'allotments', 'village_green', 'recreation_ground',
        'plant_nursery', 'aquaculture', 'salt_pond', 'landfill', 'vacant',
        'other', 'yes'
    );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_landuse_core_type(
    p_class_code text,
    p_tags jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN lower(btrim(coalesce(p_class_code, ''))) IN ('park', 'recreation_ground')
          OR lower(btrim(coalesce(p_tags->>'leisure', ''))) IN ('park', 'nature_reserve', 'garden')
            THEN 'named_park_or_public_zone'
        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'protected', 'nature_reserve', 'national_park', 'conservation'
          )
          OR lower(btrim(coalesce(p_tags->>'boundary', ''))) = 'protected_area'
          OR p_tags ? 'protect_class'
            THEN 'protected_area'
        WHEN lower(btrim(coalesce(p_class_code, ''))) IN (
            'education', 'university', 'school', 'campus', 'healthcare', 'hospital',
            'religious', 'cemetery', 'military', 'government', 'civic'
          )
            THEN 'named_campus_or_public_zone'
        WHEN lower(btrim(coalesce(p_class_code, ''))) = 'industrial'
            THEN 'named_industrial_zone'
        ELSE 'named_searchable_area'
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_water_core_type(
    p_family text,
    p_class_code text,
    p_tags jsonb DEFAULT NULL,
    p_has_name boolean DEFAULT false
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN lower(btrim(coalesce(p_tags->>'route', ''))) = 'ferry'
          OR lower(btrim(coalesce(p_tags->>'motorboat', ''))) IN ('yes', 'designated')
          OR lower(btrim(coalesce(p_tags->>'boat', ''))) IN ('yes', 'designated')
          OR lower(btrim(coalesce(p_class_code, ''))) IN ('fairway', 'dock', 'lock_gate')
            THEN 'important_ferry_or_navigation'

        WHEN p_has_name
             AND lower(btrim(coalesce(p_class_code, ''))) IN ('river', 'stream', 'tidal_channel')
            THEN 'named_river'

        WHEN p_has_name
             AND (
                lower(btrim(coalesce(p_class_code, ''))) IN ('lake', 'oxbow')
                OR lower(btrim(coalesce(p_tags->>'natural', ''))) = 'water'
                    AND lower(btrim(coalesce(p_tags->>'water', ''))) IN ('lake', 'oxbow')
             )
            THEN 'named_lake'

        WHEN lower(btrim(coalesce(p_class_code, ''))) = 'reservoir'
          OR lower(btrim(coalesce(p_tags->>'water', ''))) = 'reservoir'
            THEN CASE
                WHEN p_has_name THEN 'major_reservoir'
                ELSE NULL
            END

        WHEN p_has_name
             AND lower(btrim(coalesce(p_class_code, ''))) IN ('canal', 'ditch', 'drain')
            THEN 'important_canal'

        WHEN p_has_name
             AND lower(btrim(coalesce(p_family, ''))) IN ('water_lines', 'water_polygons')
            THEN 'named_water_feature'

        ELSE NULL
    END;
$$;

-- Returns jsonb:
--   eligible_for_core boolean
--   core_selection_reason text|null
--   pmtiles_only_reason text|null
CREATE OR REPLACE FUNCTION system.pipeline_select_core_vs_pmtiles(
    p_family text,
    p_canonical_name text,
    p_class_code text,
    p_normalized_data jsonb DEFAULT NULL,
    p_linked_to_important_place boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_family text := lower(btrim(coalesce(p_family, '')));
    v_tags jsonb := coalesce(p_normalized_data->'tags', p_normalized_data, '{}'::jsonb);
    v_has_name boolean;
    v_type text;
    v_reason text;
BEGIN
    IF v_family NOT IN ('buildings', 'landuse', 'water_lines', 'water_polygons') THEN
        RETURN jsonb_build_object(
            'eligible_for_core', true,
            'core_selection_reason', 'family_not_in_pmtiles_filter_scope',
            'pmtiles_only_reason', NULL
        );
    END IF;

    v_has_name := system.pipeline_has_real_name(p_canonical_name)
               OR system.pipeline_tags_has_real_name(v_tags);

    IF v_family = 'buildings' THEN
        IF p_linked_to_important_place THEN
            RETURN jsonb_build_object(
                'eligible_for_core', true,
                'core_selection_reason', 'linked_to_important_place',
                'pmtiles_only_reason', NULL
            );
        END IF;

        v_type := system.pipeline_building_important_type(p_class_code, v_tags);
        IF v_type IS NOT NULL THEN
            RETURN jsonb_build_object(
                'eligible_for_core', true,
                'core_selection_reason', v_type,
                'pmtiles_only_reason', NULL
            );
        END IF;

        IF v_has_name THEN
            RETURN jsonb_build_object(
                'eligible_for_core', true,
                'core_selection_reason', 'named_building',
                'pmtiles_only_reason', NULL
            );
        END IF;

        RETURN jsonb_build_object(
            'eligible_for_core', false,
            'core_selection_reason', NULL,
            'pmtiles_only_reason', 'unnamed_ordinary_building'
        );
    END IF;

    IF v_family = 'landuse' THEN
        IF NOT v_has_name THEN
            v_reason := CASE lower(btrim(coalesce(p_class_code, '')))
                WHEN 'farmland' THEN 'ordinary_farmland'
                WHEN 'paddy' THEN 'ordinary_farmland'
                WHEN 'orchard' THEN 'ordinary_farmland'
                WHEN 'farmyard' THEN 'ordinary_farmland'
                WHEN 'forest' THEN 'ordinary_forest'
                WHEN 'wood' THEN 'ordinary_forest'
                WHEN 'residential' THEN 'ordinary_residential_landuse'
                WHEN 'industrial' THEN 'ordinary_industrial_landuse'
                ELSE 'ordinary_basemap_geometry'
            END;
            RETURN jsonb_build_object(
                'eligible_for_core', false,
                'core_selection_reason', NULL,
                'pmtiles_only_reason', v_reason
            );
        END IF;

        -- Named but ordinary visual landuse still stays PMTiles unless useful type.
        IF system.pipeline_landuse_ordinary_basemap(p_class_code)
           AND lower(btrim(coalesce(p_class_code, ''))) IN (
                'farmland', 'paddy', 'orchard', 'farmyard', 'forest', 'wood',
                'residential', 'meadow', 'grass', 'grassland', 'scrub'
           ) THEN
            RETURN jsonb_build_object(
                'eligible_for_core', false,
                'core_selection_reason', NULL,
                'pmtiles_only_reason', CASE lower(btrim(coalesce(p_class_code, '')))
                    WHEN 'forest' THEN 'ordinary_forest'
                    WHEN 'wood' THEN 'ordinary_forest'
                    WHEN 'residential' THEN 'ordinary_residential_landuse'
                    ELSE 'ordinary_farmland'
                END
            );
        END IF;

        v_type := system.pipeline_landuse_core_type(p_class_code, v_tags);
        RETURN jsonb_build_object(
            'eligible_for_core', true,
            'core_selection_reason', v_type,
            'pmtiles_only_reason', NULL
        );
    END IF;

    -- water_lines / water_polygons
    v_type := system.pipeline_water_core_type(v_family, p_class_code, v_tags, v_has_name);
    IF v_type IS NOT NULL THEN
        RETURN jsonb_build_object(
            'eligible_for_core', true,
            'core_selection_reason', v_type,
            'pmtiles_only_reason', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible_for_core', false,
        'core_selection_reason', NULL,
        'pmtiles_only_reason', CASE
            WHEN NOT v_has_name THEN 'unnamed_small_water'
            ELSE 'ordinary_basemap_geometry'
        END
    );
END;
$$;

-- True when a building footprint is near an important production place
-- (local lab uses prod_mirror — never local core.*; IDs must match Supabase).
CREATE OR REPLACE FUNCTION system.pipeline_building_linked_to_important_place(
    p_geom geometry,
    p_canonical_name text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM prod_mirror.core_places AS p
        LEFT JOIN prod_mirror.ref_poi_categories AS c ON c.id = p.category_id
        WHERE p.deleted_at IS NULL
          AND p.point_geom IS NOT NULL
          AND p_geom IS NOT NULL
          AND (
                ST_DWithin(p.point_geom::geography, ST_PointOnSurface(p_geom)::geography, 30)
                OR (
                    system.pipeline_has_real_name(p_canonical_name)
                    AND lower(btrim(p.primary_name)) = lower(btrim(p_canonical_name))
                    AND ST_DWithin(p.point_geom::geography, ST_PointOnSurface(p_geom)::geography, 75)
                )
          )
          AND (
                c.code IN (
                    'hospital', 'clinic', 'school', 'university', 'government',
                    'township_office', 'police_station', 'market', 'bus_stop',
                    'ferry_terminal', 'train_station', 'city', 'town', 'village',
                    'religion', 'monastery', 'hotel'
                )
                OR coalesce(p.is_verified, false)
          )
    );
$$;
