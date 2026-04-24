begin;

insert into ref.ref_source_types (code, name)
values ('osm', 'OpenStreetMap')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_publish_statuses (code, name)
values
    ('approved', 'Approved'),
    ('published', 'Published')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_admin_levels (code, name, rank)
values ('township', 'Township', 40)
on conflict (code) do update
set name = excluded.name,
    rank = excluded.rank;

insert into ref.ref_place_classes (code, name)
values ('poi', 'Point Of Interest')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_poi_categories (parent_id, code, name, sort_order, is_searchable, is_public)
values (null, 'food', 'Food', 10, true, true)
on conflict (code) do update
set parent_id = excluded.parent_id,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

insert into ref.ref_poi_categories (parent_id, code, name, sort_order, is_searchable, is_public)
select
    parent.id,
    'restaurant',
    'Restaurant',
    11,
    true,
    true
from ref.ref_poi_categories as parent
where parent.code = 'food'
on conflict (code) do update
set parent_id = excluded.parent_id,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

insert into ref.ref_road_classes (code, name)
values ('residential', 'Residential')
on conflict (code) do update
set name = excluded.name;

insert into system.system_source_registry (
    source_code,
    source_name,
    source_uri,
    source_type_id,
    is_active,
    config
)
values (
    'osm_myanmar_core_demo',
    'OpenStreetMap Myanmar Core Promotion Demo',
    'https://download.geofabrik.de/asia/myanmar-latest.osm.pbf',
    (
        select id
        from ref.ref_source_types
        where code = 'osm'
    ),
    true,
    jsonb_build_object(
        'country_code', 'MM',
        'workflow', 'core_promotion_demo',
        'provider', 'Geofabrik'
    )
)
on conflict (source_code) do update
set source_name = excluded.source_name,
    source_uri = excluded.source_uri,
    source_type_id = excluded.source_type_id,
    is_active = excluded.is_active,
    config = excluded.config,
    updated_at = now();

insert into system.system_import_batches (
    source_registry_id,
    batch_name,
    trigger_type,
    status,
    started_at,
    finished_at,
    note
)
values (
    (
        select id
        from system.system_source_registry
        where source_code = 'osm_myanmar_core_demo'
    ),
    'osm_myanmar_core_demo_import_2026_04_15',
    'manual',
    'completed',
    timestamptz '2026-04-15 13:00:00+06:30',
    timestamptz '2026-04-15 13:20:00+06:30',
    'Example import batch used for staging-to-core promotion workflow.'
);

insert into system.system_source_snapshots (
    source_registry_id,
    import_batch_id,
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum,
    captured_at
)
values (
    (
        select id
        from system.system_source_registry
        where source_code = 'osm_myanmar_core_demo'
    ),
    (
        select id
        from system.system_import_batches
        where batch_name = 'osm_myanmar_core_demo_import_2026_04_15'
        order by id desc
        limit 1
    ),
    'osm_myanmar_core_demo_snapshot_2026_04_15_a',
    '2026-04-15',
    'MM-YGN',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    timestamptz '2026-04-15 13:05:00+06:30'
)
on conflict (source_registry_id, snapshot_ref) do update
set import_batch_id = excluded.import_batch_id,
    snapshot_version = excluded.snapshot_version,
    region_code = excluded.region_code,
    checksum = excluded.checksum,
    captured_at = excluded.captured_at;

do $$
declare
    v_snapshot_id bigint;
    v_source_type_id bigint;
    v_admin_area_candidate_id bigint;
    v_place_candidate_id bigint;
    v_road_candidate_id bigint;
    v_bus_stop_candidate_id bigint;
    v_bus_route_candidate_id bigint;
    v_core_admin_area_id bigint;
    v_core_place_id bigint;
    v_core_street_id bigint;
    v_core_bus_stop_id bigint;
    v_core_bus_route_id bigint;
    v_place_version_id bigint;
    v_publish_batch_id bigint;
