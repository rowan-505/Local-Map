-- verify core admin areas exist and can self-join to parents
select
    child.id as admin_area_id,
    child.public_id,
    child.canonical_name,
    child.slug,
    child.is_active,
    parent.id as parent_admin_area_id,
    parent.canonical_name as parent_canonical_name,
    child.admin_level_id,
    child.source_type_id
from core.core_admin_areas as child
left join core.core_admin_areas as parent
    on parent.id = child.parent_id
order by child.id;

-- verify core places join correctly to names, contacts, sources, and versions
select
    p.id as place_id,
    p.public_id,
    p.primary_name,
    p.display_name,
    pn.id as place_name_id,
    pn.name as place_name,
    pc.id as contact_id,
    pc.phone,
    pc.website,
    ps.id as source_id,
    ps.external_id,
    ps.source_name,
    pv.id as version_id,
    pv.version_no,
    pv.publish_status_id
from core.core_places as p
left join core.core_place_names as pn
    on pn.place_id = p.id
left join core.core_place_contacts as pc
    on pc.place_id = p.id
left join core.core_place_sources as ps
    on ps.place_id = p.id
left join core.core_place_versions as pv
    on pv.place_id = p.id
order by p.id, pn.id, ps.id, pv.version_no;

-- verify current_version_id in core_places resolves correctly
select
    p.id as place_id,
    p.public_id,
    p.primary_name,
    p.current_version_id,
    pv.id as resolved_version_id,
    pv.version_no,
    pv.created_at as version_created_at,
    pv.published_at as version_published_at
from core.core_places as p
left join core.core_place_versions as pv
    on pv.id = p.current_version_id
order by p.id;

-- verify streets and street names join correctly
select
    s.id as street_id,
    s.public_id,
    s.canonical_name,
    s.is_active,
    sn.id as street_name_id,
    sn.name,
    sn.language_code,
    sn.script_code,
    sn.name_type,
    sn.is_primary
from core.core_streets as s
left join core.core_street_names as sn
    on sn.street_id = s.id
order by s.id, sn.id;

-- verify addresses and address components join correctly
select
    a.id as address_id,
    a.public_id,
    a.full_address,
    a.house_number,
    a.unit_number,
    a.street_id,
    a.admin_area_id,
    ac.id as address_component_id,
    ac.component_type_id,
    ac.component_value,
    ac.sort_order
from core.core_addresses as a
left join core.core_address_components as ac
    on ac.address_id = a.id
order by a.id, ac.sort_order, ac.id;

-- verify bus routes, variants, stops, and ordered stops join correctly
select
    r.id as route_id,
    r.route_code,
    r.public_name,
    v.id as route_variant_id,
    v.variant_code,
    rs.stop_sequence,
    s.id as stop_id,
    s.public_id as stop_public_id,
    s.name as stop_name,
    rs.distance_from_start_m,
    rs.is_timing_point
from core.core_bus_routes as r
left join core.core_bus_route_variants as v
    on v.route_id = r.id
left join core.core_bus_route_stops as rs
    on rs.route_variant_id = v.id
left join core.core_bus_stops as s
    on s.id = rs.stop_id
order by r.id, v.id, rs.stop_sequence, s.id;

-- verify staging matched_core_* ids are populated after promotion
select
    'staging_admin_area_candidates' as staging_table,
    count(*) as total_rows,
    count(*) filter (where matched_core_admin_area_id is not null) as matched_rows
from staging.staging_admin_area_candidates
union all
select
    'staging_place_candidates' as staging_table,
    count(*) as total_rows,
    count(*) filter (where matched_core_place_id is not null) as matched_rows
from staging.staging_place_candidates
union all
select
    'staging_road_candidates' as staging_table,
    count(*) as total_rows,
    count(*) filter (where matched_core_edge_id is not null) as matched_rows
from staging.staging_road_candidates
union all
select
    'staging_bus_stop_candidates' as staging_table,
    count(*) as total_rows,
    count(*) filter (where matched_core_bus_stop_id is not null) as matched_rows
from staging.staging_bus_stop_candidates
union all
select
    'staging_bus_route_candidates' as staging_table,
    count(*) as total_rows,
    count(*) filter (where matched_core_bus_route_id is not null) as matched_rows
from staging.staging_bus_route_candidates;

-- verify publish batches and publish items reflect promoted entities
select
    pb.id as publish_batch_id,
    pb.batch_name,
    pb.status as publish_batch_status,
    pi.id as publish_item_id,
    pi.entity_family,
    pi.entity_id,
    pi.version_id,
    pi.publish_action,
    pi.publish_status,
    pi.created_at as publish_item_created_at
from system.system_publish_batches as pb
join system.system_publish_items as pi
    on pi.publish_batch_id = pb.id
where pi.entity_family in (
    'core_admin_areas',
    'core_places',
    'core_streets',
    'core_bus_stops',
    'core_bus_routes'
)
order by pb.id, pi.id;

-- verify tile/public POI view returns expected rows
select
    id,
    public_id,
    name,
    category_code,
    importance_score,
    geom
from tiles.tiles_poi_public_v
order by id;

-- verify tile/public bus stop view returns expected rows
select
    id,
    public_id,
    name,
    stop_code,
    geom
from tiles.tiles_bus_stops_public_v
order by id;

-- verify tile/public bus route view returns expected rows
select
    id,
    route_id,
    route_code,
    public_name,
    variant_code,
    geom
from tiles.tiles_bus_routes_public_v
order by route_id, id;

-- end-to-end lineage query:
-- system source -> batch -> snapshot -> staging place candidate -> core place -> tile public view
select
    sr.id as source_registry_id,
    sr.source_code,
    sr.source_name,
    ib.id as import_batch_id,
    ib.batch_name,
    ss.id as source_snapshot_id,
    ss.snapshot_ref,
    spc.id as staging_place_candidate_id,
    spc.external_id as staging_external_id,
    spc.canonical_name as staging_canonical_name,
    spc.matched_core_place_id,
    cp.id as core_place_id,
    cp.public_id as core_place_public_id,
    cp.primary_name as core_primary_name,
    cps.id as core_place_source_id,
    cps.external_id as core_source_external_id,
    tpv.id as tile_place_id,
    tpv.public_id as tile_public_id,
    tpv.name as tile_name,
    tpv.category_code
from system.system_source_registry as sr
join system.system_import_batches as ib
    on ib.source_registry_id = sr.id
join system.system_source_snapshots as ss
    on ss.source_registry_id = sr.id
   and ss.import_batch_id = ib.id
join staging.staging_place_candidates as spc
    on spc.source_snapshot_id = ss.id
left join core.core_places as cp
    on cp.id = spc.matched_core_place_id
left join core.core_place_sources as cps
    on cps.place_id = cp.id
   and coalesce(cps.external_id, '') = coalesce(spc.external_id, '')
left join tiles.tiles_poi_public_v as tpv
    on tpv.id = cp.id
order by sr.id, ib.id, ss.id, spc.id, cp.id;
