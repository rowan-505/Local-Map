-- inspect existing primary place names before running the insert
select
    pn.place_candidate_id,
    pn.name,
    pn.language_code,
    pn.name_type,
    pn.is_primary
from staging.staging_place_name_candidates as pn
where pn.name_type = 'primary'
order by pn.place_candidate_id, pn.id;

-- insert first-pass primary place names
with eligible_place_candidates as (
    select
        p.id as place_candidate_id,
        p.source_snapshot_id,
        nullif(btrim(p.canonical_name), '') as canonical_name,
        nullif(btrim(p.normalized_data ->> 'name'), '') as normalized_name,
        nullif(btrim(p.normalized_data ->> 'name:en'), '') as normalized_name_en
    from staging.staging_place_candidates as p
    where nullif(btrim(p.canonical_name), '') is not null
),
prepared_primary_names as (
    select
        p.place_candidate_id,
        p.source_snapshot_id,
        p.canonical_name as name,
        case
            when p.normalized_name_en is not null
             and p.canonical_name = p.normalized_name_en
             and (
                 p.normalized_name is null
                 or p.normalized_name <> p.normalized_name_en
             ) then 'en'
            else 'und'
        end as language_code,
        null::text as script_code,
        'primary'::text as name_type,
        true as is_primary,
        1.000::numeric(6,3) as search_weight
    from eligible_place_candidates as p
),
inserted_rows as (
    insert into staging.staging_place_name_candidates (
        source_snapshot_id,
        place_candidate_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        p.source_snapshot_id,
        p.place_candidate_id,
        p.name,
        p.language_code,
        p.script_code,
        p.name_type,
        p.is_primary,
        p.search_weight
    from prepared_primary_names as p
    where not exists (
        select 1
        from staging.staging_place_name_candidates as existing
        where existing.place_candidate_id = p.place_candidate_id
          and existing.name = p.name
          and existing.name_type = 'primary'
    )
    returning id
)
select
    count(*) as inserted_rows
from inserted_rows;

-- validation: total primary name rows in scope
select
    count(*) as total_primary_name_rows
from staging.staging_place_name_candidates as pn
join staging.staging_place_candidates as p
    on p.id = pn.place_candidate_id
where pn.name_type = 'primary'
  and p.canonical_name is not null;

-- validation: sample rows
select
    pn.id,
    pn.source_snapshot_id,
    pn.place_candidate_id,
    pn.name,
    pn.language_code,
    pn.script_code,
    pn.name_type,
    pn.is_primary,
    pn.search_weight
from staging.staging_place_name_candidates as pn
join staging.staging_place_candidates as p
    on p.id = pn.place_candidate_id
where pn.name_type = 'primary'
  and p.canonical_name is not null
order by pn.id desc
limit 50;

-- validation: places missing a primary name candidate
select
    p.id as place_candidate_id,
    p.source_snapshot_id,
    p.external_id,
    p.canonical_name
from staging.staging_place_candidates as p
where nullif(btrim(p.canonical_name), '') is not null
  and not exists (
      select 1
      from staging.staging_place_name_candidates as pn
      where pn.place_candidate_id = p.id
        and pn.name_type = 'primary'
        and pn.name = p.canonical_name
  )
order by p.id
limit 50;
