-- =============================================================================
-- verify_search_index_health.sql
-- -----------------------------------------------------------------------------
-- Read-only unified search index health check.
-- Compares search.v_search_*_source (indexer eligibility) against
-- search.search_documents (runtime index).
--
-- Does NOT modify data. Does NOT rebuild the index.
--
-- Run (psql):
--   PAGER=cat psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/verification/verify_search_index_health.sql
--
-- Or via API helper:
--   npm --prefix apps/api run search:health
--   npm --prefix apps/api run search:reconcile -- --repair
--
-- Output columns:
--   entity_family, search_entity_type, canonical_count, indexed_count,
--   missing_count, ghost_count, stale_count,
--   latest_indexed_at, latest_source_updated_at
-- =============================================================================

\pset pager off

WITH families AS (
    SELECT *
    FROM (
        VALUES
            ('places', 'place', 'search.v_search_places_source', 'core.core_places'),
            ('admin_areas', 'admin_area', 'search.v_search_admin_areas_source', 'core.core_admin_areas'),
            ('street_groups', 'street_group', 'search.v_search_street_groups_source', 'core.core_streets (grouped)'),
            ('addresses', 'address', 'search.v_search_addresses_source', 'core.core_addresses'),
            ('transport_stops', 'transport_stop', 'search.v_search_bus_stops_source', 'transport.stops'),
            ('transport_terminals', 'transport_terminal', 'search.v_search_transport_terminals_source', 'transport.terminals'),
            ('transport_routes', 'transport_route', 'search.v_search_bus_routes_source', 'transport.routes'),
            ('transport_route_variants', 'transport_route_variant', 'search.v_search_bus_routes_source', 'transport.route_variants'),
            ('buildings', 'building', 'search.v_search_buildings_source', 'core.core_map_buildings'),
            ('landuse', 'landuse', 'search.v_search_landuse_source', 'core.core_map_landuse'),
            ('water_lines', 'water_line', 'search.v_search_water_lines_source', 'core.core_map_water_lines'),
            ('water_polygons', 'water_polygon', 'search.v_search_water_polygons_source', 'core.core_map_water_polygons')
    ) AS t(entity_family, search_entity_type, source_view, canonical_table)
),
canonical AS (
    SELECT entity_type, entity_id::bigint AS entity_id, source_updated_at
    FROM search.v_search_places_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_admin_areas_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_street_groups_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_addresses_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_bus_stops_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_bus_routes_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_transport_terminals_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_buildings_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_landuse_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_water_lines_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_water_polygons_source
),
indexed AS (
    SELECT
        entity_type,
        entity_id::bigint AS entity_id,
        source_updated_at,
        indexed_at
    FROM search.search_documents
    WHERE is_public = true
      AND is_active = true
),
joined AS (
    SELECT
        coalesce(c.entity_type, i.entity_type) AS entity_type,
        c.entity_id AS canonical_entity_id,
        i.entity_id AS indexed_entity_id,
        c.source_updated_at AS canonical_source_updated_at,
        i.source_updated_at AS indexed_source_updated_at,
        i.indexed_at
    FROM canonical c
    FULL OUTER JOIN indexed i
        ON i.entity_type = c.entity_type
       AND i.entity_id = c.entity_id
),
per_family AS (
    SELECT
        f.entity_family,
        f.search_entity_type,
        f.source_view,
        f.canonical_table,
        count(j.canonical_entity_id) AS canonical_count,
        count(j.indexed_entity_id) AS indexed_count,
        count(*) FILTER (
            WHERE j.canonical_entity_id IS NOT NULL
              AND j.indexed_entity_id IS NULL
        ) AS missing_count,
        count(*) FILTER (
            WHERE j.indexed_entity_id IS NOT NULL
              AND j.canonical_entity_id IS NULL
        ) AS ghost_count,
        count(*) FILTER (
            WHERE j.canonical_entity_id IS NOT NULL
              AND j.indexed_entity_id IS NOT NULL
              AND (
                  j.indexed_source_updated_at IS NULL
                  OR j.canonical_source_updated_at IS NULL
                  OR j.indexed_source_updated_at < j.canonical_source_updated_at
              )
        ) AS stale_count,
        max(j.indexed_at) AS latest_indexed_at,
        max(j.canonical_source_updated_at) AS latest_source_updated_at
    FROM families f
    LEFT JOIN joined j
        ON j.entity_type = f.search_entity_type
    GROUP BY
        f.entity_family,
        f.search_entity_type,
        f.source_view,
        f.canonical_table
)
SELECT
    entity_family,
    search_entity_type,
    canonical_count,
    indexed_count,
    missing_count,
    ghost_count,
    stale_count,
    latest_indexed_at,
    latest_source_updated_at
FROM per_family
ORDER BY entity_family;

-- -----------------------------------------------------------------------------
-- Transport stops detail (read-only): raw table vs source view vs index entity_type
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== transport_stops_detail ==='

SELECT
    'transport.stops (indexer eligibility)' AS label,
    count(*)::bigint AS row_count
FROM search.v_search_bus_stops_source
UNION ALL
SELECT
    'transport.stops (active, not deleted, has geom)' AS label,
    count(*)::bigint AS row_count
FROM transport.stops s
WHERE s.deleted_at IS NULL
  AND s.is_active = true
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
UNION ALL
SELECT
    'search.search_documents (entity_type = transport_stop)' AS label,
    count(*)::bigint AS row_count
FROM search.search_documents d
WHERE d.entity_type = 'transport_stop'
  AND d.is_public = true
  AND d.is_active = true;

-- -----------------------------------------------------------------------------
-- Latest rebuild run (informational)
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== latest_search_index_run ==='

SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
ORDER BY id DESC
LIMIT 1;
