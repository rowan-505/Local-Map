-- verify all expected schemas exist
select
    n.nspname as schema_name
from pg_namespace as n
where n.nspname in ('ref', 'system', 'raw', 'staging')
order by n.nspname;

-- verify all expected tables exist
select
    t.table_schema,
    t.table_name
from information_schema.tables as t
where (t.table_schema, t.table_name) in (
    ('ref', 'ref_admin_levels'),
    ('ref', 'ref_poi_categories'),
    ('ref', 'ref_source_types'),
    ('ref', 'ref_publish_statuses'),
    ('ref', 'ref_validation_task_types'),
    ('ref', 'ref_validation_statuses'),
    ('ref', 'ref_report_types'),
    ('ref', 'ref_report_statuses'),
    ('ref', 'ref_address_component_types'),
    ('ref', 'ref_place_classes'),
    ('ref', 'ref_road_classes'),
    ('system', 'system_source_registry'),
    ('system', 'system_import_batches'),
    ('system', 'system_source_snapshots'),
    ('system', 'system_diff_runs'),
    ('system', 'system_diff_items'),
    ('system', 'system_conflict_queue'),
    ('system', 'system_review_tasks'),
    ('system', 'system_review_logs'),
    ('system', 'system_publish_batches'),
    ('system', 'system_publish_items'),
    ('raw', 'raw_osm_points'),
    ('raw', 'raw_osm_lines'),
    ('raw', 'raw_osm_polygons'),
    ('staging', 'staging_place_candidates'),
    ('staging', 'staging_place_name_candidates'),
    ('staging', 'staging_admin_area_candidates'),
    ('staging', 'staging_road_candidates'),
    ('staging', 'staging_bus_stop_candidates'),
    ('staging', 'staging_bus_route_candidates')
)
order by t.table_schema, t.table_name;

-- verify one source can be traced to its import batches and snapshots
select
    r.source_code,
    r.source_name,
    b.id as import_batch_id,
    b.batch_name,
    b.status as batch_status,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    s.snapshot_version,
    s.region_code,
    s.captured_at
from system.system_source_registry as r
join system.system_import_batches as b
    on b.source_registry_id = r.id
join system.system_source_snapshots as s
    on s.source_registry_id = r.id
   and s.import_batch_id = b.id
order by r.source_code, b.id, s.id;

-- verify raw point rows can be traced back to source snapshots
select
    p.id as raw_point_id,
    p.osm_feature_type,
    p.osm_id,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code,
    b.batch_name
from raw.raw_osm_points as p
join system.system_source_snapshots as s
    on s.id = p.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
join system.system_import_batches as b
    on b.id = s.import_batch_id
order by p.id;

-- verify raw line rows can be traced back to source snapshots
select
    l.id as raw_line_id,
    l.osm_feature_type,
    l.osm_id,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code,
    b.batch_name
from raw.raw_osm_lines as l
join system.system_source_snapshots as s
    on s.id = l.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
join system.system_import_batches as b
    on b.id = s.import_batch_id
order by l.id;

-- verify raw polygon rows can be traced back to source snapshots
select
    p.id as raw_polygon_id,
    p.osm_feature_type,
    p.osm_id,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code,
    b.batch_name
from raw.raw_osm_polygons as p
join system.system_source_snapshots as s
    on s.id = p.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
join system.system_import_batches as b
    on b.id = s.import_batch_id
order by p.id;

-- verify staging place candidates can be traced back to source snapshots
select
    c.id as place_candidate_id,
    c.external_id,
    c.canonical_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code
from staging.staging_place_candidates as c
join system.system_source_snapshots as s
    on s.id = c.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
order by c.id;

-- verify staging admin area candidates can be traced back to source snapshots
select
    a.id as admin_area_candidate_id,
    a.external_id,
    a.canonical_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code
from staging.staging_admin_area_candidates as a
join system.system_source_snapshots as s
    on s.id = a.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
order by a.id;

-- verify staging road candidates can be traced back to source snapshots
select
    rdc.id as road_candidate_id,
    rdc.external_id,
    rdc.canonical_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    src.source_code
