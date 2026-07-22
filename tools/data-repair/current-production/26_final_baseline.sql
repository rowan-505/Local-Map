-- Prompt 12 — Final baseline counts (READ-ONLY after lineage register)
-- Parent rank rule: parent.rank must be strictly lower than child.rank (country=10 … ward=60).
SET statement_timeout = '10min';

SELECT 'admin_total' AS metric, count(*)::text FROM core.core_admin_areas WHERE deleted_at IS NULL
UNION ALL SELECT 'admin_verified', count(*)::text FROM core.core_admin_areas WHERE deleted_at IS NULL AND coalesce(is_verified,false)
UNION ALL SELECT 'admin_null_external', count(*)::text FROM core.core_admin_areas WHERE deleted_at IS NULL AND external_id IS NULL
UNION ALL SELECT 'admin_invalid_geom', count(*)::text FROM core.core_admin_areas WHERE deleted_at IS NULL AND geom IS NOT NULL AND NOT ST_IsValid(geom)
UNION ALL SELECT 'admin_parent_rank_bad', count(*)::text FROM core.core_admin_areas a
  JOIN core.core_admin_areas p ON p.id = a.parent_id
  JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
  JOIN ref.ref_admin_levels pl ON pl.id = p.admin_level_id
  WHERE a.deleted_at IS NULL AND pl.rank >= al.rank;

SELECT l.code AS admin_level, count(*) FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
WHERE a.deleted_at IS NULL GROUP BY 1 ORDER BY min(l.rank);

SELECT t.code AS admin_type, count(*) FROM core.core_admin_areas a
JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE a.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;

-- Admin links
SELECT 'places_missing_admin' AS metric, count(*)::text FROM core.core_places WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'buildings_missing_admin', count(*)::text FROM core.core_map_buildings WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'landuse_missing_admin', count(*)::text FROM core.core_map_landuse WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'streets_missing_admin', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'stops_missing_admin', count(*)::text FROM transport.stops WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'terminals_missing_admin', count(*)::text FROM transport.terminals WHERE deleted_at IS NULL AND admin_area_id IS NULL
UNION ALL SELECT 'infra_missing_admin', count(*)::text FROM transport.infrastructure_lines WHERE deleted_at IS NULL AND admin_area_id IS NULL;

-- Roads
SELECT 'streets_active' AS metric, count(*)::text FROM core.core_streets WHERE deleted_at IS NULL
UNION ALL SELECT 'streets_verified', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND coalesce(is_verified,false)
UNION ALL SELECT 'streets_manual_override', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND coalesce(manual_override,false)
UNION ALL SELECT 'streets_null_external', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND external_id IS NULL
UNION ALL SELECT 'streets_name_generated', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND coalesce((normalized_data->>'name_is_generated')::boolean,false)
UNION ALL SELECT 'streets_has_osm_name', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND nullif(btrim(normalized_data->'tags'->>'name'),'') IS NOT NULL
UNION ALL SELECT 'road_class_text_fk_mismatch', count(*)::text FROM core.core_streets s
  LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
  WHERE s.deleted_at IS NULL AND s.road_class IS DISTINCT FROM r.code
UNION ALL SELECT 'oneway_true', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND is_oneway IS TRUE
UNION ALL SELECT 'bridge_true', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND bridge IS TRUE
UNION ALL SELECT 'tunnel_true', count(*)::text FROM core.core_streets WHERE deleted_at IS NULL AND tunnel IS TRUE;

SELECT coalesce(r.code, s.road_class, '(null)') AS road_class, count(*)
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes r ON r.id = s.road_class_id
WHERE s.deleted_at IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- Small core
SELECT 'places_active' AS metric, count(*)::text FROM core.core_places WHERE deleted_at IS NULL
UNION ALL SELECT 'buildings_active', count(*)::text FROM core.core_map_buildings WHERE deleted_at IS NULL
UNION ALL SELECT 'landuse_active', count(*)::text FROM core.core_map_landuse WHERE deleted_at IS NULL
UNION ALL SELECT 'water_lines', count(*)::text FROM core.core_map_water_lines WHERE deleted_at IS NULL
UNION ALL SELECT 'water_polygons', count(*)::text FROM core.core_map_water_polygons WHERE deleted_at IS NULL;

-- Review / lineage
SELECT 'publish_batches_archived' AS metric, count(*)::text FROM system.system_publish_batches WHERE status='archived'
UNION ALL SELECT 'publish_batches_promoted', count(*)::text FROM system.system_publish_batches WHERE status='promoted'
UNION ALL SELECT 'publish_items_pending', count(*)::text FROM system.system_publish_items WHERE publish_status='pending'
UNION ALL SELECT 'publish_items_skipped', count(*)::text FROM system.system_publish_items WHERE publish_status='skipped'
UNION ALL SELECT 'import_batches', count(*)::text FROM system.system_import_batches
UNION ALL SELECT 'source_snapshots', count(*)::text FROM system.system_source_snapshots
UNION ALL SELECT 'ir_road_candidates', count(*)::text FROM import_review.road_candidates;
