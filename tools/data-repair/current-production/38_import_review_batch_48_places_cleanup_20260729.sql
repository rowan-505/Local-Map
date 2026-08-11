-- =============================================================================
-- One-time import-review place batch 48 publish + scoped cleanup
-- Prepared: 2026-07-29
-- Phase 1 status: PROPOSED ONLY; this file has not been executed.
--
-- Safety properties:
--   * one SERIALIZABLE transaction; every failed assertion rolls everything back
--   * does not use place_candidates.matched_core_id or prior duplicate labels
--   * source identity is recalculated with system.pipeline_osm_identity_key()
--   * proximity alone is never a merge signal
--   * existing core.core_places rows are never updated
--   * verified/manual Core fields therefore cannot be overwritten
--   * categories are resolved by existing ref.ref_poi_categories.code values
--   * every candidate is recorded in system.system_publish_items before cleanup
--   * cleanup deletes only completed place_candidates from review batch 48
--   * manual_review candidates, source snapshots, audit history, Core rows,
--     the review batch header, and all other batches are retained
--   * rerun after success performs verification only and creates no duplicates
--
-- Approved dry-run manifest expected by the assertions below:
--   update_exact_source       11
--   merge_strong_identity     31
--   insert_separate         2154
--   skip_wrong_entity_family 198
--   reject_unusable            3
--   manual_review            141
--   total                   2538
--
-- Expected first-run effects:
--   new Core places         2154
--   existing Core rows changed 0
--   completed review rows removed 2397
--   manual-review rows retained 141
-- =============================================================================

BEGIN ISOLATION LEVEL SERIALIZABLE;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '15min';
SET LOCAL idle_in_transaction_session_timeout = '20min';
SET LOCAL client_min_messages = notice;

-- Prevent two executions of this one-time operation from overlapping.
SELECT pg_advisory_xact_lock(hashtextextended('coremap:import_review:places:batch:48:20260729', 0));

CREATE TEMP TABLE batch48_params (
    review_batch_id bigint PRIMARY KEY,
    publish_batch_name text NOT NULL,
    expected_snapshot_version text NOT NULL,
    expected_total integer NOT NULL,
    expected_update_exact integer NOT NULL,
    expected_merge integer NOT NULL,
    expected_insert integer NOT NULL,
    expected_wrong_family integer NOT NULL,
    expected_reject integer NOT NULL,
    expected_manual integer NOT NULL
) ON COMMIT DROP;

INSERT INTO batch48_params VALUES (
    48,
    'import_review_places_batch_48_cleanup_20260729',
    'osm_myanmar_2026_07_21_national_dry_run_v1',
    2538,
    11,
    31,
    2154,
    198,
    3,
    141
);

DO $preflight$
BEGIN
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'batch 48: system.pipeline_osm_identity_key(text) is missing';
    END IF;

    IF to_regclass('import_review.review_batches') IS NULL
       OR to_regclass('import_review.place_candidates') IS NULL
       OR to_regclass('core.core_places') IS NULL
       OR to_regclass('core.core_place_names') IS NULL
       OR to_regclass('core.core_place_sources') IS NULL
       OR to_regclass('core.core_place_contacts') IS NULL
       OR to_regclass('system.system_publish_batches') IS NULL
       OR to_regclass('system.system_publish_items') IS NULL THEN
        RAISE EXCEPTION 'batch 48: required table is missing';
    END IF;
END
$preflight$;

-- Lock only the requested review-batch header.
SELECT rb.id
FROM import_review.review_batches AS rb
JOIN batch48_params AS p ON p.review_batch_id = rb.id
WHERE rb.source_snapshot_version = p.expected_snapshot_version
  AND rb.entity_families = ARRAY['places']::text[]
FOR UPDATE;

DO $batch_header$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM import_review.review_batches AS rb
        JOIN batch48_params AS p ON p.review_batch_id = rb.id
        WHERE rb.source_snapshot_version = p.expected_snapshot_version
          AND rb.entity_families = ARRAY['places']::text[]
    ) THEN
        RAISE EXCEPTION 'batch 48: review-batch header/snapshot/entity family changed';
    END IF;
END
$batch_header$;

-- A completed prior run is the only accepted rerun state.
CREATE TEMP TABLE batch48_run_state (
    apply_needed boolean NOT NULL,
    publish_batch_id bigint
) ON COMMIT DROP;

INSERT INTO batch48_run_state (apply_needed, publish_batch_id)
SELECT
    pb.id IS NULL,
    pb.id
FROM batch48_params AS p
LEFT JOIN LATERAL (
    SELECT b.id
    FROM system.system_publish_batches AS b
    WHERE b.batch_name = p.publish_batch_name
      AND b.source_review_batch_id = p.review_batch_id
    ORDER BY b.id
    LIMIT 1
) AS pb ON true;

DO $run_state$
DECLARE
    v_apply boolean;
    v_publish_batch_id bigint;
    v_item_count bigint;
    v_live_candidates bigint;
    v_manual_items bigint;
BEGIN
    SELECT apply_needed, publish_batch_id
      INTO v_apply, v_publish_batch_id
    FROM batch48_run_state;

    SELECT count(*) INTO v_live_candidates
    FROM import_review.place_candidates
    WHERE review_batch_id = 48;

    IF v_apply THEN
        IF v_live_candidates <> 2538 THEN
            RAISE EXCEPTION
                'batch 48: first run requires 2538 live candidates; found %',
                v_live_candidates;
        END IF;
    ELSE
        SELECT
            count(*),
            count(*) FILTER (WHERE review_decision = 'manual_review')
          INTO v_item_count, v_manual_items
        FROM system.system_publish_items
        WHERE publish_batch_id = v_publish_batch_id;

        IF NOT EXISTS (
            SELECT 1
            FROM system.system_publish_batches
            WHERE id = v_publish_batch_id
              AND status = 'promoted'
        ) OR v_item_count <> 2538 OR v_manual_items <> 141 THEN
            RAISE EXCEPTION
                'batch 48: partial/inconsistent prior run (items %, manual %)',
                v_item_count, v_manual_items;
        END IF;

        IF v_live_candidates <> 141 OR EXISTS (
            SELECT 1
            FROM import_review.place_candidates AS pc
            WHERE pc.review_batch_id = 48
              AND NOT EXISTS (
                  SELECT 1
                  FROM system.system_publish_items AS pi
                  WHERE pi.publish_batch_id = v_publish_batch_id
                    AND pi.review_candidate_table = 'place_candidates'
                    AND pi.review_candidate_id = pc.id
                    AND pi.review_decision = 'manual_review'
              )
        ) THEN
            RAISE EXCEPTION
                'batch 48: rerun state does not contain exactly the 141 audited manual-review rows';
        END IF;
    END IF;
END
$run_state$;

-- First-run drift guard: do not surprise-delete related review data.
DO $review_relations$
DECLARE
    v_apply boolean;