begin
    select s.id
    into v_snapshot_id
    from system.system_source_snapshots as s
    join system.system_source_registry as r
        on r.id = s.source_registry_id
    where r.source_code = 'osm_myanmar_core_demo'
      and s.snapshot_ref = 'osm_myanmar_core_demo_snapshot_2026_04_15_a';

    if v_snapshot_id is null then
        raise exception 'demo source snapshot not found';
    end if;

    select source_type_id
    into v_source_type_id
    from system.system_source_registry
    where source_code = 'osm_myanmar_core_demo';

    insert into staging.staging_admin_area_candidates (
        source_snapshot_id,
        external_id,
        canonical_name,
        admin_level_id,
        parent_candidate_id,
        geom,
        centroid,
        confidence_score,
        match_status,
        matched_core_admin_area_id,
        normalized_data,
        source_refs
    )
    values (
        v_snapshot_id,
        'demo_admin_rel_1001',
        'Example Township',
        (
            select id
            from ref.ref_admin_levels
            where code = 'township'
        ),
        null,
        ST_Multi(
            ST_GeomFromText(
                'POLYGON((96.1550 16.8200, 96.1900 16.8200, 96.1900 16.8500, 96.1550 16.8500, 96.1550 16.8200))',
                4326
            )
        ),
        ST_SetSRID(ST_MakePoint(96.1725, 16.8350), 4326),
        0.9900,
        'approved',
        (
            select ca.id
            from core.core_admin_areas as ca
            where ca.slug = core.make_slug('Example Township')
            limit 1
        ),
        jsonb_build_object(
            'admin_level_code', 'township',
            'name', 'Example Township'
        ),
        jsonb_build_object(
            'source_snapshot_id', v_snapshot_id,
            'source_table', 'raw.raw_osm_polygons',
            'osm_feature_type', 'relation',
            'osm_id', '900001001'
        )
    )
    returning id into v_admin_area_candidate_id;

    v_core_admin_area_id := core.promote_admin_area_candidate(v_admin_area_candidate_id);

    insert into staging.staging_place_candidates (
        source_snapshot_id,
        source_entity_type,
        external_id,
        canonical_name,
        place_class_id,
        poi_category_id,
        admin_area_candidate_id,
        point_geom,
        confidence_score,
        match_status,
        matched_core_place_id,
        normalized_data,
        source_refs
    )
    values (
        v_snapshot_id,
        'osm_node',
        'demo_place_node_2001',
        'Example Tea House',
        (
            select id
            from ref.ref_place_classes
            where code = 'poi'
        ),
        (
            select id
            from ref.ref_poi_categories
            where code = 'restaurant'
        ),
        v_admin_area_candidate_id,
        ST_SetSRID(ST_MakePoint(96.1736, 16.8394), 4326),
        0.9500,
        'approved',
        (
            select cps.place_id
            from core.core_place_sources as cps
            where cps.external_id = 'demo_place_node_2001'
              and cps.source_type_id = v_source_type_id
            order by cps.id desc
            limit 1
        ),
        jsonb_build_object(
            'amenity', 'restaurant',
            'display_name', 'Example Tea House',
            'lat', 16.8394,
            'lng', 96.1736
        ),
        jsonb_build_object(
            'source_snapshot_id', v_snapshot_id,
            'source_table', 'raw.raw_osm_points',
            'osm_feature_type', 'node',
            'osm_id', '900002001'
        )
    )
    returning id into v_place_candidate_id;

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
    values
        (
            v_snapshot_id,
            v_place_candidate_id,
            'Example Tea House',
            'en',
            'Latn',
            'primary',
            true,
            1.000
        ),
        (
            v_snapshot_id,
            v_place_candidate_id,
            'ဥပမာ လက်ဖက်ရည်ဆိုင်',
            'my',
            'Mymr',
            'local',
            false,
            0.800
        );

    v_core_place_id := core.promote_place_candidate(v_place_candidate_id);

    select current_version_id
    into v_place_version_id
    from core.core_places
    where id = v_core_place_id;

    insert into staging.staging_road_candidates (
        source_snapshot_id,
        external_id,
        canonical_name,
        road_class_id,
        geom,
        is_oneway,
        length_m,
        confidence_score,
        match_status,
        matched_core_edge_id,
        normalized_data,
        source_refs
    )
    values (
        v_snapshot_id,
        'demo_way_3001',
        'Example Road',
        (
            select id
            from ref.ref_road_classes
            where code = 'residential'
        ),
        ST_GeomFromText('LINESTRING(96.1700 16.8380, 96.1720 16.8390, 96.1750 16.8400)', 4326),
        false,
        540.0,
        0.9100,
        'approved',
        (
            select cs.id
            from core.core_streets as cs
            where cs.canonical_name = 'Example Road'
              and cs.source_type_id = v_source_type_id
            order by cs.id desc
            limit 1
        ),
        jsonb_build_object(
            'highway', 'residential',
            'name', 'Example Road'
        ),
        jsonb_build_object(
            'source_snapshot_id', v_snapshot_id,
            'source_table', 'raw.raw_osm_lines',
            'osm_feature_type', 'way',
            'osm_id', '900003001'
        )
    )
    returning id into v_road_candidate_id;

    v_core_street_id := core.promote_road_candidate(v_road_candidate_id);

    insert into staging.staging_bus_stop_candidates (
        source_snapshot_id,
        external_id,
        canonical_name,
        point_geom,
        admin_area_candidate_id,
        confidence_score,
        match_status,
        matched_core_bus_stop_id,
        normalized_data,
        source_refs
    )
    values (
        v_snapshot_id,
        'demo_stop_node_4001',
        'Example Bus Stop',
        ST_SetSRID(ST_MakePoint(96.1718, 16.8388), 4326),
        v_admin_area_candidate_id,
        0.9200,
        'approved',
        (
            select cbs.id
            from core.core_bus_stops as cbs
            where cbs.name = 'Example Bus Stop'
              and cbs.source_type_id = v_source_type_id
            order by cbs.id desc
            limit 1
        ),
        jsonb_build_object(
            'highway', 'bus_stop',
            'public_transport', 'platform'
        ),
        jsonb_build_object(
            'source_snapshot_id', v_snapshot_id,
            'source_table', 'raw.raw_osm_points',
            'osm_feature_type', 'node',
            'osm_id', '900004001'
        )
    )
    returning id into v_bus_stop_candidate_id;

    v_core_bus_stop_id := core.promote_bus_stop_candidate(v_bus_stop_candidate_id);

    insert into staging.staging_bus_route_candidates (
        source_snapshot_id,
        external_id,
        route_code,
        public_name,
        geom,
        confidence_score,
        match_status,
        matched_core_bus_route_id,
        normalized_data,
        source_refs
    )
    values (
        v_snapshot_id,
        'demo_route_rel_5001',
        'YBS-DEMO-1',
        'YBS Demo Loop',
        ST_GeomFromText('LINESTRING(96.1660 16.8360, 96.1700 16.8380, 96.1740 16.8400, 96.1780 16.8420)', 4326),
        0.9000,
        'approved',
        (
            select cbr.id
            from core.core_bus_routes as cbr
            where cbr.route_code = 'YBS-DEMO-1'
            limit 1
        ),
        jsonb_build_object(
            'route', 'bus',
            'network', 'YBS',
            'operator_name', 'Demo Transit'
        ),
        jsonb_build_object(
            'source_snapshot_id', v_snapshot_id,
            'source_table', 'raw.raw_osm_lines',
            'osm_feature_type', 'way',
            'osm_id', '900005001'
        )
    )
    returning id into v_bus_route_candidate_id;

    v_core_bus_route_id := core.promote_bus_route_candidate(v_bus_route_candidate_id);

    insert into system.system_publish_batches (
        batch_name,
        created_by,
        approved_by,
        status,
        created_at,
        published_at,
        note
    )
    values (
        'core_demo_publish_batch_2026_04_15',
        null,
        null,
        'approved',
        now(),
        null,
        'Example publish batch for staging-to-core promotion workflow.'
    )
    returning id into v_publish_batch_id;

    insert into system.system_publish_items (
        publish_batch_id,
        entity_family,
        entity_id,
        version_id,
        publish_action,
        publish_status
    )
    values
        (v_publish_batch_id, 'core_admin_areas', v_core_admin_area_id, null, 'upsert', 'approved'),
        (v_publish_batch_id, 'core_places', v_core_place_id, v_place_version_id, 'upsert', 'approved'),
        (v_publish_batch_id, 'core_streets', v_core_street_id, null, 'upsert', 'approved'),
        (v_publish_batch_id, 'core_bus_stops', v_core_bus_stop_id, null, 'upsert', 'approved'),
        (v_publish_batch_id, 'core_bus_routes', v_core_bus_route_id, null, 'upsert', 'approved');

    insert into system.system_review_logs (
        entity_family,
        entity_id,
        reviewer_user_id,
        action_type,
        before_snapshot,
        after_snapshot,
        reason,
        created_at
    )
    values (
        'core_places',
        v_core_place_id,
        null,
        'promote_from_staging',
        null,
        jsonb_build_object(
            'staging_place_candidate_id', v_place_candidate_id,
            'core_place_id', v_core_place_id,
            'core_place_version_id', v_place_version_id,
            'source_snapshot_id', v_snapshot_id,
            'publish_batch_id', v_publish_batch_id
        ),
        'Approved staging place candidate promoted into product-ready core data.',
        now()
    );
end;
$$;

commit;
