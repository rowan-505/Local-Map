begin;

insert into ref.ref_source_types (code, name)
values ('osm', 'OpenStreetMap')
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
    'osm_myanmar_main',
    'OpenStreetMap Myanmar Extract',
    'https://download.geofabrik.de/asia/myanmar-latest.osm.pbf',
    (
        select id
        from ref.ref_source_types
        where code = 'osm'
    ),
    true,
    jsonb_build_object(
        'country_code', 'MM',
        'provider', 'Geofabrik',
        'format', 'osm_pbf',
        'coverage', 'Myanmar'
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
        where source_code = 'osm_myanmar_main'
    ),
    'osm_myanmar_first_import_2026_04_15',
    'manual',
    'completed',
    timestamptz '2026-04-15 09:00:00+06:30',
    timestamptz '2026-04-15 09:18:00+06:30',
    'Initial Myanmar OSM import for Yangon sample workflow.'
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
        where source_code = 'osm_myanmar_main'
    ),
    (
        select id
        from system.system_import_batches
        where batch_name = 'osm_myanmar_first_import_2026_04_15'
        order by id desc
        limit 1
    ),
    'osm_myanmar_snapshot_2026_04_15_a',
    '2026-04-15',
    'MM-YGN',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    timestamptz '2026-04-15 09:05:00+06:30'
)
on conflict (source_registry_id, snapshot_ref) do update
set import_batch_id = excluded.import_batch_id,
    snapshot_version = excluded.snapshot_version,
    region_code = excluded.region_code,
    checksum = excluded.checksum,
    captured_at = excluded.captured_at;

insert into raw.raw_osm_points (
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    geom,
    tags,
    raw_payload
)
values (
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'node',
    '1000001001',
    ST_SetSRID(ST_MakePoint(96.1735, 16.8409), 4326),
    jsonb_build_object(
        'amenity', 'restaurant',
        'name', 'Shwe Bon Thar Tea House',
        'addr:city', 'Yangon'
    ),
    jsonb_build_object(
        'type', 'node',
        'id', '1000001001',
        'lat', 16.8409,
        'lon', 96.1735
    )
)
on conflict (source_snapshot_id, osm_feature_type, osm_id) do update
set geom = excluded.geom,
    tags = excluded.tags,
    raw_payload = excluded.raw_payload,
    ingested_at = now();

insert into raw.raw_osm_lines (
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    geom,
    tags,
    raw_payload
)
values (
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'way',
    '2000002001',
    ST_GeomFromText('LINESTRING(96.1710 16.8400, 96.1722 16.8407, 96.1738 16.8412)', 4326),
    jsonb_build_object(
        'highway', 'residential',
        'name', 'Merchant Road',
        'oneway', 'yes'
    ),
    jsonb_build_object(
        'type', 'way',
        'id', '2000002001'
    )
)
on conflict (source_snapshot_id, osm_feature_type, osm_id) do update
set geom = excluded.geom,
    tags = excluded.tags,
    raw_payload = excluded.raw_payload,
    ingested_at = now();