BEGIN
    SELECT apply_needed INTO v_apply FROM batch48_run_state;
    IF v_apply AND (
        EXISTS (SELECT 1 FROM import_review.place_address_links WHERE review_batch_id = 48)
        OR EXISTS (SELECT 1 FROM import_review.review_candidate_edits WHERE review_batch_id = 48)
        OR EXISTS (SELECT 1 FROM import_review.review_comments WHERE review_batch_id = 48)
        OR EXISTS (SELECT 1 FROM import_review.review_tasks WHERE review_batch_id = 48)
        OR EXISTS (
            SELECT 1
            FROM system.system_publish_batches
            WHERE source_review_batch_id = 48
        )
        OR EXISTS (
            SELECT 1
            FROM system.system_review_logs
            WHERE review_candidate_table = 'place_candidates'
              AND review_candidate_id IN (
                  SELECT id
                  FROM import_review.place_candidates
                  WHERE review_batch_id = 48
              )
        )
    ) THEN
        RAISE EXCEPTION
            'batch 48: related review/publish rows appeared after dry-run; re-inspect before applying';
    END IF;
END
$review_relations$;

CREATE TEMP TABLE batch48_before_counts AS
SELECT
    (SELECT count(*) FROM core.core_places WHERE deleted_at IS NULL) AS active_core_places,
    (SELECT count(*) FROM core.core_place_names) AS core_place_names,
    (SELECT count(*) FROM core.core_place_sources) AS core_place_sources,
    (SELECT count(*) FROM core.core_place_contacts) AS core_place_contacts,
    (SELECT count(*) FROM import_review.place_candidates WHERE review_batch_id = 48) AS batch48_candidates,
    (SELECT count(*) FROM import_review.place_candidates WHERE review_batch_id <> 48) AS other_place_candidates;

-- Category codes only. IDs are always resolved from the existing reference table.
CREATE TEMP TABLE batch48_category_map (
    source_family text NOT NULL,
    source_subtype text NOT NULL,
    category_code text,
    PRIMARY KEY (source_family, source_subtype)
) ON COMMIT DROP;

INSERT INTO batch48_category_map (source_family, source_subtype, category_code) VALUES
    ('education', '*', 'school'),
    ('healthcare', '*', 'health'),
    ('religion', '*', 'religion'),
    ('building', '*', 'facility'),
    ('office', 'government', 'government'),
    ('office', 'administrative', 'government'),
    ('office', 'diplomatic', 'government'),
    ('office', 'ngo', 'community'),
    ('office', 'charity', 'community'),
    ('office', 'association', 'community'),
    ('office', 'educational_institution', 'education'),
    ('office', 'financial', 'finance'),
    ('office', 'insurance', 'finance'),
    ('office', '*', 'office'),
    ('tourism', 'hotel', 'hotel'),
    ('tourism', 'guest_house', 'hotel'),
    ('tourism', 'hostel', 'hotel'),
    ('tourism', 'motel', 'hotel'),
    ('tourism', 'apartment', 'hotel'),
    ('tourism', 'attraction', 'entertainment'),
    ('tourism', 'viewpoint', 'entertainment'),
    ('tourism', 'artwork', 'entertainment'),
    ('tourism', 'gallery', 'entertainment'),
    ('tourism', 'museum', 'entertainment'),
    ('tourism', 'camp_site', 'entertainment'),
    ('tourism', '*', 'services'),
    ('leisure', 'park', 'entertainment'),
    ('leisure', 'playground', 'entertainment'),
    ('leisure', 'sports_centre', 'entertainment'),
    ('leisure', 'fitness_centre', 'entertainment'),
    ('leisure', 'stadium', 'entertainment'),
    ('leisure', 'golf_course', 'entertainment'),
    ('leisure', 'water_park', 'entertainment'),
    ('leisure', '*', 'facility'),
    ('shop', 'coffee', 'cafe'),
    ('shop', 'bakery', 'food'),
    ('shop', 'confectionery', 'food'),
    ('shop', 'deli', 'food'),
    ('shop', 'food', 'food'),
    ('shop', 'seafood', 'food'),
    ('shop', 'butcher', 'food'),
    ('shop', 'beverages', 'food'),
    ('shop', 'tea', 'food'),
    ('shop', 'pastry', 'food'),
    ('shop', 'pharmacy', 'health'),
    ('shop', 'medical_supply', 'health'),
    ('shop', 'optician', 'health'),
    ('shop', 'hearing_aids', 'health'),
    ('shop', 'supermarket', 'supermarket'),
    ('shop', 'convenience', 'convenience_store'),
    ('shop', 'mall', 'shopping_mall'),
    ('shop', 'department_store', 'shopping_mall'),
    ('shop', 'bookmaker', 'finance'),
    ('shop', 'pawnbroker', 'finance'),
    ('shop', 'lottery', 'finance'),
    ('shop', 'travel_agency', 'transport'),
    ('shop', 'ticket', 'transport'),
    ('shop', '*', 'shopping'),
    ('amenity', 'cafe', 'cafe'),
    ('amenity', 'restaurant', 'food'),
    ('amenity', 'fast_food', 'food'),
    ('amenity', 'food_court', 'food'),
    ('amenity', 'bar', 'food'),
    ('amenity', 'pub', 'food'),
    ('amenity', 'ice_cream', 'food'),
    ('amenity', 'biergarten', 'food'),
    ('amenity', 'pharmacy', 'pharmacy'),
    ('amenity', 'clinic', 'clinic'),
    ('amenity', 'doctors', 'clinic'),
    ('amenity', 'dentist', 'clinic'),
    ('amenity', 'veterinary', 'clinic'),
    ('amenity', 'hospital', 'hospital'),
    ('amenity', 'school', 'education'),
    ('amenity', 'kindergarten', 'education'),
    ('amenity', 'college', 'education'),
    ('amenity', 'university', 'education'),
    ('amenity', 'library', 'education'),
    ('amenity', 'bus_station', 'transport'),
    ('amenity', 'ferry_terminal', 'transport'),
    ('amenity', 'taxi', 'transport'),
    ('amenity', 'vehicle_inspection', 'transport'),
    ('amenity', 'bank', 'bank'),
    ('amenity', 'atm', 'atm'),
    ('amenity', 'bureau_de_change', 'atm'),
    ('amenity', 'fuel', 'fuel'),
    ('amenity', 'charging_station', 'fuel'),
    ('amenity', 'place_of_worship', 'religion'),
    ('amenity', 'monastery', 'religion'),
    ('amenity', 'townhall', 'government'),
    ('amenity', 'courthouse', 'government'),
    ('amenity', 'government', 'government'),
    ('amenity', 'post_office', 'government'),
    ('amenity', 'police', 'emergency'),
    ('amenity', 'fire_station', 'emergency'),
    ('amenity', 'community_centre', 'community'),
    ('amenity', 'social_facility', 'community'),
    ('amenity', 'childcare', 'community'),
    ('amenity', 'toilets', 'toilet'),
    ('amenity', 'parking', 'parking'),
    ('amenity', 'parking_entrance', 'parking'),
    ('amenity', 'cinema', 'entertainment'),
    ('amenity', 'theatre', 'entertainment'),
    ('amenity', 'arts_centre', 'entertainment'),
    ('amenity', 'nightclub', 'entertainment'),
    ('amenity', 'car_rental', 'services'),
    ('amenity', 'car_wash', 'services'),
    ('amenity', 'bicycle_rental', 'services'),
    ('amenity', 'bench', NULL),
    ('amenity', 'bell', NULL),
    ('amenity', 'post_box', NULL),
    ('amenity', 'recycling', NULL),
    ('amenity', 'fixme', NULL),
    ('amenity', '*', 'facility');

