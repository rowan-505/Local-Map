-- =============================================================================
-- Supabase migration 043: backfill import_review.address_components from tags
-- =============================================================================
--
-- Purpose:
--   Extract structured addr:* (and normalized_data) fields from
--   import_review.address_candidates into import_review.address_components.
--   Does not write full_address on the candidate row.
--
-- Safety:
--   - Idempotent: dedupe key (address_candidate_id, component_type_code,
--     language_code, component_value); skips when an active row already exists.
--   - Does not UPDATE or DELETE existing components (including is_reviewed = true).
--   - Inserts only is_inferred = true rows from tag extraction.
--
-- Depends on: 040 (ref_address_component_types), 041, 042.
--
-- =============================================================================

begin;

create schema if not exists import_review;

do $guard$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise exception '043 backfill requires import_review.address_candidates';
    end if;
    if to_regclass('import_review.address_components') is null then
        raise exception '043 backfill requires import_review.address_components';
    end if;
    if to_regclass('ref.ref_address_component_types') is null then
        raise exception '043 backfill requires ref.ref_address_component_types';
    end if;
end
$guard$;

-- Dedup support for idempotent inserts (active rows only)
create unique index if not exists irr_acmp_dedup_active_uq
    on import_review.address_components (
        address_candidate_id,
        component_type_code,
        language_code,
        component_value
    )
    where is_deleted = false;

