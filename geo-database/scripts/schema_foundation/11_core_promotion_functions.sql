create or replace function core.is_promotable_match_status(p_match_status text)
returns boolean
language sql
immutable
as $$
    select coalesce(lower(btrim(p_match_status)), '') in (
        'approved',
        'publishable',
        'ready_to_publish',
        'published'
    );
$$;

create or replace function core.get_source_type_id_from_snapshot(p_source_snapshot_id bigint)
returns bigint
language sql
stable
as $$
    select r.source_type_id
    from system.system_source_snapshots as s
    join system.system_source_registry as r
        on r.id = s.source_registry_id
    where s.id = p_source_snapshot_id;
$$;

create or replace function core.get_source_registry_from_snapshot(p_source_snapshot_id bigint)
returns system.system_source_registry
language sql
stable
as $$
    select r.*
    from system.system_source_snapshots as s
    join system.system_source_registry as r
        on r.id = s.source_registry_id
    where s.id = p_source_snapshot_id;
$$;

create or replace function core.get_source_snapshot_row(p_source_snapshot_id bigint)
returns system.system_source_snapshots
language sql
stable
as $$
    select s.*
    from system.system_source_snapshots as s
    where s.id = p_source_snapshot_id;
$$;

create or replace function core.get_initial_publish_status_id()
returns bigint
language sql
stable
as $$
    select p.id
    from ref.ref_publish_statuses as p
    where p.code in ('approved', 'published')
    order by case p.code
        when 'approved' then 1
        when 'published' then 2
        else 99
    end
    limit 1;
$$;

