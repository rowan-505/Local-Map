-- =============================================================================
-- Supabase migration 131: search.search_aliases + index integration
-- =============================================================================
--
-- Search-specific alternative names without changing canonical entity names.
-- Active aliases are folded into search.search_document_names and appended to
-- searchable_text / trigram_text on rebuild, sync, and refresh.
--
-- Affected / replaced functions:
--   - search.sync_search_documents(text, bigint[])
--   - search.rebuild_search_documents(text[])
--   - search.apply_search_aliases_for_documents(text, bigint[])  [new]
--   - search.refresh_search_aliases(text, bigint[])              [new]
--   - search.fetch_source_searchable_text(text, bigint)          [new]
--   - search.search_alias_weight(text)                           [new]
--
-- After applying (only entities with new/changed aliases need refresh):
--   SELECT search.refresh_search_aliases('place', ARRAY[<place_id>]);
--   -- or partial rebuild:
--   npm --prefix apps/api run rebuild:search-index -- --views places
-- =============================================================================

begin;

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- search.search_aliases
-- ---------------------------------------------------------------------------
create table if not exists search.search_aliases (
    id bigserial primary key,
    entity_type text not null,
    entity_id bigint not null,
    alias_text text not null,
    normalized_alias text not null,
    language_code text null,
    alias_type text not null,
    source text null,
    is_active boolean not null default true,
    created_by bigint null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint search_aliases_alias_text_chk
        check (btrim(alias_text) <> ''),
    constraint search_aliases_normalized_alias_chk
        check (btrim(normalized_alias) <> ''),
    constraint search_aliases_alias_type_chk
        check (alias_type in (
            'common_name',
            'abbreviation',
            'alternative_spelling',
            'old_name',
            'transliteration',
            'local_name',
            'search_correction'
        ))
);

comment on table search.search_aliases is
    'Search-only alternative names for indexed entities. Does not change canonical official names in core tables.';

comment on column search.search_aliases.normalized_alias is
    'Lowercase trimmed alias_text used for exact / trigram matching.';

create unique index if not exists search_aliases_active_unique_idx
    on search.search_aliases (
        entity_type,
        entity_id,
        normalized_alias,
        coalesce(language_code, '')
    )
    where is_active = true;

create index if not exists search_aliases_entity_idx
    on search.search_aliases (entity_type, entity_id);

create index if not exists search_aliases_active_entity_idx
    on search.search_aliases (entity_type, entity_id)
    where is_active = true;

create index if not exists search_aliases_normalized_alias_trgm_idx
    on search.search_aliases using gin (normalized_alias gin_trgm_ops)
    where is_active = true;

create or replace function search.search_aliases_normalize_trg()
returns trigger
language plpgsql
as $fn$
begin
    new.alias_text := btrim(coalesce(new.alias_text, ''));
    if new.alias_text = '' then
        raise exception 'alias_text cannot be empty';
    end if;
    new.normalized_alias := lower(new.alias_text);
    new.updated_at := now();
    return new;
end;
$fn$;

drop trigger if exists search_aliases_normalize_trg on search.search_aliases;

create trigger search_aliases_normalize_trg
    before insert or update of alias_text, language_code, alias_type, source, is_active
    on search.search_aliases
    for each row
    execute function search.search_aliases_normalize_trg();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function search.search_alias_types()
returns text[]
language sql
immutable
parallel safe
as $$
    select array[
        'common_name',
        'abbreviation',
        'alternative_spelling',
        'old_name',
        'transliteration',
        'local_name',
        'search_correction'
    ]::text[];
$$;

create or replace function search.search_alias_weight(p_alias_type text)
returns numeric
language sql
immutable
parallel safe
as $$
    select case lower(btrim(coalesce(p_alias_type, '')))
        when 'abbreviation' then 90
        when 'search_correction' then 88
        when 'common_name' then 82
        when 'local_name' then 80
        when 'transliteration' then 78
        when 'alternative_spelling' then 76
        when 'old_name' then 70
        else 75
    end::numeric;
$$;

comment on function search.search_alias_weight(text) is
    'Relative search_document_names.search_weight for folded aliases (0-100 scale).';

create or replace function search.fetch_source_searchable_text(
    p_entity_type text,
    p_entity_id bigint
)
returns text
language plpgsql
stable
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_entity_type text := lower(btrim(coalesce(p_entity_type, '')));
    v_view text;
    v_text text;
