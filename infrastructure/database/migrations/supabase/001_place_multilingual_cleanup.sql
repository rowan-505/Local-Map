-- Conservative cleanup/backfill for core_place_names + core_places denormalized fields.
-- Inspect counts in a transaction before committing.

begin;

-- Normalize script casing (ISO 15924 uses mixed case; DB convention follows existing API queries.)
update core.core_place_names
set script_code = 'Mymr'
where upper(trim(script_code)) = 'MYMR';

update core.core_place_names
set script_code = 'Latn'
where upper(trim(script_code)) = 'LATN';

-- Infer language/script only when missing or explicitly undetermined.
update core.core_place_names pn
set language_code = 'my'
where coalesce(trim(language_code), '') in ('', 'und')
  and pn.script_code = 'Mymr';

update core.core_place_names pn
set
    language_code = 'en',
    script_code = coalesce(pn.script_code, 'Latn')
where coalesce(trim(language_code), '') in ('', 'und')
  and pn.script_code is distinct from 'Mymr'
  and pn.name ~ '^[[:ascii:]]+$'
  and pn.name ~ '[A-Za-z]';

update core.core_place_names pn
set script_code = coalesce(pn.script_code, case pn.language_code when 'my' then 'Mymr' when 'en' then 'Latn' end)
where pn.script_code is null
  and pn.language_code in ('my', 'en');

update core.core_place_names pn
set name_type = coalesce(nullif(trim(name_type), ''), 'alias');

update core.core_place_names pn
set name_type = 'english'
where pn.language_code = 'en'
  and pn.name_type = 'alias';

update core.core_place_names pn
set name_type = 'official'
where pn.language_code = 'my'
  and pn.is_primary is true
  and pn.name_type = 'alias';

update core.core_place_names
set is_primary = coalesce(is_primary, false);

update core.core_place_names pn
set search_weight = case
    when pn.is_primary then 100
    when pn.language_code = 'en' or pn.name_type = 'english' then 90
    else 70
end
where pn.search_weight is null;

with ranked as (
    select
        id,
        place_id,
        row_number() over (
            partition by place_id
            order by
                case
                    when language_code = 'my' then 0
                    when language_code = 'en' then 1
                    else 2
                end,
                case name_type when 'official' then 0 when 'primary' then 1 else 2 end,
                search_weight desc nulls last,
                name asc
        ) as rn
    from core.core_place_names
),
winner as (
    select id
    from ranked
    where rn = 1
)
update core.core_place_names pn
set is_primary = (pn.id in (select id from winner)),
    search_weight = case
        when pn.id in (select id from winner) then 100
        when pn.language_code = 'en' or pn.name_type = 'english' then 90
        else greatest(coalesce(pn.search_weight, 70), 70)
    end;

with mm as (
    select distinct on (pn.place_id)
        pn.place_id,
        pn.name as mm_name
    from core.core_place_names pn
    where pn.language_code = 'my'
       or pn.script_code = 'Mymr'
    order by
        pn.place_id,
        pn.is_primary desc,
        pn.search_weight desc nulls last,
        pn.name asc
),
en as (
    select distinct on (pn.place_id)
        pn.place_id,
        pn.name as en_name
    from core.core_place_names pn
    where pn.language_code = 'en'
       or pn.name_type = 'english'
       or pn.script_code = 'Latn'
    order by
        pn.place_id,
        pn.is_primary desc,
        pn.search_weight desc nulls last,
        pn.name asc
),
prim as (
    select distinct on (pn.place_id)
        pn.place_id,
        pn.name as primary_row_name
    from core.core_place_names pn
    where pn.is_primary is true
    order by
        pn.place_id,
        pn.search_weight desc nulls last,
        pn.name asc
),
agg as (
    select
        p.id as place_id,
        mm.mm_name,
        en.en_name,
        prim.primary_row_name
    from core.core_places p
    left join mm on mm.place_id = p.id
    left join en on en.place_id = p.id
    left join prim on prim.place_id = p.id
    where p.deleted_at is null
)
update core.core_places p
set
    primary_name = coalesce(
        nullif(trim(a.mm_name), ''),
        nullif(trim(a.primary_row_name), ''),
        nullif(trim(p.display_name), ''),
        p.primary_name
    ),
    secondary_name = case when nullif(trim(a.en_name), '') is not null then trim(a.en_name) end,
    name_local = case when nullif(trim(a.mm_name), '') is not null then trim(a.mm_name) end,
    display_name = coalesce(
        nullif(trim(a.mm_name), ''),
        nullif(trim(a.en_name), ''),
        nullif(trim(p.primary_name), ''),
        p.display_name
    ),
    importance_score = coalesce(p.importance_score, 0),
    popularity_score = coalesce(p.popularity_score, 0),
    confidence_score = coalesce(
        p.confidence_score,
        case when st.code = 'manual' then 50 else 0 end
    ),
    is_public = coalesce(p.is_public, true),
    is_verified = coalesce(p.is_verified, false),
    updated_at = now()
from agg a
left join ref.ref_source_types st on st.id = p.source_type_id
where p.id = a.place_id;

commit;