CREATE TEMP TABLE batch48_candidates ON COMMIT DROP AS
WITH source_rows AS (
    SELECT
        pc.*,
        lower(coalesce(pc.normalized_data ->> 'source_category_hint', '')) AS source_family,
        lower(coalesce(
            pc.normalized_data ->> 'source_type_hint',
            pc.class_code,
            ''
        )) AS source_subtype,
        coalesce(pc.normalized_data -> 'tags', '{}'::jsonb) AS tags,
        lower(regexp_replace(
            coalesce(pc.primary_name, pc.canonical_name, ''),
            '[^[:alnum:]]',
            '',
            'g'
        )) AS normalized_name,
        system.pipeline_osm_identity_key(pc.external_id) AS identity_key
    FROM import_review.place_candidates AS pc
    JOIN batch48_run_state AS rs ON rs.apply_needed
    WHERE pc.review_batch_id = 48
),
mapped AS (
    SELECT
        s.*,
        CASE
            WHEN exact_map.source_subtype IS NOT NULL THEN exact_map.category_code
            ELSE fallback_map.category_code
        END AS mapped_category_code
    FROM source_rows AS s
    LEFT JOIN batch48_category_map AS exact_map
      ON exact_map.source_family = s.source_family
     AND exact_map.source_subtype = s.source_subtype
    LEFT JOIN batch48_category_map AS fallback_map
      ON fallback_map.source_family = s.source_family
     AND fallback_map.source_subtype = '*'
)
SELECT
    m.*,
    cat.id AS mapped_category_id,
    coalesce(cat.parent_id, cat.id) AS mapped_category_root
FROM mapped AS m
LEFT JOIN ref.ref_poi_categories AS cat
  ON cat.code = m.mapped_category_code;

CREATE INDEX batch48_candidates_id_idx ON batch48_candidates (id);
CREATE INDEX batch48_candidates_identity_idx ON batch48_candidates (identity_key);
CREATE INDEX batch48_candidates_name_idx ON batch48_candidates (normalized_name);
CREATE INDEX batch48_candidates_geom_idx ON batch48_candidates USING gist (point_geom);