create or replace function core.make_slug(p_value text)
returns text
language sql
immutable
as $$
    select trim(both '-' from regexp_replace(lower(btrim(p_value)), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function core.promote_admin_area_candidate(p_candidate_id bigint)
returns bigint
language plpgsql
as $$
declare
    v_candidate staging.staging_admin_area_candidates%rowtype;
    v_core_id bigint;
    v_parent_core_id bigint;
    v_source_type_id bigint;
    v_slug text;
begin
    select *
    into v_candidate
    from staging.staging_admin_area_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging admin area candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging admin area candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    if v_candidate.parent_candidate_id is not null then
        select matched_core_admin_area_id
        into v_parent_core_id
        from staging.staging_admin_area_candidates
        where id = v_candidate.parent_candidate_id;
    else
        v_parent_core_id := null;
    end if;

    v_slug := core.make_slug(v_candidate.canonical_name);

    if v_candidate.matched_core_admin_area_id is not null then
        v_core_id := v_candidate.matched_core_admin_area_id;

        update core.core_admin_areas
        set parent_id = v_parent_core_id,
            admin_level_id = v_candidate.admin_level_id,
            canonical_name = v_candidate.canonical_name,
            slug = v_slug,
            geom = v_candidate.geom,
            centroid = coalesce(v_candidate.centroid, st_centroid(v_candidate.geom)),
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_admin_areas (
            parent_id,
            admin_level_id,
            canonical_name,
            slug,
            geom,
            centroid,
            source_type_id,
            is_active
        )
        values (
            v_parent_core_id,
            v_candidate.admin_level_id,
            v_candidate.canonical_name,
            v_slug,
            v_candidate.geom,
            coalesce(v_candidate.centroid, st_centroid(v_candidate.geom)),
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_admin_area_names (
        admin_area_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary,
        search_weight
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true,
        100
    where not exists (
        select 1
        from core.core_admin_area_names as n
        where n.admin_area_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_admin_area_candidates
    set matched_core_admin_area_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;

create or replace function core.promote_place_candidate(p_candidate_id bigint)
returns bigint
language plpgsql
as $$
declare
    v_candidate staging.staging_place_candidates%rowtype;
    v_source_registry system.system_source_registry%rowtype;
    v_source_snapshot system.system_source_snapshots%rowtype;
    v_core_id bigint;
    v_admin_area_id bigint;
    v_publish_status_id bigint;
    v_lat double precision;
    v_lng double precision;
    v_name_local text;
    v_version_no integer;
    v_version_id bigint;
    v_version_snapshot jsonb;
begin
    select *
    into v_candidate
    from staging.staging_place_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging place candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging place candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    select *
    into v_source_registry
    from core.get_source_registry_from_snapshot(v_candidate.source_snapshot_id);

    if v_source_registry.id is null then
        raise exception 'no source registry found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    select *
    into v_source_snapshot
    from core.get_source_snapshot_row(v_candidate.source_snapshot_id);

    v_publish_status_id := core.get_initial_publish_status_id();
    if v_publish_status_id is null then
        raise exception 'no initial publish status found in ref.ref_publish_statuses';
    end if;

    select a.matched_core_admin_area_id
    into v_admin_area_id
    from staging.staging_admin_area_candidates as a
    where a.id = v_candidate.admin_area_candidate_id;

    v_lat := st_y(v_candidate.point_geom);
    v_lng := st_x(v_candidate.point_geom);

    select pn.name
    into v_name_local
    from staging.staging_place_name_candidates as pn
    where pn.place_candidate_id = v_candidate.id
      and coalesce(pn.script_code, '') <> ''
      and lower(coalesce(pn.script_code, '')) <> 'latn'
    order by pn.is_primary desc, pn.id
    limit 1;

    if v_candidate.matched_core_place_id is not null then
        v_core_id := v_candidate.matched_core_place_id;

        update core.core_places
        set primary_name = v_candidate.canonical_name,
            name_local = coalesce(v_name_local, name_local),
            display_name = v_candidate.canonical_name,
            category_id = v_candidate.poi_category_id,
            admin_area_id = v_admin_area_id,
            point_geom = v_candidate.point_geom,
            lat = v_lat,
            lng = v_lng,
            confidence_score = coalesce(v_candidate.confidence_score, confidence_score),
            source_type_id = v_source_registry.source_type_id,
            publish_status_id = v_publish_status_id,
            is_public = true,
            is_verified = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_places (
            primary_name,
            name_local,
            display_name,
            category_id,
            admin_area_id,
            point_geom,
            lat,
            lng,
            confidence_score,
            is_public,
            is_verified,
            source_type_id,
            publish_status_id
        )
        values (
            v_candidate.canonical_name,
            v_name_local,
            v_candidate.canonical_name,
            v_candidate.poi_category_id,
            v_admin_area_id,
            v_candidate.point_geom,
            v_lat,
            v_lng,
            coalesce(v_candidate.confidence_score, 0),
            true,
            true,
            v_source_registry.source_type_id,
            v_publish_status_id
        )
        returning id into v_core_id;
    end if;

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
        v_core_id,
        pn.name,
        pn.language_code,
        pn.script_code,
        pn.name_type,
        pn.is_primary,
        coalesce(round(pn.search_weight)::integer, 0)
    from staging.staging_place_name_candidates as pn
    where pn.place_candidate_id = v_candidate.id
      and not exists (
          select 1
          from core.core_place_names as cpn
          where cpn.place_id = v_core_id
            and cpn.name = pn.name
            and coalesce(cpn.language_code, '') = coalesce(pn.language_code, '')
            and coalesce(cpn.script_code, '') = coalesce(pn.script_code, '')
            and cpn.name_type = pn.name_type
      );

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
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true,
        100
    where not exists (
        select 1
        from core.core_place_names as cpn
        where cpn.place_id = v_core_id
          and cpn.name = v_candidate.canonical_name
          and cpn.name_type = 'primary'
    );

    insert into core.core_place_sources (
        place_id,
        source_type_id,
        external_id,
        source_name,
        source_url,
        source_priority,
        captured_at,
        raw_payload
    )
    select
        v_core_id,
        v_source_registry.source_type_id,
        v_candidate.external_id,
        v_source_registry.source_name,
        v_source_registry.source_uri,
        0,
        v_source_snapshot.captured_at,
        jsonb_build_object(
            'staging_place_candidate_id', v_candidate.id,
            'source_snapshot_id', v_candidate.source_snapshot_id,
            'source_entity_type', v_candidate.source_entity_type,
            'normalized_data', v_candidate.normalized_data,
            'source_refs', v_candidate.source_refs
        )
    where not exists (
        select 1
        from core.core_place_sources as cps
        where cps.place_id = v_core_id
          and cps.source_type_id = v_source_registry.source_type_id
          and coalesce(cps.external_id, '') = coalesce(v_candidate.external_id, '')
          and cps.source_name = v_source_registry.source_name
    );

    select coalesce(max(version_no), 0) + 1
    into v_version_no
    from core.core_place_versions
    where place_id = v_core_id;

    select jsonb_build_object(
        'place_id', p.id,
        'public_id', p.public_id,
        'primary_name', p.primary_name,
        'secondary_name', p.secondary_name,
        'name_local', p.name_local,
        'display_name', p.display_name,
        'category_id', p.category_id,
        'admin_area_id', p.admin_area_id,
        'lat', p.lat,
        'lng', p.lng,
        'plus_code', p.plus_code,
        'importance_score', p.importance_score,
        'popularity_score', p.popularity_score,
        'confidence_score', p.confidence_score,
        'is_public', p.is_public,
        'is_verified', p.is_verified,
        'source_type_id', p.source_type_id,
        'publish_status_id', p.publish_status_id,
        'point_geom_wkt', st_astext(p.point_geom),
        'entry_geom_wkt', case when p.entry_geom is null then null else st_astext(p.entry_geom) end,
        'footprint_geom_wkt', case when p.footprint_geom is null then null else st_astext(p.footprint_geom) end,
        'staging_place_candidate_id', v_candidate.id,
        'source_snapshot_id', v_candidate.source_snapshot_id
    )
    into v_version_snapshot
    from core.core_places as p
    where p.id = v_core_id;

    insert into core.core_place_versions (
        place_id,
        version_no,
        snapshot_data,
        publish_status_id,
        created_by,
        created_at,
        published_at,
        approved_by
    )
    values (
        v_core_id,
        v_version_no,
        v_version_snapshot,
        v_publish_status_id,
        null,
        now(),
        null,
        null
    )
    returning id into v_version_id;

    update core.core_places
    set current_version_id = v_version_id,
        updated_at = now()
    where id = v_core_id;

    update staging.staging_place_candidates
    set matched_core_place_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;

create or replace function core.promote_road_candidate(p_candidate_id bigint)
returns bigint
language plpgsql
as $$
declare
    v_candidate staging.staging_road_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
begin
    select *
    into v_candidate
    from staging.staging_road_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging road candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging road candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    v_core_id := v_candidate.matched_core_edge_id;

    if v_core_id is not null then
        update core.core_streets
        set canonical_name = v_candidate.canonical_name,
            geom = v_candidate.geom,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_streets (
            canonical_name,
            geom,
            source_type_id,
            is_active
        )
        values (
            v_candidate.canonical_name,
            v_candidate.geom,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_street_names (
        street_id,
        name,
        language_code,
        script_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_street_names as n
        where n.street_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_road_candidates
    set matched_core_edge_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;

create or replace function core.promote_bus_stop_candidate(p_candidate_id bigint)
returns bigint
language plpgsql
as $$
declare
    v_candidate staging.staging_bus_stop_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
    v_admin_area_id bigint;
begin
    select *
    into v_candidate
    from staging.staging_bus_stop_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging bus stop candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging bus stop candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    select a.matched_core_admin_area_id
    into v_admin_area_id
    from staging.staging_admin_area_candidates as a
    where a.id = v_candidate.admin_area_candidate_id;

    v_core_id := v_candidate.matched_core_bus_stop_id;

    if v_core_id is not null then
        update core.core_bus_stops
        set name = v_candidate.canonical_name,
            geom = v_candidate.point_geom,
            admin_area_id = v_admin_area_id,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_bus_stops (
            name,
            geom,
            admin_area_id,
            source_type_id,
            is_active
        )
        values (
            v_candidate.canonical_name,
            v_candidate.point_geom,
            v_admin_area_id,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    insert into core.core_bus_stop_names (
        stop_id,
        name,
        language_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.canonical_name,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_bus_stop_names as n
        where n.stop_id = v_core_id
          and n.name = v_candidate.canonical_name
          and n.name_type = 'primary'
    );

    update staging.staging_bus_stop_candidates
    set matched_core_bus_stop_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;

create or replace function core.promote_bus_route_candidate(p_candidate_id bigint)
returns bigint
language plpgsql
as $$
declare
    v_candidate staging.staging_bus_route_candidates%rowtype;
    v_source_type_id bigint;
    v_core_id bigint;
    v_variant_id bigint;
    v_variant_code text;
begin
    select *
    into v_candidate
    from staging.staging_bus_route_candidates
    where id = p_candidate_id;

    if not found then
        raise exception 'staging bus route candidate % not found', p_candidate_id;
    end if;

    if not core.is_promotable_match_status(v_candidate.match_status) then
        raise exception 'staging bus route candidate % is not approved for promotion: %', p_candidate_id, v_candidate.match_status;
    end if;

    v_source_type_id := core.get_source_type_id_from_snapshot(v_candidate.source_snapshot_id);
    if v_source_type_id is null then
        raise exception 'no source_type_id found for source_snapshot_id %', v_candidate.source_snapshot_id;
    end if;

    v_core_id := v_candidate.matched_core_bus_route_id;
    v_variant_code := coalesce(nullif(v_candidate.external_id, ''), v_candidate.route_code || '_v1');

    if v_core_id is not null then
        update core.core_bus_routes
        set route_code = v_candidate.route_code,
            public_name = v_candidate.public_name,
            source_type_id = v_source_type_id,
            is_active = true,
            updated_at = now()
        where id = v_core_id;
    else
        insert into core.core_bus_routes (
            route_code,
            public_name,
            source_type_id,
            is_active
        )
        values (
            v_candidate.route_code,
            v_candidate.public_name,
            v_source_type_id,
            true
        )
        returning id into v_core_id;
    end if;

    select id
    into v_variant_id
    from core.core_bus_route_variants
    where route_id = v_core_id
      and variant_code = v_variant_code
    order by id desc
    limit 1;

    if v_variant_id is not null then
        update core.core_bus_route_variants
        set geom = v_candidate.geom,
            is_active = true
        where id = v_variant_id;
    else
        insert into core.core_bus_route_variants (
            route_id,
            variant_code,
            geom,
            distance_m,
            is_active
        )
        values (
            v_core_id,
            v_variant_code,
            v_candidate.geom,
            st_length(v_candidate.geom::geography),
            true
        )
        returning id into v_variant_id;
    end if;

    insert into core.core_bus_route_names (
        route_id,
        name,
        language_code,
        name_type,
        is_primary
    )
    select
        v_core_id,
        v_candidate.public_name,
        null,
        'primary',
        true
    where not exists (
        select 1
        from core.core_bus_route_names as n
        where n.route_id = v_core_id
          and n.name = v_candidate.public_name
          and n.name_type = 'primary'
    );

    update staging.staging_bus_route_candidates
    set matched_core_bus_route_id = v_core_id,
        updated_at = now()
    where id = p_candidate_id;

    return v_core_id;
end;
$$;
