-- create primary core place names for MVP

with eligible_places as (
    select
        p.id as place_id,
        p.primary_name as name
    from core.core_places as p
    where p.primary_name is not null
      and nullif(btrim(p.primary_name), '') is not null
),
inserted_rows as (
    insert into core.core_place_names (
        place_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        e.place_id,
        e.name,
        'und'::text as language_code,
        null::text as script_code,
        'primary'::text as name_type,
        true as is_primary,
        100::integer as search_weight
    from eligible_places as e
    where not exists (
        select 1
        from core.core_place_names as n
        where n.place_id = e.place_id
          and n.name = e.name
    )
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;

-- validation: total primary core place name rows
select
    count(*) as total_primary_name_rows
from core.core_place_names as n
where n.name_type = 'primary'
  and n.is_primary = true;
