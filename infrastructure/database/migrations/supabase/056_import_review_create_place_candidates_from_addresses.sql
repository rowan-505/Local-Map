-- =============================================================================
-- Supabase migration 056: create place candidates from POI-like addresses
-- =============================================================================
--
-- Purpose:
--   Repair current import_review data by creating or linking place candidates for
--   address candidates classified as place_only or place_with_address.
--
-- Safety:
--   - Idempotent: reuses an existing same-batch/source place candidate when found.
--   - Does not modify core tables.
--   - Does not promote anything.
--   - Does not write source names into address_components.
--   - Uses negative address candidate ids as synthetic place local_staging_id values
--     to avoid collisions with staging-derived place local ids.
--
-- Depends on:
--   - 053_import_review_address_source_classification.sql
--   - 054_import_review_address_source_classification_backfill.sql
--   - 055_import_review_place_address_links.sql
--
-- =============================================================================

begin;

do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise exception '056 repair requires import_review.address_candidates';
    end if;

    if to_regclass('import_review.place_candidates') is null then
        raise exception '056 repair requires existing import_review.place_candidates';
    end if;

    if to_regclass('import_review.place_address_links') is null then
        raise exception '056 repair requires import_review.place_address_links';
    end if;

    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'address_candidates'
          and column_name = 'linked_place_candidate_id'
    ) then
        raise exception '056 repair requires migration 053 linked_place_candidate_id column';
    end if;
end
$migration$;