DO $candidate_integrity$
BEGIN
    IF (SELECT apply_needed FROM batch48_run_state) AND (
        (SELECT count(*) FROM batch48_candidates) <> 2538
        OR EXISTS (
            SELECT 1
            FROM batch48_candidates
            WHERE identity_key IS NULL
               OR nullif(btrim(primary_name), '') IS NULL
               OR point_geom IS NULL
               OR ST_SRID(point_geom) <> 4326
               OR GeometryType(point_geom) <> 'POINT'
        )
    ) THEN
        RAISE EXCEPTION 'batch 48: candidate identity/name/geometry integrity changed';
    END IF;

    IF (SELECT apply_needed FROM batch48_run_state) AND EXISTS (
        SELECT identity_key
        FROM batch48_candidates
        GROUP BY identity_key
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'batch 48: duplicate OSM identity exists inside the batch';
    END IF;
END
$candidate_integrity$;

CREATE TEMP TABLE batch48_core_identity ON COMMIT DROP AS
WITH active_osm_identities AS (
    SELECT
        p.id AS core_place_id,
        system.pipeline_osm_identity_key(p.external_id) AS identity_key
    FROM core.core_places AS p
    WHERE p.deleted_at IS NULL
      AND p.external_id IS NOT NULL
    UNION
    SELECT
        s.place_id,
        system.pipeline_osm_identity_key(s.external_id)
    FROM core.core_place_sources AS s
    JOIN ref.ref_source_types AS st
      ON st.id = s.source_type_id
     AND st.code = 'osm'
    JOIN core.core_places AS p
      ON p.id = s.place_id
     AND p.deleted_at IS NULL
    WHERE s.external_id IS NOT NULL
)
SELECT
    i.identity_key,
    count(*) AS match_count,
    min(i.core_place_id) AS core_place_id
FROM active_osm_identities AS i
WHERE i.identity_key IS NOT NULL
GROUP BY i.identity_key;

CREATE INDEX batch48_core_identity_key_idx ON batch48_core_identity (identity_key);

CREATE TEMP TABLE batch48_candidate_names ON COMMIT DROP AS
SELECT DISTINCT
    q.candidate_id,
    q.name,
    q.language_code,
    q.is_declared_primary,
    lower(regexp_replace(q.name, '[^[:alnum:]]', '', 'g')) AS normalized_name
FROM (
    SELECT
        c.id AS candidate_id,
        c.primary_name AS name,
        'und'::text AS language_code,
        true AS is_declared_primary
    FROM batch48_candidates AS c
    UNION ALL
    SELECT
        c.id,
        child ->> 'name',
        coalesce(nullif(btrim(child ->> 'language_code'), ''), 'und'),
        coalesce((child ->> 'is_primary')::boolean, false)
    FROM batch48_candidates AS c
    CROSS JOIN LATERAL jsonb_array_elements(
        coalesce(c.normalized_data -> '_child_place_name_candidates', '[]'::jsonb)
    ) AS child
    WHERE nullif(btrim(child ->> 'name'), '') IS NOT NULL
) AS q
WHERE nullif(lower(regexp_replace(q.name, '[^[:alnum:]]', '', 'g')), '') IS NOT NULL;

CREATE INDEX batch48_candidate_names_norm_idx
    ON batch48_candidate_names (normalized_name);
CREATE INDEX batch48_candidate_names_candidate_idx
    ON batch48_candidate_names (candidate_id);

CREATE TEMP TABLE batch48_core_names ON COMMIT DROP AS
SELECT DISTINCT
    q.core_place_id,
    lower(regexp_replace(q.name, '[^[:alnum:]]', '', 'g')) AS normalized_name
FROM (
    SELECT p.id AS core_place_id, p.primary_name AS name
    FROM core.core_places AS p
    WHERE p.deleted_at IS NULL
    UNION ALL
    SELECT p.id, p.display_name
    FROM core.core_places AS p
    WHERE p.deleted_at IS NULL
    UNION ALL
    SELECT n.place_id, n.name
    FROM core.core_place_names AS n
    JOIN core.core_places AS p
      ON p.id = n.place_id
     AND p.deleted_at IS NULL
) AS q
WHERE nullif(lower(regexp_replace(q.name, '[^[:alnum:]]', '', 'g')), '') IS NOT NULL;

CREATE INDEX batch48_core_names_norm_idx ON batch48_core_names (normalized_name);
CREATE INDEX batch48_core_names_place_idx ON batch48_core_names (core_place_id);

-- Strong merge evidence:
--   exact normalized primary/alias name
--   AND compatible existing category family
--   AND within 100m.
-- Distance is only a bound after name + category evidence; it is never sufficient.
CREATE TEMP TABLE batch48_strong_matches ON COMMIT DROP AS
SELECT
    c.id AS candidate_id,
    count(DISTINCT p.id) AS match_count,
    min(p.id) AS core_place_id,
    min(ST_Distance(c.point_geom::geography, p.point_geom::geography)) AS distance_m
FROM batch48_candidates AS c
JOIN batch48_candidate_names AS cn ON cn.candidate_id = c.id
JOIN batch48_core_names AS kn ON kn.normalized_name = cn.normalized_name
JOIN core.core_places AS p
  ON p.id = kn.core_place_id
 AND p.deleted_at IS NULL
JOIN ref.ref_poi_categories AS core_cat ON core_cat.id = p.category_id
WHERE c.mapped_category_id IS NOT NULL
  AND coalesce(core_cat.parent_id, core_cat.id) = c.mapped_category_root
  AND ST_DWithin(c.point_geom::geography, p.point_geom::geography, 100)
GROUP BY c.id;

CREATE UNIQUE INDEX batch48_strong_matches_candidate_idx
    ON batch48_strong_matches (candidate_id);

CREATE TEMP TABLE batch48_category_conflicts ON COMMIT DROP AS
SELECT DISTINCT c.id AS candidate_id
FROM batch48_candidates AS c
JOIN batch48_candidate_names AS cn ON cn.candidate_id = c.id
JOIN batch48_core_names AS kn ON kn.normalized_name = cn.normalized_name
JOIN core.core_places AS p
  ON p.id = kn.core_place_id
 AND p.deleted_at IS NULL
JOIN ref.ref_poi_categories AS core_cat ON core_cat.id = p.category_id
WHERE c.mapped_category_id IS NOT NULL
  AND coalesce(core_cat.parent_id, core_cat.id) <> c.mapped_category_root
  AND ST_DWithin(c.point_geom::geography, p.point_geom::geography, 30);

CREATE UNIQUE INDEX batch48_category_conflicts_candidate_idx
    ON batch48_category_conflicts (candidate_id);

-- Conservative within-batch duplicate candidates. They remain manual; they are
-- not merged with each other by this script.
CREATE TEMP TABLE batch48_batch_duplicates ON COMMIT DROP AS
SELECT DISTINCT a.id AS candidate_id
FROM batch48_candidates AS a
JOIN batch48_candidates AS b
  ON b.id <> a.id
 AND b.normalized_name = a.normalized_name
 AND b.source_family = a.source_family
 AND b.source_subtype = a.source_subtype
 AND ST_DWithin(a.point_geom::geography, b.point_geom::geography, 30);

CREATE UNIQUE INDEX batch48_batch_duplicates_candidate_idx
    ON batch48_batch_duplicates (candidate_id);

CREATE TEMP TABLE batch48_plan ON COMMIT DROP AS
WITH evidence AS (
    SELECT
        c.*,
        coalesce(ci.match_count, 0) AS exact_match_count,
        ci.core_place_id AS exact_core_place_id,
        coalesce(sm.match_count, 0) AS strong_match_count,
        sm.core_place_id AS strong_core_place_id,
        sm.distance_m,
        bd.candidate_id IS NOT NULL AS is_batch_duplicate,
        cc.candidate_id IS NOT NULL AS has_category_conflict,
        (
            c.source_family = 'building'
            AND (
                c.tags ?| ARRAY[
                    'phone', 'contact:phone', 'website', 'contact:website',
                    'email', 'contact:email'
                ]
                OR c.normalized_name ~
                   '(office|university|school|police|engineering|headquarter|hq|psi|rca)'
            )
        ) AS is_meaningful_named_building,
        c.normalized_name IN ('', 'j', 'pagoda', 'primaryschool') AS is_generic_name,
        c.normalized_name ~ '(^myhome$|shouse$|shome$)'
            AS is_suspected_private_home_or_mistag
    FROM batch48_candidates AS c
    LEFT JOIN batch48_core_identity AS ci ON ci.identity_key = c.identity_key
    LEFT JOIN batch48_strong_matches AS sm ON sm.candidate_id = c.id
    LEFT JOIN batch48_batch_duplicates AS bd ON bd.candidate_id = c.id
    LEFT JOIN batch48_category_conflicts AS cc ON cc.candidate_id = c.id
)
SELECT
    e.*,
    CASE
        WHEN e.source_family = 'public_transport'
            THEN 'skip_wrong_entity_family'
        WHEN e.exact_match_count > 1
            THEN 'manual_review'
        WHEN e.exact_match_count = 1
            THEN 'update_exact_source'
        WHEN e.source_family = 'building'
             AND NOT e.is_meaningful_named_building
             AND NOT e.is_generic_name
            THEN 'skip_wrong_entity_family'
        WHEN e.is_generic_name
             OR e.point_geom IS NULL
             OR nullif(btrim(e.primary_name), '') IS NULL
            THEN 'reject_unusable'
        WHEN e.source_family = 'building'
            THEN 'manual_review'
        WHEN e.is_suspected_private_home_or_mistag
            THEN 'manual_review'
        WHEN e.mapped_category_id IS NULL
            THEN 'manual_review'
        WHEN e.is_batch_duplicate
            THEN 'manual_review'
        WHEN e.has_category_conflict
            THEN 'manual_review'
        WHEN e.strong_match_count = 1
            THEN 'merge_strong_identity'
        WHEN e.strong_match_count > 1
            THEN 'manual_review'
        ELSE 'insert_separate'
    END AS decision,
    CASE
        WHEN e.source_family = 'public_transport'
            THEN 'generic_platform_record'
        WHEN e.exact_match_count > 1
            THEN 'multiple_active_core_source_matches'
        WHEN e.exact_match_count = 1
            THEN 'same_osm_identity'
        WHEN e.source_family = 'building'
             AND NOT e.is_meaningful_named_building
             AND NOT e.is_generic_name
            THEN 'generic_or_private_building'
        WHEN e.is_generic_name
            THEN 'generic_or_unusable_name'
        WHEN e.mapped_category_id IS NULL
            THEN 'no_existing_category_mapping'
        WHEN e.point_geom IS NULL
            THEN 'missing_geometry'
        WHEN nullif(btrim(e.primary_name), '') IS NULL
            THEN 'missing_name'
        WHEN e.source_family = 'building'
            THEN 'meaningful_named_building_needs_review'
        WHEN e.is_suspected_private_home_or_mistag
            THEN 'suspected_private_home_or_mistag'
        WHEN e.is_batch_duplicate
            THEN 'within_batch_same_name_type_30m'
        WHEN e.has_category_conflict
            THEN 'nearby_same_name_incompatible_category'
        WHEN e.strong_match_count = 1
            THEN 'exact_name_compatible_category_100m'
        WHEN e.strong_match_count > 1
            THEN 'multiple_strong_core_matches'
        ELSE 'different_identity_no_strong_match'
    END AS reason,
    CASE
        WHEN e.exact_match_count = 1 THEN e.exact_core_place_id
        WHEN e.strong_match_count = 1 THEN e.strong_core_place_id
        ELSE NULL
    END AS proposed_core_place_id
FROM evidence AS e;

CREATE UNIQUE INDEX batch48_plan_candidate_idx ON batch48_plan (id);
CREATE INDEX batch48_plan_decision_idx ON batch48_plan (decision);

DO $plan_assertions$
DECLARE
    v_total bigint;
    v_update bigint;
    v_merge bigint;
    v_insert bigint;
    v_wrong bigint;
    v_reject bigint;
    v_manual bigint;
BEGIN
    IF NOT (SELECT apply_needed FROM batch48_run_state) THEN
        RETURN;
    END IF;

    SELECT
        count(*),
        count(*) FILTER (WHERE decision = 'update_exact_source'),
        count(*) FILTER (WHERE decision = 'merge_strong_identity'),
        count(*) FILTER (WHERE decision = 'insert_separate'),
        count(*) FILTER (WHERE decision = 'skip_wrong_entity_family'),
        count(*) FILTER (WHERE decision = 'reject_unusable'),
        count(*) FILTER (WHERE decision = 'manual_review')
      INTO v_total, v_update, v_merge, v_insert, v_wrong, v_reject, v_manual
    FROM batch48_plan;

    IF (v_total, v_update, v_merge, v_insert, v_wrong, v_reject, v_manual)
       IS DISTINCT FROM (2538::bigint, 11::bigint, 31::bigint, 2154::bigint,
                         198::bigint, 3::bigint, 141::bigint) THEN
        RAISE EXCEPTION
            'batch 48: classification drift: total %, exact %, merge %, insert %, wrong %, reject %, manual %',
            v_total, v_update, v_merge, v_insert, v_wrong, v_reject, v_manual;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM batch48_plan
        WHERE decision IN ('update_exact_source', 'merge_strong_identity')
          AND proposed_core_place_id IS NULL
    ) OR EXISTS (
        SELECT 1
        FROM batch48_plan
        WHERE decision = 'insert_separate'
          AND (mapped_category_id IS NULL OR exact_match_count <> 0)
    ) THEN
        RAISE EXCEPTION 'batch 48: unsafe target/category appeared in approved plan';
    END IF;
