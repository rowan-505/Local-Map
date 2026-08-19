-- core.core_addresses is empty in production. Make postal_code the sole Core
-- persistence column while retaining "postcode" as the normalized component
-- type and search API field name.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE VIEW search.v_search_addresses_source AS
SELECT
    'address'::text AS entity_type,
    a.id AS entity_id,
    a.public_id::text AS public_id,
    coalesce(nullif(btrim(a.full_address), ''), parts.composed) AS display_name,
    'Address'::text AS subtitle,
    NULL::text AS primary_name_my,
    NULL::text AS primary_name_en,
    coalesce(nullif(btrim(a.full_address), ''), parts.composed) AS primary_name_und,
    nullif(btrim(coalesce(parts.postcode, a.postal_code)), '') AS code,
    NULL::text AS external_id,
    NULL::text AS category_code,
    NULL::text AS category_name_my,
    NULL::text AS category_name_en,
    a.admin_area_id,
    search.admin_area_name(a.admin_area_id, 'my') AS admin_area_name_my,
    search.admin_area_name(a.admin_area_id, 'en') AS admin_area_name_en,
    jsonb_strip_nulls(jsonb_build_object(
        'village', parts.village,
        'ward', parts.ward,
        'village_tract', parts.village_tract,
        'township', coalesce(parts.township, nullif(btrim(a.township), '')),
        'district', coalesce(parts.district, nullif(btrim(a.district), '')),
        'region_state', coalesce(parts.region, nullif(btrim(a.state_region), '')),
        'country', coalesce(parts.country, nullif(btrim(a.country), ''))
    )) AS admin_hierarchy,
    coalesce(
        nullif(btrim(a.full_address), ''),
        search.build_address_search_line(a.id, 'en'),
        search.build_address_search_line(a.id, 'my'),
        parts.composed
    ) AS address_text,
    jsonb_strip_nulls(jsonb_build_object(
        'house_number', coalesce(parts.house_number, nullif(btrim(a.house_number), '')),
        'unit_number', nullif(btrim(a.unit_number), ''),
        'street', coalesce(parts.street, nullif(btrim(a.street_name), '')),
        'quarter', nullif(btrim(a.quarter), ''),
        'suburb', nullif(btrim(a.suburb), ''),
        'city', coalesce(parts.city, nullif(btrim(a.city), '')),
        'postcode', nullif(btrim(coalesce(parts.postcode, a.postal_code)), ''),
        'full_address', nullif(btrim(a.full_address), '')
    )) AS address_parts,
    'POINT'::text AS geometry_type,
    search.safe_centroid(coalesce(a.entrance_geom, a.point_geom, a.geom)) AS centroid,
    search.safe_bbox(coalesce(a.entrance_geom, a.point_geom, a.geom)) AS bbox,
    (coalesce(a.entrance_geom, a.point_geom, a.geom) IS NOT NULL) AS has_geometry,
    (coalesce(a.entrance_geom, a.point_geom, a.geom) IS NOT NULL) AS supports_plus_code,
    concat_ws(' ',
        a.full_address,
        search.build_address_search_line(a.id, 'en'),
        search.build_address_search_line(a.id, 'my'),
        search.build_address_search_line(a.id, 'und'),
        a.street_name, a.quarter, a.suburb, a.township, a.city, a.district,
        a.state_region, a.country,
        search.admin_area_name(a.admin_area_id, 'en'),
        search.admin_area_name(a.admin_area_id, 'my'),
        search.hierarchy_text(search.admin_area_hierarchy(a.admin_area_id))
    ) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    coalesce(a.confidence_score, 0) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    coalesce(a.is_verified, false) AS is_verified,
    coalesce(a.is_public, false) AS is_public,
    (a.deleted_at IS NULL) AS is_active,
    a.updated_at AS source_updated_at,
    '[]'::jsonb AS names
FROM core.core_addresses AS a
LEFT JOIN LATERAL (
    SELECT
        search.pick_address_component_value(a.id, 'house_number') AS house_number,
        search.pick_address_field_text(a.id, 'en', 'street') AS street,
        search.pick_address_component_value(a.id, 'village') AS village,
        search.pick_address_component_value(a.id, 'ward') AS ward,
        search.pick_address_component_value(a.id, 'village_tract') AS village_tract,
        search.pick_address_component_value(a.id, 'town') AS town,
        search.pick_address_component_value(a.id, 'city') AS city,
        search.pick_address_component_value(a.id, 'township') AS township,
        search.pick_address_component_value(a.id, 'district') AS district,
        search.pick_address_component_value(a.id, 'region') AS region,
        search.pick_address_component_value(a.id, 'postcode') AS postcode,
        search.pick_address_component_value(a.id, 'country') AS country,
        search.build_address_search_line(a.id, 'en') AS composed
) AS parts ON true
WHERE a.deleted_at IS NULL
  AND a.is_public = true
  AND coalesce(a.entrance_geom, a.point_geom, a.geom) IS NOT NULL;

ALTER TABLE core.core_addresses
    DROP COLUMN postcode RESTRICT;
