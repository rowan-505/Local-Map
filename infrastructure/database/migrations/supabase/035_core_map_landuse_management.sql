-- =============================================================================
-- Supabase migration 035: core.core_map_landuse long-term management columns
-- =============================================================================
--
-- Purpose:
--   Extend core landuse polygons for ref taxonomy, admin boundaries, geometry
--   metrics, verification, village/paddy parcel metadata, and zoom-aware detail.
--
--   Category labels remain in ref.ref_landuse_classes; feature names in
--   core.core_map_landuse_names. Legacy class_code and name columns are kept.
--
-- Safety:
--   - Non-destructive: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--   - Does not alter tiles.tiles_landuse_v (still uses id, name, class_code, geom).
--   - landuse_class_id stays nullable until rows are mapped.
--   - Skips FK/backfill when ref.core tables are missing.
--
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Columns (idempotent; is_verified/deleted_at may exist from 026/030)
-- ---------------------------------------------------------------------------
alter table core.core_map_landuse
    add column if not exists public_id uuid,
    add column if not exists landuse_class_id bigint,
    add column if not exists admin_area_id bigint,
    add column if not exists centroid geometry(Point, 4326),
    add column if not exists area_m2 numeric,
    add column if not exists confidence_score numeric default 70,
    add column if not exists is_verified boolean not null default false,
    add column if not exists manual_override boolean not null default false,
    add column if not exists source_tags jsonb not null default '{}'::jsonb,
    add column if not exists deleted_at timestamptz,
    add column if not exists created_by bigint,
    add column if not exists updated_by bigint,
    add column if not exists crop_code text,
    add column if not exists irrigated boolean,
    add column if not exists seasonality text,
    add column if not exists detail_level text not null default 'zone';

-- Defaults for columns added in earlier migrations without explicit defaults.
alter table core.core_map_landuse
    alter column confidence_score set default 70,
    alter column manual_override set default false,
    alter column source_tags set default '{}'::jsonb,
    alter column detail_level set default 'zone';

comment on column core.core_map_landuse.public_id is
    'Stable UUID for dashboard/API references (internal bigint id remains primary key).';

comment on column core.core_map_landuse.landuse_class_id is
    'Controlled landuse category FK (ref.ref_landuse_classes). Legacy class_code retained for lineage.';

comment on column core.core_map_landuse.admin_area_id is
    'Optional admin boundary containing or best matching this polygon.';

comment on column core.core_map_landuse.centroid is
    'Point-on-surface centroid for labels and low-zoom aggregation.';

comment on column core.core_map_landuse.area_m2 is
    'Geodesic area in square meters (ST_Area on geography).';

comment on column core.core_map_landuse.confidence_score is
    'Import/review confidence 0–100 (not 0–1).';

comment on column core.core_map_landuse.manual_override is
    'True when a reviewer has manually corrected attributes beyond import defaults.';

comment on column core.core_map_landuse.source_tags is
    'Raw/normalized OSM tags snapshot for lineage (separate from normalized_data).';

comment on column core.core_map_landuse.crop_code is
    'Crop hint when class is farmland/paddy (e.g. rice for village paddy parcels).';

comment on column core.core_map_landuse.irrigated is
    'Optional irrigation hint for agricultural parcels.';

comment on column core.core_map_landuse.seasonality is
    'Optional seasonality hint (e.g. monsoon, dry) — free text until standardized.';

comment on column core.core_map_landuse.detail_level is
    'Geometry granularity: zone = generalized area (low/medium zoom); parcel = detailed field plot (high zoom).';

-- ---------------------------------------------------------------------------
-- Check constraints (drop/recreate idempotently)
-- ---------------------------------------------------------------------------
alter table core.core_map_landuse
    drop constraint if exists core_map_landuse_confidence_score_chk;

alter table core.core_map_landuse
    add constraint core_map_landuse_confidence_score_chk
        check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100));

