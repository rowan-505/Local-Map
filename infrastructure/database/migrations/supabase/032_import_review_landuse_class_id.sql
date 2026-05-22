-- =============================================================================
-- Supabase migration 032: import_review.landuse_candidates landuse_class_id
-- =============================================================================
--
-- Adds controlled ref.ref_landuse_classes FK while keeping class_code for source
-- compatibility. Nullable for existing unmapped rows.
--
-- =============================================================================

begin;

alter table import_review.landuse_candidates
    add column if not exists landuse_class_id bigint null,
    add column if not exists name_mm text null,
    add column if not exists name_en text null;

do $$
begin
    if to_regclass('ref.ref_landuse_classes') is not null then
        if not exists (
            select 1
            from pg_constraint
            where conname = 'irr_lu_landuse_class_id_fkey'
              and conrelid = 'import_review.landuse_candidates'::regclass
        ) then
            alter table import_review.landuse_candidates
                add constraint irr_lu_landuse_class_id_fkey
                foreign key (landuse_class_id) references ref.ref_landuse_classes (id);
        end if;
    end if;
end $$;

create index if not exists irr_lu_landuse_class_id_idx
    on import_review.landuse_candidates (landuse_class_id);

comment on column import_review.landuse_candidates.landuse_class_id is
    'Controlled land-use class (ref.ref_landuse_classes). review_overrides.landuse_class_id wins when set.';

comment on column import_review.landuse_candidates.class_code is
    'Legacy imported OSM/source slug; retained for compatibility — not a display name.';

commit;
