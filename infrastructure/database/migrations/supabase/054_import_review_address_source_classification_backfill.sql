-- =============================================================================
-- Supabase migration 054: backfill import_review address source classification
-- =============================================================================
--
-- Purpose:
--   Classify existing import_review.address_candidates without rerunning the
--   local OSM pipeline. This separates POI-like source features from real address
--   candidates before any promotion step.
--
-- Safety:
--   - Idempotent: classification is recomputed from current source metadata.
--   - Does not delete data.
--   - Does not change review_status.
--   - Does not change promotion_status.
--   - Preserves manually advanced place_candidate_status values:
--     place_candidate_created, matched_core_place, ignored.
--
-- =============================================================================

begin;

do $migration$
begin
    if to_regclass('import_review.address_candidates') is null then
        raise exception '054 backfill requires import_review.address_candidates';
    end if;

    if to_regclass('import_review.address_components') is null then
        raise exception '054 backfill requires import_review.address_components';
    end if;

    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = 'address_candidates'
          and column_name = 'source_classification'
    ) then
        raise exception '054 backfill requires migration 053 source classification columns';
    end if;
end
$migration$;

with
component_flags as (
    select
        ac.address_candidate_id,
        bool_or(ac.component_type_code = 'house_number') as has_component_house_number,
        bool_or(ac.component_type_code = 'street') as has_component_street,
        bool_or(ac.component_type_code = 'postcode') as has_component_postcode,
        bool_or(ac.component_type_code = 'city') as has_component_city,
        bool_or(ac.component_type_code = 'country') as has_component_country,
        bool_or(
            ac.component_type_code in (
                'township',
                'district',
                'state_region',
                'quarter',
                'suburb',
                'ward',
                'village_tract',
                'village',
                'town'
            )
        ) as has_component_admin,
        bool_or(
            ac.source_admin_area_id is not null
            or nullif(btrim(coalesce(ac.boundary_status, '')), '') is not null
            or nullif(btrim(coalesce(ac.address_usage, '')), '') is not null
            or nullif(btrim(coalesce(ac.match_type, '')), '') is not null
        ) as has_inferred_admin_component,
        min(nullif(btrim(ac.component_value), '')) filter (
            where ac.component_type_code = 'house_number'
        ) as component_house_number_value
    from import_review.address_components as ac
    where coalesce(ac.is_deleted, false) = false
      and nullif(btrim(ac.component_value), '') is not null
    group by ac.address_candidate_id
),
source_rows as (
    select
        c.id,
        c.external_id,
        c.source_tags,
        c.normalized_data,
        c.source_refs,
        c.house_number,
        c.street_name,
        c.postcode,
        c.postal_code,
        c.city,
        c.township,
        c.district,
        c.state_region,
        c.quarter,
        c.suburb,
        c.country,
        c.matched_admin_area_id,
        c.place_candidate_status as existing_place_candidate_status,
        coalesce(cf.has_component_house_number, false) as has_component_house_number,
        coalesce(cf.has_component_street, false) as has_component_street,
        coalesce(cf.has_component_postcode, false) as has_component_postcode,
        coalesce(cf.has_component_city, false) as has_component_city,
        coalesce(cf.has_component_country, false) as has_component_country,
        coalesce(cf.has_component_admin, false) as has_component_admin,
        coalesce(cf.has_inferred_admin_component, false) as has_inferred_admin_component,
        cf.component_house_number_value,
        (
            case
                when jsonb_typeof(c.source_refs) = 'object' then c.source_refs
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(c.source_refs -> 'tags') = 'object' then c.source_refs -> 'tags'
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(c.normalized_data -> 'tags') = 'object' then c.normalized_data -> 'tags'
                else '{}'::jsonb
            end
            || case
                when jsonb_typeof(c.source_tags) = 'object' then c.source_tags
                else '{}'::jsonb
            end
        ) as tags
    from import_review.address_candidates as c
    left join component_flags as cf
        on cf.address_candidate_id = c.id
),
tagged as (
    select
        s.*,
        nullif(btrim(coalesce(
            s.tags ->> 'name',
            s.tags ->> 'name:en',
            s.tags ->> 'name:my',
            s.tags ->> 'name:mm'
        )), '') as source_name,
        nullif(btrim(s.tags ->> 'amenity'), '') as amenity_value,
        nullif(btrim(s.tags ->> 'shop'), '') as shop_value,
        nullif(btrim(s.tags ->> 'tourism'), '') as tourism_value,
        nullif(btrim(s.tags ->> 'leisure'), '') as leisure_value,
        nullif(btrim(s.tags ->> 'office'), '') as office_value,
        nullif(btrim(s.tags ->> 'healthcare'), '') as healthcare_value,
        nullif(btrim(s.tags ->> 'public_transport'), '') as public_transport_value,
        nullif(btrim(s.tags ->> 'highway'), '') as highway_value,
        nullif(btrim(s.tags ->> 'religion'), '') as religion_value,
        nullif(btrim(s.tags ->> 'building'), '') as building_value,
        nullif(btrim(s.tags ->> 'school'), '') as school_value,
        nullif(btrim(s.tags ->> 'education'), '') as education_value,
        nullif(btrim(s.tags ->> 'isced:level'), '') as isced_level_value,
        nullif(btrim(s.tags ->> 'social_facility'), '') as social_facility_value,
        nullif(btrim(s.tags ->> 'brand'), '') as brand_value,
        nullif(btrim(s.tags ->> 'operator'), '') as operator_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:housenumber',
            s.tags ->> 'addr:house_number',
            s.house_number,
            s.normalized_data ->> 'house_number',
            s.component_house_number_value
        )), '') as house_number_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:street',
            s.street_name,
            s.normalized_data ->> 'street_name'
        )), '') as street_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:postcode',
            s.postcode,
            s.postal_code,
            s.normalized_data ->> 'postcode',
            s.normalized_data ->> 'postal_code'
        )), '') as postcode_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:city',
            s.city,
            s.normalized_data ->> 'city'
        )), '') as city_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:country',
            s.normalized_data ->> 'country'
        )), '') as country_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:township',
            s.township,
            s.normalized_data ->> 'township'
        )), '') as township_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:district',
            s.district,
            s.normalized_data ->> 'district'
        )), '') as district_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:state',
            s.state_region,
            s.normalized_data ->> 'state_region'
        )), '') as state_region_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:quarter',
            s.quarter,
            s.normalized_data ->> 'quarter'
        )), '') as quarter_value,
        nullif(btrim(coalesce(
            s.tags ->> 'addr:suburb',
            s.suburb,
            s.normalized_data ->> 'suburb'
        )), '') as suburb_value
    from source_rows as s
),
evidence as (
    select
        t.*,
        t.source_name is not null as has_name,
        (
            t.amenity_value is not null
            or t.shop_value is not null
            or t.tourism_value is not null
            or t.leisure_value is not null
            or t.office_value is not null
            or t.healthcare_value is not null
            or t.public_transport_value is not null
            or lower(coalesce(t.highway_value, '')) in ('bus_stop', 'stop', 'platform', 'stop_position')
            or t.religion_value is not null
            or t.social_facility_value is not null
            or t.school_value is not null
            or t.education_value is not null
            or t.isced_level_value is not null
            or lower(coalesce(t.amenity_value, '')) in (
                'school',
                'college',
                'university',
                'kindergarten'
            )
            or (t.building_value is not null and t.source_name is not null)
            or ((t.brand_value is not null or t.operator_value is not null) and t.source_name is not null)
        ) as has_poi_category,
        (
            t.house_number_value is not null
            or t.has_component_house_number
        ) as has_house_number,
        (
            t.street_value is not null
            or t.has_component_street
        ) as has_street,
        (
            t.postcode_value is not null
            or t.has_component_postcode
        ) as has_postcode,
        (
            t.city_value is not null
            or t.has_component_city
        ) as has_city,
        (
            t.country_value is not null
            or t.has_component_country
        ) as has_country,
        (
            t.city_value is not null
            or t.township_value is not null
            or t.district_value is not null
            or t.state_region_value is not null
            or t.quarter_value is not null
            or t.suburb_value is not null
            or t.has_component_city
            or t.has_component_admin
            or t.matched_admin_area_id is not null
        ) as has_useful_locality_admin,
        (
            t.matched_admin_area_id is not null
            or t.has_inferred_admin_component
        ) as has_useful_admin_inferred
    from tagged as t
),
scored as (
    select
        e.*,
        (e.has_name and e.has_poi_category) as has_place_evidence,
        (
            e.has_house_number
            or e.has_street
            or e.has_postcode
            or e.has_city
            or e.has_country
        ) as has_address_evidence,
        (
            e.has_house_number
            and e.house_number_value is not null
            and (
                lower(e.house_number_value) ~ '(zone|area|block|ward|quarter|village|tract|compound|market|monastery|school|hospital)'
                or e.house_number_value ~ '(ဇုန်|ကွက်|ရပ်ကွက်|ကျေးရွာ|ဈေး|ကျောင်း|ဘုန်းကြီးကျောင်း|ဆေးရုံ)'
                or e.house_number_value !~ '[0-9၀-၉]'
            )
        ) as has_ambiguous_house_number
    from evidence as e
),
classified as (
    select
        s.*,
        case
            when s.has_house_number
                 and not s.has_ambiguous_house_number
                 and s.has_street
                 and s.has_useful_locality_admin
                 and (s.has_postcode or s.has_country)
                then 'full'
            when (
                s.has_house_number
                and not s.has_ambiguous_house_number
                and s.has_street
            ) or (
                s.has_house_number
                and not s.has_ambiguous_house_number
                and s.has_useful_locality_admin
            ) or (
                s.has_street
                and s.has_postcode
                and s.has_useful_locality_admin
            )
                then 'strong'
            when s.has_street
                 or (s.has_postcode and s.has_city)
                 or (s.has_city and s.has_useful_admin_inferred)
                then 'partial'
            when s.has_address_evidence
                then 'weak'
            else 'none'
        end as computed_address_strength
    from scored as s
),
final_classification as (
    select
        c.*,
        case
            when c.has_place_evidence
                 and c.computed_address_strength in ('partial', 'strong', 'full')
                then 'place_with_address'
            when c.has_place_evidence
                 and c.computed_address_strength in ('none', 'weak')
                then 'place_only'
            when not c.has_place_evidence
                 and c.computed_address_strength in ('partial', 'strong', 'full')
                then 'address_only'
            when not c.has_place_evidence
                 and c.computed_address_strength = 'weak'
                then 'weak_address'
            else 'ignore'
        end as computed_source_classification
    from classified as c
),
reason_rows as (
    select id, 10 as sort_order, 'has_name' as reason
    from final_classification
    where has_name

    union all
    select id, 20, 'has_poi_tag:amenity=' || amenity_value
    from final_classification
    where amenity_value is not null

    union all
    select id, 30, 'has_poi_tag:shop=' || shop_value
    from final_classification
    where shop_value is not null

    union all
    select id, 40, 'has_poi_tag:tourism=' || tourism_value
    from final_classification
    where tourism_value is not null

    union all
    select id, 50, 'has_poi_tag:leisure=' || leisure_value
    from final_classification
    where leisure_value is not null

    union all
    select id, 60, 'has_poi_tag:office=' || office_value
    from final_classification
    where office_value is not null

    union all
    select id, 70, 'has_poi_tag:healthcare=' || healthcare_value
    from final_classification
    where healthcare_value is not null

    union all
    select id, 80, 'has_poi_tag:public_transport=' || public_transport_value
    from final_classification
    where public_transport_value is not null

    union all
    select id, 90, 'has_poi_tag:highway=' || highway_value
    from final_classification
    where lower(coalesce(highway_value, '')) in ('bus_stop', 'stop', 'platform', 'stop_position')

    union all
    select id, 100, 'has_poi_tag:religion=' || religion_value
    from final_classification
    where religion_value is not null

    union all
    select id, 110, 'has_poi_tag:building=' || building_value
    from final_classification
    where building_value is not null and has_name

    union all
    select id, 120, 'has_poi_tag:school=' || school_value
    from final_classification
    where school_value is not null

    union all
    select id, 130, 'has_poi_tag:education=' || education_value
    from final_classification
    where education_value is not null

    union all
    select id, 140, 'has_poi_tag:isced:level=' || isced_level_value
    from final_classification
    where isced_level_value is not null

    union all
    select id, 150, 'has_poi_tag:social_facility=' || social_facility_value
    from final_classification
    where social_facility_value is not null

    union all
    select id, 160, 'has_poi_tag:brand=' || brand_value
    from final_classification
    where brand_value is not null and has_name

    union all
    select id, 170, 'has_poi_tag:operator=' || operator_value
    from final_classification
    where operator_value is not null and has_name

    union all
    select id, 200, 'has_addr_housenumber'
    from final_classification
    where has_house_number

    union all
    select id, 210, 'has_addr_street'
    from final_classification
    where has_street

    union all
    select id, 220, 'has_addr_postcode'
    from final_classification
    where has_postcode

    union all
    select id, 230, 'has_addr_city'
    from final_classification
    where has_city

    union all
    select id, 240, 'has_addr_country'
    from final_classification
    where has_country

    union all
    select id, 250, 'has_useful_locality_admin'
    from final_classification
    where has_useful_locality_admin

    union all
    select id, 260, 'has_useful_admin_inferred'
    from final_classification
    where has_useful_admin_inferred

    union all
    select id, 270, 'ambiguous_house_number:' || house_number_value
    from final_classification
    where has_ambiguous_house_number
      and house_number_value is not null

    union all
    select id, 900, 'address_strength:' || computed_address_strength
    from final_classification

    union all
    select id, 910, 'source_classification:' || computed_source_classification
    from final_classification
),
reasons as (
    select
        id,
        jsonb_agg(to_jsonb(reason) order by sort_order, reason) as classification_reasons
    from reason_rows
    group by id
),
computed as (
    select
        fc.id,
        fc.has_place_evidence,
        fc.has_address_evidence,
        fc.computed_address_strength as address_strength,
        fc.computed_source_classification as source_classification,
        case
            when fc.existing_place_candidate_status in (
                'place_candidate_created',
                'matched_core_place',
                'ignored'
            ) then fc.existing_place_candidate_status
            when fc.computed_source_classification in ('place_only', 'place_with_address')
                then 'needs_place_candidate'
            else 'not_applicable'
        end as place_candidate_status,
        coalesce(r.classification_reasons, '[]'::jsonb) as classification_reasons
    from final_classification as fc
    left join reasons as r
        on r.id = fc.id
)
update import_review.address_candidates as c
set
    source_classification = computed.source_classification,
    has_place_evidence = computed.has_place_evidence,
    has_address_evidence = computed.has_address_evidence,
    address_strength = computed.address_strength,
    place_candidate_status = computed.place_candidate_status,
    classification_reasons = computed.classification_reasons,
    classified_at = now()