alter table core.core_map_landuse
    drop constraint if exists core_map_landuse_detail_level_chk;

alter table core.core_map_landuse
    add constraint core_map_landuse_detail_level_chk
        check (detail_level in ('zone', 'parcel'));

alter table core.core_map_landuse
    drop constraint if exists core_map_landuse_crop_code_chk;

alter table core.core_map_landuse
    add constraint core_map_landuse_crop_code_chk
        check (crop_code is null or btrim(crop_code) <> '');

alter table core.core_map_landuse
    drop constraint if exists core_map_landuse_seasonality_chk;

alter table core.core_map_landuse
    add constraint core_map_landuse_seasonality_chk
        check (seasonality is null or btrim(seasonality) <> '');

-- ---------------------------------------------------------------------------
-- Foreign keys (conditional)
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('ref.ref_landuse_classes') is not null then
        if not exists (
            select 1
            from pg_constraint
            where conname = 'core_map_landuse_landuse_class_id_fkey'
              and conrelid = 'core.core_map_landuse'::regclass
        ) then
            alter table core.core_map_landuse
                add constraint core_map_landuse_landuse_class_id_fkey
                foreign key (landuse_class_id)
                references ref.ref_landuse_classes (id);
        end if;
    end if;

    if to_regclass('core.core_admin_areas') is not null then
        if not exists (
            select 1
            from pg_constraint
            where conname = 'core_map_landuse_admin_area_id_fkey'
              and conrelid = 'core.core_map_landuse'::regclass
        ) then
            alter table core.core_map_landuse
                add constraint core_map_landuse_admin_area_id_fkey
                foreign key (admin_area_id)
                references core.core_admin_areas (id);
        end if;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- public_id backfill + unique index
-- ---------------------------------------------------------------------------
update core.core_map_landuse as l
set public_id = gen_random_uuid()
where l.public_id is null;

alter table core.core_map_landuse
    alter column public_id set default gen_random_uuid();

alter table core.core_map_landuse
    alter column public_id set not null;

create unique index if not exists core_map_landuse_public_id_uidx
    on core.core_map_landuse (public_id);

-- ---------------------------------------------------------------------------
-- Geometry metrics backfill
-- ---------------------------------------------------------------------------
update core.core_map_landuse as l
set centroid = st_pointonsurface(st_makevalid(l.geom))::geometry(Point, 4326)
where l.centroid is null
  and l.geom is not null
  and not st_isempty(l.geom);

update core.core_map_landuse as l
set area_m2 = st_area(l.geom::geography)
where l.area_m2 is null
  and l.geom is not null
  and not st_isempty(l.geom);