with
eligible_addresses as (
    select
        a.id as address_candidate_id,
        a.review_batch_id,
        coalesce(a.source_snapshot_id, a.source_snapshot_id_local) as source_snapshot_id,
        a.source_snapshot_version,
        a.source_snapshot_id_local,
        a.external_id,
        a.source_entity_type,
        a.source_classification,
        a.address_strength,
        a.classification_reasons,
        a.confidence_score,
        a.point_geom,
        a.matched_core_id,
        a.matched_core_table,
        a.matched_core_data,
        a.matched_core_place_id,
        a.source_refs,
        a.source_tags,
        a.normalized_data,
        (
            case
                when jsonb_typeof(a.source_refs) = 'object' then a.source_refs
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(a.source_refs -> 'tags') = 'object' then a.source_refs -> 'tags'
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(a.normalized_data -> 'tags') = 'object' then a.normalized_data -> 'tags'
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(a.source_tags) = 'object' then a.source_tags
                else '{}'::jsonb
            end
        ) as tags
    from import_review.address_candidates as a
    where a.source_classification in ('place_only', 'place_with_address')
),
source_details as (
    select
        e.*,
        nullif(btrim(e.tags ->> 'name'), '') as name_und,
        nullif(btrim(e.tags ->> 'name:en'), '') as name_en,
        nullif(btrim(e.tags ->> 'name:my'), '') as name_my,
        nullif(btrim(e.tags ->> 'name:mm'), '') as name_mm,
        nullif(btrim(coalesce(
            e.tags ->> 'name',
            e.tags ->> 'name:en',
            e.tags ->> 'name:my',
            e.tags ->> 'name:mm'
        )), '') as source_name,
        coalesce(
            nullif(btrim(e.tags ->> 'amenity'), ''),
            nullif(btrim(e.tags ->> 'shop'), ''),
            nullif(btrim(e.tags ->> 'tourism'), ''),
            nullif(btrim(e.tags ->> 'leisure'), ''),
            nullif(btrim(e.tags ->> 'office'), ''),
            nullif(btrim(e.tags ->> 'healthcare'), ''),
            nullif(btrim(e.tags ->> 'public_transport'), ''),
            nullif(btrim(e.tags ->> 'religion'), ''),
            nullif(btrim(e.tags ->> 'building'), ''),
            nullif(btrim(e.tags ->> 'social_facility'), ''),
            nullif(btrim(e.tags ->> 'school'), ''),
            nullif(btrim(e.tags ->> 'education'), ''),
            nullif(btrim(e.tags ->> 'highway'), '')
        ) as source_type,
        case
            when nullif(btrim(e.tags ->> 'amenity'), '') is not null then 'amenity'
            when nullif(btrim(e.tags ->> 'shop'), '') is not null then 'shop'
            when nullif(btrim(e.tags ->> 'tourism'), '') is not null then 'tourism'
            when nullif(btrim(e.tags ->> 'leisure'), '') is not null then 'leisure'
            when nullif(btrim(e.tags ->> 'office'), '') is not null then 'office'
            when nullif(btrim(e.tags ->> 'healthcare'), '') is not null then 'healthcare'
            when nullif(btrim(e.tags ->> 'public_transport'), '') is not null then 'public_transport'
            when nullif(btrim(e.tags ->> 'religion'), '') is not null then 'religion'
            when nullif(btrim(e.tags ->> 'building'), '') is not null then 'building'
            when nullif(btrim(e.tags ->> 'social_facility'), '') is not null then 'social_facility'
            when nullif(btrim(e.tags ->> 'school'), '') is not null then 'school'
            when nullif(btrim(e.tags ->> 'education'), '') is not null then 'education'
            when nullif(btrim(e.tags ->> 'highway'), '') is not null then 'highway'
            else null
        end as source_type_key,
        coalesce(
            nullif(btrim(e.source_entity_type), ''),
            nullif(btrim(e.source_refs ->> 'osm_feature_type'), ''),
            nullif(btrim(e.source_refs ->> 'source_entity_type'), '')
        ) as source_entity_type_resolved,
        nullif(btrim(coalesce(e.tags ->> 'phone', e.tags ->> 'contact:phone')), '') as phone,
        nullif(btrim(coalesce(e.tags ->> 'email', e.tags ->> 'contact:email')), '') as email,
        nullif(btrim(e.tags ->> 'opening_hours'), '') as opening_hours
    from eligible_addresses as e
),
name_rows as (
    select
        d.address_candidate_id,
        n.sort_order,
        n.source_tag,
        n.name,
        n.language_code,
        n.is_primary
    from source_details as d
    cross join lateral (
        values
            (10, 'name', d.name_und, 'und', true),
            (20, 'name:en', d.name_en, 'en', d.name_und is null),
            (30, 'name:my', d.name_my, 'my', d.name_und is null and d.name_en is null),
            (40, 'name:mm', d.name_mm, 'my', d.name_und is null and d.name_en is null and d.name_my is null)
    ) as n(sort_order, source_tag, name, language_code, is_primary)
    where nullif(btrim(n.name), '') is not null
),
name_payloads as (
    select
        nr.address_candidate_id,
        jsonb_agg(
            jsonb_build_object(
                'name',
                nr.name,
                'language_code',
                nr.language_code,
                'script_code',
                null,
                'name_type',
                'official',
                'is_primary',
                nr.is_primary,
                'search_weight',
                100,
                'source_tag',
                nr.source_tag,
                'source',
                'address_source_classification_repair_056',
                'normalized_data',
                jsonb_build_object(
                    'source_tag',
                    nr.source_tag,
                    'created_from_address_candidate_id',
                    nr.address_candidate_id::text
                )
            )
            order by nr.sort_order
        ) as place_name_candidates
    from name_rows as nr
    group by nr.address_candidate_id
),
candidate_source as (
    select
        d.*,
        coalesce(np.place_name_candidates, '[]'::jsonb) as place_name_candidates,
        least(100, greatest(0, coalesce(d.confidence_score, 65))) as place_confidence_score,
        coalesce(nullif(btrim(d.source_name), ''), d.external_id, 'Address source ' || d.address_candidate_id::text) as place_name,
        (
            coalesce(d.normalized_data, '{}'::jsonb)
            || jsonb_strip_nulls(
                jsonb_build_object(
                    'created_from',
                    'import_review.address_candidates',
                    'created_from_address_candidate_id',
                    d.address_candidate_id::text,
                    'created_by_migration',
                    '056_import_review_create_place_candidates_from_addresses',
                    'source_classification',
                    d.source_classification,
                    'address_strength',
                    d.address_strength,
                    'classification_reasons',
                    coalesce(d.classification_reasons, '[]'::jsonb),
                    'tags',
                    d.tags,
                    'source_name',
                    d.source_name,
                    'source_name_en',
                    d.name_en,
                    'source_name_my',
                    d.name_my,
                    'source_type',
                    d.source_type,
                    'source_type_key',
                    d.source_type_key,
                    'source_entity_type',
                    d.source_entity_type_resolved,
                    'phone',
                    d.phone,
                    'email',
                    d.email,
                    'opening_hours',
                    d.opening_hours,
                    'place_name_candidates',
                    coalesce(np.place_name_candidates, '[]'::jsonb)
                )
            )
        ) as place_normalized_data,
        (
            coalesce(d.source_refs, '{}'::jsonb)
            || jsonb_strip_nulls(
                jsonb_build_object(
                    'created_from',
                    'import_review.address_candidates',
                    'source_address_candidate_id',
                    d.address_candidate_id::text,
                    'source_classification',
                    d.source_classification,
                    'address_strength',
                    d.address_strength,
                    'tags',
                    d.tags,
                    'source_entity_type',
                    d.source_entity_type_resolved,
                    'place_name_candidates',
                    coalesce(np.place_name_candidates, '[]'::jsonb)
                )
            )
        ) as place_source_refs
    from source_details as d
    left join name_payloads as np
        on np.address_candidate_id = d.address_candidate_id
),
existing_places as (
    select distinct on (cs.address_candidate_id)
        cs.address_candidate_id,
        p.id as place_candidate_id,
        p.matched_core_id
    from candidate_source as cs
    inner join import_review.place_candidates as p
        on p.review_batch_id = cs.review_batch_id
       and (
           (
               cs.external_id is not null
               and p.external_id = cs.external_id
           )
           or p.normalized_data ->> 'created_from_address_candidate_id' = cs.address_candidate_id::text
           or p.source_refs ->> 'source_address_candidate_id' = cs.address_candidate_id::text
           or p.local_staging_id = -cs.address_candidate_id
       )
    order by
        cs.address_candidate_id,
        case
            when cs.external_id is not null and p.external_id = cs.external_id then 1
            when p.normalized_data ->> 'created_from_address_candidate_id' = cs.address_candidate_id::text then 2
            when p.source_refs ->> 'source_address_candidate_id' = cs.address_candidate_id::text then 3
            else 4
        end,
        p.id
),
to_insert as (
    select cs.*
    from candidate_source as cs
    where not exists (
        select 1
        from existing_places as ep
        where ep.address_candidate_id = cs.address_candidate_id
    )
),
inserted_places as (
    insert into import_review.place_candidates (
        review_batch_id,
        source_snapshot_version,
        source_snapshot_id_local,
        local_staging_id,
        entity_family,
        external_id,
        canonical_name,
        class_code,
        confidence_score,
        match_status,
        auto_action,
        review_status,
        review_decision,
        normalized_data,
        source_refs,
        matched_core_id,
        matched_core_table,
        matched_core_data,
        f2_comparison,
        primary_name,
        display_name,
        category_id,
        place_class_id,
        admin_area_id,
        point_geom,
        lat,
        lng,
        promotion_status,
        updated_at
    )
    select
        ti.review_batch_id,
        ti.source_snapshot_version,
        ti.source_snapshot_id_local,
        -ti.address_candidate_id,
        'places',
        ti.external_id,
        ti.place_name,
        ti.source_type,
        ti.place_confidence_score,
        'new_auto',
        'insert_candidate',
        'pending',
        null,
        ti.place_normalized_data,
        ti.place_source_refs,
        case
            when ti.matched_core_table = 'core_places' then ti.matched_core_id
            else null
        end,
        case
            when ti.matched_core_table = 'core_places' then ti.matched_core_table
            else null
        end,
        case
            when ti.matched_core_table = 'core_places' then ti.matched_core_data
            else null
        end,
        null,
        ti.place_name,
        ti.place_name,
        null,
        null,
        null,
        ti.point_geom,
        case when ti.point_geom is not null then st_y(ti.point_geom)::double precision end,
        case when ti.point_geom is not null then st_x(ti.point_geom)::double precision end,
        'not_ready',
        now()
    from to_insert as ti
    returning
        id as place_candidate_id,
        (normalized_data ->> 'created_from_address_candidate_id')::bigint as address_candidate_id,
        matched_core_id
),
all_place_links as (
    select
        ep.address_candidate_id,
        ep.place_candidate_id,
        ep.matched_core_id
    from existing_places as ep

    union all

    select
        ip.address_candidate_id,
        ip.place_candidate_id,
        ip.matched_core_id
    from inserted_places as ip
),
updated_addresses as (
    update import_review.address_candidates as a
    set
        linked_place_candidate_id = apl.place_candidate_id,
        place_candidate_status = 'place_candidate_created',
        matched_core_place_id = coalesce(a.matched_core_place_id, apl.matched_core_id),
        updated_at = now()
    from all_place_links as apl
    where a.id = apl.address_candidate_id
      and (
          a.linked_place_candidate_id is distinct from apl.place_candidate_id
          or a.place_candidate_status is distinct from 'place_candidate_created'
          or (
              a.matched_core_place_id is null
              and apl.matched_core_id is not null
          )
      )
    returning
        a.id as address_candidate_id,
        a.linked_place_candidate_id,
        a.matched_core_place_id
),
link_candidates as (
    select
        cs.address_candidate_id,
        cs.review_batch_id,
        cs.source_snapshot_id,
        cs.external_id,
        apl.place_candidate_id,
        coalesce(cs.matched_core_place_id, apl.matched_core_id) as matched_core_place_id,
        case
            when cs.matched_core_table = 'core_addresses' then cs.matched_core_id
            else null
        end as matched_core_address_id,
        cs.place_confidence_score,
        cs.source_refs,
        cs.normalized_data,
        cs.tags,
        cs.source_classification,
        cs.address_strength,
        cs.classification_reasons
    from candidate_source as cs
    inner join all_place_links as apl
        on apl.address_candidate_id = cs.address_candidate_id
    where cs.source_classification = 'place_with_address'
      and cs.address_strength in ('partial', 'strong', 'full')
),
inserted_link_candidates as (
    insert into import_review.place_address_links (
        review_batch_id,
        source_snapshot_id,
        external_id,
        place_candidate_id,
        address_candidate_id,
        matched_core_place_id,
        matched_core_address_id,
        relation_type,
        is_primary,
        confidence_score,
        match_status,
        auto_action,
        review_status,
        validation_status,
        validation_errors,
        validation_warnings,
        promotion_status,
        source_refs,
        normalized_data,
        updated_at
    )
    select
        lc.review_batch_id,
        lc.source_snapshot_id,
        lc.external_id,
        lc.place_candidate_id,
        lc.address_candidate_id,
        lc.matched_core_place_id,
        lc.matched_core_address_id,
        'primary',
        true,
        lc.place_confidence_score,
        'new_auto',
        'insert_candidate',
        'pending',
        'not_checked',
        '[]'::jsonb,
        '[]'::jsonb,
        'not_ready',
        coalesce(lc.source_refs, '{}'::jsonb)
            || jsonb_build_object(
                'created_from',
                'import_review.address_candidates',
                'source_address_candidate_id',
                lc.address_candidate_id::text,
                'source_place_candidate_id',
                lc.place_candidate_id::text
            ),
        coalesce(lc.normalized_data, '{}'::jsonb)
            || jsonb_build_object(
                'created_by_migration',
                '056_import_review_create_place_candidates_from_addresses',
                'source_classification',
                lc.source_classification,
                'address_strength',
                lc.address_strength,
                'classification_reasons',
                coalesce(lc.classification_reasons, '[]'::jsonb),
                'tags',
                lc.tags
            ),
        now()
    from link_candidates as lc
    where not exists (
        select 1
        from import_review.place_address_links as existing
        where existing.review_batch_id = lc.review_batch_id
          and existing.place_candidate_id = lc.place_candidate_id
          and existing.address_candidate_id = lc.address_candidate_id
          and existing.relation_type = 'primary'
    )
    returning id
)
select
    (select count(*)::bigint from inserted_places) as inserted_place_candidates,
    (select count(*)::bigint from existing_places) as reused_existing_place_candidates,
    (select count(*)::bigint from updated_addresses) as linked_address_candidates_updated,
    (select count(*)::bigint from inserted_link_candidates) as inserted_place_address_links;

