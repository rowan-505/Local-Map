-- =============================================================================
-- 07_verify_entity_admin_assignment.sql
-- Post-backfill verification for places, streets (roads), and buildings.
--
-- Read-only verification (no UPDATE).
--
-- Hard fail:
--   - admin_area_id points to missing/inactive admin area (orphan FK)
--
-- Warnings only:
--   - null admin_area_id
--   - geometry mismatch with assigned admin_area_id
--   - no matching best/minimum admin area for entity geometry
--   - verified / manual_override rows still needing repair
-- =============================================================================

\pset pager off
\timing off
\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

\echo ''
\echo '========================================================================'
\echo ' ENTITY ADMIN ASSIGNMENT — metrics by type'
\echo '========================================================================'

CREATE TEMP TABLE _verify_places AS
SELECT
    p.id,
    p.admin_area_id,
    p.is_verified,
    coalesce(
        CASE
            WHEN p.point_geom IS NOT NULL
                 AND NOT st_isempty(p.point_geom)
                 AND st_isvalid(p.point_geom)
                THEN p.point_geom
            ELSE NULL
        END,
        CASE
            WHEN p.entry_geom IS NOT NULL
                 AND NOT st_isempty(p.entry_geom)
                 AND st_isvalid(p.entry_geom)
                THEN p.entry_geom
            ELSE NULL
        END,
        st_setsrid(st_makepoint(p.lng, p.lat), 4326)
    ) AS lookup_geom,
    core.entity_rep_point_for_admin_lookup(
        coalesce(
            CASE
                WHEN p.point_geom IS NOT NULL
                     AND NOT st_isempty(p.point_geom)
                     AND st_isvalid(p.point_geom)
                    THEN p.point_geom
                ELSE NULL
            END,
            CASE
                WHEN p.entry_geom IS NOT NULL
                     AND NOT st_isempty(p.entry_geom)
                     AND st_isvalid(p.entry_geom)
                    THEN p.entry_geom
                ELSE NULL
            END,
            st_setsrid(st_makepoint(p.lng, p.lat), 4326)
        )
    ) AS rep_point,
    false::boolean AS manual_override,
    NULL::text AS verification_status
FROM core.core_places AS p
WHERE p.deleted_at IS NULL;

CREATE TEMP TABLE _verify_roads AS
SELECT
    s.id,
    s.admin_area_id,
    s.geom,
    s.is_verified,
    coalesce(s.manual_override, false) AS manual_override,
    NULL::text AS verification_status
FROM core.core_streets AS s
WHERE s.deleted_at IS NULL
  AND coalesce(s.is_active, true) IS TRUE
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
  AND st_isvalid(s.geom);

CREATE TEMP TABLE _verify_buildings AS
SELECT
    b.id,
    b.admin_area_id,
    b.geom,
    b.centroid,
    b.is_verified,
    false::boolean AS manual_override,
    NULL::text AS verification_status,
    st_setsrid(
        coalesce(
            CASE
                WHEN b.centroid IS NOT NULL
                     AND NOT st_isempty(b.centroid)
                     AND st_isvalid(b.centroid)
                    THEN b.centroid
                ELSE NULL
            END,
            st_pointonsurface(st_makevalid(st_setsrid(b.geom, 4326)))
        ),
        4326
    )::geometry(Point, 4326) AS lookup_point
FROM core.core_map_buildings AS b
WHERE b.deleted_at IS NULL
  AND coalesce(b.is_active, true) IS TRUE
  AND b.geom IS NOT NULL
  AND NOT st_isempty(b.geom)
  AND st_isvalid(b.geom);