from staging.staging_road_candidates as rdc
join system.system_source_snapshots as s
    on s.id = rdc.source_snapshot_id
join system.system_source_registry as src
    on src.id = s.source_registry_id
order by rdc.id;

-- verify staging bus stop candidates can be traced back to source snapshots
select
    bsc.id as bus_stop_candidate_id,
    bsc.external_id,
    bsc.canonical_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code
from staging.staging_bus_stop_candidates as bsc
join system.system_source_snapshots as s
    on s.id = bsc.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
order by bsc.id;

-- verify staging bus route candidates can be traced back to source snapshots
select
    brc.id as bus_route_candidate_id,
    brc.external_id,
    brc.route_code,
    brc.public_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    r.source_code
from staging.staging_bus_route_candidates as brc
join system.system_source_snapshots as s
    on s.id = brc.source_snapshot_id
join system.system_source_registry as r
    on r.id = s.source_registry_id
order by brc.id;

-- verify place candidates can join to their name candidates
select
    p.id as place_candidate_id,
    p.external_id,
    p.canonical_name,
    n.id as place_name_candidate_id,
    n.name,
    n.language_code,
    n.name_type,
    n.is_primary
from staging.staging_place_candidates as p
join staging.staging_place_name_candidates as n
    on n.place_candidate_id = p.id
order by p.id, n.is_primary desc, n.id;

-- verify admin area candidates can self-join to parent candidates
select
    child.id as child_admin_area_candidate_id,
    child.canonical_name as child_name,
    parent.id as parent_admin_area_candidate_id,
    parent.canonical_name as parent_name
from staging.staging_admin_area_candidates as child
left join staging.staging_admin_area_candidates as parent
    on parent.id = child.parent_candidate_id
order by child.id;

-- verify review tasks exist and can be filtered by status
select
    t.id as review_task_id,
    t.entity_family,
    t.entity_id,
    task_type.code as task_type_code,
    status.code as status_code,
    t.priority,
    t.note,
    t.created_at,
    t.resolved_at
from system.system_review_tasks as t
join ref.ref_validation_task_types as task_type
    on task_type.id = t.task_type_id
join ref.ref_validation_statuses as status
    on status.id = t.status_id
where status.code = 'pending'
order by t.priority desc, t.created_at desc;

-- verify publish items exist under publish batches
select
    pb.id as publish_batch_id,
    pb.batch_name,
    pb.status as publish_batch_status,
    pi.id as publish_item_id,
    pi.entity_family,
    pi.entity_id,
    pi.publish_action,
    pi.publish_status
from system.system_publish_batches as pb
join system.system_publish_items as pi
    on pi.publish_batch_id = pb.id
order by pb.id, pi.id;

-- lineage query:
-- system_source_registry -> system_import_batches -> system_source_snapshots -> raw_osm_points -> staging_place_candidates
select
    r.source_code,
    r.source_name,
    b.id as import_batch_id,
    b.batch_name,
    s.id as source_snapshot_id,
    s.snapshot_ref,
    raw_point.id as raw_point_id,
    raw_point.osm_feature_type,
    raw_point.osm_id,
    place_candidate.id as place_candidate_id,
    place_candidate.external_id as place_candidate_external_id,
    place_candidate.canonical_name as place_candidate_name
from system.system_source_registry as r
join system.system_import_batches as b
    on b.source_registry_id = r.id
join system.system_source_snapshots as s
    on s.source_registry_id = r.id
   and s.import_batch_id = b.id
join raw.raw_osm_points as raw_point
    on raw_point.source_snapshot_id = s.id
left join staging.staging_place_candidates as place_candidate
    on place_candidate.source_snapshot_id = s.id
   and (
       place_candidate.source_refs -> 'raw_point' ->> 'osm_feature_type' = raw_point.osm_feature_type
       and place_candidate.source_refs -> 'raw_point' ->> 'osm_id' = raw_point.osm_id
   )
order by r.source_code, b.id, s.id, raw_point.id, place_candidate.id;