begin
    if p_entity_id is null then
        return null;
    end if;

    v_view := case v_entity_type
        when 'place' then 'search.v_search_places_source'
        when 'admin_area' then 'search.v_search_admin_areas_source'
        when 'street_group' then 'search.v_search_street_groups_source'
        when 'street' then 'search.v_search_streets_source'
        when 'address' then 'search.v_search_addresses_source'
        when 'transport_stop' then 'search.v_search_bus_stops_source'
        when 'bus_stop' then 'search.v_search_bus_stops_source'
        when 'transport_terminal' then 'search.v_search_transport_terminals_source'
        when 'transport_route' then 'search.v_search_bus_routes_source'
        when 'transport_route_variant' then 'search.v_search_bus_routes_source'
        when 'bus_route' then 'search.v_search_bus_routes_source'
        when 'bus_route_variant' then 'search.v_search_bus_routes_source'
        when 'building' then 'search.v_search_buildings_source'
        when 'water_line' then 'search.v_search_water_lines_source'
        when 'water_polygon' then 'search.v_search_water_polygons_source'
        when 'landuse' then 'search.v_search_landuse_source'
        else null
    end;

    if v_view is null then
        return null;
    end if;

    if v_entity_type in (
        'transport_route',
        'transport_route_variant',
        'bus_route',
        'bus_route_variant'
    ) then
        execute format(
            'select searchable_text from %I where entity_type = $1 and entity_id = $2 limit 1',
            v_view
        )
        into v_text
        using v_entity_type, p_entity_id;
    else
        execute format(
            'select searchable_text from %I where entity_id = $1 limit 1',
            v_view
        )
        into v_text
        using p_entity_id;
    end if;

    return v_text;
end;
$fn$;

create or replace function search.apply_search_aliases_for_documents(
    p_entity_type text default null,
    p_entity_ids bigint[] default null
)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_entity_type text := nullif(lower(btrim(coalesce(p_entity_type, ''))), '');
    v_names_removed int := 0;
    v_names_added int := 0;
    v_docs_updated int := 0;
begin
    delete from search.search_document_names n
    using search.search_documents d
    where n.search_document_id = d.id
      and n.name_type = any (search.search_alias_types())
      and n.is_primary = false
      and (v_entity_type is null or d.entity_type = v_entity_type)
      and (p_entity_ids is null or cardinality(p_entity_ids) = 0 or d.entity_id = any (p_entity_ids))
      and not exists (
          select 1
          from search.search_aliases a
          where a.is_active
            and a.entity_type = d.entity_type
            and a.entity_id = d.entity_id
            and a.normalized_alias = n.normalized_name
            and coalesce(nullif(btrim(a.language_code), ''), 'und') = n.language_code
      );

    get diagnostics v_names_removed = row_count;

    with ins as (
        insert into search.search_document_names (
            search_document_id,
            language_code,
            script_code,
            name,
            normalized_name,
            name_type,
            is_primary,
            search_weight
        )
        select
            d.id,
            coalesce(nullif(btrim(a.language_code), ''), 'und'),
            null,
            a.alias_text,
            a.normalized_alias,
            a.alias_type,
            false,
            least(100, greatest(0, search.search_alias_weight(a.alias_type)))
        from search.search_aliases a
        inner join search.search_documents d
            on d.entity_type = a.entity_type
           and d.entity_id = a.entity_id
        where a.is_active
          and (v_entity_type is null or a.entity_type = v_entity_type)
          and (p_entity_ids is null or cardinality(p_entity_ids) = 0 or a.entity_id = any (p_entity_ids))
          and not exists (
              select 1
              from search.search_document_names n
              where n.search_document_id = d.id
                and n.normalized_name = a.normalized_alias
                and n.language_code = coalesce(nullif(btrim(a.language_code), ''), 'und')
          )
        returning 1
    )
    select count(*)::int into v_names_added from ins;

    with targets as (
        select d.id, d.entity_type, d.entity_id
        from search.search_documents d
        where (v_entity_type is null or d.entity_type = v_entity_type)
          and (p_entity_ids is null or cardinality(p_entity_ids) = 0 or d.entity_id = any (p_entity_ids))
    ),
    merged as (
        select
            t.id,
            nullif(
                btrim(
                    concat_ws(
                        ' ',
                        search.fetch_source_searchable_text(t.entity_type, t.entity_id),
                        (
                            select string_agg(distinct a.alias_text, ' ' order by a.alias_text)
                            from search.search_aliases a
                            where a.is_active
                              and a.entity_type = t.entity_type
                              and a.entity_id = t.entity_id
                        )
                    )
                ),
                ''
            ) as merged_text
        from targets t
    )
    update search.search_documents d
    set searchable_text = m.merged_text,
        trigram_text = nullif(lower(m.merged_text), ''),
        indexed_at = now()
    from merged m
    where d.id = m.id
      and m.merged_text is distinct from d.searchable_text;

    get diagnostics v_docs_updated = row_count;

    return jsonb_build_object(
        'entity_type', v_entity_type,
        'entity_ids', coalesce(to_jsonb(p_entity_ids), 'null'::jsonb),
        'names_removed', v_names_removed,
        'names_added', v_names_added,
        'documents_updated', v_docs_updated
    );
