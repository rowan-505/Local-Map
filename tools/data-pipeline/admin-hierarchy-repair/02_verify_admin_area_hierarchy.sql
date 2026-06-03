-- =============================================================================
-- 02_verify_admin_area_hierarchy.sql
-- Post-repair hierarchy verification (read-only; no UPDATE/DELETE).
--
-- Hard fail (raises, exits non-zero with ON_ERROR_STOP):
--   - self_parent > 0
--   - parent same or more detailed than child
--   - orphan parent_id
--   - invalid geometry on active areas > 0
--
-- Warnings (reported only):
--   - parent_id null on non-country levels
--   - child centroid outside parent geom
--   - overlapping same-level admin areas
--   - missing canonical_name
-- =============================================================================

\pset pager off
\timing off
\set ON_ERROR_STOP on

\echo ''
\echo '========================================================================'
\echo ' VERIFY — gate checks (hard fail vs warning)'
\echo '========================================================================'

-- Shared context (parity with 01_repair_admin_area_hierarchy.sql)
CREATE TEMP TABLE _verify_admin AS
SELECT
    a.id,
    a.public_id,
    a.external_id,
    a.parent_id,
    a.canonical_name,
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    a.geom,
    a.centroid,
    a.is_active,
    a.deleted_at,
    st_setsrid(
        coalesce(
            CASE
                WHEN a.centroid IS NOT NULL
                     AND NOT st_isempty(a.centroid)
                     AND st_isvalid(a.centroid)
                    THEN a.centroid
                ELSE NULL
            END,
            CASE
                WHEN a.geom IS NOT NULL
                     AND NOT st_isempty(a.geom)
                     AND st_isvalid(a.geom)
                    THEN st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
                ELSE NULL
            END
        ),
        4326
    )::geometry(Point, 4326) AS child_centroid,
    coalesce(
        al.rank::integer,
        CASE lower(trim(coalesce(al.code, '')))
            WHEN 'country' THEN 2
            WHEN 'state_region' THEN 4
            WHEN 'state' THEN 4
            WHEN 'division' THEN 4
            WHEN 'region' THEN 4
            WHEN 'district' THEN 5
            WHEN 'township' THEN 6
            WHEN 'town' THEN 6
            WHEN 'city' THEN 6
            WHEN 'suburb' THEN 7
            WHEN 'ward' THEN 7
            WHEN 'quarter' THEN 7
            WHEN 'village_tract' THEN 7
            WHEN 'village' THEN 8
            WHEN 'hamlet' THEN 8
            WHEN 'neighbourhood' THEN 9
            ELSE NULL
        END,
        99
    ) AS hierarchy_order,
    (
        lower(trim(coalesce(al.code, ''))) = 'country'
        OR coalesce(
            al.rank::integer,
            CASE lower(trim(coalesce(al.code, '')))
                WHEN 'country' THEN 2
                WHEN 'state_region' THEN 4
                WHEN 'state' THEN 4
                WHEN 'division' THEN 4
                WHEN 'region' THEN 4
                ELSE 99
            END
        ) <= 4
    ) AS is_country_level
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id;

