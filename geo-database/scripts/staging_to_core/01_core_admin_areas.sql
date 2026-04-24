-- promote Kyauktan admin areas from staging to core
-- TODO: set source_type_id before running the insert
-- core.core_admin_areas.source_type_id is required by schema and cannot be guessed safely

-- source_type_id configuration check
with source_type_todo as (
    select
        null::bigint as source_type_id
)
select
    case
        when source_type_id is null then 'TODO: set source_type_id in source_type_todo before running insert'
        else 'source_type_id configured'
    end as source_type_status,
    source_type_id
from source_type_todo;

-- strict insert
with source_type_todo as (
    select
        null::bigint as source_type_id
),
kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
prepared_admin_areas as (
    select
        s.id as staging_admin_area_candidate_id,
        s.canonical_name,
        replace(lower(regexp_replace(btrim(s.canonical_name), '\s+', ' ', 'g')), ' ', '_') as slug,
        s.admin_level_id,
        st_setsrid(
            st_multi(
                st_collectionextract(
                    st_makevalid(s.geom),
                    3
                )
            ),
            4326
        ) as geom
    from staging.staging_admin_area_candidates as s
    join raw.raw_osm_polygons as p
        on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
    cross join kyauktan_boundary as b
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
      and st_intersects(
          st_multi(
              st_collectionextract(
                  st_makevalid(p.geom),
                  3
              )
          ),
          b.geom
      )
),
eligible_admin_areas as (
    select
        p.staging_admin_area_candidate_id,
        p.canonical_name,
        p.slug,
        p.admin_level_id,
        p.geom,
        st_pointonsurface(p.geom) as centroid
    from prepared_admin_areas as p
    where p.geom is not null
      and not st_isempty(p.geom)
      and st_isvalid(p.geom)
      and geometrytype(p.geom) in ('MULTIPOLYGON', 'POLYGON')
),
inserted_rows as (
    insert into core.core_admin_areas (
        canonical_name,
        slug,
        admin_level_id,
        geom,
        centroid,
        source_type_id,
        is_active
    )
    select
        e.canonical_name,
        e.slug,
        e.admin_level_id,
        e.geom,
        e.centroid,
        t.source_type_id,
        true as is_active
    from eligible_admin_areas as e
    cross join source_type_todo as t
    where t.source_type_id is not null
      and not exists (
          select 1
          from core.core_admin_areas as c
          where c.canonical_name = e.canonical_name
            and c.admin_level_id = e.admin_level_id
      )
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;

-- validation: core row count for this Kyauktan promotion scope
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
eligible_admin_areas as (
    select distinct
        s.canonical_name,
        s.admin_level_id
    from staging.staging_admin_area_candidates as s
    join raw.raw_osm_polygons as p
        on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
    cross join kyauktan_boundary as b
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
      and st_isvalid(
          st_setsrid(
              st_multi(
                  st_collectionextract(
                      st_makevalid(s.geom),
                      3
                  )
              ),
              4326
          )
      )
      and st_intersects(
          st_multi(
              st_collectionextract(
                  st_makevalid(p.geom),
                  3
              )
          ),
          b.geom
      )
)
select
    count(*) as promoted_row_count
from core.core_admin_areas as c
join eligible_admin_areas as e
    on e.canonical_name = c.canonical_name
   and e.admin_level_id = c.admin_level_id;

-- validation: invalid geometry count in promoted core rows
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
eligible_admin_areas as (
    select distinct
        s.canonical_name,
        s.admin_level_id
    from staging.staging_admin_area_candidates as s
    join raw.raw_osm_polygons as p
        on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
    cross join kyauktan_boundary as b
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
      and st_intersects(
          st_multi(
              st_collectionextract(
                  st_makevalid(p.geom),
                  3
              )
          ),
          b.geom
      )
)
select
    count(*) as invalid_geometry_count
from core.core_admin_areas as c
join eligible_admin_areas as e
    on e.canonical_name = c.canonical_name
   and e.admin_level_id = c.admin_level_id
where c.geom is null
   or st_isempty(c.geom)
   or not st_isvalid(c.geom)
   or geometrytype(c.geom) <> 'MULTIPOLYGON';

-- validation: duplicate slug check
with kyauktan_boundary as (
    select
        st_unaryunion(st_collect(geom)) as geom
    from raw.kyauktan_boundary
),
eligible_admin_areas as (
    select distinct
        s.canonical_name,
        s.admin_level_id
    from staging.staging_admin_area_candidates as s
    join raw.raw_osm_polygons as p
        on p.id = (s.source_refs -> 'raw_polygon' ->> 'raw_id')::bigint
    cross join kyauktan_boundary as b
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
      and st_intersects(
          st_multi(
              st_collectionextract(
                  st_makevalid(p.geom),
                  3
              )
          ),
          b.geom
      )
)
select
    c.slug,
    count(*) as duplicate_count
from core.core_admin_areas as c
join eligible_admin_areas as e
    on e.canonical_name = c.canonical_name
   and e.admin_level_id = c.admin_level_id
group by c.slug
having count(*) > 1
order by duplicate_count desc, c.slug;