END
$plan_assertions$;

-- Immutable comparison snapshots for every existing exact/merge target.
CREATE TEMP TABLE batch48_existing_core_before ON COMMIT DROP AS
SELECT p.id, to_jsonb(p) AS row_snapshot
FROM core.core_places AS p
JOIN (
    SELECT DISTINCT proposed_core_place_id
    FROM batch48_plan
    WHERE decision IN ('update_exact_source', 'merge_strong_identity')
) AS target ON target.proposed_core_place_id = p.id;

-- Create the audit/publish batch once.
INSERT INTO system.system_publish_batches (
    batch_name,
    status,
    note,
    source_review_batch_id,
    source_snapshot_version,
    region_code,
    total_item_count,
    success_count,
    failed_count,
    skipped_count,
    validation_total,
    validation_done,
    validation_percent,
    summary
)
SELECT
    p.publish_batch_name,
    'draft',
    'One-time conservative place publish and scoped cleanup for import-review batch 48',
    p.review_batch_id,
    p.expected_snapshot_version,
    'MM',
    p.expected_total,
    p.expected_update_exact + p.expected_merge + p.expected_insert,
    0,
    p.expected_wrong_family + p.expected_reject + p.expected_manual,
    p.expected_total,
    0,
    0,
    jsonb_build_object(
        'prepared_on', '2026-07-29',
        'policy', 'independent_identity_no_proximity_only_no_core_overwrite',
        'expected_decisions', jsonb_build_object(
            'update_exact_source', p.expected_update_exact,
            'merge_strong_identity', p.expected_merge,
            'insert_separate', p.expected_insert,
            'skip_wrong_entity_family', p.expected_wrong_family,
            'reject_unusable', p.expected_reject,
            'manual_review', p.expected_manual
        )
    )
FROM batch48_params AS p
JOIN batch48_run_state AS rs ON rs.apply_needed;

UPDATE batch48_run_state AS rs
SET publish_batch_id = pb.id
FROM batch48_params AS p
JOIN system.system_publish_batches AS pb
  ON pb.batch_name = p.publish_batch_name
 AND pb.source_review_batch_id = p.review_batch_id
WHERE rs.publish_batch_id IS NULL;

-- New separate places only. Exact and merge targets are deliberately not updated.
CREATE TEMP TABLE batch48_inserted_places ON COMMIT DROP AS
WITH inserted AS (
    INSERT INTO core.core_places (
        primary_name,
        display_name,
        category_id,
        admin_area_id,
        point_geom,
        lat,
        lng,
        plus_code,
        importance_score,
        popularity_score,
        confidence_score,
        is_public,
        is_verified,
        source_type_id,
        external_id,
        source_refs,
        normalized_data,
        verification_status
    )
    SELECT
        p.primary_name,
        coalesce(nullif(btrim(p.display_name), ''), p.primary_name),
        p.mapped_category_id,
        p.admin_area_id,
        p.point_geom,
        ST_Y(p.point_geom),
        ST_X(p.point_geom),
        p.plus_code,
        least(100, greatest(0, coalesce(p.importance_score, 0))),
        least(100, greatest(0, coalesce(p.popularity_score, 0))),
        least(100, greatest(0, coalesce(p.confidence_score, 0))),
        true,
        false,
        st.id,
        p.external_id,
        jsonb_build_object(
            'external_id', p.external_id,
            'osm_identity_key', p.identity_key,
            'source_snapshot_version', p.source_snapshot_version,
            'source_snapshot_id_local', p.source_snapshot_id_local,
            'review_batch_id', 48,
            'review_candidate_id', p.id,
            'source_refs', p.source_refs
        ),
        jsonb_build_object(
            'source', 'import_review_batch_48',
            'source_tags', p.tags,
            'source_class_code', p.class_code,
            'source_category_hint', p.source_family,
            'source_type_hint', p.source_subtype,
            'classification_reason', p.reason
        ),
        'unverified'
    FROM batch48_plan AS p
    CROSS JOIN LATERAL (
        SELECT id
        FROM ref.ref_source_types
        WHERE code = 'osm'
        ORDER BY id
        LIMIT 1
    ) AS st
    WHERE p.decision = 'insert_separate'
    ORDER BY p.identity_key
    RETURNING id, external_id
)
SELECT
    p.id AS candidate_id,
    i.id AS core_place_id
