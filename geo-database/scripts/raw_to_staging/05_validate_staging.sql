-- Kyauktan staging validation

-- row counts for Kyauktan migration scope
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    'staging_admin_area_candidates'::text as table_name,
    count(*) as row_count
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)

union all

select
    'staging_road_candidates'::text as table_name,
    count(*) as row_count
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)

union all

select
    'staging_place_candidates'::text as table_name,
    count(*) as row_count
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)

union all

select
    'staging_place_name_candidates'::text as table_name,
    count(*) as row_count
from staging.staging_place_name_candidates as n
join staging.staging_place_candidates as s
    on s.id = n.place_candidate_id
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
order by table_name;

-- duplicate admin candidates by source snapshot and external id
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    s.source_snapshot_id,
    s.external_id,
    count(*) as duplicate_count
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
group by s.source_snapshot_id, s.external_id
having count(*) > 1
order by duplicate_count desc, s.source_snapshot_id, s.external_id;

-- duplicate road candidates by source snapshot and external id
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    s.source_snapshot_id,
    s.external_id,
    count(*) as duplicate_count
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)
group by s.source_snapshot_id, s.external_id
having count(*) > 1
order by duplicate_count desc, s.source_snapshot_id, s.external_id;

-- duplicate place candidates by source snapshot and external id
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    s.source_snapshot_id,
    s.external_id,
    count(*) as duplicate_count
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
group by s.source_snapshot_id, s.external_id
having count(*) > 1
order by duplicate_count desc, s.source_snapshot_id, s.external_id;

-- null critical field checks
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    'staging_admin_area_candidates'::text as table_name,
    count(*) filter (where nullif(btrim(s.canonical_name), '') is null) as null_canonical_name_rows,
    count(*) filter (where s.geom is null or st_isempty(s.geom)) as null_or_empty_geom_rows,
    null::bigint as null_class_id_rows
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)

union all

select
    'staging_road_candidates'::text as table_name,
    count(*) filter (where nullif(btrim(s.canonical_name), '') is null) as null_canonical_name_rows,
    count(*) filter (where s.geom is null or st_isempty(s.geom)) as null_or_empty_geom_rows,
    count(*) filter (where s.road_class_id is null) as null_class_id_rows
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)

union all

select
    'staging_place_candidates'::text as table_name,
    count(*) filter (where nullif(btrim(s.canonical_name), '') is null) as null_canonical_name_rows,
    count(*) filter (where s.point_geom is null or st_isempty(s.point_geom)) as null_or_empty_geom_rows,
    count(*) filter (where s.place_class_id is null) as null_class_id_rows
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
order by table_name;

-- geometry validity summary for admin areas and roads
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    'staging_admin_area_candidates'::text as table_name,
    count(*) as total_rows,
    count(*) filter (where s.geom is null) as null_geom_rows,
    count(*) filter (where s.geom is not null and st_isempty(s.geom)) as empty_geom_rows,
    count(*) filter (where s.geom is not null and not st_isvalid(s.geom)) as invalid_geom_rows
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)

union all

select
    'staging_road_candidates'::text as table_name,
    count(*) as total_rows,
    count(*) filter (where s.geom is null) as null_geom_rows,
    count(*) filter (where s.geom is not null and st_isempty(s.geom)) as empty_geom_rows,
    count(*) filter (where s.geom is not null and not st_isvalid(s.geom)) as invalid_geom_rows
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)
order by table_name;

-- invalid geometry reasons for admin areas and roads
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
)
select
    'staging_admin_area_candidates'::text as table_name,
    st_isvalidreason(s.geom) as validity_reason,
    count(*) as feature_count
from staging.staging_admin_area_candidates as s
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and s.geom is not null
  and not st_isvalid(s.geom)
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
group by st_isvalidreason(s.geom)

union all

select
    'staging_road_candidates'::text as table_name,
    st_isvalidreason(s.geom) as validity_reason,
    count(*) as feature_count
from staging.staging_road_candidates as s
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and s.geom is not null
  and not st_isvalid(s.geom)
  and st_intersects(l.geom, b.geom)
group by st_isvalidreason(s.geom)
order by table_name, feature_count desc, validity_reason;

-- places not covered by any staged admin area candidate
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
    s.admin_area_candidate_id,
    s.normalized_data ->> 'primary_category_key' as primary_category_key,
    s.normalized_data ->> 'primary_category_value' as primary_category_value
from staging.staging_place_candidates as s
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
  and not exists (
      select 1
      from staging.staging_admin_area_candidates as a
      where a.geom is not null
        and st_covers(a.geom, s.point_geom)
  )
order by s.id
limit 100;

-- roads with zero or suspicious length
-- adjust thresholds if needed after first review
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
    l.tags ->> 'highway' as highway,
    s.length_m
from staging.staging_road_candidates as s
left join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)
  and (
      s.length_m is null
      or s.length_m <= 0
      or s.length_m < 5
      or s.length_m > 50000
  )
order by s.length_m nulls first, s.id
limit 100;

-- admin level distribution
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
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
group by l.code, l.name, l.rank
order by l.rank, l.code;

-- road class distribution
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
left join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)
group by rc.code, rc.name
order by candidate_count desc, rc.code;

-- raw place category distribution
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

-- sample admin area candidates
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
    s.source_refs -> 'raw_polygon' ->> 'raw_id' as raw_id
from staging.staging_admin_area_candidates as s
join ref.ref_admin_levels as l
    on l.id = s.admin_level_id
join raw.raw_osm_polygons as p
    on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_polygon' ->> 'source_table' = 'raw.raw_osm_polygons'
  and st_intersects(st_multi(st_collectionextract(st_makevalid(p.geom), 3)), b.geom)
order by s.id desc
limit 50;

-- sample road candidates
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
    l.tags ->> 'highway' as highway,
    s.is_oneway,
    s.length_m,
    s.match_status
from staging.staging_road_candidates as s
left join ref.ref_road_classes as rc
    on rc.id = s.road_class_id
join raw.raw_osm_lines as l
    on l.id = (s.source_refs -> 'raw_line' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_line' ->> 'source_table' = 'raw.raw_osm_lines'
  and st_intersects(l.geom, b.geom)
order by s.id desc
limit 50;

-- sample place candidates with primary names
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
    s.admin_area_candidate_id,
    s.normalized_data ->> 'primary_category_key' as primary_category_key,
    s.normalized_data ->> 'primary_category_value' as primary_category_value,
    pn.name as primary_name,
    pn.language_code,
    pn.search_weight
from staging.staging_place_candidates as s
left join staging.staging_place_name_candidates as pn
    on pn.place_candidate_id = s.id
   and pn.name_type = 'primary'
   and pn.is_primary = true
join raw.raw_osm_points as p
    on p.id = (s.source_refs -> 'raw_point' ->> 'raw_id')::bigint
cross join kyauktan_boundary as b
where s.source_refs -> 'raw_point' ->> 'source_table' = 'raw.raw_osm_points'
  and s.source_entity_type = 'osm_point'
  and st_intersects(p.geom, b.geom)
order by s.id desc
limit 50;
