-- =============================================================================
-- verify_streets_admin_area_id.sql
-- Read-only verification for core.core_streets township admin_area_id assignment.
-- Does not touch places, buildings, or other entities.
-- =============================================================================

\set ON_ERROR_STOP on
\ir ../admin-hierarchy-repair/_psql_session_defaults.sql

\echo '=== Streets admin_area_id verification (township-only) ==='

DO $$
BEGIN
    IF to_regprocedure('core.admin_area_row_matches_target(bigint,text,text,text)') IS NULL THEN
        RAISE WARNING 'admin_area_row_matches_target missing — run admin-hierarchy-repair stage 03 for full checks';
    END IF;
END $$;

DROP TABLE IF EXISTS _verify_streets_admin;
CREATE TEMP TABLE _verify_streets_admin ON COMMIT DROP AS
SELECT
    s.id,
    s.public_id,
    s.admin_area_id,
    s.is_active,
    s.is_verified,
    s.deleted_at,
    s.geom,
    CASE
        WHEN s.admin_area_id IS NULL THEN 'null'
        WHEN NOT EXISTS (
            SELECT 1
            FROM core.core_admin_areas AS aa
            WHERE aa.id = s.admin_area_id
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
        ) THEN 'invalid_fk'
        WHEN to_regprocedure('core.admin_area_row_matches_target(bigint,text,text,text)') IS NOT NULL
             AND EXISTS (
                 SELECT 1
                 FROM core.core_admin_areas AS aa
                 INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                 WHERE aa.id = s.admin_area_id
                   AND aa.is_active IS TRUE
                   AND aa.deleted_at IS NULL
                   AND core.admin_area_row_matches_target(
                       aa.admin_level_id,
                       al.code,
                       al.name,
                       'township'
                   )
             )
            THEN 'township'
        WHEN s.admin_area_id IS NOT NULL THEN 'non_township'
        ELSE 'null'
    END AS assignment_kind
FROM core.core_streets AS s
WHERE coalesce(s.is_active, true) IS TRUE
  AND (
      NOT EXISTS (
          SELECT 1
          FROM information_schema.columns AS c
          WHERE c.table_schema = 'core'
            AND c.table_name = 'core_streets'
            AND c.column_name = 'deleted_at'
      )
      OR s.deleted_at IS NULL
  );

\echo ''
\echo '--- summary counts (active, not-deleted streets) ---'

SELECT 'streets_total_active' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin;

SELECT 'streets_null_admin_area_id' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin AS v
WHERE v.assignment_kind = 'null';

SELECT 'streets_assigned_township' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin AS v
WHERE v.assignment_kind = 'township';

SELECT 'streets_assigned_non_township' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin AS v
WHERE v.assignment_kind = 'non_township';

SELECT 'streets_invalid_admin_area_fk' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin AS v
WHERE v.assignment_kind = 'invalid_fk';

SELECT 'streets_needing_repair' AS metric, count(*)::bigint AS value
FROM _verify_streets_admin AS v
WHERE v.assignment_kind IN ('null', 'invalid_fk', 'non_township');

\echo ''
\echo '--- overlap inference spot-check (first 20 needing repair, read-only) ---'

SELECT
    v.id,
    v.public_id,
    v.admin_area_id AS current_admin_area_id,
    v.assignment_kind,
    core.find_admin_area_for_line(v.geom, 'township') AS inferred_township_id
FROM _verify_streets_admin AS v
WHERE v.assignment_kind IN ('null', 'invalid_fk', 'non_township')
  AND v.geom IS NOT NULL
  AND NOT st_isempty(v.geom)
  AND st_isvalid(v.geom)
  AND to_regprocedure('core.find_admin_area_for_line(geometry,text)') IS NOT NULL
ORDER BY v.id
LIMIT 20;

\echo ''
\echo '--- sample non-township assignments (limit 20) ---'

SELECT
    v.id,
    v.public_id,
    v.admin_area_id,
    aa.canonical_name AS admin_area_name,
    al.code AS admin_level_code,
    al.name AS admin_level_name
FROM _verify_streets_admin AS v
LEFT JOIN core.core_admin_areas AS aa ON aa.id = v.admin_area_id
LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
WHERE v.assignment_kind = 'non_township'
ORDER BY v.id
LIMIT 20;
