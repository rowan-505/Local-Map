-- inspect available place classes before running the insert
select
    id,
    code,
    name
from ref.ref_place_classes
order by code, id;

-- inspect Kyauktan point categories before running the insert
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
categorized_points as (
    select
        case
            when p.tags ? 'amenity' then 'amenity'
            when p.tags ? 'shop' then 'shop'
            when p.tags ? 'tourism' then 'tourism'
            when p.tags ? 'healthcare' then 'healthcare'
            when p.tags ? 'office' then 'office'
            when p.tags ? 'leisure' then 'leisure'
            when p.tags ? 'public_transport' then 'public_transport'
            else null
        end as primary_category_key,
        case
            when p.tags ? 'amenity' then p.tags ->> 'amenity'
            when p.tags ? 'shop' then p.tags ->> 'shop'
            when p.tags ? 'tourism' then p.tags ->> 'tourism'
            when p.tags ? 'healthcare' then p.tags ->> 'healthcare'
            when p.tags ? 'office' then p.tags ->> 'office'
            when p.tags ? 'leisure' then p.tags ->> 'leisure'
            when p.tags ? 'public_transport' then p.tags ->> 'public_transport'
            else null
        end as primary_category_value
    from raw.raw_osm_points as p
    cross join kyauktan_boundary as b
    where p.geom is not null
      and not st_isempty(p.geom)
      and st_intersects(p.geom, b.geom)
)
select
    primary_category_key,
    primary_category_value,
    count(*) as feature_count
from categorized_points
where primary_category_key is not null
group by primary_category_key, primary_category_value
order by primary_category_key, feature_count desc, primary_category_value;

