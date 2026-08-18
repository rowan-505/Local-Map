-- =============================================================================
-- Read-only verification: import-review direct-edit persistence (typed columns)
-- File: tools/import-review/verify-direct-edit-persistence.sql
-- Supabase SQL Editor compatible
-- =============================================================================
--
-- Use after saving from dashboard (PATCH /api/import-review/:family/:id).
-- Paste your candidate id into each section (replace the example id).
--
-- What to confirm per family:
--   1) Typed columns show the values you saved (not only effective/UI display).
--   2) updated_at moved forward at save time.
--   3) review_candidate_edits has a new row (edit_type = override_update).
--   4) review_overrides did NOT change (still {} or same as pre-save snapshot).
--      After migration 084, review_overrides column may be absent — see section 0.
--   5) review_overrides_archive unchanged since archive is historical only.
--
-- Tip: run the candidate SELECT once before save and once after; diff the rows.
-- Tip: optional filter — and review_batch_id = 2
--
-- Read-only only. Do not run INSERT/UPDATE/DELETE here.
--
-- Post-migration 084: review_overrides column may be dropped. Run section 0 first.
--   - Use each family's "*-alt" query (no override columns) if 1a fails.
--   - Skip 1b / 9c override checks when has_review_overrides = false.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) Schema flags (which override columns still exist)
-- -----------------------------------------------------------------------------
select
    t.table_name,
    exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'import_review'
          and c.table_name = t.table_name
          and c.column_name = 'review_overrides'
    ) as has_review_overrides,
    exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'import_review'
          and c.table_name = t.table_name
          and c.column_name = 'review_overrides_archive'
    ) as has_review_overrides_archive
from (
    values
        ('road_candidates'),
        ('place_candidates'),
        ('building_candidates'),
        ('land_area_candidates'),
        ('water_line_candidates'),
        ('water_polygon_candidates'),
        ('admin_area_candidates'),
        ('routing_barrier_candidates')
) as t(table_name)
order by t.table_name;


-- -----------------------------------------------------------------------------
-- 0b) Quick audit: recent direct-edit rows (last 30 minutes, all families)
-- -----------------------------------------------------------------------------
select
    e.id as edit_id,
    e.created_at,
    e.entity_family,
    e.candidate_table,
    e.candidate_id,
    e.edit_type,
    e.edited_by,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.edit_type = 'override_update'
  and e.created_at >= now() - interval '30 minutes'
order by e.created_at desc, e.id desc
limit 50;


-- =============================================================================
-- 1) ROADS — import_review.road_candidates
-- =============================================================================
-- Replace 1021 with your candidate id

-- 1a) Candidate row + latest edit (typed columns)
select
    r.id,
    r.review_batch_id,
    r.entity_family,
    r.name_mm,
    r.name_en,
    r.canonical_name,
    r.road_class_id,
    r.road_class,
    r.surface,
    r.is_oneway,
    r.admin_area_id,
    r.review_note,
    r.updated_at,
    r.review_status,
    r.promotion_status,
    r.review_overrides,
    r.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.road_candidates r
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'road_candidates'
      and e.candidate_id = r.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where r.id = 1021;
-- optional scope: and r.review_batch_id = 2

-- 1a-alt) Same as 1a when review_overrides columns were dropped (migration 084+)
select
    r.id,
    r.review_batch_id,
    r.entity_family,
    r.name_mm,
    r.name_en,
    r.canonical_name,
    r.road_class_id,
    r.road_class,
    r.surface,
    r.is_oneway,
    r.admin_area_id,
    r.review_note,
    r.updated_at,
    r.review_status,
    r.promotion_status,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.road_candidates r
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'road_candidates'
      and e.candidate_id = r.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where r.id = 1021;

-- 1b) Verify: review_overrides unchanged (skip if section 0 shows has_review_overrides = false)
select
    r.id,
    r.review_overrides,
    md5(r.review_overrides::text) as review_overrides_md5
from import_review.road_candidates r
where r.id = 1021;

-- 1c) Verify: review_candidate_edits inserted for this save
select
    e.id,
    e.created_at,
    e.edit_type,
    e.edited_by,
    e.before_data,
    e.after_data,
    e.note
from import_review.review_candidate_edits e
where e.candidate_table = 'road_candidates'
  and e.candidate_id = 1021
order by e.created_at desc, e.id desc
limit 10;

-- 1d) Verify: typed column + updated_at only (minimal)
select
    r.id,
    r.surface,
    r.is_oneway,
    r.road_class_id,
    r.name_en,
    r.updated_at
from import_review.road_candidates r
where r.id = 1021;


-- =============================================================================
-- 2) PLACES — import_review.place_candidates
-- =============================================================================
-- Replace 2042 with your candidate id

select
    p.id,
    p.review_batch_id,
    p.entity_family,
    p.name_mm,
    p.name_en,
    p.category_id,
    p.admin_area_id,
    p.review_note,
    p.updated_at,
    p.review_status,
    p.promotion_status,
    p.review_overrides,
    p.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.place_candidates p
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'place_candidates'
      and e.candidate_id = p.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where p.id = 2042;

