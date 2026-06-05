-- =============================================================================
-- 01_repair_admin_area_hierarchy.sql
-- Rebuild core.core_admin_areas.parent_id from geometry (active areas only).
--
-- Optimized for Supabase: level-by-level passes, GIST-friendly bbox prefilter
-- (parent.geom && child.centroid AND ST_Contains), set-based DISTINCT ON picks.
--
-- Does NOT: delete rows, change geom, change admin_level_id, touch import_review.
-- Does: set parent_id; touch updated_at only when parent_id changes (idempotent re-run).
--
-- Parent rules (core + ref only; no staging/tmp_import):
--   - Child point = ST_PointOnSurface(child.geom) when geom exists, else stored centroid.
--   - parent.geom && child point AND ST_Covers(parent.geom, child point).
--   - Immediate parent = coarsest allowed level for the pass, smallest area, lowest id.
--   - Level passes (with fallbacks):
--       state_region      → country
--       district          → state_region
--       township          → district, then state_region
--       ward_village_tract→ township, then district, then state_region
--       remaining non-country → any coarser level by hierarchy_order
--       still parentless      → polygon overlap, then nearest coarser parent by distance
--   - Country level: parent_id stays NULL.
--   - Non-country: parent_id set when a valid parent exists; else NULL.
--   - Never self-parent.
-- =============================================================================

\set ON_ERROR_STOP on
\ir _pipeline_session_config.sql

\pset pager off

\echo '=== Ensure core.core_admin_areas indexes (idempotent) ==='

CREATE INDEX IF NOT EXISTS core_admin_areas_geom_gix
    ON core.core_admin_areas USING gist (geom);

CREATE INDEX IF NOT EXISTS core_admin_areas_centroid_gix
    ON core.core_admin_areas USING gist (centroid)
    WHERE centroid IS NOT NULL
      AND is_active IS TRUE
      AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_admin_areas_level_idx
    ON core.core_admin_areas (admin_level_id);

CREATE INDEX IF NOT EXISTS core_admin_areas_parent_idx
    ON core.core_admin_areas (parent_id);

ANALYZE core.core_admin_areas;

\echo '=== Admin hierarchy repair (level-by-level, index-friendly) ==='

\ir _psql_repair_session_reset.sql

-- hierarchy_order: smaller = broader (e.g. country), larger = more detailed (e.g. village).
CREATE TEMP TABLE _hier_ctx AS
SELECT
    a.id,
    a.parent_id AS old_parent_id,
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    st_setsrid(
        coalesce(
            CASE
                WHEN a.geom IS NOT NULL
                     AND NOT st_isempty(a.geom)
                     AND st_isvalid(a.geom)
                    THEN st_pointonsurface(st_makevalid(st_setsrid(a.geom, 4326)))
                ELSE NULL
            END,
            CASE
                WHEN a.centroid IS NOT NULL
                     AND NOT st_isempty(a.centroid)
                     AND st_isvalid(a.centroid)
                    THEN a.centroid
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
                ELSE 99
            END
        ) <= 2
    ) AS is_country_level,
    CASE
        WHEN lower(trim(coalesce(al.code, ''))) = 'country'
            OR coalesce(al.rank::integer, 99) <= 2
            THEN 'country'
        WHEN lower(trim(coalesce(al.code, ''))) IN (
            'state_region', 'state', 'division', 'region'
        ) THEN 'state_region'
        WHEN lower(trim(coalesce(al.code, ''))) = 'district'
            THEN 'district'
        WHEN lower(trim(coalesce(al.code, ''))) IN (
            'township', 'town', 'city'
        ) THEN 'township'
        WHEN lower(trim(coalesce(al.code, ''))) IN (
            'ward_village_tract', 'ward', 'suburb', 'quarter',
            'village_tract', 'village', 'hamlet', 'neighbourhood'
        ) THEN 'ward_village_tract'
        ELSE 'other'
    END AS child_level_group
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
WHERE coalesce(a.is_active, true) IS TRUE
  AND a.deleted_at IS NULL;

CREATE INDEX _hier_ctx_child_centroid_gix ON _hier_ctx USING gist (child_centroid);
CREATE INDEX _hier_ctx_level_group_idx ON _hier_ctx (child_level_group);

