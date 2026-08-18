-- =============================================================================
-- 00_inspect_admin_area_health.sql
-- Read-only health report for core.core_admin_areas (+ optional entity assignment).
-- Uses only core.core_admin_areas and ref.ref_admin_levels unless
-- inspect_entity_assignment=true (then also places/streets/buildings).
-- Does not touch import_review. No UPDATE/DELETE.
-- =============================================================================

\pset pager off
\timing off
\set ON_ERROR_STOP on

\echo ''
\echo '========================================================================'
\echo ' ADMIN AREAS — inventory'
\echo '========================================================================'

SELECT
    'total_admin_areas' AS metric,
    count(*)::bigint AS value,
    'all rows including soft-deleted' AS note
FROM core.core_admin_areas;

SELECT
    'active_not_deleted' AS metric,
    count(*)::bigint AS value,
    'is_active AND deleted_at IS NULL' AS note
FROM core.core_admin_areas AS a
WHERE a.is_active IS TRUE
  AND a.deleted_at IS NULL;

\echo ''
\echo '--- Count by admin_level_id (ref code / name) ---'

SELECT
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    al.rank AS admin_level_rank,
    count(*)::bigint AS total_count,
    count(*) FILTER (WHERE a.is_active IS TRUE AND a.deleted_at IS NULL)::bigint AS active_count
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
GROUP BY a.admin_level_id, al.code, al.name, al.rank
ORDER BY al.rank NULLS LAST, al.code NULLS LAST, a.admin_level_id;

\echo ''
\echo '--- parent_id IS NULL count by admin level ---'

SELECT
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    count(*)::bigint AS parent_null_count
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
WHERE a.deleted_at IS NULL
  AND a.parent_id IS NULL
GROUP BY a.admin_level_id, al.code, al.name, al.rank
ORDER BY al.rank NULLS LAST, al.code NULLS LAST;

\echo ''
\echo '========================================================================'
\echo ' ADMIN AREAS — geometry'
\echo '========================================================================'

SELECT
    'null_geometry' AS issue,
    count(*)::bigint AS row_count,
    count(*) FILTER (WHERE a.is_active IS TRUE AND a.deleted_at IS NULL)::bigint AS active_row_count
FROM core.core_admin_areas AS a
WHERE a.deleted_at IS NULL
  AND (a.geom IS NULL OR st_isempty(a.geom));

SELECT
    'invalid_geometry' AS issue,
    count(*)::bigint AS row_count,
    count(*) FILTER (WHERE a.is_active IS TRUE AND a.deleted_at IS NULL)::bigint AS active_row_count
FROM core.core_admin_areas AS a
WHERE a.deleted_at IS NULL
  AND a.geom IS NOT NULL
  AND NOT st_isempty(a.geom)
  AND NOT st_isvalid(a.geom);

SELECT
    'null_or_invalid_centroid' AS issue,
    count(*)::bigint AS row_count,
    count(*) FILTER (WHERE a.is_active IS TRUE AND a.deleted_at IS NULL)::bigint AS active_row_count
FROM core.core_admin_areas AS a
WHERE a.deleted_at IS NULL
  AND (
      a.centroid IS NULL
      OR st_isempty(a.centroid)
      OR NOT st_isvalid(a.centroid)
  );

\echo ''
\echo '========================================================================'
\echo ' ADMIN AREAS — external_id duplicates'
\echo '========================================================================'

SELECT
    'duplicate_external_id_groups' AS metric,
    count(*)::bigint AS value
FROM (
    SELECT a.external_id
    FROM core.core_admin_areas AS a
    WHERE a.external_id IS NOT NULL
      AND btrim(a.external_id) <> ''
    GROUP BY a.external_id
    HAVING count(*) > 1
) AS d;

SELECT
    'rows_in_duplicate_external_id_groups' AS metric,
    count(*)::bigint AS value
FROM core.core_admin_areas AS a
WHERE a.external_id IS NOT NULL
  AND btrim(a.external_id) <> ''
  AND a.external_id IN (
      SELECT x.external_id
      FROM core.core_admin_areas AS x
      WHERE x.external_id IS NOT NULL
        AND btrim(x.external_id) <> ''
      GROUP BY x.external_id
      HAVING count(*) > 1
  );

