-- Reference taxonomy for building types + FK on core.core_map_buildings.
-- Keeps legacy text column building_type for rollback / compatibility.

create table if not exists ref.ref_building_types (
    id bigserial primary key,
    code text not null,
    name text not null,
    name_mm text,
    parent_id bigint references ref.ref_building_types (id),
    sort_order int not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ref_building_types_code_key unique (code)
);

create index if not exists ref_building_types_parent_id_idx
    on ref.ref_building_types (parent_id);

-- ---------------------------------------------------------------------------
-- Seed: parent categories (parent_id null)
-- ---------------------------------------------------------------------------
insert into ref.ref_building_types (code, name, parent_id, sort_order, is_active)
values
    ('residential', 'Residential', null, 10, true),
    ('commercial', 'Commercial', null, 20, true),
    ('education', 'Education', null, 30, true),
    ('healthcare', 'Healthcare', null, 40, true),
    ('government_civic', 'Government / Civic', null, 50, true),
    ('religious', 'Religious', null, 60, true),
    ('industrial', 'Industrial', null, 70, true),
    ('transport', 'Transport', null, 80, true),
    ('agriculture', 'Agriculture', null, 90, true),
    ('recreation_entertainment', 'Recreation / Entertainment', null, 100, true),
    ('utility_infrastructure', 'Utility / Infrastructure', null, 110, true),
    ('military_restricted', 'Military / Restricted', null, 120, true),
    ('mixed_use', 'Mixed use', null, 130, true),
    ('temporary_informal', 'Temporary / Informal', null, 140, true),
    ('unknown', 'Unknown', null, 150, true)
on conflict (code) do update
set
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Seed: child types (parent_id from parent code)
-- ---------------------------------------------------------------------------
insert into ref.ref_building_types (code, name, parent_id, sort_order, is_active)
select v.code, v.name, p.id, v.sort_order, true
from ref.ref_building_types p
cross join (values
    -- residential
    ('residential', 'house', 'House', 0),
    ('residential', 'apartment', 'Apartment', 1),
    ('residential', 'dormitory', 'Dormitory', 2),
    ('residential', 'townhouse', 'Townhouse', 3),
    ('residential', 'villa', 'Villa', 4),
    -- commercial
    ('commercial', 'office', 'Office', 0),
    ('commercial', 'retail', 'Retail', 1),
    ('commercial', 'shopping_mall', 'Shopping mall', 2),
    ('commercial', 'supermarket', 'Supermarket', 3),
    ('commercial', 'market', 'Market', 4),
    ('commercial', 'hotel', 'Hotel', 5),
    ('commercial', 'restaurant_building', 'Restaurant building', 6),
    ('commercial', 'showroom', 'Showroom', 7),
    -- education
    ('education', 'school', 'School', 0),
    ('education', 'university', 'University', 1),
    ('education', 'library', 'Library', 2),
    ('education', 'training_center', 'Training center', 3),
    -- healthcare
    ('healthcare', 'hospital', 'Hospital', 0),
    ('healthcare', 'clinic', 'Clinic', 1),
    ('healthcare', 'pharmacy_building', 'Pharmacy building', 2),
    ('healthcare', 'laboratory', 'Laboratory', 3),
    ('healthcare', 'health_center', 'Health center', 4),
    -- government_civic
    ('government_civic', 'government_office', 'Government office', 0),
    ('government_civic', 'township_office', 'Township office', 1),
    ('government_civic', 'courthouse', 'Courthouse', 2),
    ('government_civic', 'police_station', 'Police station', 3),
    ('government_civic', 'fire_station', 'Fire station', 4),
    ('government_civic', 'post_office', 'Post office', 5),
    ('government_civic', 'community_center', 'Community center', 6),
    -- religious
    ('religious', 'pagoda', 'Pagoda', 0),
    ('religious', 'monastery', 'Monastery', 1),
    ('religious', 'church', 'Church', 2),
    ('religious', 'mosque', 'Mosque', 3),
    ('religious', 'temple', 'Temple', 4),
    ('religious', 'religious_complex', 'Religious complex', 5),
    -- industrial
    ('industrial', 'factory', 'Factory', 0),
    ('industrial', 'warehouse', 'Warehouse', 1),
    ('industrial', 'workshop', 'Workshop', 2),
    ('industrial', 'processing_plant', 'Processing plant', 3),
    -- transport
    ('transport', 'bus_terminal', 'Bus terminal', 0),
    ('transport', 'train_station', 'Train station', 1),
    ('transport', 'ferry_terminal', 'Ferry terminal', 2),
    ('transport', 'airport_terminal', 'Airport terminal', 3),
    ('transport', 'parking_structure', 'Parking structure', 4),
    ('transport', 'depot', 'Depot', 5),
    -- agriculture
    ('agriculture', 'farm_building', 'Farm building', 0),
    ('agriculture', 'barn', 'Barn', 1),
    ('agriculture', 'greenhouse', 'Greenhouse', 2),
    ('agriculture', 'livestock_structure', 'Livestock structure', 3),
    -- recreation_entertainment
    ('recreation_entertainment', 'stadium', 'Stadium', 0),
    ('recreation_entertainment', 'cinema', 'Cinema', 1),
    ('recreation_entertainment', 'gym', 'Gym', 2),
    ('recreation_entertainment', 'recreation_center', 'Recreation center', 3),
    -- utility_infrastructure
    ('utility_infrastructure', 'telecom', 'Telecom', 0),
    ('utility_infrastructure', 'water_facility', 'Water facility', 1),
    ('utility_infrastructure', 'electrical_substation', 'Electrical substation', 2),
    ('utility_infrastructure', 'sewage_facility', 'Sewage facility', 3),
    ('utility_infrastructure', 'waste_management', 'Waste management', 4),
    -- military_restricted
    ('military_restricted', 'military', 'Military', 0),
    ('military_restricted', 'checkpoint', 'Checkpoint', 1),
    ('military_restricted', 'restricted_facility', 'Restricted facility', 2),
    -- mixed_use
    ('mixed_use', 'mixed_use_lowrise', 'Mixed use (low-rise)', 0),
    ('mixed_use', 'mixed_use_highrise', 'Mixed use (high-rise)', 1),
    ('mixed_use', 'integrated_complex', 'Integrated complex', 2),
    -- temporary_informal
    ('temporary_informal', 'temporary_structure', 'Temporary structure', 0),
    ('temporary_informal', 'kiosk', 'Kiosk', 1),
    ('temporary_informal', 'market_stall', 'Market stall', 2),
    ('temporary_informal', 'informal_structure', 'Informal structure', 3),
    -- unknown
    ('unknown', 'generic_building', 'Generic building', 0),
    ('unknown', 'unclassified', 'Unclassified', 1)
) as v (parent_code, code, name, sort_order)
where p.code = v.parent_code
  and p.parent_id is null