select
    p.id,
    p.review_overrides,
    md5(p.review_overrides::text) as review_overrides_md5
from import_review.place_candidates p
where p.id = 2042;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'place_candidates'
  and e.candidate_id = 2042
order by e.created_at desc, e.id desc
limit 10;

select
    p.id,
    p.name_mm,
    p.name_en,
    p.category_id,
    p.updated_at
from import_review.place_candidates p
where p.id = 2042;


-- =============================================================================
-- 3) BUILDINGS — import_review.building_candidates
-- =============================================================================
-- Replace 3055 with your candidate id

select
    b.id,
    b.review_batch_id,
    b.entity_family,
    b.name_mm,
    b.name_en,
    b.building_type_id,
    b.admin_area_id,
    b.levels,
    b.height_m,
    b.review_note,
    b.updated_at,
    b.review_status,
    b.promotion_status,
    b.review_overrides,
    b.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.building_candidates b
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'building_candidates'
      and e.candidate_id = b.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where b.id = 3055;

select
    b.id,
    b.review_overrides,
    md5(b.review_overrides::text) as review_overrides_md5
from import_review.building_candidates b
where b.id = 3055;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'building_candidates'
  and e.candidate_id = 3055
order by e.created_at desc, e.id desc
limit 10;

select
    b.id,
    b.name_en,
    b.building_type_id,
    b.levels,
    b.height_m,
    b.updated_at
from import_review.building_candidates b
where b.id = 3055;


-- =============================================================================
-- 4) LANDUSE — import_review.land_area_candidates
-- =============================================================================
-- Replace 4066 with your candidate id
-- Note: admin_area_id is not a typed column on land_area_candidates (direct PATCH drops it).

select
    l.id,
    l.review_batch_id,
    l.entity_family,
    l.name_mm,
    l.name_en,
    l.class_code,
    l.land_area_class_id,
    l.review_note,
    l.updated_at,
    l.review_status,
    l.promotion_status,
    l.review_overrides,
    l.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.land_area_candidates l
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'land_area_candidates'
      and e.candidate_id = l.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where l.id = 4066;

select
    l.id,
    l.review_overrides,
    md5(l.review_overrides::text) as review_overrides_md5
from import_review.land_area_candidates l
where l.id = 4066;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'land_area_candidates'
  and e.candidate_id = 4066
order by e.created_at desc, e.id desc
limit 10;

select
    l.id,
    l.class_code,
    l.land_area_class_id,
    l.name_en,
    l.updated_at
from import_review.land_area_candidates l
where l.id = 4066;


-- =============================================================================
-- 5) WATER LINES — import_review.water_line_candidates
-- =============================================================================
-- Replace 5077 with your candidate id

select
    w.id,
    w.review_batch_id,
    w.entity_family,
    w.name_mm,
    w.name_en,
    w.class_code,
    w.review_note,
    w.updated_at,
    w.review_status,
    w.promotion_status,
    w.review_overrides,
    w.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.water_line_candidates w
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'water_line_candidates'
      and e.candidate_id = w.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where w.id = 5077;

select
    w.id,
    w.review_overrides,
    md5(w.review_overrides::text) as review_overrides_md5
from import_review.water_line_candidates w
where w.id = 5077;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'water_line_candidates'
  and e.candidate_id = 5077
order by e.created_at desc, e.id desc
limit 10;

select
    w.id,
    w.class_code,
    w.name_en,
    w.updated_at
from import_review.water_line_candidates w
where w.id = 5077;


-- =============================================================================
-- 6) WATER POLYGONS — import_review.water_polygon_candidates
-- =============================================================================
-- Replace 6088 with your candidate id

select
    w.id,
    w.review_batch_id,
    w.entity_family,
    w.name_mm,
    w.name_en,
    w.class_code,
    w.review_note,
    w.updated_at,
    w.review_status,
    w.promotion_status,
    w.review_overrides,
    w.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.water_polygon_candidates w
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'water_polygon_candidates'
      and e.candidate_id = w.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where w.id = 6088;

select
    w.id,
    w.review_overrides,
    md5(w.review_overrides::text) as review_overrides_md5
from import_review.water_polygon_candidates w
where w.id = 6088;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'water_polygon_candidates'
  and e.candidate_id = 6088
order by e.created_at desc, e.id desc
limit 10;

select
    w.id,
    w.class_code,
    w.name_en,
    w.updated_at
from import_review.water_polygon_candidates w
where w.id = 6088;


-- =============================================================================
-- 7) ADMIN AREAS — import_review.admin_area_candidates
-- =============================================================================
-- Replace 7099 with your candidate id

select
    a.id,
    a.review_batch_id,
    a.entity_family,
    a.name_mm,
    a.name_en,
    a.admin_level_id,
    a.parent_id,
    a.slug,
    a.review_note,
    a.updated_at,
    a.review_status,
    a.promotion_status,
    a.review_overrides,
    a.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.admin_area_candidates a
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'admin_area_candidates'
      and e.candidate_id = a.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where a.id = 7099;

select
    a.id,
    a.review_overrides,
    md5(a.review_overrides::text) as review_overrides_md5
