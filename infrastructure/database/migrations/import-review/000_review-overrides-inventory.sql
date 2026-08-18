-- Phase 0 read-only inventory for review_overrides migration planning.
-- Mirrors policy in apps/api/src/modules/import-review/import-review-overrides-allowlist.ts
-- plus legacy, archive-only, and PATCH alias keys documented for migration.
--
-- Usage:
--   set -a && source apps/api/.env && set +a
--   psql "$DATABASE_URL" -v review_batch_id=0 \
--     -f infrastructure/database/migrations/import-review/000_review-overrides-inventory.sql
--
-- review_batch_id=0 (default) includes all batches; set to a specific batch id to scope.

\set ON_ERROR_STOP on
\set review_batch_id 0

\echo '=== Section 1: Per-table review_overrides counts (review_batch_id=' :review_batch_id ') ==='

SELECT
    candidate_table,
    coalesce(nullif(trim(max(entity_family)), ''), '(mixed)') AS entity_family,
    count(*)::bigint AS total_rows,
    count(*) FILTER (WHERE review_overrides <> '{}'::jsonb)::bigint AS non_empty_overrides,
    count(*) FILTER (
        WHERE promotion_status = 'promoted' OR review_status = 'promoted'
    )::bigint AS promoted_rows,
    count(*) FILTER (
        WHERE (promotion_status = 'promoted' OR review_status = 'promoted')
          AND review_overrides <> '{}'::jsonb
    )::bigint AS promoted_with_overrides,
    promotion_in_import_review
FROM (
    SELECT
        'import_review.address_candidates'::text AS candidate_table,
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        ) AS promotion_in_import_review
    FROM import_review.address_candidates
    UNION ALL
    SELECT
        'import_review.admin_area_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.admin_area_candidates
    UNION ALL
    SELECT
        'import_review.building_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.building_candidates
    UNION ALL
    SELECT
        'import_review.bus_route_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        false
    FROM import_review.bus_route_candidates
    UNION ALL
    SELECT
        'import_review.bus_route_stop_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        false
    FROM import_review.bus_route_stop_candidates
    UNION ALL
    SELECT
        'import_review.bus_route_variant_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        false
    FROM import_review.bus_route_variant_candidates
    UNION ALL
    SELECT
        'import_review.bus_stop_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        false
    FROM import_review.bus_stop_candidates
    UNION ALL
    SELECT
        'import_review.land_area_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.land_area_candidates
    UNION ALL
    SELECT
        'import_review.place_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.place_candidates
    UNION ALL
    SELECT
        'import_review.road_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.road_candidates
    UNION ALL
    SELECT
        'import_review.routing_barrier_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.routing_barrier_candidates
    UNION ALL
    SELECT
        'import_review.routing_turn_restriction_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        false
    FROM import_review.routing_turn_restriction_candidates
    UNION ALL
    SELECT
        'import_review.water_line_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.water_line_candidates
    UNION ALL
    SELECT
        'import_review.water_polygon_candidates',
        entity_family,
        review_overrides,
        promotion_status,
        review_status,
        review_batch_id,
        entity_family = ANY (
            ARRAY[
                'buildings', 'places', 'landuse', 'water_lines', 'water_polygons',
                'roads', 'addresses', 'admin_areas', 'routing_barriers'
            ]::text[]
        )
    FROM import_review.water_polygon_candidates
) AS all_candidates
WHERE :review_batch_id = 0 OR review_batch_id = :review_batch_id
GROUP BY candidate_table, promotion_in_import_review
ORDER BY candidate_table ASC;

\echo ''
\echo '=== Section 2: Top 20 override keys per entity_family ==='

