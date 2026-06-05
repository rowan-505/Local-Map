-- =============================================================================
-- Hard verify core admin hierarchy after admin-hierarchy-repair (read-only)
--
-- Validates active core.core_admin_areas + ref.ref_admin_levels and assignment
-- functions installed by admin-hierarchy-repair stage 03.
--
-- psql variables:
--   -v fail_on_warning=false           (true = treat warnings as hard fail)
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -f tools/data-pipeline/import-review-bulk-promotion/03_hard_verify_admin_hierarchy_after_repair.sql
-- =============================================================================

\set ON_ERROR_STOP on

\ir _psql_default_vars.sql

BEGIN;

\ir _psql_verify_session_reset.sql

CREATE TEMP TABLE bulk_hier_verify_params (
    fail_on_warning boolean NOT NULL DEFAULT false
);

INSERT INTO bulk_hier_verify_params (fail_on_warning)
VALUES (
    CASE lower(coalesce(NULLIF(btrim(:'fail_on_warning'), ''), 'false'))
        WHEN 'true' THEN true
        WHEN '1' THEN true
        WHEN 'yes' THEN true
        ELSE false
    END
);

CREATE TEMP TABLE bulk_hier_verify_admin AS
SELECT
    a.id AS admin_area_id,
    a.public_id,
    a.external_id,
    a.parent_id,
    a.canonical_name,
    a.admin_level_id,
    al.code AS admin_level_code,
    al.name AS admin_level_name,
    a.geom,
    a.centroid,
    coalesce(a.is_active, true) AS is_active,
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
    )::geometry(Point, 4326) AS rep_point,
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
        ) <= 2
    ) AS is_country_level
FROM core.core_admin_areas AS a
LEFT JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id;

CREATE TEMP TABLE bulk_hier_verify_summary (
    active_admin_area_count bigint NOT NULL DEFAULT 0,
    active_country_count bigint NOT NULL DEFAULT 0,
    hard_fail_count bigint NOT NULL DEFAULT 0,
    warning_count bigint NOT NULL DEFAULT 0,
    fail_on_warning boolean NOT NULL DEFAULT false,
    has_find_admin_area_for_point boolean NOT NULL DEFAULT false,
    has_find_admin_area_for_line boolean NOT NULL DEFAULT false,
    sample_centroid_test_count bigint NOT NULL DEFAULT 0,
    sample_centroid_unresolved_count bigint NOT NULL DEFAULT 0
);

INSERT INTO bulk_hier_verify_summary (
    active_admin_area_count,
    active_country_count,
    fail_on_warning,
    has_find_admin_area_for_point,
    has_find_admin_area_for_line
)
SELECT
    (SELECT count(*)::bigint FROM bulk_hier_verify_admin AS v WHERE v.is_active AND v.deleted_at IS NULL),
    (
        SELECT count(*)::bigint
        FROM bulk_hier_verify_admin AS v
        WHERE v.is_active
          AND v.deleted_at IS NULL
          AND v.is_country_level
    ),
    p.fail_on_warning,
    EXISTS (
        SELECT 1
        FROM pg_proc AS pr
        INNER JOIN pg_namespace AS ns ON ns.oid = pr.pronamespace
        WHERE ns.nspname = 'core'
          AND pr.proname = 'find_admin_area_for_point'
          AND pr.prokind = 'f'
    ),
    EXISTS (
        SELECT 1
        FROM pg_proc AS pr
        INNER JOIN pg_namespace AS ns ON ns.oid = pr.pronamespace
        WHERE ns.nspname = 'core'
          AND pr.proname = 'find_admin_area_for_line'
          AND pr.prokind = 'f'
    )
FROM bulk_hier_verify_params AS p;

CREATE TEMP TABLE bulk_hier_verify_hard_fails (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    admin_area_id bigint,
    detail text
);

CREATE TEMP TABLE bulk_hier_verify_warnings (
    ord bigserial PRIMARY KEY,
    check_key text NOT NULL,
    admin_area_id bigint,
    detail text
);