from import_review.admin_area_candidates a
where a.id = 7099;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'admin_area_candidates'
  and e.candidate_id = 7099
order by e.created_at desc, e.id desc
limit 10;

select
    a.id,
    a.name_en,
    a.admin_level_id,
    a.parent_id,
    a.slug,
    a.updated_at
from import_review.admin_area_candidates a
where a.id = 7099;


-- =============================================================================
-- 8) ROUTING BARRIERS — import_review.routing_barrier_candidates
-- =============================================================================
-- Replace 8100 with your candidate id

select
    rb.id,
    rb.review_batch_id,
    rb.entity_family,
    rb.barrier_type,
    rb.class_code,
    rb.admin_area_id,
    rb.review_note,
    rb.updated_at,
    rb.review_status,
    rb.promotion_status,
    rb.review_overrides,
    rb.review_overrides_archive,
    latest_edit.edit_id,
    latest_edit.edit_created_at,
    latest_edit.edit_type,
    latest_edit.edit_before_data,
    latest_edit.edit_after_data
from import_review.routing_barrier_candidates rb
left join lateral (
    select
        e.id as edit_id,
        e.created_at as edit_created_at,
        e.edit_type,
        e.before_data as edit_before_data,
        e.after_data as edit_after_data
    from import_review.review_candidate_edits e
    where e.candidate_table = 'routing_barrier_candidates'
      and e.candidate_id = rb.id
    order by e.created_at desc, e.id desc
    limit 1
) latest_edit on true
where rb.id = 8100;

select
    rb.id,
    rb.review_overrides,
    md5(rb.review_overrides::text) as review_overrides_md5
from import_review.routing_barrier_candidates rb
where rb.id = 8100;

select
    e.id,
    e.created_at,
    e.edit_type,
    e.before_data,
    e.after_data
from import_review.review_candidate_edits e
where e.candidate_table = 'routing_barrier_candidates'
  and e.candidate_id = 8100
order by e.created_at desc, e.id desc
limit 10;

select
    rb.id,
    rb.barrier_type,
    rb.class_code,
    rb.admin_area_id,
    rb.updated_at
from import_review.routing_barrier_candidates rb
where rb.id = 8100;


-- =============================================================================
-- 9) PASS/FAIL helpers (read-only checks)
-- =============================================================================
-- Replace ids to match the section you tested.

-- 9a) Expect: latest edit is override_update and after_data reflects your change
select
    e.candidate_table,
    e.candidate_id,
    e.edit_type,
    e.created_at,
    e.after_data
from import_review.review_candidate_edits e
where (e.candidate_table, e.candidate_id) in (
    values
        ('road_candidates', 1021::bigint),
        ('place_candidates', 2042::bigint),
        ('building_candidates', 3055::bigint),
        ('land_area_candidates', 4066::bigint),
        ('water_line_candidates', 5077::bigint),
        ('water_polygon_candidates', 6088::bigint),
        ('admin_area_candidates', 7099::bigint),
        ('routing_barrier_candidates', 8100::bigint)
)
order by e.candidate_table, e.created_at desc;

-- 9b) Expect: updated_at within last hour (adjust interval as needed)
select 'road_candidates' as family, id, updated_at, updated_at >= now() - interval '1 hour' as updated_recently
from import_review.road_candidates where id = 1021
union all
select 'place_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.place_candidates where id = 2042
union all
select 'building_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.building_candidates where id = 3055
union all
select 'land_area_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.land_area_candidates where id = 4066
union all
select 'water_line_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.water_line_candidates where id = 5077
union all
select 'water_polygon_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.water_polygon_candidates where id = 6088
union all
select 'admin_area_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.admin_area_candidates where id = 7099
union all
select 'routing_barrier_candidates', id, updated_at, updated_at >= now() - interval '1 hour'
from import_review.routing_barrier_candidates where id = 8100
order by family;

-- 9c) Expect: review_overrides still empty {} (pre-084 only; skip if section 0 has_review_overrides = false)
-- Compare review_overrides_md5 before and after save — must match.
-- Fails after migration 084 if review_overrides column was dropped.
select 'road_candidates' as family, id, review_overrides = '{}'::jsonb as overrides_empty
from import_review.road_candidates where id = 1021
union all
select 'place_candidates', id, review_overrides = '{}'::jsonb
from import_review.place_candidates where id = 2042
union all
select 'building_candidates', id, review_overrides = '{}'::jsonb
from import_review.building_candidates where id = 3055
union all
select 'land_area_candidates', id, review_overrides = '{}'::jsonb
from import_review.land_area_candidates where id = 4066
union all
select 'water_line_candidates', id, review_overrides = '{}'::jsonb
from import_review.water_line_candidates where id = 5077
union all
select 'water_polygon_candidates', id, review_overrides = '{}'::jsonb
from import_review.water_polygon_candidates where id = 6088
union all
select 'admin_area_candidates', id, review_overrides = '{}'::jsonb
from import_review.admin_area_candidates where id = 7099
union all
select 'routing_barrier_candidates', id, review_overrides = '{}'::jsonb
from import_review.routing_barrier_candidates where id = 8100
order by family;