FROM inserted AS i
JOIN batch48_plan AS p
  ON p.identity_key = system.pipeline_osm_identity_key(i.external_id);

CREATE UNIQUE INDEX batch48_inserted_candidate_idx
    ON batch48_inserted_places (candidate_id);
CREATE UNIQUE INDEX batch48_inserted_core_idx
    ON batch48_inserted_places (core_place_id);

CREATE TEMP TABLE batch48_results ON COMMIT DROP AS
SELECT
    p.id AS candidate_id,
    p.decision,
    p.reason,
    p.external_id,
    p.identity_key,
    CASE
        WHEN p.decision = 'insert_separate' THEN i.core_place_id
        WHEN p.decision IN ('update_exact_source', 'merge_strong_identity')
            THEN p.proposed_core_place_id
        ELSE NULL
    END AS resulting_core_place_id
FROM batch48_plan AS p
LEFT JOIN batch48_inserted_places AS i ON i.candidate_id = p.id;

CREATE UNIQUE INDEX batch48_results_candidate_idx ON batch48_results (candidate_id);

DO $insert_assertions$
BEGIN
    IF NOT (SELECT apply_needed FROM batch48_run_state) THEN
        RETURN;
    END IF;

    IF (SELECT count(*) FROM batch48_inserted_places) <> 2154
       OR EXISTS (
           SELECT 1
           FROM batch48_results
           WHERE decision IN (
               'insert_separate', 'update_exact_source', 'merge_strong_identity'
           )
             AND resulting_core_place_id IS NULL
       )
       OR EXISTS (
           SELECT 1
           FROM batch48_inserted_places AS i
           JOIN core.core_places AS p ON p.id = i.core_place_id
           WHERE p.is_verified
              OR p.verification_status <> 'unverified'
              OR p.deleted_at IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'batch 48: new-place insert/result mapping verification failed';
    END IF;
END
$insert_assertions$;

-- Add one official primary name for each new place.
INSERT INTO core.core_place_names (
    place_id, name, language_code, name_type, is_primary, search_weight
)
SELECT
    r.resulting_core_place_id,
    p.primary_name,
    'und',
    'official',
    true,
    100
FROM batch48_results AS r
JOIN batch48_plan AS p ON p.id = r.candidate_id
WHERE r.decision = 'insert_separate';

-- Add distinct non-primary aliases for inserts and existing exact/merge targets.
WITH proposed_aliases AS (
    SELECT
        r.resulting_core_place_id AS place_id,
        cn.name,
        cn.language_code,
        cn.normalized_name,
        row_number() OVER (
            PARTITION BY r.resulting_core_place_id, cn.normalized_name
            ORDER BY cn.is_declared_primary DESC, cn.language_code, cn.name
        ) AS alias_rank
    FROM batch48_results AS r
    JOIN batch48_candidate_names AS cn ON cn.candidate_id = r.candidate_id
    WHERE r.decision IN (
        'insert_separate', 'update_exact_source', 'merge_strong_identity'
    )
)
INSERT INTO core.core_place_names (
    place_id, name, language_code, name_type, is_primary, search_weight
)
SELECT
    a.place_id,
    a.name,
    a.language_code,
    'alternate',
    false,
    70
FROM proposed_aliases AS a
WHERE a.alias_rank = 1
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_place_names AS n
      WHERE n.place_id = a.place_id
        AND lower(regexp_replace(n.name, '[^[:alnum:]]', '', 'g')) = a.normalized_name
  )
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_places AS p
      WHERE p.id = a.place_id
        AND (
            lower(regexp_replace(p.primary_name, '[^[:alnum:]]', '', 'g')) = a.normalized_name
            OR lower(regexp_replace(p.display_name, '[^[:alnum:]]', '', 'g')) = a.normalized_name
        )
  );

-- Contacts are created only for new places. Existing Core contacts are untouched.
INSERT INTO core.core_place_contacts (
    place_id, phone, website, facebook_url, opening_hours, email
)
SELECT
    r.resulting_core_place_id,
    nullif(btrim(coalesce(p.tags ->> 'phone', p.tags ->> 'contact:phone')), ''),
    nullif(btrim(coalesce(p.tags ->> 'website', p.tags ->> 'contact:website')), ''),
    nullif(btrim(coalesce(
        p.tags ->> 'facebook',
        p.tags ->> 'contact:facebook'
    )), ''),
    nullif(btrim(p.tags ->> 'opening_hours'), ''),
    nullif(btrim(coalesce(p.tags ->> 'email', p.tags ->> 'contact:email')), '')
FROM batch48_results AS r
JOIN batch48_plan AS p ON p.id = r.candidate_id
WHERE r.decision = 'insert_separate'
  AND (
      nullif(btrim(coalesce(p.tags ->> 'phone', p.tags ->> 'contact:phone')), '') IS NOT NULL
      OR nullif(btrim(coalesce(p.tags ->> 'website', p.tags ->> 'contact:website')), '') IS NOT NULL
      OR nullif(btrim(coalesce(
          p.tags ->> 'facebook',
          p.tags ->> 'contact:facebook'
      )), '') IS NOT NULL
      OR nullif(btrim(p.tags ->> 'opening_hours'), '') IS NOT NULL
      OR nullif(btrim(coalesce(p.tags ->> 'email', p.tags ->> 'contact:email')), '') IS NOT NULL
  );

-- Append OSM lineage to inserts, exact-source targets, and strong-identity targets.
-- Existing source rows are never modified.
INSERT INTO core.core_place_sources (
    place_id,
    source_type_id,
    external_id,
    source_name,
    source_priority,
    captured_at,
    raw_payload
)
SELECT
    r.resulting_core_place_id,
    st.id,
    p.external_id,
    'OpenStreetMap',
    0,
    p.created_at,
    jsonb_build_object(
        'review_batch_id', 48,
        'review_candidate_id', p.id,
        'decision', r.decision,
        'reason', r.reason,
        'identity_key', p.identity_key,
        'source_snapshot_version', p.source_snapshot_version,
        'source_snapshot_id_local', p.source_snapshot_id_local,
        'source_refs', p.source_refs,
        'normalized_data', p.normalized_data,
        'point_geom_geojson', ST_AsGeoJSON(p.point_geom)::jsonb
    )