DO $cols$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_places'
          AND c.column_name = 'manual_override'
    ) THEN
        EXECUTE $sql$
            UPDATE _verify_places AS p
            SET manual_override = coalesce(src.manual_override, false)
            FROM core.core_places AS src
            WHERE src.id = p.id
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_map_buildings'
          AND c.column_name = 'manual_override'
    ) THEN
        EXECUTE $sql$
            UPDATE _verify_buildings AS b
            SET manual_override = coalesce(src.manual_override, false)
            FROM core.core_map_buildings AS src
            WHERE src.id = b.id
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_places'
          AND c.column_name = 'verification_status'
    ) THEN
        EXECUTE $sql$
            UPDATE _verify_places AS p
            SET verification_status = src.verification_status
            FROM core.core_places AS src
            WHERE src.id = p.id
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'verification_status'
    ) THEN
        EXECUTE $sql$
            UPDATE _verify_roads AS r
            SET verification_status = src.verification_status
            FROM core.core_streets AS src
            WHERE src.id = r.id
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_map_buildings'
          AND c.column_name = 'verification_status'
    ) THEN
        EXECUTE $sql$
            UPDATE _verify_buildings AS b
            SET verification_status = src.verification_status
            FROM core.core_map_buildings AS src
            WHERE src.id = b.id
        $sql$;
    END IF;
END $cols$;

\echo ''
\echo '--- Places ---'

SELECT 'places' AS entity, 'linked_to_active_admin' AS metric, count(*)::bigint AS value
FROM _verify_places AS p
INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
WHERE p.admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL;

SELECT 'places' AS entity, 'null_admin_area_id' AS metric, count(*)::bigint AS value
FROM _verify_places AS p
WHERE p.admin_area_id IS NULL;

SELECT 'places' AS entity, 'point_outside_assigned_admin' AS metric, count(*)::bigint AS value
FROM _verify_places AS p
INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
WHERE p.admin_area_id IS NOT NULL
  AND p.rep_point IS NOT NULL
  AND NOT st_isempty(p.rep_point)
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT (
      st_covers(aa.geom, p.rep_point)
      OR st_intersects(aa.geom, p.rep_point)
  );

\echo ''
\echo '--- Roads (core.core_streets) ---'

SELECT 'roads' AS entity, 'linked_to_active_admin' AS metric, count(*)::bigint AS value
FROM _verify_roads AS r
INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
WHERE r.admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL;

SELECT 'roads' AS entity, 'null_admin_area_id' AS metric, count(*)::bigint AS value
FROM _verify_roads AS r
WHERE r.admin_area_id IS NULL;

SELECT 'roads' AS entity, 'geom_no_intersect_assigned_admin' AS metric, count(*)::bigint AS value
FROM _verify_roads AS r
INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
WHERE r.admin_area_id IS NOT NULL
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT st_intersects(r.geom, aa.geom);

\echo ''
\echo '--- Buildings ---'

SELECT 'buildings' AS entity, 'linked_to_active_admin' AS metric, count(*)::bigint AS value
FROM _verify_buildings AS b
INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
WHERE b.admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL;

SELECT 'buildings' AS entity, 'null_admin_area_id' AS metric, count(*)::bigint AS value
FROM _verify_buildings AS b
WHERE b.admin_area_id IS NULL;

SELECT 'buildings' AS entity, 'lookup_point_outside_assigned_admin' AS metric, count(*)::bigint AS value
FROM _verify_buildings AS b
INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
WHERE b.admin_area_id IS NOT NULL
  AND b.lookup_point IS NOT NULL
  AND NOT st_isempty(b.lookup_point)
  AND aa.geom IS NOT NULL
  AND NOT st_isempty(aa.geom)
  AND st_isvalid(aa.geom)
  AND NOT (
      st_covers(aa.geom, b.lookup_point)
      OR st_intersects(aa.geom, b.lookup_point)
  );

\echo ''
\echo '========================================================================'
\echo ' Key assignment metrics (whole-country summary)'
\echo '========================================================================'

SELECT 'roads_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM _verify_roads AS r
WHERE r.admin_area_id IS NULL;

SELECT 'roads_assigned_to_township' AS metric,
    count(*)::bigint AS value
