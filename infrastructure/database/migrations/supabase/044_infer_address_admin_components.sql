-- =============================================================================
-- Supabase migration 044: infer address admin components from core admin areas
-- =============================================================================
--
-- Purpose:
--   For import_review.address_candidates with point_geom, infer structured
--   admin address_components from core.core_admin_areas (+ names), respecting
--   boundary_status and address_usage. Updates matched_admin_area_id and
--   admin_match_* on the candidate row.
--
-- Safety:
--   - Idempotent inserts (dedupe on candidate + type + language + value).
--   - Never UPDATE/DELETE existing components; skips is_reviewed = true slots.
--   - Callable via API: SELECT * FROM import_review.infer_address_admin_components($1);
--
-- Depends on: 037 (admin metadata), 040–043 (components + candidates).
--
-- =============================================================================

begin;

create schema if not exists import_review;

-- ---------------------------------------------------------------------------
-- Confidence helper (0–100 integer)
-- ---------------------------------------------------------------------------
create or replace function import_review.admin_infer_confidence_score(
    p_match_type text,
    p_boundary_status text,
    p_boundary_confidence numeric
)
returns integer
language sql
immutable
as $$
    select greatest(
        0,
        least(
            100,
            case p_match_type
                when 'point_in_polygon_official' then greatest(
                    85,
                    least(
                        95,
                        round(
                            coalesce(p_boundary_confidence, 90) * 0.95
                            + case p_boundary_status
                                when 'surveyed' then 0
                                else 2
                              end
                        )::integer
                    )
                )
                when 'point_in_polygon_locality_hint' then greatest(
                    55,
                    least(
                        75,
                        round(
                            coalesce(
                                p_boundary_confidence,
                                case p_boundary_status
                                    when 'settlement_extent' then 60
                                    else 65
                                end
                            )
                        )::integer
                    )
                )
                when 'nearest_centroid_hint' then greatest(
                    40,
                    least(
                        60,
                        round(coalesce(p_boundary_confidence, 50) * 0.85)::integer
                    )
                )
                when 'parent_fallback' then greatest(
                    30,
                    least(
                        50,
                        round(coalesce(p_boundary_confidence, 40) * 0.55)::integer
                    )
                )
                else 30
            end
        )
    );
$$;

comment on function import_review.admin_infer_confidence_score(text, text, numeric) is
    'Maps admin spatial match_type + boundary metadata to a 0–100 confidence score for address_components.';

-- ---------------------------------------------------------------------------
-- Map ref_admin_levels.code → ref_address_component_types.code
-- ---------------------------------------------------------------------------
create or replace function import_review.admin_level_to_component_type(p_admin_level_code text)
returns text
language sql
immutable
as $$
    select case lower(trim(coalesce(p_admin_level_code, '')))
        when 'state_region' then 'region'
        when 'state' then 'region'
        when 'division' then 'region'
        when 'country' then 'country'
        else lower(trim(p_admin_level_code))
    end;
$$;

-- ---------------------------------------------------------------------------
-- Batch inference
-- ---------------------------------------------------------------------------
create or replace function import_review.infer_address_admin_components(
    p_review_batch_id bigint,
    p_nearest_village_meters double precision default 3000
)
returns table (
    candidates_with_point bigint,
    candidates_matched bigint,
    components_inserted bigint,
    candidates_updated bigint
)
language plpgsql
as $func$
declare
    v_with_point bigint;
    v_matched bigint;
    v_inserted bigint;
    v_updated bigint;