CREATE TEMP TABLE _verify_gates AS
SELECT
    (SELECT count(*)::bigint
     FROM _verify_admin AS v
     WHERE v.deleted_at IS NULL
       AND v.is_active IS TRUE
       AND v.parent_id = v.id) AS self_parent_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS c
     INNER JOIN _verify_admin AS p ON p.id = c.parent_id
     WHERE c.deleted_at IS NULL
       AND c.is_active IS TRUE
       AND c.parent_id IS NOT NULL
       AND p.hierarchy_order >= c.hierarchy_order) AS parent_not_broader_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS c
     LEFT JOIN _verify_admin AS p ON p.id = c.parent_id
     WHERE c.deleted_at IS NULL
       AND c.is_active IS TRUE
       AND c.parent_id IS NOT NULL
       AND (
           p.id IS NULL
           OR p.is_active IS NOT TRUE
           OR p.deleted_at IS NOT NULL
       )) AS orphan_parent_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS v
     WHERE v.deleted_at IS NULL
       AND v.is_active IS TRUE
       AND v.geom IS NOT NULL
       AND NOT st_isempty(v.geom)
       AND NOT st_isvalid(v.geom)) AS invalid_geometry_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS v
     WHERE v.deleted_at IS NULL
       AND v.is_active IS TRUE
       AND NOT v.is_country_level
       AND v.parent_id IS NULL) AS parentless_non_country_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS c
     INNER JOIN _verify_admin AS p ON p.id = c.parent_id
     WHERE c.deleted_at IS NULL
       AND c.is_active IS TRUE
       AND c.parent_id IS NOT NULL
       AND c.child_centroid IS NOT NULL
       AND NOT st_isempty(c.child_centroid)
       AND p.geom IS NOT NULL
       AND NOT st_isempty(p.geom)
       AND st_isvalid(p.geom)
       AND NOT (
           st_contains(p.geom, c.child_centroid)
           OR st_intersects(p.geom, c.child_centroid)
       )) AS centroid_outside_parent_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS a1
     INNER JOIN _verify_admin AS a2
         ON a2.admin_level_id = a1.admin_level_id
        AND a2.id > a1.id
     WHERE a1.deleted_at IS NULL
       AND a2.deleted_at IS NULL
       AND a1.is_active IS TRUE
       AND a2.is_active IS TRUE
       AND a1.geom IS NOT NULL
       AND a2.geom IS NOT NULL
       AND NOT st_isempty(a1.geom)
       AND NOT st_isempty(a2.geom)
       AND st_isvalid(a1.geom)
       AND st_isvalid(a2.geom)
       AND st_intersects(a1.geom, a2.geom)
       AND NOT st_touches(a1.geom, a2.geom)) AS same_level_overlap_pair_count,

    (SELECT count(*)::bigint
     FROM _verify_admin AS v
     WHERE v.deleted_at IS NULL
       AND v.is_active IS TRUE
       AND (
           v.canonical_name IS NULL
           OR btrim(v.canonical_name) = ''
       )) AS missing_canonical_name_count;

SELECT
    'HARD_FAIL' AS severity,
    g.self_parent_count AS self_parent,
    g.parent_not_broader_count AS parent_same_or_more_detailed,
    g.orphan_parent_count AS orphan_parent_id,
    g.invalid_geometry_count AS invalid_geometry
FROM _verify_gates AS g;

SELECT
    'WARN' AS severity,
    g.parentless_non_country_count AS parentless_non_country,
    g.centroid_outside_parent_count AS centroid_outside_parent,
    g.same_level_overlap_pair_count AS same_level_overlapping_pairs,
    g.missing_canonical_name_count AS missing_canonical_name
FROM _verify_gates AS g;

\echo ''
\echo '========================================================================'
\echo ' Hierarchy summary by admin level (active, not deleted)'
\echo '========================================================================'

SELECT
    v.admin_level_id,
    v.admin_level_code,
    v.admin_level_name,
    v.hierarchy_order,
    count(*)::bigint AS area_count,
    count(*) FILTER (WHERE v.parent_id IS NOT NULL)::bigint AS with_parent_count,
    count(*) FILTER (WHERE v.parent_id IS NULL)::bigint AS parentless_count,
    count(*) FILTER (
        WHERE v.parent_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM _verify_admin AS p
              WHERE p.id = v.parent_id
                AND p.hierarchy_order >= v.hierarchy_order
          )
    )::bigint AS bad_parent_level_count,
    count(*) FILTER (WHERE v.parent_id = v.id)::bigint AS self_parent_count
FROM _verify_admin AS v
WHERE v.deleted_at IS NULL
  AND v.is_active IS TRUE
GROUP BY v.admin_level_id, v.admin_level_code, v.admin_level_name, v.hierarchy_order
ORDER BY v.hierarchy_order, v.admin_level_code;

\echo ''
\echo '========================================================================'
\echo ' Parentless rows by level (active; non-country only)'
\echo '========================================================================'

SELECT
    v.id,
    v.public_id,
    v.canonical_name,
    v.admin_level_code,
    v.admin_level_name,
    v.hierarchy_order,
    v.external_id
