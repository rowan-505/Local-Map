-- =============================================================================
-- Supabase migration 048: search.address_index (generated address search)
-- =============================================================================
--
-- Materialized search rows per core address (en / my / optional und).
-- Refreshed via search.refresh_address_index() after promotion or component edits.
-- Replaces the early placeholder search.search_addresses for new indexer work.
--
-- =============================================================================

begin;

create schema if not exists search;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists search.address_index (
    id bigserial primary key,
    address_id bigint not null references core.core_addresses (id) on delete cascade,
    language_code text not null,
    search_text text not null,
    search_tokens text[] null,
    house_number text null,
    street_text text null,
    admin_text text null,
    postcode text null,
    point_geom geometry(Point, 4326) null,
    admin_area_id bigint null references core.core_admin_areas (id) on delete set null,
    street_id bigint null references core.core_streets (id) on delete set null,
    rank_score numeric not null default 50,
    updated_at timestamptz not null default now(),
    constraint address_index_language_code_chk
        check (language_code in ('en', 'my', 'und'))
);

create unique index if not exists address_index_address_language_uq
    on search.address_index (address_id, language_code);

create index if not exists address_index_address_id_idx
    on search.address_index (address_id);

create index if not exists address_index_language_code_idx
    on search.address_index (language_code);

create index if not exists address_index_admin_area_id_idx
    on search.address_index (admin_area_id)
    where admin_area_id is not null;

create index if not exists address_index_street_id_idx
    on search.address_index (street_id)
    where street_id is not null;

create index if not exists address_index_point_geom_gix
    on search.address_index using gist (point_geom)
    where point_geom is not null;

create index if not exists address_index_lower_search_text_idx
    on search.address_index (lower(search_text));

comment on table search.address_index is
    'Generated address search index (one row per address per language). Not edited manually.';

comment on column search.address_index.search_text is
    'Comma-joined searchable line composed from core_address_components for this language.';

comment on column search.address_index.search_tokens is
    'Lowercase alphanumeric tokens derived from search_text for simple token matching.';

-- ---------------------------------------------------------------------------
-- Component ordering (matches apps/api address-composer composition order)
-- ---------------------------------------------------------------------------
create or replace function search.address_component_type_rank(p_code text)
returns integer
language sql
immutable
as $$
    select case lower(trim(coalesce(p_code, '')))
        when 'house_number' then 1
        when 'unit' then 2
        when 'floor' then 3
        when 'building' then 4
        when 'street' then 5
        when 'road' then 6
        when 'quarter' then 7
        when 'ward' then 8
        when 'village' then 9
        when 'village_tract' then 10
        when 'town' then 11
        when 'city' then 12
        when 'township' then 13
        when 'district' then 14
        when 'region' then 15
        when 'postcode' then 16
        when 'plus_code' then 17
        when 'country' then 18
        else 99
    end;
$$;

create or replace function search.is_neutral_address_component(p_code text)
returns boolean
language sql
immutable
as $$
    select lower(trim(coalesce(p_code, ''))) in (
        'house_number', 'unit', 'floor', 'postcode', 'plus_code', 'country'
    );
$$;

create or replace function search.is_admin_address_component(p_code text)
returns boolean
language sql
immutable
as $$
    select lower(trim(coalesce(p_code, ''))) in (
        'quarter', 'ward', 'village', 'village_tract', 'town', 'city', 'township', 'district', 'region'
    );
$$;

create or replace function search.is_street_address_component(p_code text)
returns boolean
language sql
immutable
as $$
    select lower(trim(coalesce(p_code, ''))) in ('street', 'road');
$$;

-- ---------------------------------------------------------------------------
-- Tokenize search line
-- ---------------------------------------------------------------------------
create or replace function search.tokenize_search_text(p_text text)
returns text[]
language sql
immutable
as $$
    select coalesce(
        array_remove(
            regexp_split_to_array(lower(trim(coalesce(p_text, ''))), '[^[:alnum:]]+'),
            ''
        ),
        '{}'::text[]
    );
$$;