WITH override_key_rows AS (
    SELECT entity_family, kv.key AS override_key
    FROM import_review.address_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.admin_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.building_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.bus_route_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.bus_route_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.bus_route_variant_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.bus_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.land_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.place_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.road_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.routing_barrier_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.routing_turn_restriction_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.water_line_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT entity_family, kv.key
    FROM import_review.water_polygon_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
),
key_counts AS (
    SELECT
        entity_family,
        override_key,
        count(*)::bigint AS occurrence_count
    FROM override_key_rows
    GROUP BY entity_family, override_key
),
ranked AS (
    SELECT
        entity_family,
        override_key,
        occurrence_count,
        row_number() OVER (
            PARTITION BY entity_family
            ORDER BY occurrence_count DESC, override_key ASC
        ) AS key_rank
    FROM key_counts
)
SELECT entity_family, override_key, occurrence_count, key_rank
FROM ranked
WHERE key_rank <= 20
ORDER BY entity_family ASC, key_rank ASC;

\echo ''
\echo '=== Section 3: Unknown override keys (not in allowlist + legacy + archive + alias policy) ==='

CREATE TEMP TABLE review_override_policy_keys (
    override_key text PRIMARY KEY
) ;

INSERT INTO review_override_policy_keys (override_key) VALUES
    -- import-review-overrides-allowlist.ts (all families, deduped)
    ('name_mm'),
    ('name_en'),
    ('stop_code'),
    ('admin_area_id'),
    ('name'),
    ('public_name'),
    ('route_code'),
    ('operator_name'),
    ('route_type'),
    ('directionality'),
    ('confidence_score'),
    ('route_id'),
    ('variant_code'),
    ('direction_name'),
    ('origin_name'),
    ('destination_name'),
    ('distance_m'),
    ('geom'),
    ('route_variant_id'),
    ('stop_id'),
    ('stop_sequence'),
    ('distance_from_start_m'),
    ('is_timing_point'),
    ('category_id'),
    ('importance_score'),
    ('popularity_score'),
    ('point_geom'),
    ('road_class_id'),
    ('surface'),
    ('is_oneway'),
    ('bridge'),
    ('tunnel'),
    ('layer'),
    ('access'),
    ('speed_kph'),
    ('building_type_id'),
    ('levels'),
    ('height_m'),
    ('class_code'),
    ('land_area_class_id'),
    ('waterway_class'),
    ('intermittent'),
    ('water_class'),
    ('admin_level_id'),
    ('parent_id'),
    ('slug'),
    ('full_address'),
    ('house_number'),
    ('street_name'),
    ('street_id'),
    ('quarter'),
    ('township'),
    ('city'),
    ('postcode'),
    ('plus_code'),
    ('barrier_type'),
    -- legacy name keys
    ('name_local'),
    -- archive-only keys (historical JSON)
    ('admin_area'),
    ('effective_admin_area_name'),
    ('primary_name'),
    ('display_name'),
    ('building_type'),
    ('poi_category_id'),
    ('external_id'),
    ('highway'),
    ('canonical_name'),
    ('validation_summary'),
    -- PATCH alias (import-review-overrides-allowlist.ts)
    ('parent_admin_area_id')
ON CONFLICT (override_key) DO NOTHING;

WITH all_override_keys AS (
    SELECT t.entity_family, t.id AS candidate_id, kv.key AS override_key
    FROM import_review.address_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.admin_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.building_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.bus_route_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.bus_route_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.bus_route_variant_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.bus_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.land_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.place_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.road_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.routing_barrier_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.routing_turn_restriction_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.water_line_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT t.entity_family, t.id, kv.key
    FROM import_review.water_polygon_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
)
SELECT
    entity_family,
    override_key,
    count(*)::bigint AS occurrence_count,
    count(DISTINCT candidate_id)::bigint AS distinct_candidates
FROM all_override_keys AS k
WHERE NOT EXISTS (
    SELECT 1
    FROM review_override_policy_keys AS p
    WHERE p.override_key = k.override_key
)
GROUP BY entity_family, override_key
ORDER BY occurrence_count DESC, entity_family ASC, override_key ASC;

\echo ''
\echo '=== Section 4: Road geom override checks ==='