FROM _verify_roads AS r
INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
WHERE r.admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL
  AND core.admin_area_row_matches_target(
      aa.admin_level_id,
      aa.level_code,
      aa.level_name,
      'township'
  );

SELECT 'roads_assigned_to_non_township' AS metric,
    count(*)::bigint AS value
FROM _verify_roads AS r
INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
WHERE r.admin_area_id IS NOT NULL
  AND aa.is_active IS TRUE
  AND aa.deleted_at IS NULL
  AND NOT core.admin_area_row_matches_target(
      aa.admin_level_id,
      aa.level_code,
      aa.level_name,
      'township'
  );

SELECT 'places_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM _verify_places AS p
WHERE p.admin_area_id IS NULL;

SELECT 'buildings_null_admin_area_id' AS metric,
    count(*)::bigint AS value
FROM _verify_buildings AS b
WHERE b.admin_area_id IS NULL;

SELECT 'invalid_admin_assignment_count' AS metric,
    (
        (SELECT count(*)::bigint
         FROM _verify_places AS p
         LEFT JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
         WHERE p.admin_area_id IS NOT NULL
           AND (
               aa.id IS NULL
               OR aa.is_active IS NOT TRUE
               OR aa.deleted_at IS NOT NULL
               OR (
                   p.rep_point IS NOT NULL
                   AND NOT st_isempty(p.rep_point)
                   AND aa.geom IS NOT NULL
                   AND NOT st_isempty(aa.geom)
                   AND st_isvalid(aa.geom)
                   AND NOT (
                       st_covers(aa.geom, p.rep_point)
                       OR st_intersects(aa.geom, p.rep_point)
                   )
               )
           ))
        + (SELECT count(*)::bigint
           FROM _verify_roads AS r
           LEFT JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
           WHERE r.admin_area_id IS NOT NULL
             AND (
                 aa.id IS NULL
                 OR aa.is_active IS NOT TRUE
                 OR aa.deleted_at IS NOT NULL
                 OR (
                     aa.geom IS NOT NULL
                     AND NOT st_isempty(aa.geom)
                     AND st_isvalid(aa.geom)
                     AND NOT st_intersects(r.geom, aa.geom)
                 )
             ))
        + (SELECT count(*)::bigint
           FROM _verify_buildings AS b
           LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
           WHERE b.admin_area_id IS NOT NULL
             AND (
                 aa.id IS NULL
                 OR aa.is_active IS NOT TRUE
                 OR aa.deleted_at IS NOT NULL
                 OR (
                     b.lookup_point IS NOT NULL
                     AND NOT st_isempty(b.lookup_point)
                     AND aa.geom IS NOT NULL
                     AND NOT st_isempty(aa.geom)
                     AND st_isvalid(aa.geom)
                     AND NOT (
                         st_covers(aa.geom, b.lookup_point)
                         OR st_intersects(aa.geom, b.lookup_point)
                     )
                 )
             ))
    ) AS value;

\echo ''
\echo '========================================================================'
\echo ' Gate summary (hard fail vs warning)'
\echo '========================================================================'