-- Batch-level hard fails
INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'active_country_count',
    NULL::bigint,
    format('active_country_count=%s (expected exactly 1)', s.active_country_count)
FROM bulk_hier_verify_summary AS s
WHERE s.active_country_count IS DISTINCT FROM 1;

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'missing_function_find_admin_area_for_point',
    NULL::bigint,
    'core.find_admin_area_for_point(geometry, text) is not installed'
FROM bulk_hier_verify_summary AS s
WHERE NOT s.has_find_admin_area_for_point;

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'missing_function_find_admin_area_for_line',
    NULL::bigint,
    'core.find_admin_area_for_line(geometry, text) is not installed'
FROM bulk_hier_verify_summary AS s
WHERE NOT s.has_find_admin_area_for_line;

-- Per-row hierarchy hard fails (active, not deleted)
INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'non_country_parent_id_null',
    v.admin_area_id,
    format('admin_level_code=%s hierarchy_order=%s', v.admin_level_code, v.hierarchy_order)
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND NOT v.is_country_level
  AND v.parent_id IS NULL;

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'self_parent',
    v.admin_area_id,
    format('parent_id=%s', v.parent_id)
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND v.parent_id = v.admin_area_id;

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'orphan_parent_id',
    v.admin_area_id,
    format('parent_id=%s missing or inactive/deleted', v.parent_id)
FROM bulk_hier_verify_admin AS v
LEFT JOIN bulk_hier_verify_admin AS p ON p.admin_area_id = v.parent_id
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND v.parent_id IS NOT NULL
  AND (
      p.admin_area_id IS NULL
      OR NOT p.is_active
      OR p.deleted_at IS NOT NULL
  );

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'parent_same_or_lower_detail',
    c.admin_area_id,
    format(
        'child level=%s order=%s parent_id=%s parent level=%s order=%s',
        c.admin_level_code,
        c.hierarchy_order,
        c.parent_id,
        p.admin_level_code,
        p.hierarchy_order
    )
FROM bulk_hier_verify_admin AS c
INNER JOIN bulk_hier_verify_admin AS p ON p.admin_area_id = c.parent_id
WHERE c.is_active
  AND c.deleted_at IS NULL
  AND c.parent_id IS NOT NULL
  AND p.hierarchy_order >= c.hierarchy_order;

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'invalid_geometry',
    v.admin_area_id,
    format('geom_type=%s valid=%s', ST_GeometryType(v.geom), ST_IsValid(v.geom))
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND v.geom IS NOT NULL
  AND NOT st_isempty(v.geom)
  AND NOT st_isvalid(v.geom);

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'null_geometry',
    v.admin_area_id,
    'active admin area has NULL or empty geom'
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND (v.geom IS NULL OR st_isempty(v.geom));

-- Sample centroid → find_admin_area_for_point (requires functions)
CREATE TEMP TABLE bulk_hier_verify_sample_centroids AS
SELECT
    s.admin_area_id,
    s.admin_level_code,
    s.rep_point AS test_point
FROM (
    SELECT
        v.admin_area_id,
        v.admin_level_code,
        v.rep_point,
        row_number() OVER (PARTITION BY v.admin_level_code ORDER BY v.admin_area_id) AS rn
    FROM bulk_hier_verify_admin AS v
    WHERE v.is_active
      AND v.deleted_at IS NULL
      AND v.rep_point IS NOT NULL
      AND NOT st_isempty(v.rep_point)
      AND st_isvalid(v.rep_point)
) AS s
WHERE s.rn <= 3;

CREATE TEMP TABLE bulk_hier_verify_sample_results AS
SELECT
    sc.admin_area_id,
    sc.admin_level_code,
    sc.test_point,
    CASE
        WHEN (SELECT has_find_admin_area_for_point FROM bulk_hier_verify_summary LIMIT 1) THEN
            core.find_admin_area_for_point(sc.test_point, NULL::text)
        ELSE NULL::bigint
    END AS resolved_admin_area_id