SELECT
    count(*) FILTER (WHERE review_overrides ? 'geom')::bigint AS rows_with_geom_override_key,
    count(*) FILTER (
        WHERE review_overrides ? 'geom'
          AND jsonb_typeof(review_overrides->'geom') IS DISTINCT FROM 'object'
    )::bigint AS geom_override_invalid_json_type,
    count(*) FILTER (
        WHERE review_overrides ? 'geom'
          AND jsonb_typeof(review_overrides->'geom') = 'object'
          AND (
              geom IS NULL
              OR NOT st_equals(
                  geom,
                  st_setsrid(st_geomfromgeojson(review_overrides->'geom'), 4326)
              )
          )
    )::bigint AS geom_override_object_column_mismatch
FROM import_review.road_candidates AS r
WHERE r.entity_family = 'roads'
  AND (:review_batch_id = 0 OR r.review_batch_id = :review_batch_id);

\echo ''
\echo '=== Section 5: Scalar column vs override disagreements (counts) ==='

SELECT
  'buildings.building_type_id' AS check_name,
  count(*)::bigint AS mismatch_count
FROM import_review.building_candidates AS b
WHERE b.review_overrides ? 'building_type_id'
  AND (:review_batch_id = 0 OR b.review_batch_id = :review_batch_id)
  AND nullif(trim(b.review_overrides->>'building_type_id'), '') IS NOT NULL
  AND b.building_type_id IS DISTINCT FROM (b.review_overrides->>'building_type_id')::bigint

UNION ALL

SELECT
  'roads.road_class_id',
  count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'road_class_id'
  AND (:review_batch_id = 0 OR r.review_batch_id = :review_batch_id)
  AND nullif(trim(r.review_overrides->>'road_class_id'), '') IS NOT NULL
  AND r.road_class_id IS DISTINCT FROM (r.review_overrides->>'road_class_id')::bigint

UNION ALL

SELECT
  'places.category_id',
  count(*)::bigint
FROM import_review.place_candidates AS p
WHERE p.review_overrides ? 'category_id'
  AND (:review_batch_id = 0 OR p.review_batch_id = :review_batch_id)
  AND nullif(trim(p.review_overrides->>'category_id'), '') IS NOT NULL
  AND p.category_id IS DISTINCT FROM (p.review_overrides->>'category_id')::bigint

UNION ALL

SELECT
  'landuse.land_area_class_id',
  count(*)::bigint
FROM import_review.land_area_candidates AS l
WHERE l.review_overrides ? 'land_area_class_id'
  AND (:review_batch_id = 0 OR l.review_batch_id = :review_batch_id)
  AND nullif(trim(l.review_overrides->>'land_area_class_id'), '') IS NOT NULL
  AND l.land_area_class_id IS DISTINCT FROM (l.review_overrides->>'land_area_class_id')::bigint;

\echo ''
\echo '=== Section 5b: Scalar disagreement samples (up to 10 per check) ==='

