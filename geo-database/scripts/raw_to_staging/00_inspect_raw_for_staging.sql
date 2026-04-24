-- inspect raw OSM data before staging migration

-- raw feature counts
select
    'raw.raw_osm_points'::text as table_name,
    count(*) as row_count
from raw.raw_osm_points
union all
select
    'raw.raw_osm_lines'::text as table_name,
    count(*) as row_count
from raw.raw_osm_lines
union all
select
    'raw.raw_osm_polygons'::text as table_name,
    count(*) as row_count
from raw.raw_osm_polygons
order by table_name;

-- administrative polygon tags
select
    coalesce(tags ->> 'boundary', '<null>') as boundary,
    coalesce(tags ->> 'admin_level', '<null>') as admin_level,
    count(*) as feature_count
from raw.raw_osm_polygons
where tags ->> 'boundary' = 'administrative'
   or tags ? 'admin_level'
group by
    coalesce(tags ->> 'boundary', '<null>'),
    coalesce(tags ->> 'admin_level', '<null>')
order by feature_count desc, boundary, admin_level;

-- highway values from lines
select
    tags ->> 'highway' as highway,
    count(*) as feature_count
from raw.raw_osm_lines
where tags ? 'highway'
group by tags ->> 'highway'
order by feature_count desc, highway;

-- point tag families
with point_tag_values as (
    select
        'amenity'::text as tag_key,
        tags ->> 'amenity' as tag_value
    from raw.raw_osm_points
    where tags ? 'amenity'

    union all

    select
        'shop'::text as tag_key,
        tags ->> 'shop' as tag_value
    from raw.raw_osm_points
    where tags ? 'shop'

    union all

    select
        'tourism'::text as tag_key,
        tags ->> 'tourism' as tag_value
    from raw.raw_osm_points
    where tags ? 'tourism'

    union all

    select
        'leisure'::text as tag_key,
        tags ->> 'leisure' as tag_value
    from raw.raw_osm_points
    where tags ? 'leisure'

    union all

    select
        'office'::text as tag_key,
        tags ->> 'office' as tag_value
    from raw.raw_osm_points
    where tags ? 'office'

    union all

    select
        'public_transport'::text as tag_key,
        tags ->> 'public_transport' as tag_value
    from raw.raw_osm_points
    where tags ? 'public_transport'
)
select
    tag_key,
    tag_value,
    count(*) as feature_count
from point_tag_values
group by tag_key, tag_value
order by tag_key, feature_count desc, tag_value;

-- geometry validity summary
select
    'raw.kyauktan_boundary'::text as table_name,
    count(*) as total_rows,
    count(*) filter (where geom is null) as null_geom_rows,
    count(*) filter (where geom is not null and st_isempty(geom)) as empty_geom_rows,
    count(*) filter (where geom is not null and not st_isvalid(geom)) as invalid_geom_rows
from raw.kyauktan_boundary
union all
select
    'raw.raw_osm_polygons'::text as table_name,
    count(*) as total_rows,
    count(*) filter (where geom is null) as null_geom_rows,
    count(*) filter (where geom is not null and st_isempty(geom)) as empty_geom_rows,
    count(*) filter (where geom is not null and not st_isvalid(geom)) as invalid_geom_rows
from raw.raw_osm_polygons
union all
select
    'raw.raw_osm_lines'::text as table_name,
    count(*) as total_rows,
    count(*) filter (where geom is null) as null_geom_rows,
    count(*) filter (where geom is not null and st_isempty(geom)) as empty_geom_rows,
    count(*) filter (where geom is not null and not st_isvalid(geom)) as invalid_geom_rows
from raw.raw_osm_lines
order by table_name;

-- geometry validity reasons
select
    'raw.kyauktan_boundary'::text as table_name,
    st_isvalidreason(geom) as validity_reason,
    count(*) as feature_count
from raw.kyauktan_boundary
where geom is not null
  and not st_isvalid(geom)
group by st_isvalidreason(geom)

union all

select
    'raw.raw_osm_polygons'::text as table_name,
    st_isvalidreason(geom) as validity_reason,
    count(*) as feature_count
from raw.raw_osm_polygons
where geom is not null
  and not st_isvalid(geom)
group by st_isvalidreason(geom)

union all

select
    'raw.raw_osm_lines'::text as table_name,
    st_isvalidreason(geom) as validity_reason,
    count(*) as feature_count
from raw.raw_osm_lines
where geom is not null
  and not st_isvalid(geom)
group by st_isvalidreason(geom)
order by table_name, feature_count desc, validity_reason;

-- sample administrative polygons
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'boundary' as boundary,
    tags ->> 'admin_level' as admin_level,
    st_geometrytype(geom) as geometry_type,
    st_astext(st_pointonsurface(geom)) as sample_point_wkt
from raw.raw_osm_polygons
where tags ->> 'boundary' = 'administrative'
   or tags ? 'admin_level'
order by id
limit 50;

-- sample highway lines
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'highway' as highway,
    st_geometrytype(geom) as geometry_type,
    st_length(geom::geography) as length_meters
from raw.raw_osm_lines
where tags ? 'highway'
order by id
limit 50;

-- sample amenity points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'amenity' as amenity,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'amenity'
order by id
limit 50;

-- sample shop points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'shop' as shop,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'shop'
order by id
limit 50;

-- sample tourism points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'tourism' as tourism,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'tourism'
order by id
limit 50;

-- sample leisure points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'leisure' as leisure,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'leisure'
order by id
limit 50;

-- sample office points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'office' as office,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'office'
order by id
limit 50;

-- sample public transport points
select
    id,
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    tags ->> 'name' as name,
    tags ->> 'public_transport' as public_transport,
    st_astext(geom) as point_wkt
from raw.raw_osm_points
where tags ? 'public_transport'
order by id
limit 50;