FROM bulk_hier_verify_sample_centroids AS sc;

UPDATE bulk_hier_verify_summary AS s
SET
    sample_centroid_test_count = (SELECT count(*)::bigint FROM bulk_hier_verify_sample_results),
    sample_centroid_unresolved_count = (
        SELECT count(*)::bigint
        FROM bulk_hier_verify_sample_results AS r
        WHERE r.resolved_admin_area_id IS NULL
    );

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'sample_centroid_lookup_failed',
    r.admin_area_id,
    format(
        'find_admin_area_for_point returned NULL for sample admin_area_id=%s level=%s',
        r.admin_area_id,
        r.admin_level_code
    )
FROM bulk_hier_verify_sample_results AS r
WHERE r.resolved_admin_area_id IS NULL
  AND (SELECT has_find_admin_area_for_point FROM bulk_hier_verify_summary LIMIT 1);

INSERT INTO bulk_hier_verify_hard_fails (check_key, admin_area_id, detail)
SELECT
    'sample_centroid_test_empty',
    NULL::bigint,
    'no valid sample centroids available for find_admin_area_for_point test'
FROM bulk_hier_verify_summary AS s
WHERE s.has_find_admin_area_for_point
  AND s.sample_centroid_test_count = 0
  AND s.active_admin_area_count > 0;

-- Warnings
INSERT INTO bulk_hier_verify_warnings (check_key, admin_area_id, detail)
SELECT
    'same_level_overlap_pair',
    a1.admin_area_id,
    format(
        'overlaps admin_area_id=%s level=%s overlap_m2=%s',
        a2.admin_area_id,
        a1.admin_level_code,
        round(st_area(st_intersection(a1.geom, a2.geom)::geography)::numeric, 2)
    )
FROM bulk_hier_verify_admin AS a1
INNER JOIN bulk_hier_verify_admin AS a2
    ON a2.admin_level_id = a1.admin_level_id
   AND a2.admin_area_id > a1.admin_area_id
WHERE a1.is_active
  AND a2.is_active
  AND a1.deleted_at IS NULL
  AND a2.deleted_at IS NULL
  AND a1.geom IS NOT NULL
  AND a2.geom IS NOT NULL
  AND NOT st_isempty(a1.geom)
  AND NOT st_isempty(a2.geom)
  AND st_isvalid(a1.geom)
  AND st_isvalid(a2.geom)
  AND st_intersects(a1.geom, a2.geom)
  AND NOT st_touches(a1.geom, a2.geom);

INSERT INTO bulk_hier_verify_warnings (check_key, admin_area_id, detail)
SELECT
    'missing_core_admin_area_names',
    v.admin_area_id,
    'no rows in core.core_admin_area_names'
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_admin_area_names AS n
      WHERE n.admin_area_id = v.admin_area_id
  );

INSERT INTO bulk_hier_verify_warnings (check_key, admin_area_id, detail)
SELECT
    'inactive_parent_active_child',
    c.admin_area_id,
    format(
        'child level=%s has parent_id=%s (parent active=%s deleted_at=%s)',
        c.admin_level_code,
        c.parent_id,
        coalesce(p.is_active::text, '<missing>'),
        coalesce(p.deleted_at::text, '<missing>')
    )
FROM bulk_hier_verify_admin AS c
INNER JOIN bulk_hier_verify_admin AS p ON p.admin_area_id = c.parent_id
WHERE c.is_active
  AND c.deleted_at IS NULL
  AND c.parent_id IS NOT NULL
  AND (
      NOT p.is_active
      OR p.deleted_at IS NOT NULL
  );

UPDATE bulk_hier_verify_summary AS s
SET
    hard_fail_count = (SELECT count(*)::bigint FROM bulk_hier_verify_hard_fails),
    warning_count = (SELECT count(*)::bigint FROM bulk_hier_verify_warnings);

\echo ''
\echo '=== admin hierarchy after repair — summary ==='

