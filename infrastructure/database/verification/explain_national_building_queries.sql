-- Representative read-only query plans for one imported building region.
--
-- Required:
--   -v region_code=MM-KAYAH
--
-- Run after ANALYZE and capture the complete output in the regional evidence
-- bundle. Review actual rows, estimated rows, execution time, shared/temp
-- buffers and the selected indexes. A passing result has no unexpected
-- national-scale sequential scan or temp spill.

\set ON_ERROR_STOP on
\pset pager off

\if :{?region_code}
\else
    \echo 'missing required variable: region_code'
    SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10min';

SELECT
    building.id AS building_id,
    building.public_id AS public_id,
    building.admin_area_id AS admin_area_id,
    building.source_registry_id AS source_registry_id,
    building.source_feature_type AS source_feature_type,
    building.source_feature_id AS source_feature_id,
    ST_X(ST_PointOnSurface(building.geom)) AS point_x,
    ST_Y(ST_PointOnSurface(building.geom)) AS point_y,
    ST_X(ST_PointOnSurface(building.geom)) - 0.01 AS bbox_xmin,
    ST_Y(ST_PointOnSurface(building.geom)) - 0.01 AS bbox_ymin,
    ST_X(ST_PointOnSurface(building.geom)) + 0.01 AS bbox_xmax,
    ST_Y(ST_PointOnSurface(building.geom)) + 0.01 AS bbox_ymax,
    (
        SELECT building_name.building_id
        FROM core.core_building_names AS building_name
        ORDER BY building_name.id
        LIMIT 1
    ) AS name_building_id,
    (
        SELECT place_building.building_id
        FROM core.core_place_buildings AS place_building
        ORDER BY place_building.building_id, place_building.place_id
        LIMIT 1
    ) AS link_building_id
FROM core.core_buildings AS building
WHERE building.region_code = btrim(:'region_code')
  AND building.admin_area_id IS NOT NULL
  AND building.source_registry_id IS NOT NULL
  AND building.source_feature_type IS NOT NULL
  AND building.source_feature_id IS NOT NULL
  AND building.geom IS NOT NULL
ORDER BY building.id
LIMIT 1
\gset sample_

\if :{?sample_building_id}
\else
    \echo 'no complete representative row for region'
    SELECT 1 / 0;
\endif

\echo '1. tile/bbox base-table lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT
    building.id,
    building.public_id,
    building.region_code,
    building.geom
FROM core.core_buildings AS building
WHERE building.is_active IS TRUE
  AND building.deleted_at IS NULL
  AND building.geom && ST_MakeEnvelope(
      :sample_bbox_xmin,
      :sample_bbox_ymin,
      :sample_bbox_xmax,
      :sample_bbox_ymax,
      4326
  );

\echo '2. reverse point-in-building lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT building.id, building.public_id
FROM core.core_buildings AS building
WHERE building.geom && ST_SetSRID(
        ST_MakePoint(:sample_point_x, :sample_point_y),
        4326
    )
  AND ST_Covers(
      building.geom,
      ST_SetSRID(ST_MakePoint(:sample_point_x, :sample_point_y), 4326)
  )
LIMIT 1;

\echo '3. public ID detail lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT building.*
FROM core.core_buildings AS building
WHERE building.public_id = :'sample_public_id'::uuid;

\echo '4. admin-area lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT building.id, building.public_id, building.updated_at
FROM core.core_buildings AS building
WHERE building.admin_area_id = :sample_admin_area_id
ORDER BY building.updated_at DESC
LIMIT 100;

\echo '5. localized-name lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT building_name.*
FROM core.core_building_names AS building_name
WHERE building_name.building_id = :sample_name_building_id
ORDER BY building_name.is_primary DESC, building_name.id;

\echo '6. typed OSM identity lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT building.id, building.public_id
FROM core.core_buildings AS building
WHERE building.source_registry_id = :sample_source_registry_id
  AND building.source_feature_type = :'sample_source_feature_type'
  AND building.source_feature_id = :sample_source_feature_id;

\echo '7. reverse POI link lookup'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT place_building.place_id, place_building.is_primary
FROM core.core_place_buildings AS place_building
WHERE place_building.building_id = :sample_link_building_id;

\echo '8. regional tile-view export'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, VERBOSE)
SELECT
    tile_building.id,
    tile_building.public_id,
    tile_building.region_code,
    tile_building.name_my,
    tile_building.name_en,
    tile_building.name_und,
    tile_building.name,
    tile_building.building_type_code,
    tile_building.levels,
    tile_building.height_m,
    tile_building.geom
FROM tiles.tiles_buildings_v AS tile_building
WHERE tile_building.region_code = btrim(:'region_code');

ROLLBACK;