on conflict (code) do update
set
    name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Buildings: nullable FK to ref
-- ---------------------------------------------------------------------------
alter table core.core_map_buildings
    add column if not exists building_type_id bigint;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'core_map_buildings_building_type_id_fkey'
    ) then
        alter table core.core_map_buildings
            add constraint core_map_buildings_building_type_id_fkey
            foreign key (building_type_id) references ref.ref_building_types (id);
    end if;
end $$;

create index if not exists core_map_buildings_building_type_id_idx
    on core.core_map_buildings (building_type_id);

-- ---------------------------------------------------------------------------
-- Backfill building_type_id from legacy text (exact code match)
-- ---------------------------------------------------------------------------
update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and b.building_type is not null
  and length(trim(b.building_type)) > 0
  and lower(trim(b.building_type)) = t.code;

-- Common legacy synonyms / OSM-ish values -> ref codes (only where still null)
update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'residential'
  and lower(trim(COALESCE(b.building_type, ''))) = 'residential';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'house'
  and lower(trim(COALESCE(b.building_type, ''))) = 'house';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'commercial'
  and lower(trim(COALESCE(b.building_type, ''))) = 'commercial';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'retail'
  and lower(trim(COALESCE(b.building_type, ''))) = 'retail';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'school'
  and lower(trim(COALESCE(b.building_type, ''))) = 'school';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'hospital'
  and lower(trim(COALESCE(b.building_type, ''))) = 'hospital';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'clinic'
  and lower(trim(COALESCE(b.building_type, ''))) = 'clinic';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'religious'
  and lower(trim(COALESCE(b.building_type, ''))) = 'religious';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'pagoda'
  and lower(trim(COALESCE(b.building_type, ''))) = 'pagoda';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'warehouse'
  and lower(trim(COALESCE(b.building_type, ''))) = 'warehouse';

update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'industrial'
  and lower(trim(COALESCE(b.building_type, ''))) = 'industrial';

-- yes / generic -> generic_building
update core.core_map_buildings b
set building_type_id = t.id
from ref.ref_building_types t
where b.building_type_id is null
  and t.code = 'generic_building'
  and lower(trim(COALESCE(b.building_type, b.class_code, ''))) = 'yes';