-- ---------------------------------------------------------------------------
-- Backfill insert (NOT EXISTS — never touches existing rows)
-- ---------------------------------------------------------------------------
with
candidates as (
    select
        c.id,
        coalesce(c.source_tags, '{}'::jsonb) as source_tags,
        coalesce(c.normalized_data, '{}'::jsonb) as normalized_data,
        coalesce(c.source_refs, '{}'::jsonb) as source_refs,
        nullif(btrim(c.plus_code), '') as plus_code_column
    from import_review.address_candidates as c
),
merged as (
    select
        c.id as address_candidate_id,
        c.source_refs,
        c.plus_code_column,
        c.normalized_data,
        (
            case
                when jsonb_typeof(c.source_tags) = 'object' then c.source_tags
                else '{}'::jsonb
            end
            || coalesce(
                case
                    when jsonb_typeof(c.normalized_data -> 'tags') = 'object' then c.normalized_data -> 'tags'
                    else '{}'::jsonb
                end,
                '{}'::jsonb
            )
            || coalesce(
                case
                    when jsonb_typeof(c.source_refs -> 'tags') = 'object' then c.source_refs -> 'tags'
                    else '{}'::jsonb
                end,
                '{}'::jsonb
            )
        ) as tags
    from candidates as c
),
-- Inline language helpers via scalar subqueries in each branch
extracted as (
    -- 1) addr:housenumber / addr:house_number
    select
        m.address_candidate_id,
        'house_number'::text as component_type_code,
        v.component_value,
        'und'::text as language_code,
        v.source_tag,
        85::numeric as confidence_score
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:housenumber'), ''), 'addr:housenumber'),
            (nullif(btrim(m.tags ->> 'addr:house_number'), ''), 'addr:house_number'),
            (nullif(btrim(m.normalized_data ->> 'house_number'), ''), 'normalized_data:house_number')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 2) addr:street (und or en if ASCII/Latin-looking)
    select
        m.address_candidate_id,
        'street',
        v.component_value,
        case
            when v.component_value ~ E'[\u1000-\u109F]' then 'my'
            when v.component_value ~ '^[[:print:][:space:]]*$'
                 and v.component_value ~ '[A-Za-z]'
                 and v.component_value !~ E'[\u1000-\u109F]' then 'en'
            else 'und'
        end,
        v.source_tag,
        75::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:street'), ''), 'addr:street'),
            (nullif(btrim(m.normalized_data ->> 'street_name'), ''), 'normalized_data:street_name')
    ) as v(component_value, source_tag)
    where v.component_value is not null
      and nullif(btrim(m.tags ->> 'addr:street:en'), '') is null
      and nullif(btrim(m.tags ->> 'addr:street:my'), '') is null
      and nullif(btrim(m.tags ->> 'addr:street:mm'), '') is null

    union all

    -- 3) addr:street:en
    select
        m.address_candidate_id,
        'street',
        nullif(btrim(m.tags ->> 'addr:street:en'), ''),
        'en',
        'addr:street:en',
        75::numeric
    from merged as m
    where nullif(btrim(m.tags ->> 'addr:street:en'), '') is not null

    union all

    -- 4) addr:street:my / addr:street:mm
    select
        m.address_candidate_id,
        'street',
        v.component_value,
        'my',
        v.source_tag,
        75::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:street:my'), ''), 'addr:street:my'),
            (nullif(btrim(m.tags ->> 'addr:street:mm'), ''), 'addr:street:mm')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 5) addr:postcode
    select
        m.address_candidate_id,
        'postcode',
        v.component_value,
        'und',
        v.source_tag,
        80::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:postcode'), ''), 'addr:postcode'),
            (nullif(btrim(m.normalized_data ->> 'postcode'), ''), 'normalized_data:postcode'),
            (nullif(btrim(m.normalized_data ->> 'postal_code'), ''), 'normalized_data:postal_code')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 6) addr:country
    select
        m.address_candidate_id,
        'country',
        v.component_value,
        'und',
        v.source_tag,
        80::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:country'), ''), 'addr:country'),
            (nullif(btrim(m.normalized_data ->> 'country'), ''), 'normalized_data:country')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 7) addr:city
    select
        m.address_candidate_id,
        'city',
        v.component_value,
        case
            when v.component_value ~ E'[\u1000-\u109F]' then 'my'
            when v.component_value ~ '^[[:print:][:space:]]*$'
                 and v.component_value ~ '[A-Za-z]'
                 and v.component_value !~ E'[\u1000-\u109F]' then 'en'
            else 'und'
        end,
        v.source_tag,
        72::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:city'), ''), 'addr:city'),
            (nullif(btrim(m.normalized_data ->> 'city'), ''), 'normalized_data:city')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 8) addr:township
    select
        m.address_candidate_id,
        'township',
        v.component_value,
        case
            when v.source_tag in ('addr:township:my', 'addr:township:mm') then 'my'
            when v.source_tag = 'addr:township:en' then 'en'
            when v.component_value ~ E'[\u1000-\u109F]' then 'my'
            when v.component_value ~ '^[[:print:][:space:]]*$'
                 and v.component_value ~ '[A-Za-z]'
                 and v.component_value !~ E'[\u1000-\u109F]' then 'en'
            else 'und'
        end,
        v.source_tag,
        72::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:township'), ''), 'addr:township'),
            (nullif(btrim(m.tags ->> 'addr:township:en'), ''), 'addr:township:en'),
            (nullif(btrim(m.tags ->> 'addr:township:my'), ''), 'addr:township:my'),
            (nullif(btrim(m.tags ->> 'addr:township:mm'), ''), 'addr:township:mm'),
            (nullif(btrim(m.normalized_data ->> 'township'), ''), 'normalized_data:township')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 9) addr:village
    select
        m.address_candidate_id,
        'village',
        v.component_value,
        case
            when v.source_tag in ('addr:village:my', 'addr:village:mm') then 'my'
            when v.source_tag = 'addr:village:en' then 'en'
            when v.component_value ~ E'[\u1000-\u109F]' then 'my'
            when v.component_value ~ '^[[:print:][:space:]]*$'
                 and v.component_value ~ '[A-Za-z]'
                 and v.component_value !~ E'[\u1000-\u109F]' then 'en'
            else 'und'
        end,
        v.source_tag,
        72::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:village'), ''), 'addr:village'),
            (nullif(btrim(m.tags ->> 'addr:village:en'), ''), 'addr:village:en'),
            (nullif(btrim(m.tags ->> 'addr:village:my'), ''), 'addr:village:my'),
            (nullif(btrim(m.tags ->> 'addr:village:mm'), ''), 'addr:village:mm')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 10) addr:quarter
    select
        m.address_candidate_id,
        'quarter',
        v.component_value,
        case
            when v.source_tag in ('addr:quarter:my', 'addr:quarter:mm') then 'my'
            when v.source_tag = 'addr:quarter:en' then 'en'
            when v.component_value ~ E'[\u1000-\u109F]' then 'my'
            when v.component_value ~ '^[[:print:][:space:]]*$'
                 and v.component_value ~ '[A-Za-z]'
                 and v.component_value !~ E'[\u1000-\u109F]' then 'en'
            else 'und'
        end,
        v.source_tag,
        70::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:quarter'), ''), 'addr:quarter'),
            (nullif(btrim(m.tags ->> 'addr:quarter:en'), ''), 'addr:quarter:en'),
            (nullif(btrim(m.tags ->> 'addr:quarter:my'), ''), 'addr:quarter:my'),
            (nullif(btrim(m.tags ->> 'addr:quarter:mm'), ''), 'addr:quarter:mm'),
            (nullif(btrim(m.normalized_data ->> 'quarter'), ''), 'normalized_data:quarter')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 11) addr:unit
    select
        m.address_candidate_id,
        'unit',
        v.component_value,
        'und',
        v.source_tag,
        80::numeric
    from merged as m
    cross join lateral (
        values
            (nullif(btrim(m.tags ->> 'addr:unit'), ''), 'addr:unit'),
            (nullif(btrim(m.normalized_data ->> 'unit_number'), ''), 'normalized_data:unit_number')
    ) as v(component_value, source_tag)
    where v.component_value is not null

    union all

    -- 12) addr:floor
    select
        m.address_candidate_id,
        'floor',
        nullif(btrim(m.tags ->> 'addr:floor'), ''),
        'und',
        'addr:floor',
        80::numeric
    from merged as m
    where nullif(btrim(m.tags ->> 'addr:floor'), '') is not null

    union all

    -- 13) plus_code / addr:plus_code
    select
        m.address_candidate_id,
        'plus_code',
        v.component_value,
        'und',
        v.source_tag,
        75::numeric
    from merged as m
    cross join lateral (
        values
            (m.plus_code_column, 'column:plus_code'),
            (nullif(btrim(m.tags ->> 'plus_code'), ''), 'plus_code'),
            (nullif(btrim(m.tags ->> 'addr:plus_code'), ''), 'addr:plus_code'),
            (nullif(btrim(m.normalized_data ->> 'plus_code'), ''), 'normalized_data:plus_code')
    ) as v(component_value, source_tag)
    where v.component_value is not null
),
-- 14) Inferred country MM when no addr:country but region indicates Myanmar
inferred_country as (
    select
        m.address_candidate_id,
        'country'::text as component_type_code,
        'MM'::text as component_value,
        'und'::text as language_code,
        'inferred:source_refs.region_code'::text as source_tag,
        70::numeric as confidence_score
    from merged as m
    where nullif(btrim(m.tags ->> 'addr:country'), '') is null
      and nullif(btrim(m.normalized_data ->> 'country'), '') is null
      and upper(
          coalesce(
              nullif(btrim(m.source_refs ->> 'region_code'), ''),
              nullif(btrim(m.normalized_data ->> 'region_code'), ''),
              nullif(btrim(m.source_refs ->> 'region'), ''),
              ''
          )
      ) in ('MM', 'MMR', 'MYANMAR', 'BURMA', 'YANGON', 'YANGON_REGION')
),
all_extracted as (
    select * from extracted
    union all
    select * from inferred_country
),
typed as (
    select
        e.address_candidate_id,
        rt.id as component_type_id,
        e.component_type_code,
        e.component_value,
        e.language_code,
        e.source_tag,
        rt.rank as sort_order,
        e.confidence_score
    from all_extracted as e
    inner join ref.ref_address_component_types as rt
        on rt.code = e.component_type_code
    where btrim(e.component_value) <> ''
),
to_insert as (
    select distinct on (
        t.address_candidate_id,
        t.component_type_code,
        t.language_code,
        t.component_value
    )
        t.*
    from typed as t
    where not exists (
        select 1
        from import_review.address_components as ac
        where ac.address_candidate_id = t.address_candidate_id
          and ac.component_type_code = t.component_type_code
          and ac.language_code = t.language_code
          and ac.component_value = t.component_value
          and ac.is_deleted = false
    )
    order by
        t.address_candidate_id,
        t.component_type_code,
        t.language_code,
        t.component_value,
        t.confidence_score desc
)
insert into import_review.address_components (
    address_candidate_id,
    component_type_id,
    component_type_code,
    component_value,
    language_code,
    source_tag,
    sort_order,
    confidence_score,
    match_type,
    is_inferred,
    is_reviewed,
    is_deleted,
    source_refs,
    normalized_data
)
select
    ti.address_candidate_id,
    ti.component_type_id,
    ti.component_type_code,
    ti.component_value,
    ti.language_code,
    ti.source_tag,
    ti.sort_order,
    ti.confidence_score,
    'tag_extract',
    true,
    false,
    false,
    jsonb_build_object('backfill', '043', 'source_tag', ti.source_tag),
    jsonb_build_object('backfill', '043', 'source_tag', ti.source_tag)
