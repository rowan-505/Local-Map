-- inspect available road class references before running the insert
select
    id,
    code,
    name
from ref.ref_road_classes
order by code, id;

-- inspect Kyauktan raw highway values before confirming the mapping
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    p.tags ->> 'highway' as highway,
    count(*) as feature_count
from raw.raw_osm_lines as p
cross join kyauktan_boundary as b
where p.tags ? 'highway'
  and p.geom is not null
  and not st_isempty(p.geom)
  and st_intersects(p.geom, b.geom)
group by p.tags ->> 'highway'
order by feature_count desc, highway;

-- confirm this mapping before running the insert
-- set ref_code to null for any OSM highway value that needs manual review
with road_class_mapping as (
    select 'motorway'::text as osm_highway, 'motorway'::text as ref_code
    union all
    select 'trunk'::text as osm_highway, 'trunk'::text as ref_code
    union all
    select 'primary'::text as osm_highway, 'primary'::text as ref_code
    union all
    select 'secondary'::text as osm_highway, 'secondary'::text as ref_code
    union all
    select 'tertiary'::text as osm_highway, 'tertiary'::text as ref_code
    union all
    select 'unclassified'::text as osm_highway, null::text as ref_code
    union all
    select 'residential'::text as osm_highway, 'residential'::text as ref_code
    union all
    select 'service'::text as osm_highway, 'service'::text as ref_code
    union all
    select 'living_street'::text as osm_highway, null::text as ref_code
    union all
    select 'track'::text as osm_highway, null::text as ref_code
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
eligible_raw_roads as (
    select
        l.id as raw_id,
        l.source_snapshot_id,
        l.osm_feature_type,
        l.osm_id,
        l.geom,
        l.tags,
        nullif(btrim(l.tags ->> 'highway'), '') as highway,
        nullif(btrim(l.tags ->> 'name'), '') as name_local,
        nullif(btrim(l.tags ->> 'name:en'), '') as name_en,
        nullif(btrim(l.tags ->> 'surface'), '') as surface,
        nullif(btrim(l.tags ->> 'lanes'), '') as lanes,
        nullif(btrim(l.tags ->> 'bridge'), '') as bridge,
        nullif(btrim(l.tags ->> 'tunnel'), '') as tunnel,
        nullif(btrim(l.tags ->> 'maxspeed'), '') as maxspeed,
        nullif(btrim(l.tags ->> 'access'), '') as access,
        nullif(lower(btrim(l.tags ->> 'oneway')), '') as oneway_tag
    from raw.raw_osm_lines as l
    cross join kyauktan_boundary as b
    where l.tags ? 'highway'
      and l.geom is not null
      and not st_isempty(l.geom)
      and st_intersects(l.geom, b.geom)
      and coalesce(l.tags ->> 'highway', '') not in (
          'footway',
          'path',
          'cycleway',
          'steps',
          'corridor',
          'pedestrian',
          'bridleway',
          'sidewalk'
      )
),
prepared_roads as (
    select
        r.raw_id,
        r.source_snapshot_id,
        r.osm_feature_type,
        r.osm_id,
        'osm_' || lower(r.osm_feature_type) || '_' || r.osm_id as external_id,
        coalesce(r.name_local, r.name_en, 'Unnamed ' || r.highway || ' ' || r.osm_id) as canonical_name,
        r.highway,
        r.geom,
        case
            when r.oneway_tag in ('yes', 'true', '1', '-1') then true
            when r.oneway_tag in ('no', 'false', '0') then false
            else null
        end as is_oneway,
        st_length(st_transform(r.geom, 32647)) as length_m,
        jsonb_strip_nulls(
            jsonb_build_object(
                'highway', r.highway,
                'name', r.name_local,
                'name:en', r.name_en,
                'surface', r.surface,
                'lanes', r.lanes,
                'bridge', r.bridge,
                'tunnel', r.tunnel,
                'maxspeed', r.maxspeed,
                'access', r.access,
                'oneway', r.oneway_tag
            )
        ) as normalized_data,
        jsonb_build_object(
            'raw_line',
            jsonb_build_object(
                'source_table', 'raw.raw_osm_lines',
                'raw_id', r.raw_id,
                'osm_id', r.osm_id,
                'osm_feature_type', r.osm_feature_type
            )
        ) as source_refs
    from eligible_raw_roads as r
    where r.highway in (
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'unclassified',
        'residential',
        'service',
        'living_street',
        'track'
    )
),
inserted_rows as (
    insert into staging.staging_road_candidates (
        source_snapshot_id,
        external_id,
        canonical_name,
        road_class_id,
        geom,
        is_oneway,
        length_m,
        confidence_score,
        match_status,
        matched_core_edge_id,
        normalized_data,
        source_refs,
        created_at,
        updated_at
    )
    select
        p.source_snapshot_id,
        p.external_id,
        p.canonical_name,
        rc.id as road_class_id,
        p.geom,
        p.is_oneway,
        p.length_m,
        null as confidence_score,
        'unmatched'::text as match_status,
        null as matched_core_edge_id,
        p.normalized_data,
        p.source_refs,
        now() as created_at,
        now() as updated_at
    from prepared_roads as p
    join road_class_mapping as m
        on m.osm_highway = p.highway
    join ref.ref_road_classes as rc
        on rc.code = m.ref_code
    where m.ref_code is not null
      and not exists (
          select 1
          from staging.staging_road_candidates as s
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
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and l.tags ? 'highway'
  and st_intersects(l.geom, b.geom);

-- validation: grouped counts by highway class
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    l.tags ->> 'highway' as highway,
    count(*) as candidate_count
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and l.tags ? 'highway'
  and st_intersects(l.geom, b.geom)
group by l.tags ->> 'highway'
order by candidate_count desc, highway;

-- validation: grouped counts by joined road class
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    rc.code as road_class_code,
    rc.name as road_class_name,
    count(*) as candidate_count
from staging.staging_road_candidates as s
join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and l.tags ? 'highway'
  and st_intersects(l.geom, b.geom)
group by rc.code, rc.name
order by candidate_count desc, rc.code;

-- validation: sample staged rows
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
    rc.code as road_class_code,
    s.is_oneway,
    s.length_m,
    s.match_status,
    s.source_refs -> 'raw_line' ->> 'raw_id' as raw_id,
    s.source_refs -> 'raw_line' ->> 'osm_id' as osm_id,
    l.tags ->> 'highway' as highway
from staging.staging_road_candidates as s
join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and l.tags ? 'highway'
  and st_intersects(l.geom, b.geom)
order by s.id desc
limit 50;
