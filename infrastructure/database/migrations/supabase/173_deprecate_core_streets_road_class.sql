-- Phase 4 (streets): keep the large-table text column temporarily, but make
-- road_class_id -> ref.ref_road_classes authoritative for tile output.
-- No core.core_streets row update and no table rewrite.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

COMMENT ON COLUMN core.core_streets.road_class IS
  'DEPRECATED compatibility mirror. Authoritative classification is road_class_id -> ref.ref_road_classes. Do not write or read independently.';

COMMENT ON COLUMN core.core_streets.road_class_id IS
  'Authoritative street classification FK to ref.ref_road_classes.';

CREATE OR REPLACE VIEW tiles.tiles_streets_v AS
SELECT
  s.id,
  s.public_id::text AS public_id,
  COALESCE(
    NULLIF(btrim(mm.name), ''),
    NULLIF(btrim(en.name), ''),
    NULLIF(btrim(s.canonical_name), ''),
    'Unnamed street'
  ) AS name,
  s.canonical_name,
  s.admin_area_id,
  s.is_active,
  s.updated_at,
  ST_Force2D(ST_SetSRID(s.geom, 4326))::geometry(LineString, 4326) AS geom,
  mm.name AS name_mm,
  en.name AS name_en,
  COALESCE(rc.code, 'unknown') AS road_class,
  COALESCE(rc.code, 'unknown') AS road_class_code,
  COALESCE(rc.rank, 100) AS sort_rank,
  COALESCE(rc.min_zoom, 12::numeric) AS min_zoom,
  s.surface,
  COALESCE(s.is_oneway, false) AS is_oneway,
  COALESCE(s.bridge, false) AS bridge,
  COALESCE(s.tunnel, false) AS tunnel,
  COALESCE(s.layer, 0) AS layer
FROM core.core_streets AS s
LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
LEFT JOIN LATERAL (
  SELECT sn.name
  FROM core.core_street_names AS sn
  WHERE sn.street_id = s.id
    AND coalesce(btrim(sn.name_type), '') <> 'generated'
    AND (lower(btrim(sn.language_code)) IN ('mm', 'my')
      OR upper(btrim(coalesce(sn.script_code, ''))) = 'MYMR')
  ORDER BY sn.is_primary DESC NULLS LAST,
    CASE WHEN sn.name_type = 'official' THEN 0 ELSE 1 END,
    sn.id
  LIMIT 1
) AS mm ON true
LEFT JOIN LATERAL (
  SELECT sn.name
  FROM core.core_street_names AS sn
  WHERE sn.street_id = s.id
    AND coalesce(btrim(sn.name_type), '') <> 'generated'
    AND (lower(btrim(sn.language_code)) = 'en'
      OR upper(btrim(coalesce(sn.script_code, ''))) = 'LATN')
  ORDER BY sn.is_primary DESC NULLS LAST,
    CASE WHEN sn.name_type = 'official' THEN 0 ELSE 1 END,
    sn.id
  LIMIT 1
) AS en ON true
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND ST_IsValid(s.geom)
  AND NOT ST_IsEmpty(s.geom)
  AND ST_GeometryType(ST_Force2D(ST_SetSRID(s.geom, 4326))) = 'ST_LineString';

COMMENT ON VIEW tiles.tiles_streets_v IS
  'Street MVT compatibility view; road_class and road_class_code derive only from road_class_id -> ref.ref_road_classes.';

COMMIT;