\echo ''
\echo '--- Top duplicate external_id values (sample) ---'

SELECT
    a.external_id,
    count(*)::bigint AS row_count,
    array_agg(a.id ORDER BY a.id) AS admin_area_ids
FROM core.core_admin_areas AS a
WHERE a.external_id IS NOT NULL
  AND btrim(a.external_id) <> ''
GROUP BY a.external_id
HAVING count(*) > 1
ORDER BY row_count DESC, a.external_id
LIMIT 15;

\echo ''
\echo '========================================================================'
\echo ' ADMIN AREAS — parent_id integrity'
\echo '========================================================================'

SELECT
    'self_parent' AS issue,
    count(*)::bigint AS row_count
FROM core.core_admin_areas AS a
WHERE a.deleted_at IS NULL
  AND a.parent_id = a.id;

SELECT
    'orphan_parent_id' AS issue,
    count(*)::bigint AS row_count,
    'parent_id set but parent row missing/inactive/deleted' AS note
FROM core.core_admin_areas AS a
LEFT JOIN core.core_admin_areas AS p ON p.id = a.parent_id
WHERE a.deleted_at IS NULL
  AND a.parent_id IS NOT NULL
  AND (
      p.id IS NULL
      OR p.is_active IS NOT TRUE
      OR p.deleted_at IS NOT NULL
  );

SELECT
    'parent_same_or_lower_detail' AS issue,
    count(*)::bigint AS row_count,
    'parent ref.rank >= child rank (parent not coarser)' AS note
FROM core.core_admin_areas AS a
INNER JOIN ref.ref_admin_levels AS al_child ON al_child.id = a.admin_level_id
INNER JOIN core.core_admin_areas AS p ON p.id = a.parent_id
INNER JOIN ref.ref_admin_levels AS al_parent ON al_parent.id = p.admin_level_id
WHERE a.deleted_at IS NULL
  AND al_parent.rank >= al_child.rank;

\if :inspect_entity_assignment

\echo ''
\echo '========================================================================'
\echo ' ENTITY ADMIN ASSIGNMENT — summary counts'
\echo '========================================================================'

SELECT
    'places_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM core.core_places AS p
WHERE p.deleted_at IS NULL
  AND p.admin_area_id IS NULL;

SELECT
    'places_point_outside_assigned_admin_geom' AS metric,
    count(*)::bigint AS value
FROM core.core_places AS p
INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
WHERE p.deleted_at IS NULL
  AND p.admin_area_id IS NOT NULL
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT (
      st_covers(aa.geom, p.point_geom)
      OR st_intersects(aa.geom, p.point_geom)
  );

SELECT
    'places_invalid_admin_fk' AS metric,
    count(*)::bigint AS value
FROM core.core_places AS p
LEFT JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
WHERE p.deleted_at IS NULL
  AND p.admin_area_id IS NOT NULL
  AND (
      aa.id IS NULL
      OR aa.is_active IS NOT TRUE
      OR aa.deleted_at IS NOT NULL
  );

SELECT
    'streets_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM core.core_streets AS s
WHERE s.deleted_at IS NULL
  AND coalesce(s.is_active, true) IS TRUE
  AND s.admin_area_id IS NULL;

SELECT
    'streets_geom_no_intersect_assigned_admin' AS metric,
    count(*)::bigint AS value
FROM core.core_streets AS s
INNER JOIN core.core_admin_areas AS aa ON aa.id = s.admin_area_id
WHERE s.deleted_at IS NULL
  AND coalesce(s.is_active, true) IS TRUE
  AND s.admin_area_id IS NOT NULL
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
  AND st_isvalid(s.geom)
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT st_intersects(s.geom, aa.geom);

SELECT
    'streets_invalid_admin_fk' AS metric,
    count(*)::bigint AS value
FROM core.core_streets AS s
LEFT JOIN core.core_admin_areas AS aa ON aa.id = s.admin_area_id
WHERE s.deleted_at IS NULL
  AND coalesce(s.is_active, true) IS TRUE
  AND s.admin_area_id IS NOT NULL
  AND (
      aa.id IS NULL
      OR aa.is_active IS NOT TRUE
      OR aa.deleted_at IS NOT NULL
  );

SELECT
    'buildings_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM core.core_buildings AS b
