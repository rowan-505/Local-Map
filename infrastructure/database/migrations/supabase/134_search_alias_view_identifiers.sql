-- =============================================================================
-- Supabase migration 134: fix dynamic SQL view identifiers for search aliases
-- -----------------------------------------------------------------------------
-- Migration 131 used format(%I, 'search.v_search_*_source'), which quotes the
-- full string as one identifier ("search.v_search_*_source") and breaks rebuild,
-- sync, and alias folding. Use search.%I with unqualified view names instead.
-- =============================================================================

begin;

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
    v_view_name text;
    v_text text;
begin
    if p_entity_id is null then
        return null;
    end if;

    v_view_name := case v_entity_type
        when 'place' then 'v_search_places_source'
        when 'admin_area' then 'v_search_admin_areas_source'
        when 'street_group' then 'v_search_street_groups_source'
        when 'street' then 'v_search_streets_source'
        when 'address' then 'v_search_addresses_source'
        when 'transport_stop' then 'v_search_bus_stops_source'
        when 'bus_stop' then 'v_search_bus_stops_source'
        when 'transport_terminal' then 'v_search_transport_terminals_source'
        when 'transport_route' then 'v_search_bus_routes_source'
        when 'transport_route_variant' then 'v_search_bus_routes_source'
        when 'bus_route' then 'v_search_bus_routes_source'
        when 'bus_route_variant' then 'v_search_bus_routes_source'
        when 'building' then 'v_search_buildings_source'
        when 'water_line' then 'v_search_water_lines_source'
        when 'water_polygon' then 'v_search_water_polygons_source'
        when 'landuse' then 'v_search_landuse_source'
        else null
    end;

    if v_view_name is null then
        return null;
    end if;

    if v_entity_type in (
        'transport_route',
        'transport_route_variant',
        'bus_route',
        'bus_route_variant'
    ) then
        execute format(
            'select searchable_text from search.%I where entity_type = $1 and entity_id = $2 limit 1',
            v_view_name
        )
        into v_text
        using v_entity_type, p_entity_id;
    else
        execute format(
            'select searchable_text from search.%I where entity_id = $1 limit 1',
            v_view_name
        )
        into v_text
        using p_entity_id;
    end if;

    return v_text;
end;
$fn$;

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
    v_view_name text;
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

    v_view_name := case v_entity_type
        when 'place' then 'v_search_places_source'
        when 'admin_area' then 'v_search_admin_areas_source'
        when 'transport_stop' then 'v_search_bus_stops_source'
        when 'transport_terminal' then 'v_search_transport_terminals_source'
        when 'transport_route' then 'v_search_bus_routes_source'
        when 'transport_route_variant' then 'v_search_bus_routes_source'
        when 'street_group' then 'v_search_street_groups_source'
        else null
    end;

    if v_view_name is null then
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
                 select * from search.%I where entity_type = $1 and entity_id = $2',
                v_view_name
            ) using v_entity_type, v_entity_id;
        else
            execute format(
                'create temp table tmp_search_one on commit drop as
                 select * from search.%I where entity_id = $1',
                v_view_name
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
        end if;

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

        if exists (
            select 1
            from search.search_aliases a
            where a.is_active
              and a.entity_type = v_entity_type
              and a.entity_id = v_entity_id
        ) then
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

commit;