CREATE TEMP TABLE _hier_parents AS
SELECT
    p.id,
    lower(trim(coalesce(al.code, ''))) AS admin_level_code,
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
    p.geom,
    st_area(p.geom::geography) AS geom_area_sqm
FROM core.core_admin_areas AS p
LEFT JOIN ref.ref_admin_levels AS al ON al.id = p.admin_level_id
WHERE coalesce(p.is_active, true) IS TRUE
  AND p.deleted_at IS NULL
  AND p.geom IS NOT NULL
  AND NOT st_isempty(p.geom)
  AND st_isvalid(p.geom);

CREATE INDEX _hier_parents_geom_gix ON _hier_parents USING gist (geom);
CREATE INDEX _hier_parents_level_code_idx ON _hier_parents (admin_level_code);
CREATE INDEX _hier_parents_hierarchy_order_idx ON _hier_parents (hierarchy_order);

CREATE TEMP TABLE _hier_planned (
    id bigint PRIMARY KEY,
    old_parent_id bigint,
    new_parent_id bigint,
    admin_level_id bigint,
    admin_level_code text,
    admin_level_name text,
    hierarchy_order integer,
    is_country_level boolean NOT NULL,
    child_level_group text NOT NULL
);

INSERT INTO _hier_planned (
    id,
    old_parent_id,
    new_parent_id,
    admin_level_id,
    admin_level_code,
    admin_level_name,
    hierarchy_order,
    is_country_level,
    child_level_group
)
SELECT
    c.id,
    c.old_parent_id,
    NULL::bigint,
    c.admin_level_id,
    c.admin_level_code,
    c.admin_level_name,
    c.hierarchy_order,
    c.is_country_level,
    c.child_level_group
FROM _hier_ctx AS c;

-- Country rows: parent_id stays NULL.
UPDATE _hier_planned AS plan
SET new_parent_id = NULL
WHERE plan.is_country_level;

-- state_region → country
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code = 'country'
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'state_region'
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id;

-- district → state_region
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code IN ('state_region', 'state', 'division', 'region')
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'district'
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.hierarchy_order DESC, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id;

-- township → district
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code = 'district'
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'township'
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id;

-- township fallback → state_region
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code IN ('state_region', 'state', 'division', 'region')
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'township'
      AND hp.new_parent_id IS NULL
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

-- ward_village_tract → township
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code IN ('township', 'town', 'city')
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'ward_village_tract'
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id;

-- ward_village_tract fallback → district
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code = 'district'
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'ward_village_tract'
      AND hp.new_parent_id IS NULL
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

-- ward_village_tract fallback → state_region
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.admin_level_code IN ('state_region', 'state', 'division', 'region')
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE c.child_level_group = 'ward_village_tract'
      AND hp.new_parent_id IS NULL
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

-- any remaining non-country → broadest valid coarser parent by hierarchy_order
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.hierarchy_order < c.hierarchy_order
       AND p.geom && c.child_centroid
       AND st_covers(p.geom, c.child_centroid)
       AND p.id <> c.id
    WHERE NOT c.is_country_level
      AND hp.new_parent_id IS NULL
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY c.id, p.hierarchy_order DESC, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

-- still parentless: polygon overlap with any coarser parent (bad centroid / boundary cases)
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN core.core_admin_areas AS child ON child.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.hierarchy_order < c.hierarchy_order
       AND p.id <> c.id
       AND child.geom IS NOT NULL
       AND NOT st_isempty(child.geom)
       AND st_isvalid(child.geom)
       AND p.geom && child.geom
       AND st_intersects(p.geom, child.geom)
    WHERE NOT c.is_country_level
      AND hp.new_parent_id IS NULL
    ORDER BY c.id, p.hierarchy_order DESC, p.geom_area_sqm ASC NULLS LAST, p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

-- still parentless: nearest coarser parent by distance (last resort for OSM edge cases)
UPDATE _hier_planned AS plan
SET new_parent_id = pick.parent_id
FROM (
    SELECT DISTINCT ON (c.id)
        c.id AS child_id,
        p.id AS parent_id
    FROM _hier_ctx AS c
    INNER JOIN _hier_planned AS hp ON hp.id = c.id
    INNER JOIN _hier_parents AS p
        ON p.hierarchy_order < c.hierarchy_order
       AND p.id <> c.id
    WHERE NOT c.is_country_level
      AND hp.new_parent_id IS NULL
      AND c.child_centroid IS NOT NULL
      AND NOT st_isempty(c.child_centroid)
      AND st_isvalid(c.child_centroid)
    ORDER BY
        c.id,
        st_distance(c.child_centroid::geography, p.geom::geography) ASC NULLS LAST,
        p.hierarchy_order DESC,
        p.geom_area_sqm ASC NULLS LAST,
        p.id ASC
) AS pick
WHERE plan.id = pick.child_id
  AND plan.new_parent_id IS NULL;

