-- promote Kyauktan streets from staging to core

-- strict insert
with allowed_highways as (
    select 'motorway'::text as highway
    union all
    select 'trunk'
    union all
    select 'primary'
    union all
    select 'secondary'
    union all
    select 'tertiary'
    union all
    select 'residential'
),
prepared_streets as (
    select
        s.id as staging_road_candidate_id,
        s.canonical_name,
        s.normalized_data ->> 'highway' as highway,
        st_setsrid(
            st_multi(
                st_linemerge(
                    st_makevalid(s.geom)
                )
            ),
            4326
        ) as normalized_geom_multiline
    from staging.staging_road_candidates as s
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
),
classified_streets as (
    select
        p.*,
        case
            when p.highway in (select highway from allowed_highways) then true
            else false
        end as is_allowed_highway,
        case
            when p.normalized_geom_multiline is null then null
            when st_isempty(p.normalized_geom_multiline) then null
            when not st_isvalid(p.normalized_geom_multiline) then null
            when st_geometrytype(p.normalized_geom_multiline) <> 'ST_MultiLineString' then null
            when st_numgeometries(p.normalized_geom_multiline) <> 1 then null
            else st_geometryn(p.normalized_geom_multiline, 1)::geometry(LineString, 4326)
        end as line_geom
    from prepared_streets as p
),
ranked_streets as (
    select
        c.*,
        case
            when c.line_geom is null then null
            else md5(encode(st_asewkb(c.line_geom), 'hex'))
        end as geom_hash,
        row_number() over (
            partition by
                c.canonical_name,
                case
                    when c.line_geom is null then null
                    else md5(encode(st_asewkb(c.line_geom), 'hex'))
                end
            order by c.staging_road_candidate_id
        ) as source_rank
    from classified_streets as c
),
eligible_streets as (
    select
        r.staging_road_candidate_id,
        r.canonical_name,
        r.line_geom as geom,
        r.geom_hash,
        admin_match.admin_area_id
    from ranked_streets as r
    left join lateral (
        select
            a.id as admin_area_id
        from core.core_admin_areas as a
        where a.geom is not null
          and st_intersects(a.geom, r.line_geom)
        order by st_area(a.geom::geography) asc, a.id
        limit 1
    ) as admin_match
        on true
    where r.is_allowed_highway = true
      and r.line_geom is not null
      and r.source_rank = 1
      and not exists (
          select 1
          from core.core_streets as c
          where c.canonical_name = r.canonical_name
            and md5(encode(st_asewkb(c.geom), 'hex')) = r.geom_hash
      )
),
inserted_rows as (
    insert into core.core_streets (
        canonical_name,
        geom,
        admin_area_id,
        source_type_id,
        is_active
    )
    select
        e.canonical_name,
        e.geom,
        e.admin_area_id,
        1::bigint as source_type_id,
        true as is_active
    from eligible_streets as e
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;

-- validation: promotion readiness breakdown
with allowed_highways as (
    select 'motorway'::text as highway
    union all
    select 'trunk'
    union all
    select 'primary'
    union all
    select 'secondary'
    union all
    select 'tertiary'
    union all
    select 'residential'
),
prepared_streets as (
    select
        s.id as staging_road_candidate_id,
        s.canonical_name,
        s.normalized_data ->> 'highway' as highway,
        st_setsrid(
            st_multi(
                st_linemerge(
                    st_makevalid(s.geom)
                )
            ),
            4326
        ) as normalized_geom_multiline
    from staging.staging_road_candidates as s
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
),
classified_streets as (
    select
        p.*,
        case
            when p.highway in (select highway from allowed_highways) then true
            else false
        end as is_allowed_highway,
        case
            when p.normalized_geom_multiline is null then null
            when st_isempty(p.normalized_geom_multiline) then null
            when not st_isvalid(p.normalized_geom_multiline) then null
            when st_geometrytype(p.normalized_geom_multiline) <> 'ST_MultiLineString' then null
            when st_numgeometries(p.normalized_geom_multiline) <> 1 then null
            else st_geometryn(p.normalized_geom_multiline, 1)::geometry(LineString, 4326)
        end as line_geom
    from prepared_streets as p
),
ranked_streets as (
    select
        c.*,
        case
            when c.line_geom is null then null
            else md5(encode(st_asewkb(c.line_geom), 'hex'))
        end as geom_hash,
        row_number() over (
            partition by
                c.canonical_name,
                case
                    when c.line_geom is null then null
                    else md5(encode(st_asewkb(c.line_geom), 'hex'))
                end
            order by c.staging_road_candidate_id
        ) as source_rank
    from classified_streets as c
),
street_status as (
    select
        r.*,
        exists (
            select 1
            from core.core_streets as c
            where c.canonical_name = r.canonical_name
              and r.geom_hash is not null
              and md5(encode(st_asewkb(c.geom), 'hex')) = r.geom_hash
        ) as already_promoted
    from ranked_streets as r
)
select
    count(*) as total_source_rows,
    count(*) filter (where is_allowed_highway = false) as filtered_highway_rows,
    count(*) filter (where line_geom is null) as non_insertable_geometry_rows,
    count(*) filter (where line_geom is not null and source_rank > 1) as duplicate_source_geom_rows,
    count(*) filter (where line_geom is not null and source_rank = 1 and already_promoted = true) as already_promoted_rows,
    count(*) filter (where line_geom is not null and source_rank = 1 and already_promoted = false and is_allowed_highway = true) as insertable_rows
from street_status;

-- validation: promoted row count for current source scope
with allowed_highways as (
    select 'motorway'::text as highway
    union all
    select 'trunk'
    union all
    select 'primary'
    union all
    select 'secondary'
    union all
    select 'tertiary'
    union all
    select 'residential'
),
prepared_streets as (
    select
        s.canonical_name,
        st_setsrid(
            st_multi(
                st_linemerge(
                    st_makevalid(s.geom)
                )
            ),
            4326
        ) as normalized_geom_multiline,
        s.normalized_data ->> 'highway' as highway
    from staging.staging_road_candidates as s
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
),
eligible_hashes as (
    select distinct
        p.canonical_name,
        md5(
            encode(
                st_asewkb(
                    st_geometryn(p.normalized_geom_multiline, 1)::geometry(LineString, 4326)
                ),
                'hex'
            )
        ) as geom_hash
    from prepared_streets as p
    where p.highway in (select highway from allowed_highways)
      and p.normalized_geom_multiline is not null
      and not st_isempty(p.normalized_geom_multiline)
      and st_isvalid(p.normalized_geom_multiline)
      and st_geometrytype(p.normalized_geom_multiline) = 'ST_MultiLineString'
      and st_numgeometries(p.normalized_geom_multiline) = 1
)
select
    count(*) as promoted_row_count
from core.core_streets as c
join eligible_hashes as e
    on e.canonical_name = c.canonical_name
   and e.geom_hash = md5(encode(st_asewkb(c.geom), 'hex'));

-- validation: promoted rows with invalid geometry
with allowed_highways as (
    select 'motorway'::text as highway
    union all
    select 'trunk'
    union all
    select 'primary'
    union all
    select 'secondary'
    union all
    select 'tertiary'
    union all
    select 'residential'
),
prepared_streets as (
    select
        s.canonical_name,
        st_setsrid(
            st_multi(
                st_linemerge(
                    st_makevalid(s.geom)
                )
            ),
            4326
        ) as normalized_geom_multiline,
        s.normalized_data ->> 'highway' as highway
    from staging.staging_road_candidates as s
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
      and s.geom is not null
),
eligible_hashes as (
    select distinct
        p.canonical_name,
        md5(
            encode(
                st_asewkb(
                    st_geometryn(p.normalized_geom_multiline, 1)::geometry(LineString, 4326)
                ),
                'hex'
            )
        ) as geom_hash
    from prepared_streets as p
    where p.highway in (select highway from allowed_highways)
      and p.normalized_geom_multiline is not null
      and not st_isempty(p.normalized_geom_multiline)
      and st_isvalid(p.normalized_geom_multiline)
      and st_geometrytype(p.normalized_geom_multiline) = 'ST_MultiLineString'
      and st_numgeometries(p.normalized_geom_multiline) = 1
)
select
    count(*) as invalid_geom_count
from core.core_streets as c
join eligible_hashes as e
    on e.canonical_name = c.canonical_name
   and e.geom_hash = md5(encode(st_asewkb(c.geom), 'hex'))
where c.geom is null
   or st_isempty(c.geom)
   or not st_isvalid(c.geom)
   or geometrytype(c.geom) <> 'LINESTRING'
   or st_srid(c.geom) <> 4326;