commit;

-- =============================================================================
-- Manual verification SQL
-- =============================================================================
--
-- 1) Count created place candidates:
-- select
--     count(*)::bigint as created_place_candidates
-- from import_review.place_candidates
-- where normalized_data ->> 'created_from_address_candidate_id' is not null
--    or source_refs ->> 'source_address_candidate_id' is not null;
--
-- 2) Count linked address candidates:
-- select
--     source_classification,
--     place_candidate_status,
--     count(*)::bigint as address_count,
--     count(*) filter (where linked_place_candidate_id is not null)::bigint as linked_count
-- from import_review.address_candidates
-- where source_classification in ('place_only', 'place_with_address')
-- group by source_classification, place_candidate_status
-- order by source_classification, place_candidate_status;
--
-- 3) Count place_address_links:
-- select
--     relation_type,
--     review_status,
--     promotion_status,
--     count(*)::bigint as link_count
-- from import_review.place_address_links
-- group by relation_type, review_status, promotion_status
-- order by relation_type, review_status, promotion_status;
--
-- 4) Sample linked rows:
-- with source_tags as (
--     select
--         a.id,
--         (
--             case
--                 when jsonb_typeof(a.source_refs) = 'object' then a.source_refs
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(a.source_refs -> 'tags') = 'object' then a.source_refs -> 'tags'
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(a.normalized_data -> 'tags') = 'object' then a.normalized_data -> 'tags'
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(a.source_tags) = 'object' then a.source_tags
--                 else '{}'::jsonb
--             end
--         ) as tags
--     from import_review.address_candidates as a
-- )
-- select
--     a.external_id,
--     nullif(btrim(coalesce(
--         st.tags ->> 'name',
--         st.tags ->> 'name:en',
--         st.tags ->> 'name:my',
--         st.tags ->> 'name:mm'
--     )), '') as source_name,
--     a.source_classification,
--     a.address_strength,
--     a.linked_place_candidate_id,
--     p.primary_name as linked_place_name,
--     pal.id as place_address_link_id
-- from import_review.address_candidates as a
-- left join source_tags as st
--     on st.id = a.id
-- left join import_review.place_candidates as p
--     on p.id = a.linked_place_candidate_id
-- left join import_review.place_address_links as pal
--     on pal.address_candidate_id = a.id
--    and pal.place_candidate_id = a.linked_place_candidate_id
-- where a.source_classification in ('place_only', 'place_with_address')
-- order by a.updated_at desc, a.id
-- limit 30;