WHERE b.deleted_at IS NULL
  AND coalesce(b.is_active, true) IS TRUE
  AND b.admin_area_id IS NULL;

SELECT
    'buildings_rep_point_outside_assigned_admin_geom' AS metric,
    count(*)::bigint AS value
FROM core.core_buildings AS b
INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
CROSS JOIN LATERAL (
    SELECT st_setsrid(
        coalesce(
            CASE
                WHEN b.centroid IS NOT NULL
                     AND NOT st_isempty(b.centroid)
                     AND st_isvalid(b.centroid)
                    THEN b.centroid
                ELSE NULL
            END,
            CASE
                WHEN b.geom IS NOT NULL
                     AND NOT st_isempty(b.geom)
                     AND st_isvalid(b.geom)
                    THEN st_pointonsurface(st_makevalid(st_setsrid(b.geom, 4326)))
                ELSE NULL
            END
        ),
        4326
    )::geometry(Point, 4326) AS rep_point
) AS rp
WHERE b.deleted_at IS NULL
  AND coalesce(b.is_active, true) IS TRUE
  AND b.admin_area_id IS NOT NULL
  AND rp.rep_point IS NOT NULL
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT (
      st_covers(aa.geom, rp.rep_point)
      OR st_intersects(aa.geom, rp.rep_point)
  );

SELECT
    'buildings_invalid_admin_fk' AS metric,
    count(*)::bigint AS value
FROM core.core_buildings AS b
LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
WHERE b.deleted_at IS NULL
  AND coalesce(b.is_active, true) IS TRUE
  AND b.admin_area_id IS NOT NULL
  AND (
      aa.id IS NULL
      OR aa.is_active IS NOT TRUE
      OR aa.deleted_at IS NOT NULL
  );

\echo ''
\echo '========================================================================'
\echo ' SAMPLE BAD ROWS — admin areas (up to 30)'
\echo '========================================================================'

WITH issues AS (
    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al.code AS admin_level_code,
        a.parent_id,
        'self_parent'::text AS issue
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    WHERE a.deleted_at IS NULL
      AND a.parent_id = a.id

    UNION ALL

    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al.code,
        a.parent_id,
        'orphan_parent_id'
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    LEFT JOIN core.core_admin_areas AS p ON p.id = a.parent_id
    WHERE a.deleted_at IS NULL
      AND a.parent_id IS NOT NULL
      AND (
          p.id IS NULL
          OR p.is_active IS NOT TRUE
          OR p.deleted_at IS NOT NULL
      )

    UNION ALL

    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al_child.code,
        a.parent_id,
        'parent_same_or_lower_detail'
    FROM core.core_admin_areas AS a
    INNER JOIN ref.ref_admin_levels AS al_child ON al_child.id = a.admin_level_id
    INNER JOIN core.core_admin_areas AS p ON p.id = a.parent_id
    INNER JOIN ref.ref_admin_levels AS al_parent ON al_parent.id = p.admin_level_id
    WHERE a.deleted_at IS NULL
      AND al_parent.rank >= al_child.rank

    UNION ALL

    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al.code,
        a.parent_id,
        'null_geometry'
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    WHERE a.deleted_at IS NULL
      AND (a.geom IS NULL OR st_isempty(a.geom))

    UNION ALL

    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al.code,
        a.parent_id,
        'invalid_geometry'
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    WHERE a.deleted_at IS NULL
      AND a.geom IS NOT NULL
      AND NOT st_isempty(a.geom)
      AND NOT st_isvalid(a.geom)

    UNION ALL

    SELECT
        a.id,
        a.public_id,
        a.canonical_name,
        a.external_id,
        al.code,
        a.parent_id,
        'null_or_invalid_centroid'
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    WHERE a.deleted_at IS NULL
      AND (
          a.centroid IS NULL
          OR st_isempty(a.centroid)
          OR NOT st_isvalid(a.centroid)
      )
)
SELECT *
FROM issues
ORDER BY issue, id
LIMIT 30;

\echo ''
\echo '========================================================================'
\echo ' SAMPLE BAD ROWS — places (up to 15)'
\echo '========================================================================'