FROM _verify_admin AS v
WHERE v.deleted_at IS NULL
  AND v.is_active IS TRUE
  AND NOT v.is_country_level
  AND v.parent_id IS NULL
ORDER BY v.hierarchy_order, v.admin_level_code, v.id
LIMIT 50;

\echo ''
\echo '========================================================================'
\echo ' Sample child → parent pairs (up to 20)'
\echo '========================================================================'

SELECT
    c.id AS child_id,
    c.canonical_name AS child_name,
    c.admin_level_code AS child_level,
    c.hierarchy_order AS child_order,
    p.id AS parent_id,
    p.canonical_name AS parent_name,
    p.admin_level_code AS parent_level,
    p.hierarchy_order AS parent_order,
    CASE
        WHEN st_contains(p.geom, c.child_centroid) THEN 'contains_centroid'
        WHEN st_intersects(p.geom, c.child_centroid) THEN 'intersects_centroid'
        ELSE 'no_centroid_match'
    END AS spatial_relation
FROM _verify_admin AS c
INNER JOIN _verify_admin AS p ON p.id = c.parent_id
WHERE c.deleted_at IS NULL
  AND c.is_active IS TRUE
  AND c.parent_id IS NOT NULL
  AND p.hierarchy_order < c.hierarchy_order
ORDER BY c.hierarchy_order DESC, c.id
LIMIT 20;

\echo ''
\echo '========================================================================'
\echo ' Bad hierarchy rows (up to 40)'
\echo '========================================================================'

WITH bad AS (
    SELECT
        v.id,
        v.public_id,
        v.canonical_name,
        v.admin_level_code,
        v.parent_id,
        'self_parent'::text AS issue
    FROM _verify_admin AS v
    WHERE v.deleted_at IS NULL
      AND v.is_active IS TRUE
      AND v.parent_id = v.id

    UNION ALL

    SELECT
        c.id,
        c.public_id,
        c.canonical_name,
        c.admin_level_code,
        c.parent_id,
        'orphan_parent_id'
    FROM _verify_admin AS c
    LEFT JOIN _verify_admin AS p ON p.id = c.parent_id
    WHERE c.deleted_at IS NULL
      AND c.is_active IS TRUE
      AND c.parent_id IS NOT NULL
      AND (
          p.id IS NULL
          OR p.is_active IS NOT TRUE
          OR p.deleted_at IS NOT NULL
      )

    UNION ALL

    SELECT
        c.id,
        c.public_id,
        c.canonical_name,
        c.admin_level_code,
        c.parent_id,
        'parent_same_or_more_detailed'
    FROM _verify_admin AS c
    INNER JOIN _verify_admin AS p ON p.id = c.parent_id
    WHERE c.deleted_at IS NULL
      AND c.is_active IS TRUE
      AND p.hierarchy_order >= c.hierarchy_order

    UNION ALL

    SELECT
        v.id,
        v.public_id,
        v.canonical_name,
        v.admin_level_code,
        v.parent_id,
        'invalid_geometry'
    FROM _verify_admin AS v
    WHERE v.deleted_at IS NULL
      AND v.is_active IS TRUE
      AND v.geom IS NOT NULL
      AND NOT st_isempty(v.geom)
      AND NOT st_isvalid(v.geom)

    UNION ALL

    SELECT
        c.id,
        c.public_id,
        c.canonical_name,
        c.admin_level_code,
        c.parent_id,
        'centroid_outside_parent'
    FROM _verify_admin AS c
    INNER JOIN _verify_admin AS p ON p.id = c.parent_id
    WHERE c.deleted_at IS NULL
      AND c.is_active IS TRUE
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND p.geom IS NOT NULL
      AND NOT st_isempty(p.geom)
      AND st_isvalid(p.geom)
      AND NOT (
          st_contains(p.geom, c.child_centroid)
          OR st_intersects(p.geom, c.child_centroid)
      )

    UNION ALL

    SELECT
        v.id,
        v.public_id,
        v.canonical_name,
        v.admin_level_code,
        v.parent_id,
        'parentless_non_country'
    FROM _verify_admin AS v
    WHERE v.deleted_at IS NULL
      AND v.is_active IS TRUE
      AND NOT v.is_country_level
      AND v.parent_id IS NULL

    UNION ALL

    SELECT
        v.id,
        v.public_id,
        v.canonical_name,
        v.admin_level_code,
        v.parent_id,
        'missing_canonical_name'
    FROM _verify_admin AS v
    WHERE v.deleted_at IS NULL
      AND v.is_active IS TRUE
      AND (v.canonical_name IS NULL OR btrim(v.canonical_name) = '')
)
SELECT *
FROM bad
ORDER BY
    CASE issue
        WHEN 'self_parent' THEN 1
        WHEN 'orphan_parent_id' THEN 2
        WHEN 'parent_same_or_more_detailed' THEN 3
        WHEN 'invalid_geometry' THEN 4
        WHEN 'centroid_outside_parent' THEN 5
        WHEN 'parentless_non_country' THEN 6
        WHEN 'missing_canonical_name' THEN 7
        ELSE 99
    END,
    id
