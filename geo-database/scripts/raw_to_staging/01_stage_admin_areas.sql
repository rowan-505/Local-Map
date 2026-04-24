-- inspect available admin level references before running the insert
select
    id,
    code,
    name,
    rank
from ref.ref_admin_levels
order by rank, id;

-- inspect raw Kyauktan administrative levels before confirming the mapping
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
cleaned_raw_polygons as (
    select
        p.id as raw_id,
        p.tags ->> 'admin_level' as osm_admin_level,
        st_multi(st_collectionextract(st_makevalid(p.geom), 3)) as cleaned_geom
    from raw.raw_osm_polygons as p
    where p.tags ->> 'boundary' = 'administrative'
      and p.tags ? 'admin_level'
)
select
    c.osm_admin_level,
    count(*) as feature_count
from cleaned_raw_polygons as c
cross join kyauktan_boundary as b
where c.cleaned_geom is not null
  and not st_isempty(c.cleaned_geom)
  and st_intersects(c.cleaned_geom, b.geom)
group by c.osm_admin_level
order by c.osm_admin_level;

-- confirm this mapping before running the insert
-- any OSM admin_level not listed here will be skipped
with admin_level_mapping as (
    select '2'::text as osm_admin_level, 'country'::text as ref_code
    union all
    select '4'::text as osm_admin_level, 'state_region'::text as ref_code
    union all
    select '6'::text as osm_admin_level, 'district'::text as ref_code
    union all
    select '8'::text as osm_admin_level, 'township'::text as ref_code
    union all
    select '9'::text as osm_admin_level, 'town'::text as ref_code
    union all
    select '10'::text as osm_admin_level, 'ward_village_tract'::text as ref_code
    union all
    select '11'::text as osm_admin_level, 'village'::text as ref_code
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
raw_admin_polygons as (
    select
        p.id as raw_id,
        p.source_snapshot_id,
        p.osm_feature_type,
        p.osm_id,
        p.tags,
        st_multi(st_collectionextract(st_makevalid(p.geom), 3)) as cleaned_geom,
        nullif(btrim(p.tags ->> 'name'), '') as name_local,
        nullif(btrim(p.tags ->> 'name:en'), '') as name_en,
        nullif(btrim(p.tags ->> 'official_name'), '') as official_name,
        nullif(btrim(p.tags ->> 'short_name'), '') as short_name,
        nullif(btrim(p.tags ->> 'admin_level'), '') as osm_admin_level
    from raw.raw_osm_polygons as p
    where p.tags ->> 'boundary' = 'administrative'
),
prepared_admin_polygons as (
    select
        r.raw_id,
        r.source_snapshot_id,
        r.osm_feature_type,
        r.osm_id,
        'osm_' || lower(r.osm_feature_type) || '_' || r.osm_id as external_id,
        coalesce(r.name_local, r.name_en, r.official_name, r.short_name) as canonical_name,
        r.osm_admin_level,
        r.cleaned_geom as geom,
        st_pointonsurface(r.cleaned_geom) as centroid,
        jsonb_strip_nulls(
            jsonb_build_object(
                'name', r.name_local,
                'name:en', r.name_en,
                'official_name', r.official_name,
                'short_name', r.short_name,
                'admin_level', r.osm_admin_level,
                'boundary', r.tags ->> 'boundary'
            )
        ) as normalized_data,
        jsonb_build_object(
            'raw_polygon',
            jsonb_build_object(
                'source_table', 'raw.raw_osm_polygons',
                'raw_id', r.raw_id,
                'osm_id', r.osm_id,
                'osm_feature_type', r.osm_feature_type
            )
        ) as source_refs
    from raw_admin_polygons as r
    cross join kyauktan_boundary as b
    where r.osm_admin_level is not null
      and coalesce(r.name_local, r.name_en, r.official_name, r.short_name) is not null
      and r.cleaned_geom is not null
      and not st_isempty(r.cleaned_geom)
      and st_isvalid(r.cleaned_geom)
      and st_intersects(r.cleaned_geom, b.geom)
),
inserted_rows as (
    insert into staging.staging_admin_area_candidates (
        source_snapshot_id,
        external_id,
        canonical_name,
        admin_level_id,
        parent_candidate_id,
        geom,
        centroid,
        confidence_score,
        match_status,
        matched_core_admin_area_id,
        normalized_data,
        source_refs,
        created_at,
        updated_at
    )
    select
        p.source_snapshot_id,
        p.external_id,
        p.canonical_name,
        l.id as admin_level_id,
        null as parent_candidate_id,
        p.geom,
        p.centroid,
        null as confidence_score,
        'unmatched'::text as match_status,
        null as matched_core_admin_area_id,
        p.normalized_data,
        p.source_refs,
        now() as created_at,
        now() as updated_at
    from prepared_admin_polygons as p
    join admin_level_mapping as m
        on m.osm_admin_level = p.osm_admin_level
    join ref.ref_admin_levels as l
        on l.code = m.ref_code
    where not exists (
        select 1
        from staging.staging_admin_area_candidates as s
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
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and p.tags ->> 'boundary' = 'administrative'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom);

-- validation: grouped counts by admin level
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    l.code as admin_level_code,
    l.name as admin_level_name,
    count(*) as candidate_count
from staging.staging_admin_area_candidates as s
join ref.ref_admin_levels as l
    on l.id = s.admin_level_id
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and p.tags ->> 'boundary' = 'administrative'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
group by l.code, l.name, l.rank
order by l.rank, l.code;

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
    l.code as admin_level_code,
    s.match_status,
    s.source_refs -> 'raw_polygon' ->> 'raw_id' as raw_id,
    s.source_refs -> 'raw_polygon' ->> 'osm_id' as osm_id,
    s.source_refs -> 'raw_polygon' ->> 'osm_feature_type' as osm_feature_type
from staging.staging_admin_area_candidates as s
join ref.ref_admin_levels as l
    on l.id = s.admin_level_id
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and p.tags ->> 'boundary' = 'administrative'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
order by s.id desc
limit 50;