-- ---------------------------------------------------------------------------
-- Build composed search line for one address + language
-- ---------------------------------------------------------------------------
create or replace function search.build_address_search_line(
    p_address_id bigint,
    p_language_code text
)
returns text
language sql
stable
as $$
    with ranked as (
        select
            btrim(c.component_value) as segment,
            search.address_component_type_rank(c.component_type_code) as type_rank,
            coalesce(c.sort_order, 100) as sort_order
        from core.core_address_components as c
        where c.address_id = p_address_id
          and btrim(coalesce(c.component_value, '')) <> ''
          and (
              (p_language_code = 'en'
               and lower(trim(coalesce(c.language_code, 'und'))) in ('en', 'und'))
              or (p_language_code = 'my'
                  and lower(trim(coalesce(c.language_code, 'und'))) in ('my', 'mm', 'und'))
              or (
                  p_language_code = 'und'
                  and search.is_neutral_address_component(c.component_type_code)
                  and lower(trim(coalesce(c.language_code, 'und'))) in ('und', 'en', 'my', 'mm')
              )
          )
    )
    select nullif(
        string_agg(segment, ', ' order by type_rank asc, sort_order asc, segment asc),
        ''
    )
    from ranked;
$$;

create or replace function search.pick_address_component_value(
    p_address_id bigint,
    p_type_code text,
    p_langs text[] default array['und', 'en', 'my']
)
returns text
language sql
stable
as $$
    select c.component_value
    from core.core_address_components as c
    where c.address_id = p_address_id
      and lower(trim(c.component_type_code)) = lower(trim(p_type_code))
      and btrim(coalesce(c.component_value, '')) <> ''
      and lower(trim(coalesce(c.language_code, 'und'))) = any (p_langs)
    order by
        array_position(
            p_langs,
            lower(trim(coalesce(c.language_code, 'und')))
        ) nulls last,
        c.id asc
    limit 1;
$$;

create or replace function search.pick_address_field_text(
    p_address_id bigint,
    p_language_code text,
    p_kind text
)
returns text
language sql
stable
as $$
    with comps as (
        select btrim(c.component_value) as val
        from core.core_address_components as c
        where c.address_id = p_address_id
          and btrim(coalesce(c.component_value, '')) <> ''
          and (
              (p_language_code = 'en'
               and lower(trim(coalesce(c.language_code, 'und'))) in ('en', 'und'))
              or (p_language_code = 'my'
                  and lower(trim(coalesce(c.language_code, 'und'))) in ('my', 'mm', 'und'))
              or (p_language_code = 'und')
          )
          and (
              (p_kind = 'street' and search.is_street_address_component(c.component_type_code))
              or (p_kind = 'admin' and search.is_admin_address_component(c.component_type_code))
              or (p_kind = 'house' and lower(trim(c.component_type_code)) = 'house_number')
              or (p_kind = 'postcode' and lower(trim(c.component_type_code)) = 'postcode')
          )
    )
    select nullif(string_agg(distinct val, ' ' order by val), '')
    from comps;
$$;

-- ---------------------------------------------------------------------------
-- Refresh index (full or per-address)
-- ---------------------------------------------------------------------------
create or replace function search.refresh_address_index(p_address_ids bigint[] default null)
returns bigint
language plpgsql
as $$
declare
    v_inserted bigint;
