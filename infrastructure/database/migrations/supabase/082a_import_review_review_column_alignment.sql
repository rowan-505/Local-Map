-- =============================================================================
-- Supabase migration 082a: import_review candidate column alignment (Phase 1b)
-- =============================================================================
--
-- Purpose:
--   Add typed columns required for direct-edit migration (allowlist + Phase 0
--   inventory). Does not merge review_overrides or drop JSON columns.
--
-- Verify (read-only): infrastructure/database/migrations/import-review/002_review-overrides-column-alignment-verify.sql
--
-- Prerequisite: 082_import_review_review_overrides_archive.sql applied.
--
-- Safety:
--   - ADD COLUMN IF NOT EXISTS only (no data rewrite in this migration).
--   - Aborts if expected columns missing after DDL.
--   - Optional FK on road_candidates.admin_area_id when core.core_admin_areas exists.
--
-- Rollback (only before 083 merge):
--   ALTER TABLE import_review.<table> DROP COLUMN IF EXISTS <col>, ...;
--
-- =============================================================================

begin;

do $$
begin
    if to_regnamespace('import_review') is null then
        raise exception '082a: schema import_review does not exist.';
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- buildings: bilingual display names (024 had name only)
-- -----------------------------------------------------------------------------
alter table import_review.building_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

comment on column import_review.building_candidates.name_mm is
    'Reviewer-facing Myanmar name (authoritative after Phase 2 merge).';
comment on column import_review.building_candidates.name_en is
    'Reviewer-facing English name (authoritative after Phase 2 merge).';

-- -----------------------------------------------------------------------------
-- places: bilingual names alongside primary_name / display_name
-- -----------------------------------------------------------------------------
alter table import_review.place_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

comment on column import_review.place_candidates.name_mm is
    'Reviewer-facing Myanmar name (authoritative after Phase 2 merge).';
comment on column import_review.place_candidates.name_en is
    'Reviewer-facing English name (authoritative after Phase 2 merge).';

-- -----------------------------------------------------------------------------
-- roads: names, explicit admin_area_id, routing attrs from inventory (539 rows each)
-- -----------------------------------------------------------------------------
alter table import_review.road_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null,
    add column if not exists admin_area_id bigint null,
    add column if not exists access text null,
    add column if not exists speed_kph numeric null;

comment on column import_review.road_candidates.name_mm is
    'Reviewer-facing Myanmar name; canonical_name derived for promotion when set.';
comment on column import_review.road_candidates.name_en is
    'Reviewer-facing English/Latin name.';
comment on column import_review.road_candidates.admin_area_id is
    'Explicit admin area FK when reviewer overrides spatial inference (Phase 1b).';
comment on column import_review.road_candidates.access is
    'OSM access tag for review/routing export (from review_overrides until merged).';
comment on column import_review.road_candidates.speed_kph is
    'Speed limit km/h for review/routing export (from review_overrides until merged).';

do $$
begin
    if to_regclass('core.core_admin_areas') is not null then
        if not exists (
            select 1
            from pg_constraint
            where conname = 'irr_road_admin_area_id_fkey'
              and conrelid = 'import_review.road_candidates'::regclass
        ) then
            alter table import_review.road_candidates
                add constraint irr_road_admin_area_id_fkey
                foreign key (admin_area_id) references core.core_admin_areas (id);
        end if;
    else
        raise notice '082a: skipped irr_road_admin_area_id_fkey — core.core_admin_areas missing.';
    end if;
end $$;

create index if not exists irr_road_admin_area_id_idx
    on import_review.road_candidates (admin_area_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'irr_road_speed_kph_chk'
          and conrelid = 'import_review.road_candidates'::regclass
    ) then
        alter table import_review.road_candidates
            add constraint irr_road_speed_kph_chk check (
                speed_kph is null or speed_kph > 0
            );
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- admin_areas: bilingual names
-- -----------------------------------------------------------------------------
alter table import_review.admin_area_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

comment on column import_review.admin_area_candidates.name_mm is
    'Reviewer-facing Myanmar name.';
comment on column import_review.admin_area_candidates.name_en is
    'Reviewer-facing English name.';

-- -----------------------------------------------------------------------------
-- water lines / polygons: bilingual names (class_code retains OSM slug)
-- -----------------------------------------------------------------------------
alter table import_review.water_line_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

alter table import_review.water_polygon_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

-- -----------------------------------------------------------------------------
-- bus_stops / bus_routes: bilingual names (review-only families)
-- -----------------------------------------------------------------------------
alter table import_review.bus_stop_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

alter table import_review.bus_route_candidates
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

-- landuse: name_mm / name_en added in 032 — no-op if present

-- -----------------------------------------------------------------------------
-- Verification: required columns exist
-- -----------------------------------------------------------------------------
do $$
declare
    expected constant jsonb := '[
        {"schema":"import_review","table":"building_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"place_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"road_candidates","columns":["name_mm","name_en","admin_area_id","access","speed_kph"]},
        {"schema":"import_review","table":"admin_area_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"water_line_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"water_polygon_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"bus_stop_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"bus_route_candidates","columns":["name_mm","name_en"]},
        {"schema":"import_review","table":"landuse_candidates","columns":["name_mm","name_en"]}
    ]'::jsonb;
    rec record;
    missing text[] := array[]::text[];
begin
    for rec in
        select
            e->>'schema' as table_schema,
            e->>'table' as table_name,
            jsonb_array_elements_text(e->'columns') as column_name
        from jsonb_array_elements(expected) as e
    loop
        if to_regclass(format('%I.%I', rec.table_schema, rec.table_name)) is null then
            raise notice '082a verify: skipped %.% (table missing)', rec.table_schema, rec.table_name;
            continue;
        end if;

        if not exists (
            select 1
            from information_schema.columns AS c
            where c.table_schema = rec.table_schema
              and c.table_name = rec.table_name
              and c.column_name = rec.column_name
        ) then
            missing := array_append(
                missing,
                format('%s.%s.%s', rec.table_schema, rec.table_name, rec.column_name)
            );
        end if;
    end loop;

    if coalesce(array_length(missing, 1), 0) > 0 then
        raise exception '082a verification failed — missing columns: %', array_to_string(missing, ', ');
    end if;

    raise notice '082a: all expected columns present.';
end $$;

commit;

-- -----------------------------------------------------------------------------
-- Post-apply spot check (read-only)
-- -----------------------------------------------------------------------------
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'import_review' and table_name = 'road_candidates'
--   and column_name in ('name_mm','name_en','admin_area_id','access','speed_kph')
-- order by column_name;
