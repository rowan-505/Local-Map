-- =============================================================================
-- inspect_admin_area_id_level_distribution.sql
-- =============================================================================
-- Read-only audit: admin_area_id level distribution for core-review entities.
-- No CREATE TABLE, no temp tables, no updates.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/checks/supabase/inspect_admin_area_id_level_distribution.sql
--
-- Township-policy entities (expect township-level admin_area_id):
--   streets, places, buildings, landuse, bus-stops
-- Addresses are excluded from township-policy — generic multi-level admin_area_id.
-- =============================================================================

\set ON_ERROR_STOP on

\echo ''
\echo '=== admin_area_id level distribution (all rows) ==='
\echo ''

WITH entity_rows AS (
    SELECT
        'core.core_streets'::text AS entity_table,
        'streets'::text AS entity_slug,
        true AS township_policy_entity,
        s.admin_area_id
    FROM core.core_streets AS s

    UNION ALL
    SELECT
        'core.core_places',
        'places',
        true,
        p.admin_area_id
    FROM core.core_places AS p

    UNION ALL
    SELECT
        'core.core_map_buildings',
        'buildings',
        true,
        b.admin_area_id
    FROM core.core_map_buildings AS b

    UNION ALL
    SELECT
        'core.core_map_landuse',
        'landuse',
        true,
        lu.admin_area_id
    FROM core.core_map_landuse AS lu

    UNION ALL
    SELECT
        'core_transport.stops',
        'bus-stops',
        true,
        bs.admin_area_id
    FROM core_transport.stops AS bs

    UNION ALL
    SELECT
        'core.core_addresses',
        'addresses',
        false,
        a.admin_area_id
    FROM core.core_addresses AS a
),
linked AS (
    SELECT
        e.entity_table,
        e.entity_slug,
        e.township_policy_entity,
        e.admin_area_id,
        aa.id AS linked_admin_area_id,
        aa.is_active AS linked_is_active,
        aa.deleted_at AS linked_deleted_at,
        al.code AS admin_level_code_raw,
        al.name AS admin_level_name_raw,
        lower(btrim(coalesce(al.code, ''))) AS level_code,
        lower(btrim(coalesce(al.name, ''))) AS level_name
    FROM entity_rows AS e
    LEFT JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
),
classified AS (
    SELECT
        entity_table,
        entity_slug,
        township_policy_entity,
        admin_area_id,
        linked_admin_area_id,
        linked_is_active,
        linked_deleted_at,
        admin_level_code_raw,
        admin_level_name_raw,
        level_code,
        level_name,
        (admin_area_id IS NULL) AS is_null_admin_area_id,
        (
            admin_area_id IS NOT NULL
            AND (
                linked_admin_area_id IS NULL
                OR linked_is_active IS NOT TRUE
                OR linked_deleted_at IS NOT NULL
            )
        ) AS is_broken_or_inactive_admin_area_id,
        (
            admin_area_id IS NOT NULL
            AND linked_admin_area_id IS NOT NULL
            AND linked_is_active IS TRUE
            AND linked_deleted_at IS NULL
            AND lower(btrim(coalesce(level_code, ''))) NOT IN (
                'country',
                'myanmar',
                'nation',
                'region',
                'state',
                'state_region',
                'division',
                'district',
                'ward',
                'city',
                'village',
                'hamlet',
                'village_tract',
                'quarter',
                'suburb',
                'neighbourhood',
                'neighborhood'
            )
            AND (
                lower(btrim(coalesce(level_code, ''))) IN ('township', 'town')
                OR lower(btrim(coalesce(level_name, ''))) = 'township'
            )
        ) AS is_township_level,
        CASE
            WHEN admin_area_id IS NULL THEN '(null)'
            WHEN linked_admin_area_id IS NULL THEN '(broken_fk)'
            WHEN linked_is_active IS NOT TRUE OR linked_deleted_at IS NOT NULL THEN '(broken_inactive)'
            ELSE coalesce(nullif(btrim(admin_level_code_raw), ''), '(missing_level_code)')
        END AS admin_level_code_bucket
    FROM linked
)
SELECT
    entity_table,
    entity_slug,
    admin_level_code_bucket AS admin_level_code,
    count(*)::bigint AS row_count
FROM classified
GROUP BY entity_table, entity_slug, admin_level_code_bucket
ORDER BY entity_table, row_count DESC, admin_level_code_bucket;

\echo ''
\echo '=== summary: null / broken-inactive / non-township (township-policy entities) ==='
\echo ''