(
    SELECT
        'null_admin_area_id'::text AS issue,
        p.id,
        p.public_id,
        p.display_name,
        p.admin_area_id,
        NULL::text AS admin_level_code,
        NULL::text AS admin_canonical_name
    FROM core.core_places AS p
    WHERE p.deleted_at IS NULL
      AND p.admin_area_id IS NULL
    ORDER BY p.id
    LIMIT 5
)
UNION ALL
(
    SELECT
        'point_outside_assigned_admin_geom',
        p.id,
        p.public_id,
        p.display_name,
        p.admin_area_id,
        al.code,
        aa.canonical_name
    FROM core.core_places AS p
    INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE p.deleted_at IS NULL
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND NOT (
          st_covers(aa.geom, p.point_geom)
          OR st_intersects(aa.geom, p.point_geom)
      )
    ORDER BY p.id
    LIMIT 10
);

\echo ''
\echo '========================================================================'
\echo ' SAMPLE BAD ROWS — streets / roads (up to 15)'
\echo '========================================================================'

(
    SELECT
        'null_admin_area_id'::text AS issue,
        s.id,
        s.public_id,
        s.canonical_name AS name,
        s.admin_area_id,
        NULL::text AS admin_level_code,
        NULL::text AS admin_canonical_name
    FROM core.core_streets AS s
    WHERE s.deleted_at IS NULL
      AND coalesce(s.is_active, true) IS TRUE
      AND s.admin_area_id IS NULL
    ORDER BY s.id
    LIMIT 5
)
UNION ALL
(
    SELECT
        'geom_no_intersect_assigned_admin',
        s.id,
        s.public_id,
        s.canonical_name,
        s.admin_area_id,
        al.code,
        aa.canonical_name
    FROM core.core_streets AS s
    INNER JOIN core.core_admin_areas AS aa ON aa.id = s.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE s.deleted_at IS NULL
      AND coalesce(s.is_active, true) IS TRUE
      AND s.geom IS NOT NULL
      AND NOT st_isempty(s.geom)
      AND st_isvalid(s.geom)
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND NOT st_intersects(s.geom, aa.geom)
    ORDER BY s.id
    LIMIT 10
);

\echo ''
\echo '========================================================================'
\echo ' SAMPLE BAD ROWS — buildings (up to 15)'
\echo '========================================================================'

(
    SELECT
        'null_admin_area_id'::text AS issue,
        b.id,
        b.public_id,
        coalesce(b.name, b.external_id) AS name,
        b.admin_area_id,
        NULL::text AS admin_level_code,
        NULL::text AS admin_canonical_name
    FROM core.core_buildings AS b
    WHERE b.deleted_at IS NULL
      AND coalesce(b.is_active, true) IS TRUE
      AND b.admin_area_id IS NULL
    ORDER BY b.id
    LIMIT 5
)
UNION ALL
(
    SELECT
        'rep_point_outside_assigned_admin_geom',
        b.id,
        b.public_id,
        coalesce(b.name, b.external_id),
        b.admin_area_id,
        al.code,
        aa.canonical_name
    FROM core.core_buildings AS b
    INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    CROSS JOIN LATERAL (
        SELECT st_setsrid(
            coalesce(
                CASE
                    WHEN b.centroid IS NOT NULL
                         AND NOT st_isempty(b.centroid)
                         AND st_isvalid(b.centroid)
                        THEN b.centroid
                    ELSE NULL
                END,
                CASE
                    WHEN b.geom IS NOT NULL
                         AND NOT st_isempty(b.geom)
                         AND st_isvalid(b.geom)
                        THEN st_pointonsurface(st_makevalid(st_setsrid(b.geom, 4326)))
                    ELSE NULL
                END
            ),
            4326
        )::geometry(Point, 4326) AS rep_point
    ) AS rp
    WHERE b.deleted_at IS NULL
      AND coalesce(b.is_active, true) IS TRUE
      AND rp.rep_point IS NOT NULL
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND NOT (
          st_covers(aa.geom, rp.rep_point)
          OR st_intersects(aa.geom, rp.rep_point)
      )
    ORDER BY b.id
    LIMIT 10
);

\else
\echo ''
\echo '=== Skipped entity assignment checks (inspect_entity_assignment=false) ==='
\endif

\echo ''
\echo '=== Inspection complete (read-only) ==='