insert into raw.raw_osm_polygons (
    source_snapshot_id,
    osm_feature_type,
    osm_id,
    geom,
    tags,
    raw_payload
)
values (
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'way',
    '3000003001',
    ST_Multi(
        ST_GeomFromText(
            'POLYGON((96.1728 16.8399, 96.1736 16.8399, 96.1736 16.8405, 96.1728 16.8405, 96.1728 16.8399))',
            4326
        )
    ),
    jsonb_build_object(
        'building', 'yes',
        'name', 'Yangon Township Office'
    ),
    jsonb_build_object(
        'type', 'way',
        'id', '3000003001'
    )
)
on conflict (source_snapshot_id, osm_feature_type, osm_id) do update
set geom = excluded.geom,
    tags = excluded.tags,
    raw_payload = excluded.raw_payload,
    ingested_at = now();

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
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'osm_rel_7000001',
    'Kyauktada Township',
    (
        select id
        from ref.ref_admin_levels
        where code = 'township'
    ),
    null,
    ST_Multi(
        ST_GeomFromText(
            'POLYGON((96.1650 16.8350, 96.1850 16.8350, 96.1850 16.8500, 96.1650 16.8500, 96.1650 16.8350))',
            4326
        )
    ),
    ST_SetSRID(ST_MakePoint(96.1750, 16.8425), 4326),
    0.9800,
    'unmatched',
    null,
    jsonb_build_object(
        'admin_level', '8',
        'name', 'Kyauktada Township',
        'source', 'osm'
    ),
    jsonb_build_object(
        'raw_polygon', jsonb_build_object('osm_feature_type', 'way', 'osm_id', '3000003001')
    )
);

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
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'osm_node',
    'osm_node_1000001001',
    'Shwe Bon Thar Tea House',
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
    (
        select id
        from staging.staging_admin_area_candidates
        where external_id = 'osm_rel_7000001'
        order by id desc
        limit 1
    ),
    ST_SetSRID(ST_MakePoint(96.1735, 16.8409), 4326),
    0.9400,
    'unmatched',
    null,
    jsonb_build_object(
        'amenity', 'restaurant',
        'canonical_name', 'Shwe Bon Thar Tea House'
    ),
    jsonb_build_object(
        'raw_point', jsonb_build_object('osm_feature_type', 'node', 'osm_id', '1000001001')
    )
);

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
values (
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    (
        select id
        from staging.staging_place_candidates
        where external_id = 'osm_node_1000001001'
        order by id desc
        limit 1
    ),
    'Shwe Bon Thar Tea House',
    'en',
    'Latn',
    'primary',
    true,
    1.000
);

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
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'osm_way_2000002001',
    'Merchant Road',
    (
        select id
        from ref.ref_road_classes
        where code = 'residential'
    ),
    ST_GeomFromText('LINESTRING(96.1710 16.8400, 96.1722 16.8407, 96.1738 16.8412)', 4326),
    true,
    315.4,
    0.9100,
    'unmatched',
    null,
    jsonb_build_object(
        'highway', 'residential',
        'name', 'Merchant Road'
    ),
    jsonb_build_object(
        'raw_line', jsonb_build_object('osm_feature_type', 'way', 'osm_id', '2000002001')
    )
);

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
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'osm_node_1000001002',
    'Sule Pagoda Road Bus Stop',
    ST_SetSRID(ST_MakePoint(96.1562, 16.8402), 4326),
    (
        select id
        from staging.staging_admin_area_candidates
        where external_id = 'osm_rel_7000001'
        order by id desc
        limit 1
    ),
    0.9000,
    'unmatched',
    null,
    jsonb_build_object(
        'highway', 'bus_stop',
        'public_transport', 'platform'
    ),
    jsonb_build_object(
        'raw_point', jsonb_build_object('osm_feature_type', 'node', 'osm_id', '1000001002')
    )
);

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
    (
        select s.id
        from system.system_source_snapshots as s
        join system.system_source_registry as r
            on r.id = s.source_registry_id
        where r.source_code = 'osm_myanmar_main'
          and s.snapshot_ref = 'osm_myanmar_snapshot_2026_04_15_a'
    ),
    'osm_rel_8000001',
    'YBS-56',
    'YBS 56 Downtown Loop',
    ST_GeomFromText('LINESTRING(96.1500 16.8380, 96.1560 16.8400, 96.1630 16.8420, 96.1700 16.8440)', 4326),
    0.8900,
    'unmatched',
    null,
    jsonb_build_object(
        'route', 'bus',
        'network', 'YBS'
    ),
    jsonb_build_object(
        'raw_relation', jsonb_build_object('osm_feature_type', 'relation', 'osm_id', '8000001')
    )
);

insert into system.system_review_tasks (
    task_type_id,
    status_id,
    entity_family,
    entity_id,
    assigned_to,
    priority,
    note
)
values (
    (
        select id
        from ref.ref_validation_task_types
        where code = 'verify_name'
    ),
    (
        select id
        from ref.ref_validation_statuses
        where code = 'pending'
    ),
    'staging_place_candidates',
    (
        select id
        from staging.staging_place_candidates
        where external_id = 'osm_node_1000001001'
        order by id desc
        limit 1
    ),
    null,
    10,
    'Review imported restaurant name and category before publish.'
);

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
    'publish_candidates_2026_04_15_demo',
    null,
    null,
    'draft',
    timestamptz '2026-04-15 11:00:00+06:30',
    null,
    'Draft publish batch created from first OSM Myanmar import review set.'
);

insert into system.system_publish_items (
    publish_batch_id,
    entity_family,
    entity_id,
    version_id,
    publish_action,
    publish_status
)
values (
    (
        select id
        from system.system_publish_batches
        where batch_name = 'publish_candidates_2026_04_15_demo'
        order by id desc
        limit 1
    ),
    'staging_place_candidates',
    (
        select id
        from staging.staging_place_candidates
        where external_id = 'osm_node_1000001001'
        order by id desc
        limit 1
    ),
    null,
    'create',
    'draft'
);

commit;
