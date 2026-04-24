-- promote Kyauktan places from staging to core
-- source_type_id is fixed to 1 for MVP
-- core.core_places.category_id is required, so this script uses an explicit MVP mapping with a documented fallback

-- promotion configuration
with promotion_defaults as (
    select
        1::bigint as source_type_id,
        'shopping'::text as mvp_fallback_category_code
)
select
    d.source_type_id,
    d.mvp_fallback_category_code,
    c.id as mvp_fallback_category_id,
    c.name as mvp_fallback_category_name
from promotion_defaults as d
left join ref.ref_poi_categories as c
    on c.code = d.mvp_fallback_category_code;

-- strict insert
with promotion_defaults as (
    select
        1::bigint as source_type_id,
        'shopping'::text as mvp_fallback_category_code
),
exact_category_mapping as (
    select 'amenity'::text as primary_category_key, 'restaurant'::text as primary_category_value, 'restaurant'::text as ref_category_code
    union all
    select 'amenity', 'cafe', 'cafe'
    union all
    select 'amenity', 'market', 'market'
    union all
    select 'amenity', 'hospital', 'hospital'
    union all
    select 'healthcare', 'hospital', 'hospital'
    union all
    select 'amenity', 'clinic', 'clinic'
    union all
    select 'healthcare', 'clinic', 'clinic'
    union all
    select 'amenity', 'pharmacy', 'pharmacy'
    union all
    select 'healthcare', 'pharmacy', 'pharmacy'
    union all
    select 'amenity', 'school', 'school'
    union all
    select 'amenity', 'university', 'university'
    union all
    select 'amenity', 'library', 'library'
    union all
    select 'amenity', 'bus_station', 'bus_station'
    union all
    select 'amenity', 'police_station', 'police_station'
    union all
    select 'amenity', 'post_office', 'post_office'
    union all
    select 'shop', 'supermarket', 'supermarket'
    union all
    select 'shop', 'convenience', 'convenience_store'
    union all
    select 'shop', 'mall', 'shopping_mall'
),
parent_category_mapping as (
    select 'shop'::text as primary_category_key, 'shopping'::text as ref_category_code
    union all
    select 'healthcare', 'health'
    union all
    select 'public_transport', 'transport'
    union all
    select 'office', 'government'
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
raw_scope_places as (
    select
        s.id as staging_place_candidate_id,
        s.source_snapshot_id,
        s.external_id,
        s.canonical_name as primary_name,
        s.point_geom,
        s.confidence_score,
        s.normalized_data ->> 'primary_category_key' as primary_category_key,
        s.normalized_data ->> 'primary_category_value' as primary_category_value,
        ss.captured_at,
        sr.source_name,
        sr.source_uri
    from staging.staging_place_candidates as s
    join raw.raw_osm_points as p
        on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
    left join system.system_source_snapshots as ss
        on ss.id = s.source_snapshot_id
    left join system.system_source_registry as sr
        on sr.id = ss.source_registry_id
    cross join kyauktan_boundary as b
    where s.source_entity_type = 'osm_point'
      and s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
      and st_intersects(p.geom, b.geom)
),
ranked_source_rows as (
    select
        r.*,
        row_number() over (
            partition by r.source_snapshot_id, r.external_id
            order by r.staging_place_candidate_id
        ) as source_row_rank
    from raw_scope_places as r
),
prepared_places as (
    select
        r.staging_place_candidate_id,
        r.source_snapshot_id,
        r.external_id,
        r.primary_name,
        st_setsrid(r.point_geom, 4326) as point_geom,
        st_y(st_setsrid(r.point_geom, 4326)) as lat,
        st_x(st_setsrid(r.point_geom, 4326)) as lng,
        coalesce(r.confidence_score, 0) as confidence_score,
        r.primary_category_key,
        r.primary_category_value,
        r.captured_at,
        coalesce(r.source_name, 'OpenStreetMap') as source_name,
        r.source_uri,
        source_match.place_id as existing_place_id,
        admin_match.admin_area_id
    from ranked_source_rows as r
    cross join promotion_defaults as d
    left join lateral (
        select
            cps.place_id
        from core.core_place_sources as cps
        where cps.source_type_id = d.source_type_id
          and cps.external_id = r.external_id
          and cps.raw_payload ->> 'source_snapshot_id' = r.source_snapshot_id::text
        order by cps.id desc
        limit 1
    ) as source_match
        on true
    left join lateral (
        select
            a.id as admin_area_id
        from core.core_admin_areas as a
        where a.geom is not null
          and st_contains(a.geom, st_setsrid(r.point_geom, 4326))
        order by st_area(a.geom::geography) asc, a.id
        limit 1
    ) as admin_match
        on true
    where r.source_row_rank = 1
      and r.primary_name is not null
      and nullif(btrim(r.primary_name), '') is not null
      and r.point_geom is not null
      and not st_isempty(r.point_geom)
      and st_isvalid(r.point_geom)
      and geometrytype(r.point_geom) = 'POINT'
),
eligible_places as (
    select
        p.*,
        coalesce(exact_category.id, parent_category.id, fallback_category.id) as category_id
    from prepared_places as p
    cross join promotion_defaults as d
    left join exact_category_mapping as exact_map
        on exact_map.primary_category_key = p.primary_category_key
       and exact_map.primary_category_value = p.primary_category_value
    left join ref.ref_poi_categories as exact_category
        on exact_category.code = exact_map.ref_category_code
    left join parent_category_mapping as parent_map
        on parent_map.primary_category_key = p.primary_category_key
    left join ref.ref_poi_categories as parent_category
        on parent_category.code = parent_map.ref_category_code
    left join ref.ref_poi_categories as fallback_category
        on fallback_category.code = d.mvp_fallback_category_code
    where p.existing_place_id is null
      and coalesce(exact_category.id, parent_category.id, fallback_category.id) is not null
),
inserted_places as (
    insert into core.core_places (
        primary_name,
        display_name,
        category_id,
        admin_area_id,
        point_geom,
        lat,
        lng,
        confidence_score,
        is_public,
        is_verified,
        source_type_id
    )
    select
        e.primary_name,
        e.primary_name as display_name,
        e.category_id,
        e.admin_area_id,
        e.point_geom,
        e.lat,
        e.lng,
        e.confidence_score,
        true as is_public,
        false as is_verified,
        1::bigint as source_type_id
    from eligible_places as e
    returning id, primary_name, point_geom
),
inserted_place_sources as (
    insert into core.core_place_sources (
        place_id,
        source_type_id,
        external_id,
        source_name,
        source_url,
        captured_at,
        raw_payload
    )
    select
        p.id as place_id,
        1::bigint as source_type_id,
        e.external_id,
        e.source_name,
        e.source_uri,
        e.captured_at,
        jsonb_build_object(
            'source_table', 'staging.staging_place_candidates',
            'source_snapshot_id', e.source_snapshot_id,
            'staging_place_candidate_id', e.staging_place_candidate_id
        ) as raw_payload
    from inserted_places as p
    join eligible_places as e
        on e.primary_name = p.primary_name
       and st_equals(e.point_geom, p.point_geom)
    returning id
)
select
    count(*) as inserted_rows
from inserted_places;

-- validation: promotion readiness breakdown
with promotion_defaults as (
    select
        1::bigint as source_type_id,
        'shopping'::text as mvp_fallback_category_code
),
exact_category_mapping as (
    select 'amenity'::text as primary_category_key, 'restaurant'::text as primary_category_value, 'restaurant'::text as ref_category_code
    union all
    select 'amenity', 'cafe', 'cafe'
    union all
    select 'amenity', 'market', 'market'
    union all
    select 'amenity', 'hospital', 'hospital'
    union all
    select 'healthcare', 'hospital', 'hospital'
    union all
    select 'amenity', 'clinic', 'clinic'
    union all
    select 'healthcare', 'clinic', 'clinic'
    union all
    select 'amenity', 'pharmacy', 'pharmacy'
    union all
    select 'healthcare', 'pharmacy', 'pharmacy'
    union all
    select 'amenity', 'school', 'school'
    union all
    select 'amenity', 'university', 'university'
    union all
    select 'amenity', 'library', 'library'
    union all
    select 'amenity', 'bus_station', 'bus_station'
    union all
    select 'amenity', 'police_station', 'police_station'
    union all
    select 'amenity', 'post_office', 'post_office'
    union all
    select 'shop', 'supermarket', 'supermarket'
    union all
    select 'shop', 'convenience', 'convenience_store'
    union all
    select 'shop', 'mall', 'shopping_mall'
),
parent_category_mapping as (
    select 'shop'::text as primary_category_key, 'shopping'::text as ref_category_code
    union all
    select 'healthcare', 'health'
    union all
    select 'public_transport', 'transport'
    union all
    select 'office', 'government'
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
raw_scope_places as (
    select
        s.id as staging_place_candidate_id,
        s.source_snapshot_id,
        s.external_id,
        s.canonical_name as primary_name,
        s.point_geom,
        s.normalized_data ->> 'primary_category_key' as primary_category_key,
        s.normalized_data ->> 'primary_category_value' as primary_category_value
    from staging.staging_place_candidates as s
    join raw.raw_osm_points as p
        on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
    cross join kyauktan_boundary as b
    where s.source_entity_type = 'osm_point'
      and s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
      and st_intersects(p.geom, b.geom)
),
ranked_source_rows as (
    select
        r.*,
        row_number() over (
            partition by r.source_snapshot_id, r.external_id
            order by r.staging_place_candidate_id
        ) as source_row_rank
    from raw_scope_places as r
),
classified_rows as (
    select
        r.*,
        coalesce(exact_category.id, parent_category.id, fallback_category.id) as resolved_category_id,
        source_match.place_id as existing_place_id
    from ranked_source_rows as r
    cross join promotion_defaults as d
    left join exact_category_mapping as exact_map
        on exact_map.primary_category_key = r.primary_category_key
       and exact_map.primary_category_value = r.primary_category_value
    left join ref.ref_poi_categories as exact_category
        on exact_category.code = exact_map.ref_category_code
    left join parent_category_mapping as parent_map
        on parent_map.primary_category_key = r.primary_category_key
    left join ref.ref_poi_categories as parent_category
        on parent_category.code = parent_map.ref_category_code
    left join ref.ref_poi_categories as fallback_category
        on fallback_category.code = d.mvp_fallback_category_code
    left join lateral (
        select
            cps.place_id
        from core.core_place_sources as cps
        where cps.source_type_id = d.source_type_id
          and cps.external_id = r.external_id
          and cps.raw_payload ->> 'source_snapshot_id' = r.source_snapshot_id::text
        order by cps.id desc
        limit 1
    ) as source_match
        on true
)
select
    count(*) as total_source_rows,
    count(*) filter (where source_row_rank > 1) as duplicate_source_key_rows,
    count(*) filter (where nullif(btrim(primary_name), '') is null) as missing_name_rows,
    count(*) filter (where point_geom is null or st_isempty(point_geom)) as missing_point_rows,
    count(*) filter (where point_geom is not null and (not st_isvalid(point_geom) or geometrytype(point_geom) <> 'POINT')) as invalid_point_rows,
    count(*) filter (where source_row_rank = 1 and resolved_category_id is null) as unresolved_category_rows,
    count(*) filter (where source_row_rank = 1 and existing_place_id is not null) as already_promoted_rows,
    count(*) filter (
        where source_row_rank = 1
          and nullif(btrim(primary_name), '') is not null
          and point_geom is not null
          and not st_isempty(point_geom)
          and st_isvalid(point_geom)
          and geometrytype(point_geom) = 'POINT'
          and resolved_category_id is not null
          and existing_place_id is null
    ) as insertable_rows
from classified_rows;

-- validation: promoted row count
with promotion_defaults as (
    select
        1::bigint as source_type_id
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
kyauktan_promoted_places as (
    select distinct
        cps.place_id
    from core.core_place_sources as cps
    join staging.staging_place_candidates as s
        on s.id = (cps.raw_payload ->> 'staging_place_candidate_id')::bigint
    join raw.raw_osm_points as p
        on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
    cross join promotion_defaults as d
    cross join kyauktan_boundary as b
    where cps.source_type_id = d.source_type_id
      and cps.raw_payload ->> 'source_table' = 'staging.staging_place_candidates'
      and st_intersects(p.geom, b.geom)
)
select
    count(*) as promoted_row_count
from core.core_places as c
join kyauktan_promoted_places as kp
    on kp.place_id = c.id;

-- validation: promoted rows missing admin_area_id
with promotion_defaults as (
    select
        1::bigint as source_type_id
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
kyauktan_promoted_places as (
    select distinct
        cps.place_id
    from core.core_place_sources as cps
    join staging.staging_place_candidates as s
        on s.id = (cps.raw_payload ->> 'staging_place_candidate_id')::bigint
    join raw.raw_osm_points as p
        on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
    cross join promotion_defaults as d
    cross join kyauktan_boundary as b
    where cps.source_type_id = d.source_type_id
      and cps.raw_payload ->> 'source_table' = 'staging.staging_place_candidates'
      and st_intersects(p.geom, b.geom)
)
select
    count(*) as missing_admin_area_id_count
from core.core_places as c
join kyauktan_promoted_places as kp
    on kp.place_id = c.id
where c.admin_area_id is null;

-- validation: promoted rows with invalid geometry
with promotion_defaults as (
    select
        1::bigint as source_type_id
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
kyauktan_promoted_places as (
    select distinct
        cps.place_id
    from core.core_place_sources as cps
    join staging.staging_place_candidates as s
        on s.id = (cps.raw_payload ->> 'staging_place_candidate_id')::bigint
    join raw.raw_osm_points as p
        on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
    cross join promotion_defaults as d
    cross join kyauktan_boundary as b
    where cps.source_type_id = d.source_type_id
      and cps.raw_payload ->> 'source_table' = 'staging.staging_place_candidates'
      and st_intersects(p.geom, b.geom)
)
select
    count(*) as invalid_geom_count
from core.core_places as c
join kyauktan_promoted_places as kp
    on kp.place_id = c.id
where c.point_geom is null
   or st_isempty(c.point_geom)
   or not st_isvalid(c.point_geom)
   or geometrytype(c.point_geom) <> 'POINT'
   or st_srid(c.point_geom) <> 4326;
