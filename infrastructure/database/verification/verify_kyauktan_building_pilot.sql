-- Read-only verification for migrations 149/150 and a Kyauktan-only import.
-- Usage:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -v region_code=MM-KYAUKTAN \
--     -v expected_preimport_buildings=1133 \
--     -f infrastructure/database/verification/verify_kyauktan_building_pilot.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?region_code}
\else
\set region_code 'MM-KYAUKTAN'
\endif

\if :{?expected_preimport_buildings}
\else
\set expected_preimport_buildings '1133'
\endif

BEGIN READ ONLY;

SELECT
    'building_integrity' AS section,
    count(*) AS total_buildings,
    count(DISTINCT id) AS distinct_ids,
    count(DISTINCT public_id) AS distinct_public_ids,
    count(*) FILTER (WHERE geom IS NULL) AS null_geometry,
    count(*) FILTER (WHERE geom IS NOT NULL AND st_srid(geom) <> 4326) AS wrong_srid,
    count(*) FILTER (WHERE geom IS NOT NULL AND st_isempty(geom)) AS empty_geometry,
    count(*) FILTER (WHERE geom IS NOT NULL AND NOT st_isvalid(geom)) AS invalid_geometry
FROM core.core_buildings;

SELECT
    'preimport_baseline_floor' AS section,
    :'expected_preimport_buildings'::bigint AS expected_preimport_buildings,
    count(*) AS current_buildings,
    count(*) >= :'expected_preimport_buildings'::bigint AS pass
FROM core.core_buildings;

SELECT
    'tile_contract' AS section,
    array_agg(column_name::text ORDER BY ordinal_position) AS actual_columns,
    array_agg(column_name::text ORDER BY ordinal_position) = ARRAY[
        'id',
        'public_id',
        'region_code',
        'name_my',
        'name_en',
        'name_und',
        'name',
        'building_type_code',
        'levels',
        'height_m',
        'geom'
    ]::text[] AS pass
FROM information_schema.columns
WHERE table_schema = 'tiles'
  AND table_name = 'tiles_buildings_v';

SELECT
    'tile_row_integrity' AS section,
    count(*) AS tile_rows,
    count(*) FILTER (WHERE geom IS NULL) AS null_geometry,
    count(*) FILTER (WHERE st_srid(geom) <> 4326) AS wrong_srid,
    count(*) FILTER (WHERE st_isempty(geom)) AS empty_geometry,
    count(*) FILTER (WHERE NOT st_isvalid(geom)) AS invalid_geometry
FROM tiles.tiles_buildings_v;

SELECT
    'search_unnamed_exclusion' AS section,
    count(*) FILTER (
        WHERE nullif(btrim(search_source.display_name), '') IS NULL
    ) AS unnamed_search_rows,
    count(*) FILTER (
        WHERE nullif(btrim(building.name), '') IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM core.core_building_names AS building_name
              WHERE building_name.building_id = building.id
                AND nullif(btrim(building_name.name), '') IS NOT NULL
          )
    ) AS ordinary_unnamed_rows_in_search
FROM search.v_search_buildings_source AS search_source
JOIN core.core_buildings AS building
  ON building.id = search_source.entity_id;

SELECT
    'imported_name_fallback' AS section,
    count(*) FILTER (
        WHERE building_name.name_type = 'imported'
          AND building_name.language_code IN ('my', 'mm', 'en', 'und')
    ) AS imported_name_rows,
    count(DISTINCT tile.id) FILTER (
        WHERE building_name.name_type = 'imported'
          AND tile.name IS NOT NULL
    ) AS imported_names_visible_in_tiles,
    count(DISTINCT search_source.entity_id) FILTER (
        WHERE building_name.name_type = 'imported'
          AND search_source.display_name IS NOT NULL
    ) AS imported_names_visible_in_search
FROM core.core_building_names AS building_name
LEFT JOIN tiles.tiles_buildings_v AS tile
  ON tile.id = building_name.building_id
LEFT JOIN search.v_search_buildings_source AS search_source
  ON search_source.entity_id = building_name.building_id;

SELECT
    'reverse_index' AS section,
    index_meta.indisvalid,
    index_meta.indisready,
    pg_get_indexdef(index_meta.indexrelid) AS index_definition,
    index_meta.indisvalid AND index_meta.indisready AS pass
FROM pg_index AS index_meta
WHERE index_meta.indexrelid =
      'core.core_place_buildings_building_id_idx'::regclass;

SELECT
    'kyauktan_source_identity' AS section,
    count(*) AS region_rows,
    count(*) FILTER (
        WHERE source_registry_id IS NULL
           OR source_feature_type IS NULL
           OR source_feature_id IS NULL
    ) AS missing_identity,
    count(*) FILTER (
        WHERE source_feature_type NOT IN ('way', 'relation')
    ) AS invalid_feature_type,
    count(*) FILTER (
        WHERE geom IS NULL
           OR st_srid(geom) <> 4326
           OR st_isempty(geom)
           OR NOT st_isvalid(geom)
           OR geometrytype(geom) NOT IN ('POLYGON', 'MULTIPOLYGON')
    ) AS invalid_geometry
FROM core.core_buildings
WHERE region_code = :'region_code';

SELECT
    'source_identity_duplicates' AS section,
    count(*) AS duplicate_groups
FROM (
    SELECT source_registry_id, source_feature_type, source_feature_id
    FROM core.core_buildings
    WHERE source_registry_id IS NOT NULL
      AND source_feature_type IS NOT NULL
      AND source_feature_id IS NOT NULL
    GROUP BY source_registry_id, source_feature_type, source_feature_id
    HAVING count(*) > 1
) AS duplicates;

SELECT
    'relationship_orphans' AS section,
    count(*) FILTER (WHERE building.id IS NULL) AS orphan_building_links,
    count(*) FILTER (WHERE place.id IS NULL) AS orphan_place_links
FROM core.core_place_buildings AS place_building
LEFT JOIN core.core_buildings AS building
  ON building.id = place_building.building_id
LEFT JOIN core.core_places AS place
  ON place.id = place_building.place_id;

SELECT
    'relation_sizes' AS section,
    pg_relation_size('core.core_buildings') AS table_bytes,
    pg_indexes_size('core.core_buildings') AS index_bytes,
    pg_total_relation_size('core.core_buildings') AS total_bytes,
    pg_size_pretty(pg_relation_size('core.core_buildings')) AS table_size,
    pg_size_pretty(pg_indexes_size('core.core_buildings')) AS index_size,
    pg_size_pretty(pg_total_relation_size('core.core_buildings')) AS total_size;

ROLLBACK;
