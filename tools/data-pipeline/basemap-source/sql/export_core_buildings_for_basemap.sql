-- Read-only Supabase export: one row per core.core_map_buildings
-- Used by export_core_buildings_for_basemap.sh (temp view + COPY).
-- No writes.

SELECT
  b.id AS core_id,
  b.public_id AS core_public_id,
  b.external_id,
  b.source_feature_type,
  b.source_feature_id::text AS source_feature_id,
  b.source_registry_id,
  bt.code AS building_type_code,
  b.admin_area_id,
  b.levels,
  b.height_m::double precision AS height_m,
  round(b.confidence_score)::integer AS confidence,
  b.verification_status,
  b.is_active,
  (b.deleted_at IS NOT NULL) AS is_soft_deleted,
  b.deleted_at,
  b.is_geometry_manually_edited,
  b.is_attributes_manually_edited,
  b.name AS core_name,
  COALESCE(b.source_refs, '{}'::jsonb) AS source_refs,
  COALESCE(b.normalized_data, '{}'::jsonb) AS normalized_data,
  ST_AsEWKT(b.geom) AS geom_ewkt,
  md5(ST_AsBinary(ST_Normalize(b.geom))) AS geom_hash,
  ST_GeometryType(b.geom) AS geom_type,
  ST_SRID(b.geom) AS geom_srid,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'language_code', n.language_code,
          'name', n.name,
          'name_type', n.name_type,
          'is_primary', n.is_primary,
          'search_weight', n.search_weight
        )
        ORDER BY n.is_primary DESC, n.language_code, n.name
      )
      FROM core.core_map_building_names n
      WHERE n.building_id = b.id
    ),
    '[]'::jsonb
  ) AS names_json,
  (
    SELECT count(*)::bigint
    FROM core.core_place_buildings pb
    WHERE pb.building_id = b.id
  ) AS place_link_count
FROM core.core_map_buildings b
LEFT JOIN ref.ref_building_types bt ON bt.id = b.building_type_id
ORDER BY b.id;
