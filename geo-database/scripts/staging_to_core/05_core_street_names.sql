-- create primary core street names for MVP

with eligible_streets as (
    select
        s.id as street_id,
        s.canonical_name as name
    from core.core_streets as s
    where s.canonical_name is not null
      and nullif(btrim(s.canonical_name), '') is not null
),
inserted_rows as (
    insert into core.core_street_names (
        street_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary
    )
    select
        e.street_id,
        e.name,
        'und'::text as language_code,
        null::text as script_code,
        'primary'::text as name_type,
        true as is_primary
    from eligible_streets as e
    where not exists (
        select 1
        from core.core_street_names as n
        where n.street_id = e.street_id
          and n.name = e.name
    )
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;
