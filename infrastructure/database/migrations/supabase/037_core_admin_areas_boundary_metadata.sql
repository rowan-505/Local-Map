-- =============================================================================
-- Supabase migration 037: core.core_admin_areas boundary / address usage metadata
-- =============================================================================
--
-- Purpose:
--   Support Myanmar villages and other admin areas where the polygon may be an
--   official legal boundary, a surveyed extent, or only an approximate settlement
--   area used for search and address locality hints.
--
-- Safety:
--   - Non-destructive: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--   - Existing rows receive conservative defaults on first add (official / 80).
--   - No UPDATE overwrites non-null values already stored in these columns.
--   - Skips when core.core_admin_areas is missing.
--
-- =============================================================================

begin;

do $guard$
begin
    if to_regclass('core.core_admin_areas') is null then
        raise notice 'Skipping 037: core.core_admin_areas does not exist';
        return;
    end if;

    -- -------------------------------------------------------------------------
    -- Columns (idempotent)
    -- -------------------------------------------------------------------------
    alter table core.core_admin_areas
        add column if not exists boundary_status text not null default 'official',
        add column if not exists is_official_boundary boolean not null default true,
        add column if not exists boundary_confidence_score numeric not null default 80,
        add column if not exists address_usage text not null default 'official',
        add column if not exists boundary_note text;

    alter table core.core_admin_areas
        alter column boundary_status set default 'official',
        alter column is_official_boundary set default true,
        alter column boundary_confidence_score set default 80,
        alter column address_usage set default 'official';

    comment on column core.core_admin_areas.boundary_status is
        'How trustworthy the polygon geometry is as an admin boundary. '
        'official = trusted legal/admin boundary; '
        'surveyed = manually checked or field-verified boundary; '
        'approximate = approximate polygon, not legally exact; '
        'settlement_extent = visible built-up settlement area only, not an official boundary; '
        'unknown = boundary unknown.';

    comment on column core.core_admin_areas.is_official_boundary is
        'True when the polygon represents an official legal/admin boundary. '
        'False for approximate settlement extents or other non-official footprints.';

    comment on column core.core_admin_areas.boundary_confidence_score is
        'Reviewer/import confidence in boundary quality and placement, 0–100 (not 0–1).';

    comment on column core.core_admin_areas.address_usage is
        'How this admin area may be used in address/search workflows. '
        'official = normal official address assignment; '
        'locality_hint = may appear in address display as an approximate locality; '
        'search_only = searchable/focusable but not for strict address assignment; '
        'disabled = do not use for address or search locality hints.';

    comment on column core.core_admin_areas.boundary_note is
        'Optional reviewer note explaining boundary quality, source, or address-usage caveats.';

    -- -------------------------------------------------------------------------
    -- Check constraints (drop/recreate idempotently)
    -- -------------------------------------------------------------------------
    alter table core.core_admin_areas
        drop constraint if exists core_admin_areas_boundary_status_chk;

    alter table core.core_admin_areas
        add constraint core_admin_areas_boundary_status_chk
            check (
                boundary_status in (
                    'official',
                    'surveyed',
                    'approximate',
                    'settlement_extent',
                    'unknown'
                )
            );

    alter table core.core_admin_areas
        drop constraint if exists core_admin_areas_address_usage_chk;

    alter table core.core_admin_areas
        add constraint core_admin_areas_address_usage_chk
            check (
                address_usage in (
                    'official',
                    'locality_hint',
                    'search_only',
                    'disabled'
                )
            );

    alter table core.core_admin_areas
        drop constraint if exists core_admin_areas_boundary_confidence_score_chk;

    alter table core.core_admin_areas
        add constraint core_admin_areas_boundary_confidence_score_chk
            check (boundary_confidence_score >= 0 and boundary_confidence_score <= 100);

    -- -------------------------------------------------------------------------
    -- Backfill (only fill NULLs — never overwrite existing values)
    -- -------------------------------------------------------------------------
    update core.core_admin_areas as a
    set
        boundary_status = 'official',
        is_official_boundary = true,
        boundary_confidence_score = 80,
        address_usage = 'official'
    where a.boundary_status is null
       or a.is_official_boundary is null
       or a.boundary_confidence_score is null
       or a.address_usage is null;

    -- -------------------------------------------------------------------------
    -- Indexes
    -- -------------------------------------------------------------------------
    create index if not exists core_admin_areas_boundary_status_idx
        on core.core_admin_areas (boundary_status);

    create index if not exists core_admin_areas_address_usage_idx
        on core.core_admin_areas (address_usage);

    create index if not exists core_admin_areas_is_official_boundary_idx
        on core.core_admin_areas (is_official_boundary);

    create index if not exists core_admin_areas_boundary_confidence_score_idx
        on core.core_admin_areas (boundary_confidence_score);

    raise notice 'Applied 037: core.core_admin_areas boundary / address usage metadata';
end;
$guard$;

commit;

-- Manual verification (Supabase SQL Editor):
--
-- SELECT column_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'core'
--   AND table_name = 'core_admin_areas'
--   AND column_name IN (
--       'boundary_status',
--       'is_official_boundary',
--       'boundary_confidence_score',
--       'address_usage',
--       'boundary_note'
--   )
-- ORDER BY column_name;
--
-- SELECT boundary_status, address_usage, is_official_boundary, count(*)
-- FROM core.core_admin_areas
-- GROUP BY 1, 2, 3
-- ORDER BY 1, 2, 3;
