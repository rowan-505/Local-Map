-- =============================================================================
-- 01_repair_admin_area_hierarchy.sql
-- Rebuild core.core_admin_areas.parent_id from geometry (active areas only).
--
-- Does NOT: delete rows, change geom, change admin_level_id, touch import_review.
-- Does: set parent_id; touch updated_at only when parent_id changes (idempotent re-run).
--
-- Parent rules:
--   - Broader than child (smaller hierarchy_order).
--   - ST_Contains(parent.geom, child.centroid), else ST_Intersects (centroid path).
--   - If no usable centroid: ST_Intersects(parent.geom, child.geom).
--   - Nearest broader = max hierarchy_order below child; tie-break smallest area.
--   - Country / top level: no parent (NULL).
--   - Never self-parent; reject if child is ancestor of proposed parent (cycle).
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

\echo '=== Admin hierarchy repair (geometry-based parent_id) ==='

-- hierarchy_order: smaller = broader (e.g. country), larger = more detailed (e.g. village).
-- Prefer ref.ref_admin_levels.rank; fallback OSM-style level from level code.
-- ON COMMIT PRESERVE ROWS (default): required because psql autocommits each statement.
CREATE TEMP TABLE _hier_ctx AS
SELECT
    a.id,
    a.parent_id AS old_parent_id,
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    a.geom,
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
    ) AS hierarchy_order
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
WHERE a.is_active IS TRUE
  AND a.deleted_at IS NULL;

CREATE TEMP TABLE _hier_calc AS
SELECT
    c.id,
    c.old_parent_id,
    c.admin_level_id,
    c.admin_level_code,
    c.admin_level_name,
    c.hierarchy_order,
    coalesce(pick_centroid.parent_id, pick_geom.parent_id) AS new_parent_id
FROM _hier_ctx AS c
LEFT JOIN LATERAL (
    SELECT p.id AS parent_id
    FROM _hier_ctx AS p
    WHERE p.id <> c.id
      AND p.geom IS NOT NULL
      AND NOT st_isempty(p.geom)
      AND st_isvalid(p.geom)
      AND p.hierarchy_order < c.hierarchy_order
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND (
          st_contains(p.geom, c.child_centroid)
          OR st_intersects(p.geom, c.child_centroid)
      )
      AND NOT EXISTS (
          WITH RECURSIVE walk AS (
              SELECT cur.id, cur.parent_id
              FROM core.core_admin_areas AS cur
              WHERE cur.id = p.id
              UNION ALL
              SELECT up.id, up.parent_id
              FROM core.core_admin_areas AS up
              INNER JOIN walk AS w ON up.id = w.parent_id
              WHERE w.parent_id IS NOT NULL
          )
          SELECT 1
          FROM walk
          WHERE id = c.id
      )
    ORDER BY p.hierarchy_order DESC, st_area(p.geom::geography) ASC NULLS LAST, p.id ASC
    LIMIT 1
) AS pick_centroid ON true
LEFT JOIN LATERAL (
    SELECT p.id AS parent_id
    FROM _hier_ctx AS p
    WHERE pick_centroid.parent_id IS NULL
      AND p.id <> c.id
      AND p.geom IS NOT NULL
      AND NOT st_isempty(p.geom)
      AND st_isvalid(p.geom)
      AND p.hierarchy_order < c.hierarchy_order
      AND c.geom IS NOT NULL
      AND NOT st_isempty(c.geom)
      AND st_isvalid(c.geom)
      AND st_intersects(p.geom, c.geom)
      AND NOT EXISTS (
          WITH RECURSIVE walk AS (
              SELECT cur.id, cur.parent_id
              FROM core.core_admin_areas AS cur
              WHERE cur.id = p.id
              UNION ALL
              SELECT up.id, up.parent_id
              FROM core.core_admin_areas AS up
              INNER JOIN walk AS w ON up.id = w.parent_id
              WHERE w.parent_id IS NOT NULL
          )
          SELECT 1
          FROM walk
          WHERE id = c.id
      )
    ORDER BY p.hierarchy_order DESC, st_area(p.geom::geography) ASC NULLS LAST, p.id ASC
    LIMIT 1
) AS pick_geom ON true;

\echo ''
\echo '--- Repair summary (planned) ---'

SELECT
    'updated_count' AS metric,
    count(*)::bigint AS value
FROM _hier_calc AS r
WHERE r.new_parent_id IS DISTINCT FROM r.old_parent_id;

SELECT
    'unchanged_count' AS metric,
    count(*)::bigint AS value
FROM _hier_calc AS r
WHERE r.new_parent_id IS NOT DISTINCT FROM r.old_parent_id;

SELECT
    'still_parentless_total' AS metric,
    count(*)::bigint AS value
FROM _hier_calc AS r
WHERE r.new_parent_id IS NULL;

\echo ''
\echo '--- Still parentless after repair, by admin level (planned) ---'

SELECT
    r.admin_level_id,
    r.admin_level_code,
    r.admin_level_name,
    count(*)::bigint AS parentless_count
FROM _hier_calc AS r
WHERE r.new_parent_id IS NULL
GROUP BY r.admin_level_id, r.admin_level_code, r.admin_level_name, r.hierarchy_order
ORDER BY r.hierarchy_order, r.admin_level_code;

DO $repair$
DECLARE
    v_dry_run boolean;
    v_updated bigint;
    v_unchanged bigint;
    v_parentless bigint;
BEGIN
    v_dry_run := lower(trim(coalesce(current_setting('coremap.dry_run', true), 'false')))
        IN ('true', 't', '1', 'yes', 'on');

    SELECT
        count(*) FILTER (WHERE r.new_parent_id IS DISTINCT FROM r.old_parent_id),
        count(*) FILTER (WHERE r.new_parent_id IS NOT DISTINCT FROM r.old_parent_id),
        count(*) FILTER (WHERE r.new_parent_id IS NULL)
    INTO v_updated, v_unchanged, v_parentless
    FROM _hier_calc AS r;

    IF v_dry_run THEN
        RAISE NOTICE 'DRY RUN: no UPDATE applied';
        RAISE NOTICE '  updated_count (planned): %', v_updated;
        RAISE NOTICE '  unchanged_count: %', v_unchanged;
        RAISE NOTICE '  still_parentless_total: %', v_parentless;
        RETURN;
    END IF;

    UPDATE core.core_admin_areas AS a
    SET
        parent_id = r.new_parent_id,
        updated_at = now()
    FROM _hier_calc AS r
    WHERE a.id = r.id
      AND r.new_parent_id IS DISTINCT FROM a.parent_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    SELECT count(*)::bigint
    INTO v_parentless
    FROM core.core_admin_areas AS a
    WHERE a.is_active IS TRUE
      AND a.deleted_at IS NULL
      AND a.parent_id IS NULL;

    RAISE NOTICE 'Applied UPDATE';
    RAISE NOTICE '  updated_count: %', v_updated;
    RAISE NOTICE '  unchanged_count: %', v_unchanged;
    RAISE NOTICE '  still_parentless_total: %', v_parentless;
END $repair$;

\echo ''
\echo '--- Post-update: still parentless by admin level (live) ---'

SELECT
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    count(*)::bigint AS parentless_count
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
WHERE a.is_active IS TRUE
  AND a.deleted_at IS NULL
  AND a.parent_id IS NULL
GROUP BY a.admin_level_id, al.code, al.name, al.rank
ORDER BY al.rank NULLS LAST, al.code;