(
  SELECT
      'buildings'::text AS entity_family,
      b.id,
      b.review_batch_id,
      b.building_type_id AS column_value,
      b.review_overrides->>'building_type_id' AS override_value
  FROM import_review.building_candidates AS b
  WHERE b.review_overrides ? 'building_type_id'
    AND (:review_batch_id = 0 OR b.review_batch_id = :review_batch_id)
    AND nullif(trim(b.review_overrides->>'building_type_id'), '') IS NOT NULL
    AND b.building_type_id IS DISTINCT FROM (b.review_overrides->>'building_type_id')::bigint
  ORDER BY b.id
  LIMIT 10
)
UNION ALL
(
  SELECT
      'roads',
      r.id,
      r.review_batch_id,
      r.road_class_id,
      r.review_overrides->>'road_class_id'
  FROM import_review.road_candidates AS r
  WHERE r.review_overrides ? 'road_class_id'
    AND (:review_batch_id = 0 OR r.review_batch_id = :review_batch_id)
    AND nullif(trim(r.review_overrides->>'road_class_id'), '') IS NOT NULL
    AND r.road_class_id IS DISTINCT FROM (r.review_overrides->>'road_class_id')::bigint
  ORDER BY r.id
  LIMIT 10
)
UNION ALL
(
  SELECT
      'places',
      p.id,
      p.review_batch_id,
      p.category_id,
      p.review_overrides->>'category_id'
  FROM import_review.place_candidates AS p
  WHERE p.review_overrides ? 'category_id'
    AND (:review_batch_id = 0 OR p.review_batch_id = :review_batch_id)
    AND nullif(trim(p.review_overrides->>'category_id'), '') IS NOT NULL
    AND p.category_id IS DISTINCT FROM (p.review_overrides->>'category_id')::bigint
  ORDER BY p.id
  LIMIT 10
)
UNION ALL
(
  SELECT
      'landuse',
      l.id,
      l.review_batch_id,
      l.land_area_class_id,
      l.review_overrides->>'land_area_class_id'
  FROM import_review.land_area_candidates AS l
  WHERE l.review_overrides ? 'land_area_class_id'
    AND (:review_batch_id = 0 OR l.review_batch_id = :review_batch_id)
    AND nullif(trim(l.review_overrides->>'land_area_class_id'), '') IS NOT NULL
    AND l.land_area_class_id IS DISTINCT FROM (l.review_overrides->>'land_area_class_id')::bigint
  ORDER BY l.id
  LIMIT 10
);

\echo ''
\echo '=== Section 6: Inventory-gated override key row counts ==='

SELECT 'roads.speed_kph' AS metric, count(*)::bigint AS row_count
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'speed_kph'
  AND (:review_batch_id = 0 OR r.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'roads.access', count(*)::bigint
FROM import_review.road_candidates AS r
WHERE r.review_overrides ? 'access'
  AND (:review_batch_id = 0 OR r.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'water_lines.intermittent', count(*)::bigint
FROM import_review.water_line_candidates AS wl
WHERE wl.review_overrides ? 'intermittent'
  AND (:review_batch_id = 0 OR wl.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'water_lines.waterway_class', count(*)::bigint
FROM import_review.water_line_candidates AS wl
WHERE wl.review_overrides ? 'waterway_class'
  AND (:review_batch_id = 0 OR wl.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'water_polygons.intermittent', count(*)::bigint
FROM import_review.water_polygon_candidates AS wp
WHERE wp.review_overrides ? 'intermittent'
  AND (:review_batch_id = 0 OR wp.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'water_polygons.water_class', count(*)::bigint
FROM import_review.water_polygon_candidates AS wp
WHERE wp.review_overrides ? 'water_class'
  AND (:review_batch_id = 0 OR wp.review_batch_id = :review_batch_id)

UNION ALL
SELECT 'landuse.admin_area_id', count(*)::bigint
FROM import_review.land_area_candidates AS lu
WHERE lu.review_overrides ? 'admin_area_id'
  AND (:review_batch_id = 0 OR lu.review_batch_id = :review_batch_id);

\echo ''
\echo '=== Section 7: HS-9 summary — total unknown key occurrences ==='

WITH all_override_keys AS (
    SELECT kv.key AS override_key
    FROM import_review.address_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.admin_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.building_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.bus_route_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.bus_route_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.bus_route_variant_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.bus_stop_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.land_area_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.place_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.road_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.routing_barrier_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.routing_turn_restriction_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.water_line_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
    UNION ALL
    SELECT kv.key
    FROM import_review.water_polygon_candidates AS t
    CROSS JOIN LATERAL jsonb_each(t.review_overrides) AS kv(key, value)
    WHERE t.review_overrides <> '{}'::jsonb
      AND (:review_batch_id = 0 OR t.review_batch_id = :review_batch_id)
)
SELECT count(*)::bigint AS total_unknown_key_occurrences
FROM all_override_keys AS k
WHERE NOT EXISTS (
    SELECT 1
    FROM review_override_policy_keys AS p
    WHERE p.override_key = k.override_key
);