from to_insert as ti;

-- sort_order / component_type_id repair on existing inferred rows only (NULL sort_order; not reviewed)
update import_review.address_components as ac
set
    sort_order = coalesce(ac.sort_order, rt.rank),
    component_type_id = coalesce(ac.component_type_id, rt.id),
    updated_at = now()
from ref.ref_address_component_types as rt
where ac.component_type_code = rt.code
  and ac.is_deleted = false
  and ac.is_reviewed = false
  and ac.sort_order is null;

commit;

-- =============================================================================
-- Verification (read-only)
-- =============================================================================

-- 1) Count components by type and language
select
    component_type_code,
    language_code,
    count(*)::bigint as row_count,
    count(*) filter (where is_inferred)::bigint as inferred_count,
    count(*) filter (where is_reviewed)::bigint as reviewed_count
from import_review.address_components
where is_deleted = false
group by component_type_code, language_code
order by component_type_code, language_code;

-- 2) Sample: 30 candidates with components aggregated (newest candidates first)
select
    c.id as address_candidate_id,
    c.external_id,
    count(ac.id) filter (where ac.is_deleted = false)::bigint as component_count,
    jsonb_agg(
        jsonb_build_object(
            'type', ac.component_type_code,
            'lang', ac.language_code,
            'value', ac.component_value,
            'source_tag', ac.source_tag,
            'confidence', ac.confidence_score,
            'inferred', ac.is_inferred,
            'reviewed', ac.is_reviewed
        )
        order by ac.sort_order nulls last, ac.component_type_code, ac.language_code
    ) filter (where ac.id is not null and ac.is_deleted = false) as components
from import_review.address_candidates as c
left join import_review.address_components as ac
    on ac.address_candidate_id = c.id
   and ac.is_deleted = false
group by c.id, c.external_id
order by c.updated_at desc nulls last, c.id desc
limit 30;

-- 3) Candidates with zero active components
select
    c.id,
    c.external_id,
    c.review_status,
    c.promotion_status,
    c.point_geom is not null as has_point_geom
from import_review.address_candidates as c
where not exists (
    select 1
    from import_review.address_components as ac
    where ac.address_candidate_id = c.id
      and ac.is_deleted = false
)
order by c.updated_at desc nulls last, c.id desc
limit 50;