end;
$fn$;

comment on function search.apply_search_aliases_for_documents(text, bigint[]) is
    'Fold active search.search_aliases into search_document_names and searchable_text for indexed documents.';

create or replace function search.refresh_search_aliases(
    p_entity_type text,
    p_entity_ids bigint[] default null
)
returns jsonb
language sql
set search_path = public, search, core, ref, transport
as $$
    select search.apply_search_aliases_for_documents(p_entity_type, p_entity_ids);
$$;

comment on function search.refresh_search_aliases(text, bigint[]) is
    'Refresh folded aliases after search.search_aliases CRUD. Does not rebuild canonical names.';

-- ---------------------------------------------------------------------------
-- sync_search_documents: fold aliases after each entity sync
-- ---------------------------------------------------------------------------
create or replace function search.sync_search_documents(
    p_entity_type text,
    p_entity_ids bigint[]
)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_input_type text := lower(btrim(coalesce(p_entity_type, '')));
    v_entity_type text;
    v_entity_id bigint;
    v_view_rel text;
    v_synced int := 0;
    v_removed int := 0;
    v_row_count int;
    v_legacy_types text[];
    v_alias_result jsonb;
begin
    if p_entity_ids is null or cardinality(p_entity_ids) = 0 then
        return jsonb_build_object(
            'entity_type', v_input_type,
            'synced', 0,
            'removed', 0,
            'entity_ids', '[]'::jsonb
        );
    end if;

    v_entity_type := case v_input_type
        when 'bus_stop' then 'transport_stop'
        when 'bus_route' then 'transport_route'
        when 'bus_route_variant' then 'transport_route_variant'
        else v_input_type
    end;

    v_view_rel := case v_entity_type
        when 'place' then 'search.v_search_places_source'
        when 'admin_area' then 'search.v_search_admin_areas_source'
        when 'transport_stop' then 'search.v_search_bus_stops_source'
        when 'transport_terminal' then 'search.v_search_transport_terminals_source'
        when 'transport_route' then 'search.v_search_bus_routes_source'
        when 'transport_route_variant' then 'search.v_search_bus_routes_source'
        when 'street_group' then 'search.v_search_street_groups_source'
        else null
    end;

    if v_view_rel is null then
        raise exception 'Unsupported search sync entity_type: %', p_entity_type
            using hint = 'Supported: place, admin_area, transport_stop, transport_terminal, transport_route, transport_route_variant, street_group (legacy bus_* aliases accepted)';
    end if;

    v_legacy_types := case v_entity_type
        when 'transport_stop' then array['transport_stop', 'bus_stop']
        when 'transport_route' then array['transport_route', 'bus_route']
        when 'transport_route_variant' then array['transport_route_variant', 'bus_route_variant']
        else array[v_entity_type]
    end;

    foreach v_entity_id in array p_entity_ids loop
        delete from search.search_documents
        where entity_id = v_entity_id
          and entity_type = any (v_legacy_types);

        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            v_removed := v_removed + v_row_count;
        end if;

        drop table if exists tmp_search_one;
        if v_entity_type in ('transport_route', 'transport_route_variant') then
            execute format(
                'create temp table tmp_search_one on commit drop as
                 select * from %I where entity_type = $1 and entity_id = $2',
                v_view_rel
            ) using v_entity_type, v_entity_id;
        else
            execute format(
                'create temp table tmp_search_one on commit drop as
                 select * from %I where entity_id = $1',
                v_view_rel
            ) using v_entity_id;
        end if;

        insert into search.search_documents (
            entity_type, entity_id, public_id, display_name, subtitle,
            primary_name_my, primary_name_en, primary_name_und, code, external_id,
            category_code, category_name_my, category_name_en,
            admin_area_id, admin_area_name_my, admin_area_name_en, admin_hierarchy,
            address_text, address_parts,
            geometry_type, centroid, bbox, has_geometry, supports_plus_code,
            searchable_text, trigram_text,
            importance_score, popularity_score, confidence_score, boundary_confidence_score,
            is_verified, is_public, is_active, source_updated_at, indexed_at
        )
        select
            t.entity_type, t.entity_id, t.public_id, t.display_name, t.subtitle,
            t.primary_name_my, t.primary_name_en, t.primary_name_und, t.code, t.external_id,
            t.category_code, t.category_name_my, t.category_name_en,
            t.admin_area_id, t.admin_area_name_my, t.admin_area_name_en,
            coalesce(t.admin_hierarchy, '{}'::jsonb),
            t.address_text, t.address_parts,
            t.geometry_type, t.centroid, t.bbox,
            coalesce(t.has_geometry, false), coalesce(t.supports_plus_code, false),
            t.searchable_text,
            nullif(lower(btrim(coalesce(t.searchable_text, ''))), ''),
            least(100, greatest(0, coalesce(t.importance_score, 0))),
            least(100, greatest(0, coalesce(t.popularity_score, 0))),
            least(100, greatest(0, coalesce(t.confidence_score, 0))),
            least(100, greatest(0, coalesce(t.boundary_confidence_score, 0))),
            coalesce(t.is_verified, false), coalesce(t.is_public, true),
            coalesce(t.is_active, true), t.source_updated_at, now()
        from tmp_search_one t;

        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            v_synced := v_synced + v_row_count;

            insert into search.search_document_names (
                search_document_id, language_code, script_code, name,
                normalized_name, name_type, is_primary, search_weight
            )
            select
                d.id,
                coalesce(nullif(btrim(n->>'language_code'), ''), 'und'),
                nullif(btrim(n->>'script_code'), ''),
                btrim(n->>'name'),
                nullif(lower(btrim(n->>'name')), ''),
                nullif(btrim(n->>'name_type'), ''),
                coalesce((n->>'is_primary')::boolean, false),
                least(100, greatest(0, coalesce((n->>'search_weight')::numeric, 0)))
            from tmp_search_one t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where btrim(coalesce(n->>'name', '')) <> '';

            v_alias_result := search.apply_search_aliases_for_documents(
                v_entity_type,
                array[v_entity_id]
            );
        end if;
    end loop;

    return jsonb_build_object(
        'entity_type', v_entity_type,
        'synced', v_synced,
        'removed', v_removed,
        'entity_ids', to_jsonb(p_entity_ids)
    );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- rebuild_search_documents: fold aliases after each view rebuild
