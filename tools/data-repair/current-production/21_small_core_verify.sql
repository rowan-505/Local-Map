-- Prompt 10 verify
SELECT 'places_osm_no_external' AS metric, count(*)::text AS value
FROM core.core_places WHERE deleted_at IS NULL AND external_id IS NULL AND source_type_id = 1
UNION ALL
SELECT 'place_names_mm_or_blank', count(*)::text
FROM core.core_place_names WHERE language_code = 'mm' OR language_code IS NULL OR btrim(language_code) = ''
UNION ALL
SELECT 'landuse_class_mismatch', count(*)::text
FROM core.core_map_landuse l
WHERE deleted_at IS NULL
  AND class_code IS DISTINCT FROM (SELECT code FROM ref.ref_landuse_classes c WHERE c.id = l.landuse_class_id)
UNION ALL
SELECT 'places_missing_admin', count(*)::text
FROM core.core_places WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL
SELECT 'buildings_missing_admin', count(*)::text
FROM core.core_map_buildings WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL
SELECT 'landuse_missing_admin', count(*)::text
FROM core.core_map_landuse WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL
SELECT 'stops_missing_admin', count(*)::text
FROM transport.stops WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL
SELECT 'terminals_missing_admin', count(*)::text
FROM transport.terminals WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL
SELECT 'infra_missing_admin', count(*)::text
FROM transport.infrastructure_lines WHERE deleted_at IS NULL AND admin_area_id IS NULL;

SELECT language_code, count(*) FROM core.core_place_names GROUP BY 1 ORDER BY 2 DESC;