FROM batch48_results AS r
JOIN batch48_plan AS p ON p.id = r.candidate_id
CROSS JOIN LATERAL (
    SELECT id
    FROM ref.ref_source_types
    WHERE code = 'osm'
    ORDER BY id
    LIMIT 1
) AS st
WHERE r.resulting_core_place_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_place_sources AS s
      WHERE s.place_id = r.resulting_core_place_id
        AND s.source_type_id = st.id
        AND system.pipeline_osm_identity_key(s.external_id) = p.identity_key
  );

-- One immutable publish/audit item per original candidate, including skipped/manual.
INSERT INTO system.system_publish_items (
    publish_batch_id,
    entity_family,
    entity_id,
    publish_action,
    publish_status,
    review_candidate_table,
    review_candidate_id,
    external_id,
    target_schema,
    target_table,
    target_id,
    before_data,
    after_data,
    validation_result,
    error_message,
    published_at,
    review_decision,
    source_snapshot_version
)
SELECT
    rs.publish_batch_id,
    'places',
    r.candidate_id,
    CASE r.decision
        WHEN 'update_exact_source' THEN 'update'
        WHEN 'merge_strong_identity' THEN 'merge'
        WHEN 'insert_separate' THEN 'insert'
        ELSE 'skip'
    END,
    CASE
        WHEN r.resulting_core_place_id IS NOT NULL THEN 'success'
        ELSE 'skipped'
    END,
    'place_candidates',
    r.candidate_id,
    p.external_id,
    'core',
    'core_places',
    r.resulting_core_place_id,
    (to_jsonb(p) - 'point_geom' - 'entry_geom' - 'footprint_geom')
        || jsonb_build_object(
            'point_geom_geojson', ST_AsGeoJSON(p.point_geom)::jsonb,
            'entry_geom_geojson',
                CASE WHEN p.entry_geom IS NULL THEN NULL
                     ELSE ST_AsGeoJSON(p.entry_geom)::jsonb END,
            'footprint_geom_geojson',
                CASE WHEN p.footprint_geom IS NULL THEN NULL
                     ELSE ST_AsGeoJSON(p.footprint_geom)::jsonb END
        ),
    CASE
        WHEN r.resulting_core_place_id IS NULL THEN NULL
        ELSE to_jsonb(core_row)
    END,
    jsonb_build_object(
        'decision', r.decision,
        'reason', r.reason,
        'identity_key', p.identity_key,
        'mapped_category_code', p.mapped_category_code,
        'mapped_category_id', p.mapped_category_id,
        'exact_match_count', p.exact_match_count,
        'strong_match_count', p.strong_match_count,
        'strong_match_distance_m', p.distance_m,
        'within_batch_duplicate', p.is_batch_duplicate,
        'category_conflict', p.has_category_conflict,
        'old_core_id', p.proposed_core_place_id,
        'resulting_core_place_id', r.resulting_core_place_id,
        'core_place_row_updated', false
    ),
    CASE
        WHEN r.resulting_core_place_id IS NULL THEN r.reason
        ELSE NULL
    END,
    clock_timestamp(),
    r.decision,
    p.source_snapshot_version
FROM batch48_results AS r
JOIN batch48_plan AS p ON p.id = r.candidate_id
JOIN batch48_run_state AS rs ON rs.apply_needed
LEFT JOIN core.core_places AS core_row ON core_row.id = r.resulting_core_place_id;

DO $audit_assertions$
DECLARE
    v_publish_batch_id bigint;
BEGIN
    IF NOT (SELECT apply_needed FROM batch48_run_state) THEN
        RETURN;
    END IF;

    SELECT publish_batch_id INTO v_publish_batch_id FROM batch48_run_state;

    IF (SELECT count(*) FROM system.system_publish_items
        WHERE publish_batch_id = v_publish_batch_id) <> 2538
       OR EXISTS (
           SELECT 1
           FROM batch48_plan AS p
           WHERE NOT EXISTS (
               SELECT 1
               FROM system.system_publish_items AS i
               WHERE i.publish_batch_id = v_publish_batch_id
                 AND i.review_candidate_table = 'place_candidates'
                 AND i.review_candidate_id = p.id
                 AND i.review_decision = p.decision
                 AND i.validation_result ->> 'reason' = p.reason
                 AND i.target_id IS NOT DISTINCT FROM (
                     SELECT resulting_core_place_id
                     FROM batch48_results
                     WHERE candidate_id = p.id
                 )
           )
       ) THEN
        RAISE EXCEPTION 'batch 48: per-candidate audit verification failed';
    END IF;
END
$audit_assertions$;

-- Retained manual rows remain byte-for-byte unchanged. Their independent
-- classification and reason are stored durably in system_publish_items.

-- Cleanup only completed batch-48 place candidates. Current dry-run found no
-- related child review rows; their appearance is a hard failure above.
DELETE FROM import_review.place_candidates AS pc
USING batch48_plan AS p, batch48_run_state AS rs
WHERE rs.apply_needed
  AND pc.id = p.id
  AND pc.review_batch_id = 48
  AND p.decision <> 'manual_review';

UPDATE import_review.review_batches AS rb
SET
    status = 'reviewing',
    skipped_count = 201,
    preserved_reviewed_count = 141,
    summary = rb.summary || jsonb_build_object(
        'batch_48_cleanup', jsonb_build_object(
            'publish_batch_name',
                (SELECT publish_batch_name FROM batch48_params),
            'completed_at', clock_timestamp(),
            'original_candidate_count', 2538,
            'created_core_places', 2154,
            'existing_core_rows_updated', 0,
            'exact_source_attributions', 11,
            'strong_identity_attributions', 31,
            'wrong_family', 198,
            'rejected_unusable', 3,
            'completed_review_rows_removed', 2397,
            'manual_review_rows_retained', 141
        )
    ),
    updated_at = clock_timestamp()
FROM batch48_run_state AS rs
WHERE rs.apply_needed
  AND rb.id = 48;

UPDATE system.system_publish_batches AS pb
SET
    status = 'promoted',
    total_item_count = 2538,
    success_count = 2196,
    failed_count = 0,
    skipped_count = 342,
    validation_total = 2538,
    validation_done = 2538,
    validation_percent = 100,
    validated_at = clock_timestamp(),
    published_at = clock_timestamp(),
    promoted_at = clock_timestamp(),
    summary = pb.summary || jsonb_build_object(
        'verified', true,
        'existing_core_rows_updated', 0,
        'new_core_places', 2154,
        'completed_review_rows_removed', 2397,
        'manual_review_rows_retained', 141
    )
FROM batch48_run_state AS rs
WHERE rs.apply_needed
  AND pb.id = rs.publish_batch_id;

