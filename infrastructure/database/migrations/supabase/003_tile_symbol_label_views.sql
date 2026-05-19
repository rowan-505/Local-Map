-- Multilingual label columns for Martin / MapLibre: every labellable tile exposes name_mm, name_en, name.
-- Myanmar names: language mm/my OR Myanmar script (MYMR).
-- English names: language en OR Latin script (LATN).

create schema if not exists tiles;

-- ---------------------------------------------------------------------------
-- Places (POIs): unified `name` fallback for maps that only coalesce mm/en/name.
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_places_v as
select
    p.id,
    p.public_id,
    p.display_name,
    p.primary_name,
    mm.name as name_mm,
    en.name as name_en,
    coalesce(
        nullif(trim(mm.name), ''),
        nullif(trim(en.name), ''),
        nullif(trim(p.display_name), ''),
        nullif(trim(p.primary_name), '')
    ) as name,
    p.category_id,
    c.code as category,
    c.name as category_name,
    p.importance_score,
    p.is_public,
    p.is_verified,
    p.updated_at,
    p.point_geom as geom
from core.core_places as p
left join ref.ref_poi_categories as c
    on c.id = p.category_id
left join lateral (
    select pn.name
    from core.core_place_names as pn
    where pn.place_id = p.id
      and (
          pn.language_code in ('my', 'mm')
          or upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when pn.name_type = 'official' and pn.is_primary = true then 1
            when pn.is_primary = true then 2
            when pn.name_type = 'official' then 3
            else 4
        end,
        pn.search_weight desc nulls last,
        pn.name asc
    limit 1
) as mm on true
left join lateral (
    select pn.name
    from core.core_place_names as pn
    where pn.place_id = p.id
      and (
          pn.language_code = 'en'
          or upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
      )
    order by
        case
            when pn.name_type = 'official' and pn.is_primary = true then 1
            when pn.is_primary = true then 2
            when pn.name_type = 'official' then 3
            else 4
        end,
        pn.search_weight desc nulls last,
        pn.name asc
    limit 1
) as en on true
where p.deleted_at is null
  and p.is_public = true
  and p.point_geom is not null
  and not st_isempty(p.point_geom)
  and st_isvalid(p.point_geom);

-- ---------------------------------------------------------------------------
-- Road labels (line geometries).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_road_labels_v as
select
    s.id,
    sn_mm.name as name_mm,
    sn_en.name as name_en,
    coalesce(
        nullif(trim(sn_mm.name), ''),
        nullif(trim(sn_en.name), ''),
        nullif(trim(s.canonical_name), '')
    ) as name,
    s.geom,
    'road_label'::text as layer_type
from core.core_streets as s
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and (
          sn.language_code in ('my', 'mm')
          or upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when sn.name_type = 'official' and sn.is_primary = true then 1
            when sn.is_primary = true then 2
            when sn.name_type = 'official' then 3
            else 4
        end,
        sn.name asc
    limit 1
) as sn_mm on true
left join lateral (
    select sn.name
    from core.core_street_names as sn
    where sn.street_id = s.id
      and (
          sn.language_code = 'en'
          or upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
      )
    order by
        case
            when sn.name_type = 'official' and sn.is_primary = true then 1
            when sn.is_primary = true then 2
            when sn.name_type = 'official' then 3
            else 4
        end,
        sn.name asc
    limit 1
) as sn_en on true
where s.is_active = true
  and s.canonical_name is not null
  and s.geom is not null;

-- ---------------------------------------------------------------------------
-- Admin area labels (centroid points).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_admin_areas_v as
select
    a.id,
    an_mm.name as name_mm,
    an_en.name as name_en,
    coalesce(
        nullif(trim(an_mm.name), ''),
        nullif(trim(an_en.name), ''),
        nullif(trim(a.canonical_name), '')
    ) as name,
    a.centroid as geom
from core.core_admin_areas as a
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_mm on true
left join lateral (
    select n.name
    from core.core_admin_area_names as n
    where n.admin_area_id = a.id
      and (
          n.language_code = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.search_weight desc nulls last,
        n.name asc
    limit 1
) as an_en on true
where a.is_active = true
  and a.centroid is not null
  and not st_isempty(a.centroid)
  and st_isvalid(a.centroid);

-- ---------------------------------------------------------------------------
-- Bus stops (wrap core.core_bus_stops for tiles — keeps circle + label attrs).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_bus_stops_v as
select
    b.id,
    b.public_id,
    b.name_local,
    b.stop_code,
    b.geom,
    b.admin_area_id,
    b.source_type_id,
    b.is_active,
    b.created_at,
    b.updated_at,
    bn_mm.name as name_mm,
    bn_en.name as name_en,
    coalesce(
        nullif(trim(bn_mm.name), ''),
        nullif(trim(bn_en.name), ''),
        nullif(trim(b.name), ''),
        nullif(trim(b.stop_code), '')
    ) as name
from core.core_bus_stops as b
left join lateral (
    select n.name
    from core.core_bus_stop_names as n
    where n.stop_id = b.id
      and lower(trim(coalesce(n.language_code, ''))) in ('my', 'mm')
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as bn_mm on true
left join lateral (
    select n.name
    from core.core_bus_stop_names as n
    where n.stop_id = b.id
      and lower(trim(coalesce(n.language_code, ''))) = 'en'
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as bn_en on true
where b.is_active = true;

-- ---------------------------------------------------------------------------
-- Bus route variants (line geometries + route-level bilingual names).
-- ---------------------------------------------------------------------------
create or replace view tiles.tiles_bus_route_variants_v as
select
    v.id,
    v.route_id,
    v.variant_code,
    v.direction_name,
    v.origin_name,
    v.destination_name,
    v.distance_m,
    v.is_active,
    v.geom,
    rn_mm.name as name_mm,
    rn_en.name as name_en,
    coalesce(
        nullif(trim(rn_mm.name), ''),
        nullif(trim(rn_en.name), ''),
        nullif(trim(v.variant_code), ''),
        nullif(trim(v.direction_name), '')
    ) as name
from core.core_bus_route_variants as v
inner join core.core_bus_routes as r
    on r.id = v.route_id
left join lateral (
    select n.name
    from core.core_bus_route_names as n
    where n.route_id = r.id
      and lower(trim(coalesce(n.language_code, ''))) in ('my', 'mm')
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as rn_mm on true
left join lateral (
    select n.name
    from core.core_bus_route_names as n
    where n.route_id = r.id
      and lower(trim(coalesce(n.language_code, ''))) = 'en'
    order by
        case
            when n.name_type = 'official' and n.is_primary = true then 1
            when n.is_primary = true then 2
            when n.name_type = 'official' then 3
            else 4
        end,
        n.name asc
    limit 1
) as rn_en on true
where v.is_active = true
  and r.is_active = true;