-- ---------------------------------------------------------------------------
create or replace function search.rebuild_search_documents(p_views text[] default null)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_all_views   text[] := array[
        'places', 'admin_areas', 'street_groups', 'addresses', 'bus_stops',
        'bus_routes', 'transport_terminals', 'buildings', 'water_lines', 'water_polygons', 'landuse'
    ];
    v_views       text[];
    v_invalid     text[];
    v_view        text;
    v_view_rel    text;
    v_run_id      bigint;
    v_doc_count   bigint;
    v_name_count  bigint;
    v_alias_count bigint;
    v_view_results jsonb := '{}'::jsonb;
    v_failed      int := 0;
    v_err         text;
    v_counts      jsonb;
    v_status      text;
begin
    set local statement_timeout = 0;

    if p_views is null or array_length(p_views, 1) is null then
        v_views := v_all_views;
    else
        v_views := array(
            select distinct lower(btrim(x))
            from unnest(p_views) as x
            where btrim(coalesce(x, '')) <> ''
        );
        if array_length(v_views, 1) is null then
            v_views := v_all_views;
        else
            v_invalid := array(
                select x from unnest(v_views) as x where x <> all (v_all_views)
            );
            if array_length(v_invalid, 1) is not null then
                raise exception 'Unknown search source view(s): %', array_to_string(v_invalid, ', ')
                    using hint = 'Valid views: ' || array_to_string(v_all_views, ', ');
            end if;
        end if;
    end if;

    insert into search.search_index_runs (status, started_at)
    values ('running', now())
    returning id into v_run_id;

    foreach v_view in array v_views loop
        v_view_rel := format('search.v_search_%s_source', v_view);
        begin
            execute 'drop table if exists tmp_search_src';
            execute format(
                'create temp table tmp_search_src on commit drop as select * from %s',
                v_view_rel
            );

            delete from search.search_documents d
            where d.entity_type in (select distinct t.entity_type from tmp_search_src t);

            insert into search.search_documents (
                entity_type, entity_id, public_id, display_name, subtitle,
                primary_name_my, primary_name_en, primary_name_und, code, external_id,
                category_code, category_name_my, category_name_en,
                admin_area_id, admin_area_name_my, admin_area_name_en, admin_hierarchy,
                address_text, address_parts,
                geometry_type, centroid, bbox, has_geometry, supports_plus_code,
                searchable_text, trigram_text,
                importance_score, popularity_score, confidence_score, boundary_confidence_score,
                is_verified, is_public, is_active, source_updated_at, indexed_at
            )
            select
                t.entity_type, t.entity_id, t.public_id, t.display_name, t.subtitle,
                t.primary_name_my, t.primary_name_en, t.primary_name_und, t.code, t.external_id,
                t.category_code, t.category_name_my, t.category_name_en,
                t.admin_area_id, t.admin_area_name_my, t.admin_area_name_en,
                coalesce(t.admin_hierarchy, '{}'::jsonb),
                t.address_text, t.address_parts,
                t.geometry_type, t.centroid, t.bbox,
                coalesce(t.has_geometry, false), coalesce(t.supports_plus_code, false),
                t.searchable_text,
                nullif(lower(btrim(coalesce(t.searchable_text, ''))), ''),
                least(100, greatest(0, coalesce(t.importance_score, 0))),
                least(100, greatest(0, coalesce(t.popularity_score, 0))),
                least(100, greatest(0, coalesce(t.confidence_score, 0))),
                least(100, greatest(0, coalesce(t.boundary_confidence_score, 0))),
                coalesce(t.is_verified, false), coalesce(t.is_public, true),
                coalesce(t.is_active, true), t.source_updated_at, now()
            from tmp_search_src t;

            get diagnostics v_doc_count = row_count;

            insert into search.search_document_names (
                search_document_id, language_code, script_code, name,
                normalized_name, name_type, is_primary, search_weight
            )
            select
                d.id,
                coalesce(nullif(btrim(n->>'language_code'), ''), 'und'),
                nullif(btrim(n->>'script_code'), ''),
                btrim(n->>'name'),
                nullif(lower(btrim(n->>'name')), ''),
                nullif(btrim(n->>'name_type'), ''),
                coalesce((n->>'is_primary')::boolean, false),
                least(100, greatest(0, coalesce((n->>'search_weight')::numeric, 0)))
            from tmp_search_src t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where btrim(coalesce(n->>'name', '')) <> '';

            get diagnostics v_name_count = row_count;

            select coalesce((search.apply_search_aliases_for_documents(
                null,
                (select array_agg(distinct t.entity_id) from tmp_search_src t)
            )->>'names_added')::bigint, 0)
            into v_alias_count;

            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object(
                    'documents', v_doc_count,
                    'names', v_name_count,
                    'aliases_folded', v_alias_count
                )
            );
        exception when others then
            v_failed := v_failed + 1;
            v_err := SQLERRM;
            v_view_results := v_view_results || jsonb_build_object(
                v_view, jsonb_build_object('error', v_err)
            );
        end;
    end loop;

    select coalesce(jsonb_object_agg(entity_type, cnt), '{}'::jsonb)
    into v_counts
    from (
        select entity_type, count(*)::bigint as cnt
        from search.search_documents
        group by entity_type
    ) s;

    v_status := case when v_failed > 0 then 'failed' else 'completed' end;

    update search.search_index_runs
    set status = v_status,
        finished_at = now(),
        entity_counts = v_counts,
        error_message = case when v_failed > 0 then format('%s view(s) failed', v_failed) else null end
    where id = v_run_id;

    return jsonb_build_object(
        'run_id', v_run_id,
        'status', v_status,
        'requested_views', to_jsonb(v_views),
        'view_results', v_view_results,
        'entity_counts', v_counts
    );
end;
$fn$;

commit;