INSERT INTO system.system_publish_stage_logs (
    publish_batch_id,
    stage_key,
    stage_label,
    stage_status,
    message,
    progress_percent,
    details,
    finished_at
)
SELECT
    rs.publish_batch_id,
    'batch48_verified_cleanup',
    'Batch 48 publish, verify, and scoped cleanup',
    'success',
    'All assertions passed; only completed batch-48 place candidates were removed',
    100,
    jsonb_build_object(
        'created_core_places', 2154,
        'existing_core_rows_updated', 0,
        'manual_review_rows_retained', 141
    ),
    clock_timestamp()
FROM batch48_run_state AS rs
WHERE rs.apply_needed;

INSERT INTO system.audit_logs (
    action_type,
    entity_type,
    entity_id,
    before_snapshot,
    after_snapshot,
    user_agent
)
SELECT
    'import_review_batch_publish_cleanup',
    'import_review.review_batches',
    48,
    to_jsonb(b),
    jsonb_build_object(
        'publish_batch_id', rs.publish_batch_id,
        'created_core_places', 2154,
        'existing_core_rows_updated', 0,
        'completed_review_rows_removed', 2397,
        'manual_review_rows_retained', 141
    ),
    'codex-one-time-sql-20260729'
FROM batch48_before_counts AS b
JOIN batch48_run_state AS rs ON rs.apply_needed;

-- Build the post-action source-identity map once. This avoids repeatedly
-- scanning all active Core rows during final verification.
CREATE TEMP TABLE batch48_post_identity ON COMMIT DROP AS
WITH active_osm_identities AS (
    SELECT
        p.id AS core_place_id,
        system.pipeline_osm_identity_key(p.external_id) AS identity_key
    FROM core.core_places AS p
    WHERE p.deleted_at IS NULL
      AND p.external_id IS NOT NULL
    UNION
    SELECT
        s.place_id,
        system.pipeline_osm_identity_key(s.external_id)
    FROM core.core_place_sources AS s
    JOIN ref.ref_source_types AS st
      ON st.id = s.source_type_id
     AND st.code = 'osm'
    JOIN core.core_places AS p
      ON p.id = s.place_id
     AND p.deleted_at IS NULL
    WHERE s.external_id IS NOT NULL
)
SELECT
    identity_key,
    count(DISTINCT core_place_id) AS match_count,
    min(core_place_id) AS core_place_id
FROM active_osm_identities
WHERE identity_key IS NOT NULL
GROUP BY identity_key;

CREATE UNIQUE INDEX batch48_post_identity_key_idx
    ON batch48_post_identity (identity_key);

-- Final invariants. Any failure aborts and rolls back the entire transaction.
DO $final_verification$
DECLARE
    v_apply boolean;
    v_publish_batch_id bigint;
BEGIN
    SELECT apply_needed, publish_batch_id
      INTO v_apply, v_publish_batch_id
    FROM batch48_run_state;

    IF EXISTS (
        SELECT 1
        FROM batch48_existing_core_before AS b
        JOIN core.core_places AS p ON p.id = b.id
        WHERE to_jsonb(p) IS DISTINCT FROM b.row_snapshot
    ) THEN
        RAISE EXCEPTION
            'batch 48: an existing exact/merge Core place row was overwritten';
    END IF;

    IF v_apply AND (
        (SELECT count(*) FROM import_review.place_candidates WHERE review_batch_id = 48) <> 141
        OR EXISTS (
            SELECT 1
            FROM import_review.place_candidates AS pc
            WHERE pc.review_batch_id = 48
              AND NOT EXISTS (
                  SELECT 1
                  FROM batch48_plan AS p
                  WHERE p.id = pc.id
                    AND p.decision = 'manual_review'
              )
        )
        OR (SELECT count(*) FROM import_review.place_candidates WHERE review_batch_id <> 48)
           <> (SELECT other_place_candidates FROM batch48_before_counts)
    ) THEN
        RAISE EXCEPTION 'batch 48: scoped cleanup verification failed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM batch48_results AS r
        LEFT JOIN batch48_post_identity AS identity_result
          ON identity_result.identity_key = r.identity_key
        WHERE r.decision IN ('insert_separate', 'update_exact_source')
          AND (
              coalesce(identity_result.match_count, 0) <> 1
              OR identity_result.core_place_id IS DISTINCT FROM r.resulting_core_place_id
          )
    ) THEN
        RAISE EXCEPTION 'batch 48: active Core source-identity uniqueness failed';
    END IF;

    IF v_apply AND (
        (SELECT count(*) FROM batch48_inserted_places) <> 2154
        OR (SELECT count(*) FROM system.system_publish_items
            WHERE publish_batch_id = v_publish_batch_id
              AND publish_status = 'success') <> 2196
        OR (SELECT count(*) FROM system.system_publish_items
            WHERE publish_batch_id = v_publish_batch_id
              AND publish_status = 'skipped') <> 342
        OR EXISTS (
            SELECT 1
            FROM system.system_publish_items
            WHERE publish_batch_id = v_publish_batch_id
              AND publish_status = 'failed'
        )
    ) THEN
        RAISE EXCEPTION 'batch 48: final publish counts failed';
    END IF;

    -- A hypothetical rerun resolves every successful source identity to an
    -- existing Core result, while retained rows are exactly manual_review.
    IF v_apply AND EXISTS (
        SELECT 1
        FROM batch48_results AS r
        WHERE r.resulting_core_place_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM core.core_place_sources AS s
              JOIN ref.ref_source_types AS st
                ON st.id = s.source_type_id
               AND st.code = 'osm'
              WHERE s.place_id = r.resulting_core_place_id
                AND system.pipeline_osm_identity_key(s.external_id) = r.identity_key
          )
    ) THEN
        RAISE EXCEPTION 'batch 48: rerun/source-lineage idempotency check failed';
    END IF;

    SET CONSTRAINTS ALL IMMEDIATE;
END
$final_verification$;

-- Result sets returned to the operator after success (first run or clean rerun).
SELECT
    rs.apply_needed AS changes_applied_this_run,
    rs.publish_batch_id,
    pb.status AS publish_status,
    pb.total_item_count,
    pb.success_count,
    pb.failed_count,
    pb.skipped_count
FROM batch48_run_state AS rs
JOIN system.system_publish_batches AS pb ON pb.id = rs.publish_batch_id;

SELECT
    review_decision AS decision,
    count(*) AS candidate_count
FROM system.system_publish_items
WHERE publish_batch_id = (SELECT publish_batch_id FROM batch48_run_state)
GROUP BY review_decision
ORDER BY review_decision;

SELECT
    (SELECT active_core_places FROM batch48_before_counts) AS before_active_core_places,
    (SELECT count(*) FROM core.core_places WHERE deleted_at IS NULL) AS after_active_core_places,
    (SELECT batch48_candidates FROM batch48_before_counts) AS before_batch48_candidates,
    (SELECT count(*) FROM import_review.place_candidates WHERE review_batch_id = 48)
        AS after_batch48_candidates,
    (SELECT count(*) FROM import_review.place_candidates
     WHERE review_batch_id = 48) AS remaining_manual_review_rows;

COMMIT;