\echo ''
\echo '--- Repair summary (planned) ---'

SELECT
    'planned_update_count' AS metric,
    count(*)::bigint AS value
FROM _hier_planned AS r
WHERE r.new_parent_id IS DISTINCT FROM r.old_parent_id;

SELECT
    'unchanged_count' AS metric,
    count(*)::bigint AS value
FROM _hier_planned AS r
WHERE r.new_parent_id IS NOT DISTINCT FROM r.old_parent_id;

SELECT
    'still_parentless_count' AS metric,
    count(*)::bigint AS value
FROM _hier_planned AS r
WHERE r.new_parent_id IS NULL
  AND NOT r.is_country_level;

\echo ''
\echo '--- parentless_by_level (planned, excluding country) ---'

SELECT
    r.admin_level_id,
    r.admin_level_code,
    r.admin_level_name,
    count(*)::bigint AS parentless_count
FROM _hier_planned AS r
WHERE r.new_parent_id IS NULL
  AND NOT r.is_country_level
GROUP BY r.admin_level_id, r.admin_level_code, r.admin_level_name, r.hierarchy_order
ORDER BY r.hierarchy_order, r.admin_level_code;

DO $repair$
DECLARE
    v_dry_run boolean;
    v_planned bigint;
    v_unchanged bigint;
    v_parentless bigint;
    v_applied bigint;
BEGIN
    v_dry_run := lower(trim(coalesce(current_setting('coremap.dry_run', true), 'false')))
        IN ('true', 't', '1', 'yes', 'on');

    SELECT
        count(*) FILTER (WHERE r.new_parent_id IS DISTINCT FROM r.old_parent_id),
        count(*) FILTER (WHERE r.new_parent_id IS NOT DISTINCT FROM r.old_parent_id),
        count(*) FILTER (WHERE r.new_parent_id IS NULL AND NOT r.is_country_level)
    INTO v_planned, v_unchanged, v_parentless
    FROM _hier_planned AS r;

    IF v_dry_run THEN
        RAISE NOTICE 'DRY RUN: no UPDATE applied';
        RAISE NOTICE '  planned_update_count: %', v_planned;
        RAISE NOTICE '  unchanged_count: %', v_unchanged;
        RAISE NOTICE '  still_parentless_count: %', v_parentless;
        RETURN;
    END IF;

    UPDATE core.core_admin_areas AS a
    SET
        parent_id = r.new_parent_id,
        updated_at = now()
    FROM _hier_planned AS r
    WHERE a.id = r.id
      AND r.new_parent_id IS DISTINCT FROM a.parent_id;

    GET DIAGNOSTICS v_applied = ROW_COUNT;

    SELECT count(*)::bigint
    INTO v_parentless
    FROM core.core_admin_areas AS a
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
    WHERE a.is_active IS TRUE
      AND a.deleted_at IS NULL
      AND a.parent_id IS NULL
      AND NOT (
          lower(trim(coalesce(al.code, ''))) = 'country'
          OR coalesce(al.rank::integer, 99) <= 2
      );

    RAISE NOTICE 'Applied UPDATE';
    RAISE NOTICE '  planned_update_count: %', v_planned;
    RAISE NOTICE '  rows_updated: %', v_applied;
    RAISE NOTICE '  unchanged_count: %', v_unchanged;
    RAISE NOTICE '  still_parentless_count: %', v_parentless;
END $repair$;

\echo ''
\echo '--- Post-update: parentless_by_level (live, excluding country) ---'

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
  AND NOT (
      lower(trim(coalesce(al.code, ''))) = 'country'
      OR coalesce(al.rank::integer, 99) <= 2
  )
GROUP BY a.admin_level_id, al.code, al.name, al.rank
ORDER BY al.rank NULLS LAST, al.code;