WITH entity_rows AS (
    SELECT 'core.core_streets'::text AS entity_table, 'streets'::text AS entity_slug, true AS township_policy_entity, s.admin_area_id
    FROM core.core_streets AS s
    UNION ALL
    SELECT 'core.core_places', 'places', true, p.admin_area_id FROM core.core_places AS p
    UNION ALL
    SELECT 'core.core_map_buildings', 'buildings', true, b.admin_area_id FROM core.core_map_buildings AS b
    UNION ALL
    SELECT 'core.core_map_landuse', 'landuse', true, lu.admin_area_id FROM core.core_map_landuse AS lu
    UNION ALL
    SELECT 'core_transport.stops', 'bus-stops', true, bs.admin_area_id FROM core_transport.stops AS bs
    UNION ALL
    SELECT 'core.core_addresses', 'addresses', false, a.admin_area_id FROM core.core_addresses AS a
),
linked AS (
    SELECT
        e.entity_table,
        e.entity_slug,
        e.township_policy_entity,
        e.admin_area_id,
        aa.id AS linked_admin_area_id,
        aa.is_active AS linked_is_active,
        aa.deleted_at AS linked_deleted_at,
        lower(btrim(coalesce(al.code, ''))) AS level_code,
        lower(btrim(coalesce(al.name, ''))) AS level_name
    FROM entity_rows AS e
    LEFT JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
),
classified AS (
    SELECT
        entity_table,
        entity_slug,
        township_policy_entity,
        (admin_area_id IS NULL) AS is_null_admin_area_id,
        (
            admin_area_id IS NOT NULL
            AND (
                linked_admin_area_id IS NULL
                OR linked_is_active IS NOT TRUE
                OR linked_deleted_at IS NOT NULL
            )
        ) AS is_broken_or_inactive_admin_area_id,
        (
            township_policy_entity
            AND admin_area_id IS NOT NULL
            AND linked_admin_area_id IS NOT NULL
            AND linked_is_active IS TRUE
            AND linked_deleted_at IS NULL
            AND NOT (
                lower(btrim(coalesce(level_code, ''))) NOT IN (
                    'country',
                    'myanmar',
                    'nation',
                    'region',
                    'state',
                    'state_region',
                    'division',
                    'district',
                    'ward',
                    'city',
                    'village',
                    'hamlet',
                    'village_tract',
                    'quarter',
                    'suburb',
                    'neighbourhood',
                    'neighborhood'
                )
                AND (
                    lower(btrim(coalesce(level_code, ''))) IN ('township', 'town')
                    OR lower(btrim(coalesce(level_name, ''))) = 'township'
                )
            )
        ) AS is_non_township_policy_violation
    FROM linked
),
totals AS (
    SELECT
        entity_table,
        entity_slug,
        township_policy_entity,
        count(*)::bigint AS total_rows,
        count(*) FILTER (WHERE is_null_admin_area_id)::bigint AS null_admin_area_id_count,
        count(*) FILTER (WHERE is_broken_or_inactive_admin_area_id)::bigint AS broken_inactive_admin_area_id_count,
        count(*) FILTER (WHERE is_non_township_policy_violation)::bigint AS non_township_count
    FROM classified
    GROUP BY entity_table, entity_slug, township_policy_entity
)
SELECT
    entity_table,
    entity_slug,
    township_policy_entity,
    total_rows,
    null_admin_area_id_count,
    broken_inactive_admin_area_id_count,
    CASE
        WHEN township_policy_entity THEN non_township_count
        ELSE NULL::bigint
    END AS non_township_count,
    round(100.0 * null_admin_area_id_count / nullif(total_rows, 0), 2) AS null_pct,
    round(100.0 * broken_inactive_admin_area_id_count / nullif(total_rows, 0), 2) AS broken_inactive_pct,
    round(
        100.0 * coalesce(non_township_count, 0) / nullif(total_rows, 0),
        2
    ) AS non_township_pct
FROM totals
ORDER BY entity_table;

\echo ''
\echo '=== township-policy entities only: non-township by stored admin_level_code ==='
\echo ''

WITH entity_rows AS (
    SELECT 'core.core_streets'::text AS entity_table, 'streets'::text AS entity_slug, s.admin_area_id
    FROM core.core_streets AS s
    UNION ALL
    SELECT 'core.core_places', 'places', p.admin_area_id FROM core.core_places AS p
    UNION ALL
    SELECT 'core.core_map_buildings', 'buildings', b.admin_area_id FROM core.core_map_buildings AS b
    UNION ALL
    SELECT 'core.core_map_landuse', 'landuse', lu.admin_area_id FROM core.core_map_landuse AS lu
    UNION ALL
    SELECT 'core_transport.stops', 'bus-stops', bs.admin_area_id FROM core_transport.stops AS bs
),
linked AS (
    SELECT
        e.entity_table,
        e.entity_slug,
        e.admin_area_id,
        aa.id AS linked_admin_area_id,
        aa.is_active AS linked_is_active,
        aa.deleted_at AS linked_deleted_at,
        al.code AS admin_level_code_raw,
        al.name AS admin_level_name_raw,
        lower(btrim(coalesce(al.code, ''))) AS level_code,
        lower(btrim(coalesce(al.name, ''))) AS level_name
    FROM entity_rows AS e
    LEFT JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
    LEFT JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
),
non_township AS (
    SELECT
        entity_table,
        entity_slug,
        coalesce(nullif(btrim(admin_level_code_raw), ''), '(missing_level_code)') AS admin_level_code,
        coalesce(nullif(btrim(admin_level_name_raw), ''), '(missing_level_name)') AS admin_level_name
    FROM linked
    WHERE admin_area_id IS NOT NULL
      AND linked_admin_area_id IS NOT NULL
      AND linked_is_active IS TRUE
      AND linked_deleted_at IS NULL
      AND NOT (
          lower(btrim(coalesce(level_code, ''))) NOT IN (
              'country',
              'myanmar',
              'nation',
              'region',
              'state',
              'state_region',
              'division',
              'district',
              'ward',
              'city',
              'village',
              'hamlet',
              'village_tract',
              'quarter',
              'suburb',
              'neighbourhood',
              'neighborhood'
          )
          AND (
              lower(btrim(coalesce(level_code, ''))) IN ('township', 'town')
              OR lower(btrim(coalesce(level_name, ''))) = 'township'
          )
      )
)
SELECT
    entity_table,
    entity_slug,
    admin_level_code,
    admin_level_name,
    count(*)::bigint AS row_count
FROM non_township
GROUP BY entity_table, entity_slug, admin_level_code, admin_level_name
ORDER BY entity_table, row_count DESC, admin_level_code, admin_level_name;