-- category mapping is intentionally not applied in this first pass
-- keep poi_category_id as null until a reviewed mapping exists
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
poi_place_class as (
    select
        id
    from ref.ref_place_classes
    where code = 'poi'
),
eligible_raw_points as (
    select
        p.id as raw_id,
        p.source_snapshot_id,
        p.osm_feature_type,
        p.osm_id,
        p.geom as point_geom,
        p.tags,
        nullif(btrim(p.tags ->> 'name'), '') as name_local,
        nullif(btrim(p.tags ->> 'name:en'), '') as name_en,
        nullif(btrim(p.tags ->> 'official_name'), '') as official_name,
        nullif(btrim(p.tags ->> 'brand'), '') as brand_name,
        nullif(btrim(p.tags ->> 'phone'), '') as phone,
        nullif(btrim(p.tags ->> 'contact:phone'), '') as contact_phone,
        nullif(btrim(p.tags ->> 'website'), '') as website,
        nullif(btrim(p.tags ->> 'contact:website'), '') as contact_website,
        nullif(btrim(p.tags ->> 'email'), '') as email,
        nullif(btrim(p.tags ->> 'contact:email'), '') as contact_email,
        case
            when p.tags ? 'amenity' then 'amenity'
            when p.tags ? 'shop' then 'shop'
            when p.tags ? 'tourism' then 'tourism'
            when p.tags ? 'healthcare' then 'healthcare'
            when p.tags ? 'office' then 'office'
            when p.tags ? 'leisure' then 'leisure'
            when p.tags ? 'public_transport' then 'public_transport'
            else null
        end as primary_category_key,
        case
            when p.tags ? 'amenity' then nullif(btrim(p.tags ->> 'amenity'), '')
            when p.tags ? 'shop' then nullif(btrim(p.tags ->> 'shop'), '')
            when p.tags ? 'tourism' then nullif(btrim(p.tags ->> 'tourism'), '')
            when p.tags ? 'healthcare' then nullif(btrim(p.tags ->> 'healthcare'), '')
            when p.tags ? 'office' then nullif(btrim(p.tags ->> 'office'), '')
            when p.tags ? 'leisure' then nullif(btrim(p.tags ->> 'leisure'), '')
            when p.tags ? 'public_transport' then nullif(btrim(p.tags ->> 'public_transport'), '')
            else null
        end as primary_category_value
    from raw.raw_osm_points as p
    cross join kyauktan_boundary as b
    where p.geom is not null
      and not st_isempty(p.geom)
      and st_intersects(p.geom, b.geom)
      and (
          p.tags ? 'amenity'
          or p.tags ? 'shop'
          or p.tags ? 'tourism'
          or p.tags ? 'healthcare'
          or p.tags ? 'office'
          or p.tags ? 'leisure'
          or p.tags ? 'public_transport'
      )
),
prepared_places as (
    select
        p.raw_id,
        p.source_snapshot_id,
        p.osm_feature_type,
        p.osm_id,
        'osm_point'::text as source_entity_type,
        'osm_' || lower(p.osm_feature_type) || '_' || p.osm_id as external_id,
        coalesce(p.name_local, p.name_en, p.official_name, p.brand_name) as canonical_name,
        p.point_geom,
        p.primary_category_key,
        p.primary_category_value,
        jsonb_strip_nulls(
            jsonb_build_object(
                'primary_category_key', p.primary_category_key,
                'primary_category_value', p.primary_category_value,
                'name', p.name_local,
                'name:en', p.name_en,
                'official_name', p.official_name,
                'brand', p.brand_name,
                'phone', p.phone,
                'contact:phone', p.contact_phone,
                'website', p.website,
                'contact:website', p.contact_website,
                'email', p.email,
                'contact:email', p.contact_email
            )
        ) as normalized_data,
        jsonb_build_object(
            'raw_point',
            jsonb_build_object(
                'source_table', 'raw.raw_osm_points',
                'raw_id', p.raw_id,
                'osm_id', p.osm_id,
                'osm_feature_type', p.osm_feature_type
            )
        ) as source_refs
    from eligible_raw_points as p
    where coalesce(p.name_local, p.name_en, p.official_name, p.brand_name) is not null
      and p.primary_category_key is not null
      and p.primary_category_value is not null
),
prepared_places_with_admin as (
    select
        p.*,
        admin_match.admin_area_candidate_id
    from prepared_places as p
    left join lateral (
        select
            a.id as admin_area_candidate_id
        from staging.staging_admin_area_candidates as a
        join ref.ref_admin_levels as l
            on l.id = a.admin_level_id
        where a.geom is not null
          and st_covers(a.geom, p.point_geom)
        order by l.rank desc, st_area(a.geom::geography) asc, a.id
        limit 1
    ) as admin_match
        on true
),
inserted_rows as (
    insert into staging.staging_place_candidates (
        source_snapshot_id,
        source_entity_type,
        external_id,
        canonical_name,
        place_class_id,
        poi_category_id,
        admin_area_candidate_id,
        point_geom,
        confidence_score,
        match_status,
        matched_core_place_id,
        normalized_data,
        source_refs,
        created_at,
        updated_at
    )
    select
        p.source_snapshot_id,
        p.source_entity_type,
        p.external_id,
        p.canonical_name,
        cls.id as place_class_id,
        null as poi_category_id,
        p.admin_area_candidate_id,
        p.point_geom,
        null as confidence_score,
        'unmatched'::text as match_status,
        null as matched_core_place_id,
        p.normalized_data,
        p.source_refs,
        now() as created_at,
        now() as updated_at
    from prepared_places_with_admin as p
    cross join poi_place_class as cls
    where not exists (
        select 1
        from staging.staging_place_candidates as s
        where s.source_snapshot_id = p.source_snapshot_id
          and s.external_id = p.external_id
    )
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;

-- validation: total staged rows for this migration scope
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    count(*) as total_inserted_rows
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom);

-- validation: grouped counts by raw primary category
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    s.normalized_data ->> 'primary_category_key' as primary_category_key,
    s.normalized_data ->> 'primary_category_value' as primary_category_value,
    count(*) as candidate_count
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
group by
    s.normalized_data ->> 'primary_category_key',
    s.normalized_data ->> 'primary_category_value'
order by primary_category_key, candidate_count desc, primary_category_value;

-- validation: rows without admin area matches
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    count(*) as rows_without_admin_area_candidate_id
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and s.admin_area_candidate_id is null
  and st_intersects(p.geom, b.geom);

-- validation: sample preview rows
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    s.id,
    s.source_snapshot_id,
    s.external_id,
    s.canonical_name,
    pc.code as place_class_code,
    s.poi_category_id,
    s.admin_area_candidate_id,
    s.match_status,
    s.normalized_data ->> 'primary_category_key' as primary_category_key,
    s.normalized_data ->> 'primary_category_value' as primary_category_value,
    s.source_refs -> 'raw_point' ->> 'raw_id' as raw_id,
    s.source_refs -> 'raw_point' ->> 'osm_id' as osm_id
from staging.staging_place_candidates as s
join ref.ref_place_classes as pc
    on pc.id = s.place_class_id
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
order by s.id desc
limit 50;
