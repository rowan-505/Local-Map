-- =============================================================================
-- Supabase migration 033: backfill import_review.landuse_candidates.landuse_class_id
-- =============================================================================
--
-- Maps OSM-style normalized_data / tags / legacy class_code to ref.ref_landuse_classes.
-- Idempotent: only rows with landuse_class_id IS NULL are updated.
--
-- Precedence for source fields (per key): normalized_data -> normalized_data.tags
-- Mapping precedence (most specific first): military/aeroway, amenity, leisure/natural,
-- crop/rice village rules, direct landuse, class_code fallback, other.
--
-- =============================================================================

begin;

do $$
begin
    if to_regclass('import_review.landuse_candidates') is null then
        raise notice '033: skipped — import_review.landuse_candidates does not exist.';
        return;
    end if;

    if to_regclass('ref.ref_landuse_classes') is null then
        raise notice '033: skipped — ref.ref_landuse_classes does not exist.';
        return;
    end if;

    with candidates as (
        select
            c.id,
            nullif(btrim(c.class_code), '') as class_code_trim,
            c.normalized_data as nd,
            nullif(btrim(coalesce(c.normalized_data->>'landuse', c.normalized_data->'tags'->>'landuse')), '') as landuse_val,
            nullif(btrim(coalesce(c.normalized_data->>'amenity', c.normalized_data->'tags'->>'amenity')), '') as amenity_val,
            nullif(btrim(coalesce(c.normalized_data->>'leisure', c.normalized_data->'tags'->>'leisure')), '') as leisure_val,
            nullif(btrim(coalesce(c.normalized_data->>'natural', c.normalized_data->'tags'->>'natural')), '') as natural_val,
            nullif(btrim(coalesce(c.normalized_data->>'military', c.normalized_data->'tags'->>'military')), '') as military_val,
            nullif(btrim(coalesce(c.normalized_data->>'aeroway', c.normalized_data->'tags'->>'aeroway')), '') as aeroway_val,
            nullif(btrim(coalesce(c.normalized_data->>'crop', c.normalized_data->'tags'->>'crop')), '') as crop_val,
            nullif(
                btrim(coalesce(c.normalized_data->>'farmland', c.normalized_data->'tags'->>'farmland')),
                ''
            ) as farmland_tag_val
        from import_review.landuse_candidates as c
        where c.landuse_class_id is null
    ),
    mapped as (
        select
            id,
            case
                -- -----------------------------------------------------------------
                -- 5. Military / aeroway
                -- -----------------------------------------------------------------
                when military_val is not null or landuse_val = 'military' then 'military'
                when aeroway_val = 'aerodrome' then 'transport'

                -- -----------------------------------------------------------------
                -- 3. Amenity polygon inference
                -- -----------------------------------------------------------------
                when amenity_val in ('school', 'college', 'university', 'kindergarten') then 'education'
                when amenity_val in ('hospital', 'clinic') then 'healthcare'
                when amenity_val in ('place_of_worship', 'monastery') then 'religious'
                when amenity_val = 'marketplace' then 'retail'
                when amenity_val in ('bus_station', 'ferry_terminal') then 'transport'
                when amenity_val = 'grave_yard' then 'cemetery'

                -- -----------------------------------------------------------------
                -- 4. Leisure / natural
                -- -----------------------------------------------------------------
                when leisure_val = 'park' then 'park'
                when leisure_val in ('recreation_ground', 'playground', 'sports_centre', 'stadium') then 'recreation_ground'
                when natural_val = 'wood' then 'forest'
                when natural_val = 'grassland' then 'grassland'

                -- -----------------------------------------------------------------
                -- 2. Crop / village rice field
                -- -----------------------------------------------------------------
                when landuse_val = 'farmland' and crop_val = 'rice' then 'paddy'
                when landuse_val = 'farmland' and farmland_tag_val = 'paddy' then 'paddy'
                when crop_val = 'rice'
                     and (landuse_val is null or landuse_val in ('farmland', 'paddy')) then 'paddy'

                -- -----------------------------------------------------------------
                -- 1. Direct landuse (normalized_data / tags)
                -- -----------------------------------------------------------------
                when landuse_val = 'residential' then 'residential'
                when landuse_val = 'industrial' then 'industrial'
                when landuse_val = 'commercial' then 'commercial'
                when landuse_val = 'retail' then 'retail'
                when landuse_val = 'farmland' then 'farmland'
                when landuse_val = 'paddy' then 'paddy'
                when landuse_val = 'orchard' then 'orchard'
                when landuse_val = 'aquaculture' then 'aquaculture'
                when landuse_val = 'farmyard' then 'farmyard'
                when landuse_val = 'cemetery' then 'cemetery'
                when landuse_val = 'construction' then 'construction'
                when landuse_val = 'grass' then 'grassland'
                when landuse_val = 'forest' then 'forest'

                -- -----------------------------------------------------------------
                -- class_code fallback (same rules; pipeline often stores tag slug here)
                -- -----------------------------------------------------------------
                when class_code_trim in ('school', 'college', 'university', 'kindergarten') then 'education'
                when class_code_trim in ('hospital', 'clinic') then 'healthcare'
                when class_code_trim in ('place_of_worship', 'monastery') then 'religious'
                when class_code_trim = 'marketplace' then 'retail'
                when class_code_trim in ('bus_station', 'ferry_terminal') then 'transport'
                when class_code_trim = 'grave_yard' then 'cemetery'
                when class_code_trim = 'park' then 'park'
                when class_code_trim in ('recreation_ground', 'playground', 'sports_centre', 'stadium') then 'recreation_ground'
                when class_code_trim = 'wood' then 'forest'
                when class_code_trim = 'grassland' then 'grassland'
                when class_code_trim = 'residential' then 'residential'
                when class_code_trim = 'industrial' then 'industrial'
                when class_code_trim = 'commercial' then 'commercial'
                when class_code_trim = 'retail' then 'retail'
                when class_code_trim = 'farmland' then 'farmland'
                when class_code_trim in ('paddy', 'rice') then 'paddy'
                when class_code_trim = 'orchard' then 'orchard'
                when class_code_trim = 'aquaculture' then 'aquaculture'
                when class_code_trim = 'farmyard' then 'farmyard'
                when class_code_trim = 'cemetery' then 'cemetery'
                when class_code_trim = 'military' then 'military'
                when class_code_trim = 'construction' then 'construction'
                when class_code_trim = 'grass' then 'grassland'
                when class_code_trim = 'forest' then 'forest'

                -- -----------------------------------------------------------------
                -- 6. Fallback
                -- -----------------------------------------------------------------
                else 'other'
            end as ref_code
        from candidates
    )
    update import_review.landuse_candidates as lu
    set
        landuse_class_id = lc.id,
        updated_at = now()
    from mapped as m
    inner join ref.ref_landuse_classes as lc
        on lc.code = m.ref_code
       and lc.is_active is true
    where lu.id = m.id
      and lu.landuse_class_id is null;

    raise notice '033: backfilled landuse_class_id on % row(s).',
        (select count(*) from import_review.landuse_candidates where landuse_class_id is not null);
end $$;

commit;

-- =============================================================================
-- Verification (run manually after apply)
-- =============================================================================
--
-- Row counts by legacy class_code vs mapped ref code:
--
-- SELECT
--     coalesce(nullif(btrim(c.class_code), ''), '(null)') AS class_code,
--     coalesce(lc.code, '(null)') AS landuse_class_code,
--     coalesce(lc.name_en, '(unmapped)') AS landuse_class_name,
--     count(*) AS row_count
-- FROM import_review.landuse_candidates AS c
-- LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = c.landuse_class_id
-- GROUP BY 1, 2, 3
-- ORDER BY row_count DESC, class_code, landuse_class_code;
--
-- Rows still unmapped (should be 0 after backfill unless ref seed missing codes):
--
-- SELECT count(*) AS still_null
-- FROM import_review.landuse_candidates
-- WHERE landuse_class_id IS NULL;
--
-- Mapping summary by ref class only:
--
-- SELECT
--     coalesce(lc.code, '(null)') AS landuse_class_code,
--     count(*) AS row_count
-- FROM import_review.landuse_candidates AS c
-- LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = c.landuse_class_id
-- GROUP BY 1
-- ORDER BY row_count DESC, landuse_class_code;
