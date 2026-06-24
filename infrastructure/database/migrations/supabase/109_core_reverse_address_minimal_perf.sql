-- Performance fix for core.reverse_address_minimal (supersedes the body in 108).
-- The geography-cast ST_DWithin disabled the geometry GiST indexes, forcing a
-- sequential scan over ~823k core_streets rows (~16-23s) for points with no
-- nearby place. Add a `geom && ST_Expand(point, deg)` bbox prefilter so the
-- existing GiST indexes (core_places_point_geom_gix, core_streets_geom_gix) are
-- used, then refine with the exact geography ST_DWithin. Also widen the named
-- street radius 100m -> 200m. No new tables, no new indexes, no writes.

begin;

create or replace function core.reverse_address_minimal(
    p_lat double precision,
    p_lng double precision
)
returns table (
    nearby_name text,
    nearby_type text,
    nearby_distance_m double precision,
    township text,
    district text,
    region_state text,
    country text,
    confidence text
)
language plpgsql
stable
as $$
declare
    v_point geometry(Point, 4326);
    v_township_id bigint;
    v_nearby_name text;
    v_nearby_type text;
    v_nearby_distance_m double precision;
    v_township text;
    v_district text;
    v_region_state text;
    v_country text;
    v_confidence text;
begin
    v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

    -- 1. Township (and admin chain) via the existing point-in-polygon function.
    v_township_id := core.find_admin_area_for_point(v_point, 'township');

    if v_township_id is not null then
        with recursive chain as (
            select aa.id, aa.parent_id, aa.admin_level_id, 1 as depth
            from core.core_admin_areas as aa
            where aa.id = v_township_id
              and aa.deleted_at is null
            union all
            select parent.id, parent.parent_id, parent.admin_level_id, c.depth + 1
            from core.core_admin_areas as parent
            inner join chain as c on parent.id = c.parent_id
            where parent.deleted_at is null
              and c.depth < 12
        ),
        named as (
            select
                al.code as level_code,
                coalesce(
                    (
                        select n.name
                        from core.core_admin_area_names as n
                        where n.admin_area_id = ch.id
                          and lower(trim(coalesce(n.language_code, ''))) = 'en'
                          and btrim(coalesce(n.name, '')) <> ''
                        order by n.is_primary desc nulls last, n.name asc
                        limit 1
                    ),
                    aa.canonical_name
                ) as resolved_name
            from chain as ch
            inner join core.core_admin_areas as aa on aa.id = ch.id
            inner join ref.ref_admin_levels as al on al.id = ch.admin_level_id
        )
        select
            max(resolved_name) filter (where level_code in ('township', 'town')),
            max(resolved_name) filter (where level_code = 'district'),
            max(resolved_name) filter (where level_code = 'state_region'),
            max(resolved_name) filter (where level_code = 'country')
        into v_township, v_district, v_region_state, v_country
        from named;
    end if;

    -- 2a. Nearest public place within 300m.
    --     `point_geom && ST_Expand(...)` uses core_places_point_geom_gix before the exact geography filter.
    select
        coalesce(nullif(btrim(p.display_name), ''), p.primary_name),
        'place',
        ST_Distance(p.point_geom::geography, v_point::geography)
    into v_nearby_name, v_nearby_type, v_nearby_distance_m
    from core.core_places as p
    where p.is_public = true
      and p.deleted_at is null
      and p.point_geom is not null
      and p.point_geom && ST_Expand(v_point, 0.004)
      and ST_DWithin(p.point_geom::geography, v_point::geography, 300)
    order by ST_Distance(p.point_geom::geography, v_point::geography) asc
    limit 1;

    -- 2b. Fallback: nearest active named street within 200m.
    --     `geom && ST_Expand(...)` uses core_streets_geom_gix (avoids the 823k-row seq scan).
    if v_nearby_name is null then
        select
            s.canonical_name,
            'street',
            ST_Distance(s.geom::geography, v_point::geography)
        into v_nearby_name, v_nearby_type, v_nearby_distance_m
        from core.core_streets as s
        where s.is_active = true
          and s.deleted_at is null
          and s.geom is not null
          and s.canonical_name is not null
          and s.geom && ST_Expand(v_point, 0.003)
          and ST_DWithin(s.geom::geography, v_point::geography, 200)
        order by ST_Distance(s.geom::geography, v_point::geography) asc
        limit 1;
    end if;

    -- Country fallback.
    v_country := coalesce(v_country, 'Myanmar');

    -- 3. Confidence.
    v_confidence := case
        when v_nearby_type = 'place' then 'exact_nearby'
        when v_nearby_type = 'street' then 'street_nearby'
        when v_township is not null or v_region_state is not null then 'area_based'
        else 'unknown'
    end;

    return query
    select
        v_nearby_name,
        v_nearby_type,
        v_nearby_distance_m,
        v_township,
        v_district,
        v_region_state,
        v_country,
        v_confidence;
end;
$$;

comment on function core.reverse_address_minimal(double precision, double precision) is
    'Minimal raw reverse address: nearest public place (<=300m) or active named street (<=200m), plus township/district/state_region/country resolved from core.find_admin_area_for_point + parent chain. Bbox prefilters use existing GiST indexes. English/canonical names; country falls back to Myanmar. Read-only, no plus_code.';

commit;

-- Sample test (run separately):
-- select * from core.reverse_address_minimal(16.123456, 96.123456);