from computed
where c.id = computed.id
  and (
      c.source_classification is distinct from computed.source_classification
      or c.has_place_evidence is distinct from computed.has_place_evidence
      or c.has_address_evidence is distinct from computed.has_address_evidence
      or c.address_strength is distinct from computed.address_strength
      or c.place_candidate_status is distinct from computed.place_candidate_status
      or c.classification_reasons is distinct from computed.classification_reasons
      or c.classified_at is null
  );

commit;

-- =============================================================================
-- Manual verification SQL
-- =============================================================================
--
-- 1) Count by source_classification:
-- select
--     source_classification,
--     count(*)::bigint as candidate_count
-- from import_review.address_candidates
-- group by source_classification
-- order by source_classification;
--
-- 2) Count by address_strength:
-- select
--     address_strength,
--     count(*)::bigint as candidate_count
-- from import_review.address_candidates
-- group by address_strength
-- order by
--     case address_strength
--         when 'none' then 1
--         when 'weak' then 2
--         when 'partial' then 3
--         when 'strong' then 4
--         when 'full' then 5
--         else 99
--     end;
--
-- 3) Count POI-like rows:
-- select
--     count(*) filter (where has_place_evidence)::bigint as poi_like_rows,
--     count(*) filter (
--         where source_classification = 'place_only'
--     )::bigint as place_only_rows,
--     count(*) filter (
--         where source_classification = 'place_with_address'
--     )::bigint as place_with_address_rows
-- from import_review.address_candidates;
--
-- 4) Sample 30 rows with source context:
-- with source_tags as (
--     select
--         c.id,
--         (
--             case
--                 when jsonb_typeof(c.source_refs) = 'object' then c.source_refs
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(c.source_refs -> 'tags') = 'object' then c.source_refs -> 'tags'
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(c.normalized_data -> 'tags') = 'object' then c.normalized_data -> 'tags'
--                 else '{}'::jsonb
--             end
--             || case
--                 when jsonb_typeof(c.source_tags) = 'object' then c.source_tags
--                 else '{}'::jsonb
--             end
--         ) as tags
--     from import_review.address_candidates as c
-- )
-- select
--     c.external_id,
--     nullif(btrim(coalesce(
--         st.tags ->> 'name',
--         st.tags ->> 'name:en',
--         st.tags ->> 'name:my',
--         st.tags ->> 'name:mm'
--     )), '') as source_name,
--     nullif(btrim(coalesce(
--         st.tags ->> 'amenity',
--         st.tags ->> 'shop',
--         st.tags ->> 'tourism',
--         st.tags ->> 'leisure',
--         st.tags ->> 'office',
--         st.tags ->> 'healthcare',
--         st.tags ->> 'public_transport',
--         st.tags ->> 'highway',
--         st.tags ->> 'religion',
--         st.tags ->> 'building',
--         st.tags ->> 'school',
--         st.tags ->> 'education',
--         st.tags ->> 'social_facility',
--         st.tags ->> 'brand',
--         st.tags ->> 'operator'
--     )), '') as source_type,
--     c.source_classification,
--     c.address_strength,
--     c.place_candidate_status,
--     c.classification_reasons
-- from import_review.address_candidates as c
-- inner join source_tags as st
--     on st.id = c.id
-- order by
--     c.has_place_evidence desc,
--     c.source_classification,
--     c.id
-- limit 30;
