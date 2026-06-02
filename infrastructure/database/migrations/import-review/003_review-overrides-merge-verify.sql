-- =============================================================================
-- Phase 2 quick verification after 083 merge (read-only, no hard stop)
-- Full gate before Phase 4 API: 004_review-overrides-phase3-verification-gate.sql
-- =============================================================================
-- Run in Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f infrastructure/database/migrations/import-review/003_review-overrides-merge-verify.sql
-- =============================================================================

-- HS-2 scalar parity for valid FK ids only (must be 0)
select 'buildings.building_type_id' as check_name, count(*)::bigint as mismatch_count
from import_review.building_candidates as b
where b.review_overrides ? 'building_type_id'
  and nullif(trim(b.review_overrides ->> 'building_type_id'), '') is not null
  and exists (
      select 1
      from ref.ref_building_types as bt
      where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
  )
  and b.building_type_id is distinct from (b.review_overrides ->> 'building_type_id')::bigint

union all

select 'roads.road_class_id', count(*)::bigint
from import_review.road_candidates as r
where r.review_overrides ? 'road_class_id'
  and nullif(trim(r.review_overrides ->> 'road_class_id'), '') is not null
  and exists (
      select 1
      from ref.ref_road_classes as rc
      where rc.id = (r.review_overrides ->> 'road_class_id')::bigint
  )
  and r.road_class_id is distinct from (r.review_overrides ->> 'road_class_id')::bigint

union all

select 'places.category_id', count(*)::bigint
from import_review.place_candidates as p
where (
    (
        p.review_overrides ? 'category_id'
        and nullif(trim(p.review_overrides ->> 'category_id'), '') is not null
        and exists (
            select 1
            from ref.ref_poi_categories as pc
            where pc.id = (p.review_overrides ->> 'category_id')::bigint
        )
        and p.category_id is distinct from (p.review_overrides ->> 'category_id')::bigint
    )
    or (
        p.review_overrides ? 'poi_category_id'
        and nullif(trim(p.review_overrides ->> 'poi_category_id'), '') is not null
        and exists (
            select 1
            from ref.ref_poi_categories as pc
            where pc.id = (p.review_overrides ->> 'poi_category_id')::bigint
        )
        and p.category_id is distinct from (p.review_overrides ->> 'poi_category_id')::bigint
    )
);

-- Overrides with FK ids missing from ref (informational; fix manually before drop)
select
    'buildings.building_type_id_invalid_fk' as check_name,
    count(*)::bigint as row_count
from import_review.building_candidates as b
where b.review_overrides ? 'building_type_id'
  and nullif(trim(b.review_overrides ->> 'building_type_id'), '') is not null
  and not exists (
      select 1
      from ref.ref_building_types as bt
      where bt.id = (b.review_overrides ->> 'building_type_id')::bigint
  );

-- HS-3 road geom (must be 0)
select
    'roads.geom' as check_name,
    count(*)::bigint as mismatch_count
from import_review.road_candidates as r
where r.review_overrides ? 'geom'
  and jsonb_typeof(r.review_overrides -> 'geom') = 'object'
  and (
      r.geom is null
      or not st_equals(r.geom, st_setsrid(st_geomfromgeojson(r.review_overrides -> 'geom'), 4326))
  );

-- Archive still matches live overrides (unchanged by 083)
select
    'archive_drift' as check_name,
    sum(cnt)::bigint as mismatch_count
from (
    select count(*)::bigint as cnt
    from import_review.building_candidates
    where review_overrides is distinct from review_overrides_archive
      and review_overrides <> '{}'::jsonb
    union all
    select count(*)::bigint
    from import_review.road_candidates
    where review_overrides is distinct from review_overrides_archive
      and review_overrides <> '{}'::jsonb
) as s;

-- Sample: roads with merged admin_area_id from overrides
select
    count(*) filter (where review_overrides ? 'admin_area_id') as with_override_key,
    count(*) filter (where admin_area_id is not null) as with_column,
    count(*) filter (
        where review_overrides ? 'admin_area_id'
          and admin_area_id is not distinct from (review_overrides ->> 'admin_area_id')::bigint
    ) as aligned
from import_review.road_candidates
where review_overrides <> '{}'::jsonb;