begin
    if p_address_ids is null then
        delete from search.address_index;
    elsif cardinality(p_address_ids) = 0 then
        return 0;
    else
        delete from search.address_index
        where address_id = any (p_address_ids);
    end if;

    insert into search.address_index (
        address_id,
        language_code,
        search_text,
        search_tokens,
        house_number,
        street_text,
        admin_text,
        postcode,
        point_geom,
        admin_area_id,
        street_id,
        rank_score,
        updated_at
    )
    select
        a.id as address_id,
        lang.language_code,
        coalesce(line.search_line, nullif(btrim(a.full_address), ''), '') as search_text,
        search.tokenize_search_text(
            coalesce(line.search_line, nullif(btrim(a.full_address), ''), '')
        ) as search_tokens,
        coalesce(
            search.pick_address_component_value(a.id, 'house_number'),
            nullif(btrim(a.house_number), '')
        ) as house_number,
        coalesce(
            search.pick_address_field_text(a.id, lang.language_code, 'street'),
            nullif(btrim(a.street_name), ''),
            sn.canonical_name
        ) as street_text,
        coalesce(
            search.pick_address_field_text(a.id, lang.language_code, 'admin'),
            nullif(
                concat_ws(
                    ', ',
                    nullif(btrim(a.suburb), ''),
                    nullif(btrim(a.township), ''),
                    nullif(btrim(a.city), ''),
                    nullif(btrim(a.state_region), '')
                ),
                ''
            ),
            aa.canonical_name
        ) as admin_text,
        coalesce(
            search.pick_address_component_value(a.id, 'postcode'),
            nullif(btrim(a.postal_code), ''),
            nullif(btrim(a.postcode), '')
        ) as postcode,
        coalesce(a.entrance_geom, a.point_geom) as point_geom,
        a.admin_area_id,
        a.street_id,
        (
            50
            + case when coalesce(a.is_verified, false) then 10 else 0 end
            + case
                when coalesce(
                    search.pick_address_component_value(a.id, 'house_number'),
                    nullif(btrim(a.house_number), '')
                ) is not null then 8
                else 0
              end
            + case when a.street_id is not null then 5 else 0 end
            + case when a.admin_area_id is not null then 3 else 0 end
        )::numeric as rank_score,
        now() as updated_at
    from core.core_addresses as a
    cross join (
        values ('en'::text), ('my'::text)
    ) as lang (language_code)
    left join lateral (
        select search.build_address_search_line(a.id, lang.language_code) as search_line
    ) as line on true
    left join core.core_streets as sn on sn.id = a.street_id
    left join core.core_admin_areas as aa on aa.id = a.admin_area_id
    where a.deleted_at is null
      and (p_address_ids is null or a.id = any (p_address_ids))
      and coalesce(line.search_line, nullif(btrim(a.full_address), ''), '') <> ''

    union all

    select
        a.id,
        'und'::text,
        und_line.search_line,
        search.tokenize_search_text(und_line.search_line),
        search.pick_address_component_value(a.id, 'house_number'),
        null::text,
        null::text,
        coalesce(
            search.pick_address_component_value(a.id, 'postcode'),
            nullif(btrim(a.postal_code), ''),
            nullif(btrim(a.postcode), '')
        ),
        coalesce(a.entrance_geom, a.point_geom),
        a.admin_area_id,
        a.street_id,
        40::numeric,
        now()
    from core.core_addresses as a
    left join lateral (
        select search.build_address_search_line(a.id, 'und') as search_line
    ) as und_line on true
    where a.deleted_at is null
      and (p_address_ids is null or a.id = any (p_address_ids))
      and und_line.search_line is not null
      and btrim(und_line.search_line) <> ''
    on conflict (address_id, language_code) do update set
        search_text = excluded.search_text,
        search_tokens = excluded.search_tokens,
        house_number = excluded.house_number,
        street_text = excluded.street_text,
        admin_text = excluded.admin_text,
        postcode = excluded.postcode,
        point_geom = excluded.point_geom,
        admin_area_id = excluded.admin_area_id,
        street_id = excluded.street_id,
        rank_score = excluded.rank_score,
        updated_at = excluded.updated_at;

    get diagnostics v_inserted = row_count;
    return v_inserted;
end;
$$;

comment on function search.refresh_address_index(bigint[]) is
    'Rebuild search.address_index for all addresses (NULL) or the given core.core_addresses ids.';

-- ---------------------------------------------------------------------------
-- Trigram + optional English full-text indexes
-- ---------------------------------------------------------------------------
do $migration$
begin
    if exists (select 1 from pg_extension where extname = 'pg_trgm') then
        execute $idx$
            create index if not exists address_index_search_text_trgm_idx
            on search.address_index using gin (search_text gin_trgm_ops)
        $idx$;
    end if;
end
$migration$;

create index if not exists address_index_search_text_en_tsv_idx
    on search.address_index using gin (to_tsvector('english', search_text))
    where language_code = 'en';

-- ---------------------------------------------------------------------------
-- Initial population
-- ---------------------------------------------------------------------------
do $migration$
declare
    v_rows bigint;
begin
    if to_regclass('core.core_addresses') is not null then
        v_rows := search.refresh_address_index(null);
        raise notice 'search.refresh_address_index: inserted/updated % rows', v_rows;
    end if;
end
$migration$;

commit;
