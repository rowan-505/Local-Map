-- =============================================================================
-- Supabase migration 128: incremental unified search document sync
-- =============================================================================
--
-- Row-level upsert/remove for search.search_documents using the same source
-- views as search.rebuild_search_documents(). Does not rebuild whole families.
-- =============================================================================

begin;

create or replace function search.sync_search_documents(
    p_entity_type text,
    p_entity_ids bigint[]
)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_entity_type text := lower(btrim(coalesce(p_entity_type, '')));
    v_entity_id bigint;
    v_view_rel text;
    v_synced int := 0;
    v_removed int := 0;
    v_row_count int;
begin
    if p_entity_ids is null or cardinality(p_entity_ids) = 0 then
        return jsonb_build_object(
            'entity_type', v_entity_type,
            'synced', 0,
            'removed', 0,
            'entity_ids', '[]'::jsonb
        );
    end if;

    v_view_rel := case v_entity_type
        when 'place' then 'search.v_search_places_source'
        when 'admin_area' then 'search.v_search_admin_areas_source'
        when 'bus_stop' then 'search.v_search_bus_stops_source'
        when 'bus_route' then 'search.v_search_bus_routes_source'
        when 'bus_route_variant' then 'search.v_search_bus_routes_source'
        when 'street_group' then 'search.v_search_street_groups_source'
        else null
    end;

    if v_view_rel is null then
        raise exception 'Unsupported search sync entity_type: %', p_entity_type
            using hint = 'Supported: place, admin_area, bus_stop, bus_route, bus_route_variant, street_group';
    end if;

    foreach v_entity_id in array p_entity_ids loop
        delete from search.search_documents
        where entity_type = v_entity_type
          and entity_id = v_entity_id;

        get diagnostics v_row_count = row_count;
        if v_row_count > 0 then
            v_removed := v_removed + v_row_count;
        end if;

        drop table if exists tmp_search_one;
        if v_entity_type in ('bus_route', 'bus_route_variant') then
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
                coalesce((n->>'search_weight')::numeric, 0)
            from tmp_search_one t
            join search.search_documents d
                on d.entity_type = t.entity_type and d.entity_id = t.entity_id
            cross join lateral jsonb_array_elements(coalesce(t.names, '[]'::jsonb)) as n
            where coalesce(btrim(n->>'name'), '') <> '';
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

comment on function search.sync_search_documents(text, bigint[]) is
    'Upsert or remove unified search documents for specific entity ids using search.v_search_*_source views. Removes rows that are no longer searchable.';

-- Resolve grouped street search docs from any member segment id.
create or replace function search.sync_street_group_for_street(p_street_id bigint)
returns jsonb
language plpgsql
set search_path = public, search, core, ref, transport
as $fn$
declare
    v_rep_ids bigint[];
begin
    if p_street_id is null then
        return jsonb_build_object('synced', 0, 'removed', 0, 'entity_ids', '[]'::jsonb);
    end if;

    with street as (
        select s.id, s.canonical_name, s.admin_area_id, s.road_class
        from core.core_streets s
        where s.id = p_street_id
    ),
    group_rep as (
        select min(s.id) as rep_id
        from core.core_streets s
        cross join street r
        where s.is_active = true
          and s.deleted_at is null
          and s.geom is not null
          and not st_isempty(s.geom)
          and s.canonical_name !~ '^road-[0-9]+$'
          and s.canonical_name !~* '^unnamed'
          and search.norm_street_name(s.canonical_name) = search.norm_street_name(r.canonical_name)
          and s.admin_area_id is not distinct from r.admin_area_id
          and s.road_class is not distinct from r.road_class
    )
    select coalesce(array_agg(distinct x.rep_id), '{}'::bigint[])
    into v_rep_ids
    from (
        select p_street_id as rep_id
        union all
        select rep_id from group_rep where rep_id is not null
    ) x;

    return search.sync_search_documents('street_group', v_rep_ids);
end;
$fn$;

comment on function search.sync_street_group_for_street(bigint) is
    'Refresh grouped street search documents affected by a core.core_streets segment change.';

commit;