begin
    if p_review_batch_id is null then
        raise exception 'review_batch_id is required';
    end if;

    if to_regclass('import_review.address_candidates') is null
        or to_regclass('import_review.address_components') is null
        or to_regclass('core.core_admin_areas') is null then
        raise exception '044 inference requires import_review address tables and core.core_admin_areas';
    end if;

    create temp table _infer_primary_match on commit drop as
    with batch_candidates as (
        select
            c.id as candidate_id,
            c.point_geom
        from import_review.address_candidates as c
        where c.review_batch_id = p_review_batch_id
          and c.point_geom is not null
          and not st_isempty(c.point_geom)
    ),
    containing as (
        select
            bc.candidate_id,
            aa.id as admin_area_id,
            aa.parent_id,
            aa.admin_level_id,
            al.code as admin_level_code,
            al.rank as admin_level_rank,
            aa.boundary_status,
            aa.address_usage,
            aa.boundary_confidence_score,
            aa.canonical_name,
            st_area(aa.geom::geography) as area_m2,
            case
                when aa.address_usage = 'official'
                     and aa.boundary_status in ('official', 'surveyed')
                    then 'point_in_polygon_official'
                when aa.address_usage = 'locality_hint'
                     and aa.boundary_status in ('approximate', 'settlement_extent')
                    then 'point_in_polygon_locality_hint'
                else null
            end as match_type
        from batch_candidates as bc
        inner join core.core_admin_areas as aa
            on aa.geom is not null
           and not st_isempty(aa.geom)
           and aa.is_active is true
           and aa.deleted_at is null
           and aa.address_usage not in ('search_only', 'disabled')
           and (
               st_covers(aa.geom, bc.point_geom)
               or st_intersects(aa.geom, bc.point_geom)
           )
        inner join ref.ref_admin_levels as al
            on al.id = aa.admin_level_id
    ),
    ranked_containing as (
        select
            c.*,
            row_number() over (
                partition by c.candidate_id
                order by
                    case c.match_type
                        when 'point_in_polygon_official' then 1
                        when 'point_in_polygon_locality_hint' then 2
                        else 9
                    end,
                    c.admin_level_rank asc,
                    c.area_m2 asc nulls last,
                    c.admin_area_id asc
            ) as rn
        from containing as c
        where c.match_type is not null
    ),
    primary_containing as (
        select *
        from ranked_containing
        where rn = 1
    ),
    village_containing as (
        select distinct c.candidate_id
        from containing as c
        where c.admin_level_code = 'village'
    ),
    nearest_village as (
        select
            bc.candidate_id,
            pick.admin_area_id,
            pick.parent_id,
            pick.admin_level_id,
            pick.admin_level_code,
            pick.admin_level_rank,
            pick.boundary_status,
            pick.address_usage,
            pick.boundary_confidence_score,
            pick.canonical_name,
            pick.dist_m,
            'nearest_centroid_hint'::text as match_type
        from batch_candidates as bc
        left join village_containing as vc
            on vc.candidate_id = bc.candidate_id
        inner join lateral (
            select
                aa.id as admin_area_id,
                aa.parent_id,
                aa.admin_level_id,
                al.code as admin_level_code,
                al.rank as admin_level_rank,
                aa.boundary_status,
                aa.address_usage,
                aa.boundary_confidence_score,
                aa.canonical_name,
                st_distance(aa.centroid::geography, bc.point_geom::geography) as dist_m
            from core.core_admin_areas as aa
            inner join ref.ref_admin_levels as al
                on al.id = aa.admin_level_id
            where al.code = 'village'
              and aa.centroid is not null
              and not st_isempty(aa.centroid)
              and aa.is_active is true
              and aa.deleted_at is null
              and aa.address_usage not in ('search_only', 'disabled')
              and st_dwithin(
                  aa.centroid::geography,
                  bc.point_geom::geography,
                  p_nearest_village_meters
              )
            order by st_distance(aa.centroid::geography, bc.point_geom::geography) asc
            limit 1
        ) as pick on vc.candidate_id is null
        where vc.candidate_id is null
          and pick.admin_area_id is not null
    ),
    primary_match as (
        select
            bc.candidate_id,
            coalesce(pc.admin_area_id, nv.admin_area_id) as admin_area_id,
            coalesce(pc.parent_id, nv.parent_id) as parent_id,
            coalesce(pc.admin_level_id, nv.admin_level_id) as admin_level_id,
            coalesce(pc.admin_level_code, nv.admin_level_code) as admin_level_code,
            coalesce(pc.boundary_status, nv.boundary_status) as boundary_status,
            coalesce(pc.address_usage, nv.address_usage) as address_usage,
            coalesce(pc.boundary_confidence_score, nv.boundary_confidence_score) as boundary_confidence_score,
            coalesce(pc.canonical_name, nv.canonical_name) as canonical_name,
            coalesce(pc.match_type, nv.match_type) as match_type
        from batch_candidates as bc
        left join primary_containing as pc
            on pc.candidate_id = bc.candidate_id
        left join nearest_village as nv
            on nv.candidate_id = bc.candidate_id
           and pc.candidate_id is null
        where coalesce(pc.admin_area_id, nv.admin_area_id) is not null
    )
    select
        pm.*,
        import_review.admin_infer_confidence_score(
            pm.match_type,
            pm.boundary_status,
            pm.boundary_confidence_score
        ) as confidence_score
    from primary_match as pm;

    select count(*)::bigint into v_with_point
    from import_review.address_candidates as c
    where c.review_batch_id = p_review_batch_id
      and c.point_geom is not null
      and not st_isempty(c.point_geom);

    select count(*)::bigint into v_matched
    from _infer_primary_match;

    create temp table _infer_village_hints on commit drop as
    with batch_candidates as (
        select
            c.id as candidate_id,
            c.point_geom
        from import_review.address_candidates as c
        where c.review_batch_id = p_review_batch_id
          and c.point_geom is not null
          and not st_isempty(c.point_geom)
    ),
    village_containing as (
        select distinct bc.candidate_id
        from batch_candidates as bc
        inner join core.core_admin_areas as aa
            on aa.geom is not null
           and not st_isempty(aa.geom)
           and aa.is_active is true
           and aa.deleted_at is null
           and aa.address_usage not in ('search_only', 'disabled')
           and (
               st_covers(aa.geom, bc.point_geom)
               or st_intersects(aa.geom, bc.point_geom)
           )
        inner join ref.ref_admin_levels as al
            on al.id = aa.admin_level_id
           and al.code = 'village'
    ),
    nearest_village as (
        select
            bc.candidate_id,
            pick.admin_area_id,
            pick.admin_level_code,
            pick.boundary_status,
            pick.address_usage,
            pick.boundary_confidence_score,
            pick.canonical_name,
            'nearest_centroid_hint'::text as match_type
        from batch_candidates as bc
        left join village_containing as vc
            on vc.candidate_id = bc.candidate_id
        inner join lateral (
            select
                aa.id as admin_area_id,
                al.code as admin_level_code,
                aa.boundary_status,
                aa.address_usage,
                aa.boundary_confidence_score,
                aa.canonical_name
            from core.core_admin_areas as aa
            inner join ref.ref_admin_levels as al
                on al.id = aa.admin_level_id
            where al.code = 'village'
              and aa.centroid is not null
              and not st_isempty(aa.centroid)
              and aa.is_active is true
              and aa.deleted_at is null
              and aa.address_usage not in ('search_only', 'disabled')
              and st_dwithin(
                  aa.centroid::geography,
                  bc.point_geom::geography,
                  p_nearest_village_meters
              )
            order by st_distance(aa.centroid::geography, bc.point_geom::geography) asc
            limit 1
        ) as pick on vc.candidate_id is null
        where vc.candidate_id is null
          and pick.admin_area_id is not null
    )
    select
        nv.candidate_id,
        nv.admin_area_id,
        nv.admin_level_code,
        nv.boundary_status,
        nv.address_usage,
        nv.match_type,
        import_review.admin_infer_confidence_score(
            nv.match_type,
            nv.boundary_status,
            nv.boundary_confidence_score
        ) as confidence_score,
        nv.canonical_name
    from nearest_village as nv;

    -- Parent chain + primary area → component rows (en / my / und)
    with recursive ancestor_chain as (
        select
            pm.candidate_id,
            aa.id as admin_area_id,
            aa.parent_id,
            aa.admin_level_id,
            al.code as admin_level_code,
            aa.boundary_status,
            aa.address_usage,
            aa.boundary_confidence_score,
            aa.canonical_name,
            pm.match_type,
            pm.confidence_score,
            0 as depth
        from _infer_primary_match as pm
        inner join core.core_admin_areas as aa
            on aa.id = pm.admin_area_id
        inner join ref.ref_admin_levels as al
            on al.id = aa.admin_level_id
        union all
        select
            ac.candidate_id,
            parent.id,
            parent.parent_id,
            parent.admin_level_id,
            al.code,
            parent.boundary_status,
            parent.address_usage,
            parent.boundary_confidence_score,
            parent.canonical_name,
            'parent_fallback'::text,
            import_review.admin_infer_confidence_score(
                'parent_fallback',
                parent.boundary_status,
                parent.boundary_confidence_score
            ),
            ac.depth + 1
        from ancestor_chain as ac
        inner join core.core_admin_areas as parent
            on parent.id = ac.parent_id
           and parent.is_active is true
           and parent.deleted_at is null
           and parent.address_usage not in ('search_only', 'disabled')
        inner join ref.ref_admin_levels as al
            on al.id = parent.admin_level_id
        where ac.parent_id is not null
          and ac.depth < 12
    ),
    admin_sources as (
        select
            ac.candidate_id,
            ac.admin_area_id,
            ac.admin_level_code,
            import_review.admin_level_to_component_type(ac.admin_level_code) as component_type_code,
            ac.boundary_status,
            ac.address_usage,
            case
                when ac.depth = 0 then ac.match_type
                else 'parent_fallback'
            end as match_type,
            case
                when ac.depth = 0 then ac.confidence_score
                else import_review.admin_infer_confidence_score(
                    'parent_fallback',
                    ac.boundary_status,
                    ac.boundary_confidence_score
                )
            end as confidence_score,
            ac.canonical_name
        from ancestor_chain as ac
        union all
        select
            evh.candidate_id,
            evh.admin_area_id,
            evh.admin_level_code,
            import_review.admin_level_to_component_type(evh.admin_level_code) as component_type_code,
            evh.boundary_status,
            evh.address_usage,
            evh.match_type,
            evh.confidence_score,
            evh.canonical_name
        from _infer_village_hints as evh
        where not exists (
            select 1
            from ancestor_chain as ac2
            where ac2.candidate_id = evh.candidate_id
              and ac2.admin_level_code = 'village'
        )
    ),
    typed_sources as (
        select s.*
        from admin_sources as s
        inner join ref.ref_address_component_types as rt
            on rt.code = s.component_type_code
           and rt.is_admin_component is true
    ),
    name_en as (
        select distinct on (ts.candidate_id, ts.admin_area_id)
            ts.candidate_id,
            ts.admin_area_id,
            ts.component_type_code,
            ts.boundary_status,
            ts.address_usage,
            ts.match_type,
            ts.confidence_score,
            n.name as component_value,
            'en'::text as language_code
        from typed_sources as ts
        inner join lateral (
            select n.name
            from core.core_admin_area_names as n
            where n.admin_area_id = ts.admin_area_id
              and (
                  lower(trim(coalesce(n.language_code, ''))) = 'en'
                  or upper(trim(coalesce(n.script_code, ''))) = 'LATN'
              )
              and btrim(coalesce(n.name, '')) <> ''
            order by
                case
                    when n.name_type = 'official' and n.is_primary = true then 1
                    when n.is_primary = true then 2
                    when n.name_type = 'official' then 3
                    else 4
                end,
                n.search_weight desc nulls last,
                n.name asc
            limit 1
        ) as n on true
    ),
    name_my as (
        select distinct on (ts.candidate_id, ts.admin_area_id)
            ts.candidate_id,
            ts.admin_area_id,
            ts.component_type_code,
            ts.boundary_status,
            ts.address_usage,
            ts.match_type,
            ts.confidence_score,
            n.name as component_value,
            'my'::text as language_code
        from typed_sources as ts
        inner join lateral (
            select n.name
            from core.core_admin_area_names as n
            where n.admin_area_id = ts.admin_area_id
              and (
                  lower(trim(coalesce(n.language_code, ''))) in ('my', 'mm')
                  or upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
              )
              and btrim(coalesce(n.name, '')) <> ''
            order by
                case
                    when n.name_type = 'official' and n.is_primary = true then 1
                    when n.is_primary = true then 2
                    when n.name_type = 'official' then 3
                    else 4
                end,
                n.search_weight desc nulls last,
                n.name asc
            limit 1
        ) as n on true
    ),
    name_und as (
        select
            ts.candidate_id,
            ts.admin_area_id,
            ts.component_type_code,
            ts.boundary_status,
            ts.address_usage,
            ts.match_type,
            ts.confidence_score,
            coalesce(
                nullif(trim(n_und.name), ''),
                nullif(trim(ts.canonical_name), '')
            ) as component_value,
            'und'::text as language_code
        from typed_sources as ts
        left join lateral (
            select n.name
            from core.core_admin_area_names as n
            where n.admin_area_id = ts.admin_area_id
              and lower(trim(coalesce(n.language_code, ''))) = 'und'
              and btrim(coalesce(n.name, '')) <> ''
            order by
                n.is_primary desc nulls last,
                n.search_weight desc nulls last,
                n.name asc
            limit 1
        ) as n_und on true
    ),
    all_names as (
        select * from name_en
        union all
        select * from name_my
        union all
        select * from name_und
        where component_value is not null
          and btrim(component_value) <> ''
    ),
    to_insert as (
        select distinct on (
            an.candidate_id,
            an.component_type_code,
            an.language_code,
            an.component_value
        )
            an.candidate_id,
            an.component_type_code,
            an.component_value,
            an.language_code,
            an.match_type,
            an.confidence_score,
            an.admin_area_id as source_admin_area_id,
            an.boundary_status,
            an.address_usage,
            rt.id as component_type_id,
            rt.rank as sort_order
        from all_names as an
        inner join ref.ref_address_component_types as rt
            on rt.code = an.component_type_code
        where not exists (
            select 1
            from import_review.address_components as ac
            where ac.address_candidate_id = an.candidate_id
              and ac.component_type_code = an.component_type_code
              and ac.language_code = an.language_code
              and ac.component_value = an.component_value
              and ac.is_deleted = false
        )
          and not exists (
            select 1
            from import_review.address_components as ac
            where ac.address_candidate_id = an.candidate_id
              and ac.component_type_code = an.component_type_code
              and ac.language_code = an.language_code
              and ac.is_reviewed = true
              and ac.is_deleted = false
        )
        order by
            an.candidate_id,
            an.component_type_code,
            an.language_code,
            an.component_value,
            an.confidence_score desc
    )
    insert into import_review.address_components (
        address_candidate_id,
        component_type_id,
        component_type_code,
        component_value,
        language_code,
        source_tag,
        sort_order,
        confidence_score,
        match_type,
        is_inferred,
        is_reviewed,
        is_deleted,
        source_refs,
        normalized_data,
        source_admin_area_id,
        boundary_status,
        address_usage
    )
    select
        ti.candidate_id,
        ti.component_type_id,
        ti.component_type_code,
        ti.component_value,
        ti.language_code,
        'admin_infer:044'::text,
        ti.sort_order,
        ti.confidence_score,
        ti.match_type,
        true,
        false,
        false,
        jsonb_build_object(
            'inference', '044',
            'source_admin_area_id', ti.source_admin_area_id,
            'admin_level_component', ti.component_type_code
        ),
        jsonb_build_object('inference', '044'),
        ti.source_admin_area_id,
        ti.boundary_status,
        ti.address_usage
    from to_insert as ti;

    get diagnostics v_inserted = row_count;

    update import_review.address_candidates as c
    set
        matched_admin_area_id = pm.admin_area_id,
        admin_match_type = pm.match_type,
        admin_match_confidence = pm.confidence_score,
        updated_at = now()
    from _infer_primary_match as pm
    where c.id = pm.candidate_id;

    get diagnostics v_updated = row_count;

    update import_review.address_candidates as c
    set
        matched_admin_area_id = null,
        admin_match_type = null,
        admin_match_confidence = null,
        updated_at = now()
    where c.review_batch_id = p_review_batch_id
      and c.point_geom is not null
      and not st_isempty(c.point_geom)
      and not exists (
          select 1
          from _infer_primary_match as pm
          where pm.candidate_id = c.id
      )
      and (
          c.matched_admin_area_id is not null
          or c.admin_match_type is not null
          or c.admin_match_confidence is not null
      );

    return query
    select
        v_with_point,
        v_matched,
        v_inserted,
        v_updated;