CREATE TEMP TABLE _entity_verify_gates AS
SELECT
    (SELECT count(*)::bigint FROM _verify_places AS p
     LEFT JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
     WHERE p.admin_area_id IS NOT NULL
       AND (aa.id IS NULL OR aa.is_active IS NOT TRUE OR aa.deleted_at IS NOT NULL))
    + (SELECT count(*)::bigint FROM _verify_roads AS r
       LEFT JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
       WHERE r.admin_area_id IS NOT NULL
         AND (aa.id IS NULL OR aa.is_active IS NOT TRUE OR aa.deleted_at IS NOT NULL))
    + (SELECT count(*)::bigint FROM _verify_buildings AS b
       LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
       WHERE b.admin_area_id IS NOT NULL
         AND (aa.id IS NULL OR aa.is_active IS NOT TRUE OR aa.deleted_at IS NOT NULL))
        AS orphan_admin_fk_total,

    (SELECT count(*)::bigint
     FROM _verify_places AS p
     INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
     WHERE p.admin_area_id IS NOT NULL
       AND aa.is_active IS TRUE
       AND aa.deleted_at IS NULL
       AND p.rep_point IS NOT NULL
       AND NOT st_isempty(p.rep_point)
       AND aa.geom IS NOT NULL
       AND NOT st_isempty(aa.geom)
       AND st_isvalid(aa.geom)
       AND NOT (st_covers(aa.geom, p.rep_point) OR st_intersects(aa.geom, p.rep_point)))
    + (SELECT count(*)::bigint
       FROM _verify_roads AS r
       INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
       WHERE r.admin_area_id IS NOT NULL
         AND aa.is_active IS TRUE
         AND aa.deleted_at IS NULL
         AND aa.geom IS NOT NULL
         AND NOT st_isempty(aa.geom)
         AND st_isvalid(aa.geom)
         AND NOT st_intersects(r.geom, aa.geom))
    + (SELECT count(*)::bigint
       FROM _verify_buildings AS b
       INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
       WHERE b.admin_area_id IS NOT NULL
         AND aa.is_active IS TRUE
         AND aa.deleted_at IS NULL
         AND b.lookup_point IS NOT NULL
         AND NOT st_isempty(b.lookup_point)
         AND aa.geom IS NOT NULL
         AND NOT st_isempty(aa.geom)
         AND st_isvalid(aa.geom)
         AND NOT (st_covers(aa.geom, b.lookup_point) OR st_intersects(aa.geom, b.lookup_point)))
        AS geometry_mismatch_assigned_total,

    (SELECT count(*)::bigint FROM _verify_places WHERE admin_area_id IS NULL)
    + (SELECT count(*)::bigint FROM _verify_roads WHERE admin_area_id IS NULL)
    + (SELECT count(*)::bigint FROM _verify_buildings WHERE admin_area_id IS NULL)
        AS null_admin_area_id_total,

    (SELECT count(*)::bigint
     FROM _verify_places AS p
     WHERE p.lookup_geom IS NOT NULL
       AND NOT st_isempty(p.lookup_geom)
       AND to_regprocedure('core.find_admin_area_for_point(geometry,text)') IS NOT NULL
       AND core.find_admin_area_for_point(p.lookup_geom, NULL) IS NULL)
    + (SELECT count(*)::bigint
       FROM _verify_roads AS r
       WHERE to_regprocedure('core.find_admin_area_for_line(geometry,text)') IS NOT NULL
         AND core.find_admin_area_for_line(r.geom, 'township') IS NULL)
    + (SELECT count(*)::bigint
       FROM _verify_buildings AS b
       WHERE b.lookup_point IS NOT NULL
       AND NOT st_isempty(b.lookup_point)
       AND to_regprocedure('core.find_admin_area_for_point(geometry,text)') IS NOT NULL
       AND core.find_admin_area_for_point(b.lookup_point, NULL) IS NULL)
        AS no_matching_best_admin_total,

    (SELECT count(*)::bigint
     FROM _verify_places AS p
     WHERE core.entity_admin_assignment_is_protected(
         p.manual_override, p.is_verified, p.verification_status
     )
     AND (
         p.admin_area_id IS NULL
         OR (
             p.rep_point IS NOT NULL
             AND NOT st_isempty(p.rep_point)
             AND NOT core.is_admin_area_id_valid_for_point(p.admin_area_id, p.rep_point)
         )
     ))
    + (SELECT count(*)::bigint
       FROM _verify_roads AS r
       WHERE core.entity_admin_assignment_is_protected(
           r.manual_override, r.is_verified, r.verification_status
       )
       AND (
           r.admin_area_id IS NULL
           OR NOT core.is_admin_area_id_valid_for_line(r.admin_area_id, r.geom)
       ))
    + (SELECT count(*)::bigint
       FROM _verify_buildings AS b
       WHERE core.entity_admin_assignment_is_protected(
           b.manual_override, b.is_verified, b.verification_status
       )
       AND (
           b.admin_area_id IS NULL
           OR (
               b.lookup_point IS NOT NULL
               AND NOT core.is_admin_area_id_valid_for_point(b.admin_area_id, b.lookup_point)
           )
       ))
        AS skipped_protected_still_needing_repair_total;

