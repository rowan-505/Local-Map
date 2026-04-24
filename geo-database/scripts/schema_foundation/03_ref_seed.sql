insert into ref.ref_source_types (code, name)
values
    ('osm', 'OpenStreetMap'),
    ('manual', 'Manual'),
    ('gtfs', 'GTFS'),
    ('government', 'Government'),
    ('partner', 'Partner')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_publish_statuses (code, name)
values
    ('draft', 'Draft'),
    ('review_pending', 'Review Pending'),
    ('approved', 'Approved'),
    ('published', 'Published'),
    ('archived', 'Archived'),
    ('rejected', 'Rejected')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_validation_task_types (code, name)
values
    ('verify_geometry', 'Verify Geometry'),
    ('verify_name', 'Verify Name'),
    ('verify_category', 'Verify Category'),
    ('review_duplicate', 'Review Duplicate'),
    ('review_route', 'Review Route')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_validation_statuses (code, name)
values
    ('pending', 'Pending'),
    ('in_progress', 'In Progress'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
    ('skipped', 'Skipped')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_report_types (code, name)
values
    ('wrong_location', 'Wrong Location'),
    ('duplicate_place', 'Duplicate Place'),
    ('missing_place', 'Missing Place'),
    ('wrong_name', 'Wrong Name'),
    ('wrong_route', 'Wrong Route')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_report_statuses (code, name)
values
    ('open', 'Open'),
    ('under_review', 'Under Review'),
    ('resolved', 'Resolved'),
    ('rejected', 'Rejected')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_place_classes (code, name)
values
    ('poi', 'Point Of Interest'),
    ('landmark', 'Landmark'),
    ('building', 'Building'),
    ('transit_stop', 'Transit Stop'),
    ('transit_route', 'Transit Route'),
    ('admin_area', 'Administrative Area'),
    ('road', 'Road')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_road_classes (code, name)
values
    ('motorway', 'Motorway'),
    ('trunk', 'Trunk'),
    ('primary', 'Primary'),
    ('secondary', 'Secondary'),
    ('tertiary', 'Tertiary'),
    ('residential', 'Residential'),
    ('service', 'Service'),
    ('path', 'Path')
on conflict (code) do update
set name = excluded.name;

insert into ref.ref_admin_levels (code, name, rank)
values
    ('country', 'Country', 10),
    ('state_region', 'State Or Region', 20),
    ('district', 'District', 30),
    ('township', 'Township', 40),
    ('town', 'Town', 50),
    ('ward_village_tract', 'Ward Or Village Tract', 60),
    ('village', 'Village', 70)
on conflict (code) do update
set name = excluded.name,
    rank = excluded.rank;

insert into ref.ref_address_component_types (code, name, rank)
values
    ('country', 'Country', 10),
    ('state_region', 'State Or Region', 20),
    ('district', 'District', 30),
    ('township', 'Township', 40),
    ('ward', 'Ward', 50),
    ('street', 'Street', 60),
    ('house_number', 'House Number', 70),
    ('unit', 'Unit', 80)
on conflict (code) do update
set name = excluded.name,
    rank = excluded.rank;

insert into ref.ref_poi_categories (
    parent_id,
    code,
    name,
    sort_order,
    is_searchable,
    is_public
)
values
    (null, 'food', 'Food', 10, true, true),
    (null, 'health', 'Health', 20, true, true),
    (null, 'education', 'Education', 30, true, true),
    (null, 'transport', 'Transport', 40, true, true),
    (null, 'government', 'Government', 50, true, true),
    (null, 'shopping', 'Shopping', 60, true, true)
on conflict (code) do update
set parent_id = excluded.parent_id,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;

insert into ref.ref_poi_categories (
    parent_id,
    code,
    name,
    sort_order,
    is_searchable,
    is_public
)
select
    parent.id,
    child.code,
    child.name,
    child.sort_order,
    child.is_searchable,
    child.is_public
from (
    values
        ('food', 'restaurant', 'Restaurant', 11, true, true),
        ('food', 'cafe', 'Cafe', 12, true, true),
        ('food', 'market', 'Market', 13, true, true),
        ('health', 'hospital', 'Hospital', 21, true, true),
        ('health', 'clinic', 'Clinic', 22, true, true),
        ('health', 'pharmacy', 'Pharmacy', 23, true, true),
        ('education', 'school', 'School', 31, true, true),
        ('education', 'university', 'University', 32, true, true),
        ('education', 'library', 'Library', 33, true, true),
        ('transport', 'bus_station', 'Bus Station', 41, true, true),
        ('transport', 'train_station', 'Train Station', 42, true, true),
        ('transport', 'ferry_terminal', 'Ferry Terminal', 43, true, true),
        ('government', 'township_office', 'Township Office', 51, true, true),
        ('government', 'police_station', 'Police Station', 52, true, true),
        ('government', 'post_office', 'Post Office', 53, true, true),
        ('shopping', 'supermarket', 'Supermarket', 61, true, true),
        ('shopping', 'convenience_store', 'Convenience Store', 62, true, true),
        ('shopping', 'shopping_mall', 'Shopping Mall', 63, true, true)
) as child(parent_code, code, name, sort_order, is_searchable, is_public)
join ref.ref_poi_categories as parent
    on parent.code = child.parent_code
on conflict (code) do update
set parent_id = excluded.parent_id,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_searchable = excluded.is_searchable,
    is_public = excluded.is_public;
