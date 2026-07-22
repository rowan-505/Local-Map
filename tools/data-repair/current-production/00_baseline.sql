-- Current-production repair — Prompt 1 baseline (READ-ONLY)
-- Project: locghyuranqaqsnbxflc
-- Do not UPDATE/INSERT/DELETE.

\echo '=== ADMIN TOTALS ==='
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE is_active AND deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE is_verified) AS verified,
  count(*) FILTER (WHERE deleted_at IS NULL AND parent_id IS NULL) AS null_parent,
  count(*) FILTER (WHERE deleted_at IS NULL AND geom IS NULL) AS null_geom,
  count(*) FILTER (WHERE deleted_at IS NULL AND NOT ST_IsValid(geom)) AS invalid_geom,
  count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external_id,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_type_id IS NULL) AS null_type
FROM core.core_admin_areas;

\echo '=== ADMIN BY LEVEL ==='
SELECT al.code, al.rank, count(*) AS n
FROM core.core_admin_areas aa
JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
WHERE aa.deleted_at IS NULL
GROUP BY al.code, al.rank
ORDER BY al.rank;

\echo '=== ADMIN BY TYPE ==='
SELECT t.code, count(*) AS n
FROM core.core_admin_areas aa
LEFT JOIN ref.ref_admin_area_types t ON t.id = aa.admin_area_type_id
WHERE aa.deleted_at IS NULL
GROUP BY t.code
ORDER BY n DESC;

\echo '=== ADMIN PARENT ISSUES ==='
WITH aa AS (
  SELECT aa.id, aa.parent_id, al.rank,
         pal.rank AS parent_rank
  FROM core.core_admin_areas aa
  JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
  LEFT JOIN core.core_admin_areas p ON p.id = aa.parent_id AND p.deleted_at IS NULL
  LEFT JOIN ref.ref_admin_levels pal ON pal.id = p.admin_level_id
  WHERE aa.deleted_at IS NULL
)
SELECT 'self_parent' AS issue, count(*) FROM aa WHERE id = parent_id
UNION ALL SELECT 'missing_parent_row', count(*) FROM aa WHERE parent_id IS NOT NULL AND parent_rank IS NULL
UNION ALL SELECT 'parent_rank_not_higher', count(*) FROM aa WHERE parent_id IS NOT NULL AND parent_rank IS NOT NULL AND rank <= parent_rank
UNION ALL SELECT 'dup_external_id', count(*) FROM (
  SELECT external_id FROM core.core_admin_areas
  WHERE deleted_at IS NULL AND external_id IS NOT NULL
  GROUP BY 1 HAVING count(*) > 1
) d
UNION ALL SELECT 'missing_primary_name', count(*)
FROM core.core_admin_areas aa
WHERE aa.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_admin_area_names n
    WHERE n.admin_area_id = aa.id AND n.is_primary
  );

\echo '=== STREETS TOTALS ==='
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE is_active AND deleted_at IS NULL) AS active,
  count(*) FILTER (WHERE is_verified) AS verified,
  count(*) FILTER (WHERE COALESCE(manual_override, false)) AS manual_override,
  count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
  count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external_id
FROM core.core_streets;

\echo '=== STREETS BY ROAD_CLASS ==='
SELECT road_class, count(*) AS n
FROM core.core_streets
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY n DESC;

\echo '=== STREETS TEXT/FK MISMATCH (summary) ==='
SELECT
  count(*) FILTER (WHERE s.road_class IS DISTINCT FROM rc.code) AS text_fk_mismatch,
  count(*) FILTER (WHERE s.road_class = 'unclassified' AND rc.code = 'unknown') AS unclassified_as_unknown,
  count(*) FILTER (WHERE s.road_class = 'track' AND rc.code = 'unknown') AS track_as_unknown
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL;

\echo '=== STREETS NAME FLAGS (separate JSON keys; full table OK for single keys) ==='
SELECT
  count(*) FILTER (
    WHERE normalized_data->>'generated_label' IS NOT NULL
      AND nullif(btrim(normalized_data->>'generated_label'), '') IS NOT NULL
  ) AS generated_label_present,
  count(*) FILTER (
    WHERE nullif(btrim(normalized_data->'tags'->>'name'), '') IS NOT NULL
  ) AS has_osm_name_tag
FROM core.core_streets
WHERE deleted_at IS NULL;

\echo '=== PLACES ==='
SELECT count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
       count(*) FILTER (WHERE is_verified) AS verified,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
       count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external_id
FROM core.core_places;

\echo '=== BUILDINGS ==='
SELECT count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
       count(*) FILTER (WHERE is_verified) AS verified,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
       count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external_id
FROM core.core_map_buildings;

\echo '=== LANDUSE ==='
SELECT count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted,
       count(*) FILTER (WHERE COALESCE(is_verified, false)) AS verified,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin,
       count(*) FILTER (WHERE deleted_at IS NULL AND external_id IS NULL) AS null_external_id
FROM core.core_map_landuse;

\echo '=== WATER (no admin_area_id column) ==='
SELECT 'water_lines' AS family, count(*) AS total, count(*) FILTER (WHERE deleted_at IS NULL) AS not_deleted
FROM core.core_map_water_lines
UNION ALL
SELECT 'water_polygons', count(*), count(*) FILTER (WHERE deleted_at IS NULL)
FROM core.core_map_water_polygons;

\echo '=== TRANSPORT MISSING ADMIN ==='
SELECT 'stops' AS family, count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL) AS missing_admin
FROM transport.stops
UNION ALL
SELECT 'terminals', count(*),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL)
FROM transport.terminals
UNION ALL
SELECT 'infrastructure_lines', count(*),
       count(*) FILTER (WHERE deleted_at IS NULL AND admin_area_id IS NULL)
FROM transport.infrastructure_lines;

\echo '=== LINEAGE / IMPORT REVIEW ==='
SELECT 'system_source_registry' AS t, count(*)::bigint AS n FROM system.system_source_registry
UNION ALL SELECT 'system_import_batches', count(*) FROM system.system_import_batches
UNION ALL SELECT 'system_source_snapshots', count(*) FROM system.system_source_snapshots
UNION ALL SELECT 'system_publish_batches', count(*) FROM system.system_publish_batches
UNION ALL SELECT 'system_publish_items', count(*) FROM system.system_publish_items
UNION ALL SELECT 'import_review.review_batches', count(*) FROM import_review.review_batches
UNION ALL SELECT 'road_candidates', count(*) FROM import_review.road_candidates
UNION ALL SELECT 'admin_area_candidates', count(*) FROM import_review.admin_area_candidates
UNION ALL SELECT 'place_candidates', count(*) FROM import_review.place_candidates
UNION ALL SELECT 'building_candidates', count(*) FROM import_review.building_candidates
UNION ALL SELECT 'landuse_candidates', count(*) FROM import_review.landuse_candidates
UNION ALL SELECT 'water_line_candidates', count(*) FROM import_review.water_line_candidates
UNION ALL SELECT 'water_polygon_candidates', count(*) FROM import_review.water_polygon_candidates
UNION ALL SELECT 'search.search_documents', count(*) FROM search.search_documents;

\echo '=== BASELINE COMPLETE (read-only) ==='