SELECT
    'HARD_FAIL' AS severity,
    g.orphan_admin_fk_total
FROM _entity_verify_gates AS g;

SELECT
    'WARN' AS severity,
    g.null_admin_area_id_total,
    g.geometry_mismatch_assigned_total,
    g.no_matching_best_admin_total,
    g.skipped_protected_still_needing_repair_total
FROM _entity_verify_gates AS g;

\echo ''
\echo '--- Sample geometry mismatch rows (up to 15) ---'

(
    SELECT
        'places'::text AS entity,
        p.id,
        p.admin_area_id,
        'point_outside_assigned_admin'::text AS issue
    FROM _verify_places AS p
    INNER JOIN core.core_admin_areas AS aa ON aa.id = p.admin_area_id
    WHERE p.admin_area_id IS NOT NULL
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND p.rep_point IS NOT NULL
      AND NOT (st_covers(aa.geom, p.rep_point) OR st_intersects(aa.geom, p.rep_point))
    ORDER BY p.id
    LIMIT 5
)
UNION ALL
(
    SELECT
        'roads',
        r.id,
        r.admin_area_id,
        'geom_no_intersect_assigned_admin'
    FROM _verify_roads AS r
    INNER JOIN core.core_admin_areas AS aa ON aa.id = r.admin_area_id
    WHERE r.admin_area_id IS NOT NULL
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND NOT st_intersects(r.geom, aa.geom)
    ORDER BY r.id
    LIMIT 5
)
UNION ALL
(
    SELECT
        'buildings',
        b.id,
        b.admin_area_id,
        'lookup_point_outside_assigned_admin'
    FROM _verify_buildings AS b
    INNER JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
    WHERE b.admin_area_id IS NOT NULL
      AND aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND b.lookup_point IS NOT NULL
      AND NOT (st_covers(aa.geom, b.lookup_point) OR st_intersects(aa.geom, b.lookup_point))
    ORDER BY b.id
    LIMIT 5
);

\echo ''
\echo '========================================================================'
\echo ' Hard-fail gate'
\echo '========================================================================'

DO $verify$
DECLARE
    g record;
    v_msgs text[] := ARRAY[]::text[];
BEGIN
    IF to_regprocedure('core.admin_area_row_matches_target(bigint,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Run 03_create_admin_assignment_functions.sql before entity verification';
    END IF;

    SELECT * INTO g FROM _entity_verify_gates;

    IF g.orphan_admin_fk_total > 0 THEN
        v_msgs := array_append(
            v_msgs,
            format('orphan_or_inactive_admin_fk=%s', g.orphan_admin_fk_total)
        );
    END IF;

    IF coalesce(array_length(v_msgs, 1), 0) > 0 THEN
        RAISE EXCEPTION 'Entity admin assignment verification FAILED: %', array_to_string(v_msgs, ', ');
    END IF;

    RAISE NOTICE 'Entity admin assignment verification PASSED (hard-fail gates)';
    RAISE WARNING 'WARN null_admin_area_id=%', g.null_admin_area_id_total;
    RAISE WARNING 'WARN geometry_mismatch_assigned=%', g.geometry_mismatch_assigned_total;
    RAISE WARNING 'WARN no_matching_best_admin_area=%', g.no_matching_best_admin_total;
    RAISE WARNING 'WARN skipped_protected_still_needing_repair=%',
        g.skipped_protected_still_needing_repair_total;
END $verify$;