LIMIT 40;

\echo ''
\echo '--- Same-level overlap sample (up to 10 pairs) ---'

SELECT
    a1.id AS area_a_id,
    a1.canonical_name AS area_a_name,
    a2.id AS area_b_id,
    a2.canonical_name AS area_b_name,
    a1.admin_level_code,
    st_area(st_intersection(a1.geom, a2.geom)::geography) AS overlap_area_m2
FROM _verify_admin AS a1
INNER JOIN _verify_admin AS a2
    ON a2.admin_level_id = a1.admin_level_id
   AND a2.id > a1.id
WHERE a1.deleted_at IS NULL
  AND a2.deleted_at IS NULL
  AND a1.is_active IS TRUE
  AND a2.is_active IS TRUE
  AND a1.geom IS NOT NULL
  AND a2.geom IS NOT NULL
  AND NOT st_isempty(a1.geom)
  AND NOT st_isempty(a2.geom)
  AND st_isvalid(a1.geom)
  AND st_isvalid(a2.geom)
  AND st_intersects(a1.geom, a2.geom)
  AND NOT st_touches(a1.geom, a2.geom)
ORDER BY overlap_area_m2 DESC NULLS LAST
LIMIT 10;

\echo ''
\echo '========================================================================'
\echo ' Hard-fail gate (raises on failure)'
\echo '========================================================================'

DO $verify$
DECLARE
    g record;
    v_msgs text[] := ARRAY[]::text[];
BEGIN
    SELECT * INTO g FROM _verify_gates;

    IF g.self_parent_count > 0 THEN
        v_msgs := array_append(v_msgs, format('self_parent=%s', g.self_parent_count));
    END IF;
    IF g.parent_not_broader_count > 0 THEN
        v_msgs := array_append(
            v_msgs,
            format('parent_same_or_more_detailed=%s', g.parent_not_broader_count)
        );
    END IF;
    IF g.orphan_parent_count > 0 THEN
        v_msgs := array_append(v_msgs, format('orphan_parent_id=%s', g.orphan_parent_count));
    END IF;
    IF g.invalid_geometry_count > 0 THEN
        v_msgs := array_append(v_msgs, format('invalid_geometry=%s', g.invalid_geometry_count));
    END IF;

    IF coalesce(array_length(v_msgs, 1), 0) > 0 THEN
        RAISE EXCEPTION 'Admin hierarchy verification FAILED: %', array_to_string(v_msgs, ', ');
    END IF;

    RAISE NOTICE 'Admin hierarchy verification PASSED (hard-fail gates)';
    IF g.parentless_non_country_count > 0 THEN
        RAISE WARNING 'WARN parentless_non_country=%', g.parentless_non_country_count;
    END IF;
    IF g.centroid_outside_parent_count > 0 THEN
        RAISE WARNING 'WARN centroid_outside_parent=%', g.centroid_outside_parent_count;
    END IF;
    IF g.same_level_overlap_pair_count > 0 THEN
        RAISE WARNING 'WARN same_level_overlapping_pairs=%', g.same_level_overlap_pair_count;
    END IF;
    IF g.missing_canonical_name_count > 0 THEN
        RAISE WARNING 'WARN missing_canonical_name=%', g.missing_canonical_name_count;
    END IF;
END $verify$;
