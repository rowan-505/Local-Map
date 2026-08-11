-- Post-apply verification for Core → basemap_source.buildings merge.
-- Local geo_core only.

\set ON_ERROR_STOP on
\echo '=== VERIFY CORE→BASEMAP MERGE ==='

-- 1) Every active Core export row is matched OR MANUAL_REVIEW
SELECT 'active_core_unaccounted' AS check_name,
  count(*)::text AS value,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM basemap_source.core_buildings_export e
JOIN basemap_source.core_buildings_merge_report r ON r.core_id = e.core_id
WHERE coalesce(e.is_soft_deleted, false) = false
  AND coalesce(e.is_active, true) = true
  AND r.action = 'MANUAL_REVIEW'
UNION ALL
SELECT 'active_core_without_local_or_review',
  count(*)::text,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM basemap_source.core_buildings_export e
LEFT JOIN basemap_source.core_buildings_merge_report r ON r.core_id = e.core_id
WHERE coalesce(e.is_soft_deleted, false) = false
  AND coalesce(e.is_active, true) = true
  AND (
    r.core_id IS NULL
    OR (
      r.action NOT IN ('MANUAL_REVIEW', 'SKIPPED_SOFT_DELETED')
      AND r.local_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM basemap_source.buildings b WHERE b.core_public_id = e.core_public_id
      )
    )
  )
UNION ALL
-- 2) No duplicate typed OSM identities
SELECT 'duplicate_osm_identities',
  count(*)::text,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (
  SELECT osm_feature_type, osm_id
  FROM basemap_source.buildings
  WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1
) d
UNION ALL
-- 3) No duplicate core_public_id
SELECT 'duplicate_core_public_id',
  count(*)::text,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (
  SELECT core_public_id
  FROM basemap_source.buildings
  WHERE core_public_id IS NOT NULL
  GROUP BY 1
  HAVING count(*) > 1
) d
UNION ALL
-- 4) Managed insert shape
SELECT 'managed_rows_bad_shape',
  count(*)::text,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM basemap_source.buildings
WHERE source_type = 'coremap'
  AND (
    source_feature_type IS DISTINCT FROM 'managed_building'
    OR source_feature_id IS DISTINCT FROM core_public_id::text
    OR osm_feature_type IS NOT NULL
    OR osm_id IS NOT NULL
    OR source_snapshot_id IS NOT NULL
    OR external_id IS DISTINCT FROM ('coremap:building:' || core_public_id::text)
    OR is_managed_in_core IS NOT TRUE
  )
UNION ALL
-- 5) Counts
SELECT 'local_total', count(*)::text, 'INFO'
FROM basemap_source.buildings
UNION ALL
SELECT 'osm_identity_rows', count(*)::text, 'INFO'
FROM basemap_source.buildings
WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
UNION ALL
SELECT 'managed_coremap_rows', count(*)::text, 'INFO'
FROM basemap_source.buildings
WHERE source_type = 'coremap'
UNION ALL
SELECT 'linked_core_public_id', count(*)::text, 'INFO'
FROM basemap_source.buildings
WHERE core_public_id IS NOT NULL
UNION ALL
SELECT 'report_merged', count(*)::text, 'INFO'
FROM basemap_source.core_buildings_merge_report
WHERE action = 'MERGED_EXISTING_OSM'
UNION ALL
SELECT 'report_inserted', count(*)::text, 'INFO'
FROM basemap_source.core_buildings_merge_report
WHERE action = 'INSERTED_COREMAP_MANAGED'
UNION ALL
SELECT 'report_already', count(*)::text, 'INFO'
FROM basemap_source.core_buildings_merge_report
WHERE action = 'ALREADY_IMPORTED'
UNION ALL
SELECT 'report_manual', count(*)::text, 'INFO'
FROM basemap_source.core_buildings_merge_report
WHERE action = 'MANUAL_REVIEW'
UNION ALL
SELECT 'report_skipped', count(*)::text, 'INFO'
FROM basemap_source.core_buildings_merge_report
WHERE action = 'SKIPPED_SOFT_DELETED'
ORDER BY 1;

-- Active Core must have exactly one local link OR be MANUAL_REVIEW
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM basemap_source.core_buildings_export e
      JOIN basemap_source.core_buildings_merge_report r ON r.core_id = e.core_id
      WHERE coalesce(e.is_soft_deleted, false) = false
        AND coalesce(e.is_active, true) = true
        AND r.action <> 'MANUAL_REVIEW'
        AND (
          SELECT count(*)
          FROM basemap_source.buildings b
          WHERE b.core_public_id = e.core_public_id
        ) <> 1
    )
    THEN 'FAIL: some non-MANUAL_REVIEW active Core rows do not map to exactly one local row'
    ELSE 'PASS: non-MANUAL_REVIEW active Core rows map to exactly one local row'
  END AS active_core_link_check;