SELECT
    s.active_admin_area_count,
    s.active_country_count,
    s.has_find_admin_area_for_point,
    s.has_find_admin_area_for_line,
    s.sample_centroid_test_count,
    s.sample_centroid_unresolved_count,
    s.hard_fail_count,
    s.warning_count,
    s.fail_on_warning
FROM bulk_hier_verify_summary AS s;

\echo ''
\echo '=== hierarchy summary by admin level (active, not deleted) ==='

SELECT
    v.admin_level_id,
    v.admin_level_code,
    v.admin_level_name,
    v.hierarchy_order,
    count(*)::bigint AS area_count,
    count(*) FILTER (WHERE v.is_country_level)::bigint AS country_count,
    count(*) FILTER (WHERE v.parent_id IS NOT NULL)::bigint AS with_parent_count,
    count(*) FILTER (WHERE v.parent_id IS NULL)::bigint AS parentless_count,
    count(*) FILTER (WHERE v.parent_id = v.admin_area_id)::bigint AS self_parent_count
FROM bulk_hier_verify_admin AS v
WHERE v.is_active
  AND v.deleted_at IS NULL
GROUP BY v.admin_level_id, v.admin_level_code, v.admin_level_name, v.hierarchy_order
ORDER BY v.hierarchy_order, v.admin_level_code;

\echo ''
\echo '=== hard fail checks (counts by check_key) ==='

SELECT
    f.check_key,
    count(*)::bigint AS row_count
FROM bulk_hier_verify_hard_fails AS f
GROUP BY f.check_key
ORDER BY f.check_key;

\echo ''
\echo '=== warning checks (counts by check_key) ==='

SELECT
    w.check_key,
    count(*)::bigint AS row_count
FROM bulk_hier_verify_warnings AS w
GROUP BY w.check_key
ORDER BY w.check_key;

\echo ''
\echo '=== sample hard fail rows (up to 15) ==='

SELECT
    f.check_key,
    f.admin_area_id,
    f.detail
FROM bulk_hier_verify_hard_fails AS f
ORDER BY f.ord
LIMIT 15;

\echo ''
\echo '=== sample warning rows (up to 15) ==='

SELECT
    w.check_key,
    w.admin_area_id,
    w.detail
FROM bulk_hier_verify_warnings AS w
ORDER BY w.ord
LIMIT 15;

\echo ''
\echo '=== sample centroid lookup results (up to 10) ==='

SELECT
    r.admin_area_id,
    r.admin_level_code,
    r.resolved_admin_area_id,
    CASE
        WHEN r.resolved_admin_area_id IS NULL THEN 'FAIL'
        ELSE 'PASS'
    END AS lookup_status
FROM bulk_hier_verify_sample_results AS r
ORDER BY r.admin_area_id
LIMIT 10;

DO $finalize$
DECLARE
    s bulk_hier_verify_summary%ROWTYPE;
BEGIN
    SELECT * INTO s FROM bulk_hier_verify_summary LIMIT 1;

    IF s.hard_fail_count > 0 THEN
        RAISE EXCEPTION
            'admin hierarchy after-repair hard verify FAILED: hard_fail_count=% active_country=% sample_unresolved=%/%',
            s.hard_fail_count,
            s.active_country_count,
            s.sample_centroid_unresolved_count,
            s.sample_centroid_test_count;
    END IF;

    IF s.fail_on_warning AND s.warning_count > 0 THEN
        RAISE EXCEPTION
            'admin hierarchy after-repair hard verify FAILED (fail_on_warning=true): warning_count=%',
            s.warning_count;
    END IF;

    RAISE NOTICE 'HARD_VERIFY_PASSED active_areas=% country=% warnings=% (fail_on_warning=%)',
        s.active_admin_area_count,
        s.active_country_count,
        s.warning_count,
        s.fail_on_warning;
END;
$finalize$;

SELECT
    'HARD_VERIFY_PASSED'::text AS verify_status,
    s.active_admin_area_count,
    s.active_country_count,
    s.hard_fail_count,
    s.warning_count
FROM bulk_hier_verify_summary AS s;

COMMIT;