-- ---------------------------------------------------------------------------
-- landuse_class_id backfill from legacy class_code
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('ref.ref_landuse_classes') is null then
        raise notice '035: skipped landuse_class_id backfill — ref.ref_landuse_classes missing.';
        return;
    end if;

    -- Direct code match (promoted rows with ref-aligned class_code).
    update core.core_map_landuse as l
    set
        landuse_class_id = lc.id,
        updated_at = now()
    from ref.ref_landuse_classes as lc
    where l.landuse_class_id is null
      and l.class_code is not null
      and btrim(l.class_code) <> ''
      and lc.code = btrim(l.class_code)
      and lc.is_active is true;

    -- OSM slug → ref code mapping for remaining rows (aligned with import_review 033).
    with mapped as (
        select
            l.id,
            case lower(btrim(l.class_code))
                when 'school' then 'education'
                when 'college' then 'education'
                when 'university' then 'education'
                when 'kindergarten' then 'education'
                when 'hospital' then 'healthcare'
                when 'clinic' then 'healthcare'
                when 'place_of_worship' then 'religious'
                when 'monastery' then 'religious'
                when 'marketplace' then 'retail'
                when 'bus_station' then 'transport'
                when 'ferry_terminal' then 'transport'
                when 'grave_yard' then 'cemetery'
                when 'park' then 'park'
                when 'recreation_ground' then 'recreation_ground'
                when 'playground' then 'recreation_ground'
                when 'sports_centre' then 'recreation_ground'
                when 'stadium' then 'recreation_ground'
                when 'wood' then 'forest'
                when 'grassland' then 'grassland'
                when 'residential' then 'residential'
                when 'industrial' then 'industrial'
                when 'commercial' then 'commercial'
                when 'retail' then 'retail'
                when 'farmland' then 'farmland'
                when 'paddy' then 'paddy'
                when 'rice' then 'paddy'
                when 'orchard' then 'orchard'
                when 'aquaculture' then 'aquaculture'
                when 'farmyard' then 'farmyard'
                when 'cemetery' then 'cemetery'
                when 'military' then 'military'
                when 'construction' then 'construction'
                when 'grass' then 'grassland'
                when 'forest' then 'forest'
                else null
            end as ref_code
        from core.core_map_landuse as l
        where l.landuse_class_id is null
          and l.class_code is not null
          and btrim(l.class_code) <> ''
    )
    update core.core_map_landuse as l
    set
        landuse_class_id = lc.id,
        updated_at = now()
    from mapped as m
    inner join ref.ref_landuse_classes as lc
        on lc.code = m.ref_code
       and lc.is_active is true
    where l.id = m.id
      and l.landuse_class_id is null
      and m.ref_code is not null;

    raise notice '035: landuse_class_id populated on % row(s).',
        (select count(*) from core.core_map_landuse where landuse_class_id is not null);
end $$;

-- ---------------------------------------------------------------------------
-- crop_code backfill (village paddy / rice fields)
-- ---------------------------------------------------------------------------
update core.core_map_landuse as l
set
    crop_code = 'rice',
    updated_at = now()
where l.crop_code is null
  and (
      lower(btrim(l.class_code)) in ('paddy', 'rice')
      or lower(btrim(coalesce(
          l.source_tags->>'crop',
          l.normalized_data->>'crop',
          l.normalized_data->'tags'->>'crop'
      ))) = 'rice'
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists core_map_landuse_landuse_class_id_idx
    on core.core_map_landuse (landuse_class_id);

create index if not exists core_map_landuse_admin_area_id_idx
    on core.core_map_landuse (admin_area_id);

create index if not exists core_map_landuse_detail_level_idx
    on core.core_map_landuse (detail_level);

create index if not exists core_map_landuse_deleted_at_idx
    on core.core_map_landuse (deleted_at);

create index if not exists core_map_landuse_is_active_deleted_at_idx
    on core.core_map_landuse (is_active, deleted_at);

create index if not exists core_map_landuse_geom_gix
    on core.core_map_landuse using gist (geom);

create index if not exists core_map_landuse_centroid_gix
    on core.core_map_landuse using gist (centroid)
    where centroid is not null;

create index if not exists core_map_landuse_active_class_idx
    on core.core_map_landuse (landuse_class_id, detail_level)
    where deleted_at is null
      and is_active is true;

commit;

-- =============================================================================
-- Verification (run manually after apply)
-- =============================================================================
--
-- Column presence:
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'core' AND table_name = 'core_map_landuse'
-- ORDER BY ordinal_position;
--
-- Mapping summary:
-- SELECT
--     coalesce(nullif(btrim(l.class_code), ''), '(null)') AS class_code,
--     coalesce(lc.code, '(unmapped)') AS ref_code,
--     count(*) AS row_count
-- FROM core.core_map_landuse AS l
-- LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = l.landuse_class_id
-- GROUP BY 1, 2
-- ORDER BY row_count DESC;
--
-- Unmapped rows (expected until promotion fills class_code):
-- SELECT count(*) FROM core.core_map_landuse WHERE landuse_class_id IS NULL;
--
-- Tile view unchanged:
-- SELECT definition FROM pg_views
-- WHERE schemaname = 'tiles' AND viewname = 'tiles_landuse_v';