end;
$func$;

comment on function import_review.infer_address_admin_components(bigint, double precision) is
    'Infer import_review.address_components from core admin polygons/names for a review batch. '
    'Idempotent; does not modify is_reviewed components.';

commit;

-- =============================================================================
-- Verification (read-only; substitute :review_batch_id)
-- =============================================================================

-- 1) Candidates with matched_admin_area_id (batch scope)
-- select
--     count(*) filter (where matched_admin_area_id is not null)::bigint as matched_count,
--     count(*)::bigint as total_with_point
-- from import_review.address_candidates
-- where review_batch_id = :review_batch_id
--   and point_geom is not null;

-- 2) Inferred admin components by type and language
-- select
--     component_type_code,
--     language_code,
--     count(*)::bigint as row_count
-- from import_review.address_components ac
-- inner join import_review.address_candidates c on c.id = ac.address_candidate_id
-- where c.review_batch_id = :review_batch_id
--   and ac.is_deleted = false
--   and ac.source_admin_area_id is not null
-- group by 1, 2
-- order by 1, 2;

-- 3) Sample components with boundary metadata
-- select
--     ac.address_candidate_id,
--     ac.component_type_code,
--     ac.language_code,
--     ac.component_value,
--     ac.match_type,
--     ac.confidence_score,
--     ac.boundary_status,
--     ac.address_usage,
--     ac.source_admin_area_id
-- from import_review.address_components ac
-- inner join import_review.address_candidates c on c.id = ac.address_candidate_id
-- where c.review_batch_id = :review_batch_id
--   and ac.source_admin_area_id is not null
--   and ac.is_deleted = false
-- order by ac.address_candidate_id, ac.component_type_code, ac.language_code
-- limit 30;
