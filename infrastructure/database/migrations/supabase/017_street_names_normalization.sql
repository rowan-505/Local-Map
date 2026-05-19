-- Street name normalization:
-- - Align legacy Myanmar officials to language_code = 'mm'.
-- - Demote placeholder "Unnamed …" streets to generated (do not DELETE).
-- - Tile road views: lateral joins exclude name_type = 'generated'.

begin;

update core.core_street_names
set language_code = 'mm'
where language_code = 'my'
  and trim(name) <> ''
  and coalesce(trim(name_type), '') <> 'generated';

update core.core_street_names
set name_type = 'generated',
    is_primary = false
where coalesce(trim(name_type), '') = 'official'
  and (
      name ilike 'Unnamed %'
      or lower(trim(name)) = 'unnamed street'
  );

-- ---------------------------------------------------------------------------
-- Martin street views — ignore generated placeholders (prefer official names).
-- Shapes aligned with migrations 003 (symbol) / 006 multilingual script.
-- ---------------------------------------------------------------------------
create schema if not exists tiles;

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
      and coalesce(trim(sn.name_type), '') <> 'generated'
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
      and coalesce(trim(sn.name_type), '') <> 'generated'
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

create or replace view tiles.tiles_streets_v as
select
    s.id,
    s.public_id,
    coalesce(name_mm.name, name_en.name, s.canonical_name) as name,
    s.canonical_name,
    s.admin_area_id,
    s.is_active,
    s.updated_at,
    s.geom,
    name_mm.name as name_mm,
    name_en.name as name_en
from core.core_streets as s
left join lateral (
    select n.name
    from core.core_street_names as n
    where n.street_id = s.id
      and coalesce(trim(n.name_type), '') <> 'generated'
      and (
          lower(trim(n.language_code)) in ('my', 'mm')
          or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
      )
    order by
        n.is_primary desc,
        case n.name_type when 'official' then 0 else 1 end,
        n.id
    limit 1
) as name_mm on true
left join lateral (
    select n.name
    from core.core_street_names as n
    where n.street_id = s.id
      and coalesce(trim(n.name_type), '') <> 'generated'
      and (
          lower(trim(n.language_code)) = 'en'
          or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
      )
    order by
        n.is_primary desc,
        case n.name_type when 'official' then 0 else 1 end,
        n.id
    limit 1
) as name_en on true
where s.is_active = true
  and s.geom is not null;

commit;
