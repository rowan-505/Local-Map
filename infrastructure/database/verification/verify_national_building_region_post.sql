-- Read-only, fail-closed verification for one committed regional import.
--
-- Required psql variables come from the frozen regional manifest:
--   region_code, source_code, snapshot_version, import_started_at,
--   expected_region_rows, expected_total_rows, expected_name_rows,
--   expected_link_rows, expected_identity_xor
--
-- psql "$SUPABASE_READ_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -v region_code=MM-KAYAH \
--   -v source_code=osm_myanmar \
--   -v snapshot_version=<version> \
--   -v import_started_at=<UTC timestamptz> \
--   -v expected_region_rows=<count> \
--   -v expected_total_rows=<count> \
--   -v expected_name_rows=<count> \
--   -v expected_link_rows=<count> \
--   -v expected_identity_xor=<hex> \
--   -f infrastructure/database/verification/verify_national_building_region_post.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?region_code}
\else
    \echo 'missing required variable: region_code'
    SELECT 1 / 0;
\endif
\if :{?source_code}
\else
    \echo 'missing required variable: source_code'
    SELECT 1 / 0;
\endif
\if :{?snapshot_version}
\else
    \echo 'missing required variable: snapshot_version'
    SELECT 1 / 0;
\endif
\if :{?import_started_at}
\else
    \echo 'missing required variable: import_started_at'
    SELECT 1 / 0;
\endif
\if :{?expected_region_rows}
\else
    \echo 'missing required variable: expected_region_rows'
    SELECT 1 / 0;
\endif
\if :{?expected_total_rows}
\else
    \echo 'missing required variable: expected_total_rows'
    SELECT 1 / 0;
\endif
\if :{?expected_name_rows}
\else
    \echo 'missing required variable: expected_name_rows'
    SELECT 1 / 0;
\endif
\if :{?expected_link_rows}
\else
    \echo 'missing required variable: expected_link_rows'
    SELECT 1 / 0;
\endif
\if :{?expected_identity_xor}
\else
    \echo 'missing required variable: expected_identity_xor'
    SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10min';

WITH source AS (
    SELECT registry.id AS source_registry_id, snapshot.id AS source_snapshot_id
    FROM system.system_source_registry AS registry
    JOIN system.system_source_snapshots AS snapshot
      ON snapshot.source_registry_id = registry.id
    WHERE registry.source_code = btrim(:'source_code')
      AND snapshot.snapshot_version = btrim(:'snapshot_version')
),
region AS (
    SELECT building.*
    FROM core.core_buildings AS building
    CROSS JOIN source
    WHERE building.region_code = btrim(:'region_code')
      AND building.source_registry_id = source.source_registry_id
),
identity_duplicates AS (
    SELECT
        building.source_registry_id,
        building.source_feature_type,
        building.source_feature_id
    FROM core.core_buildings AS building
    WHERE building.source_registry_id IS NOT NULL
      AND building.source_feature_type IS NOT NULL
      AND building.source_feature_id IS NOT NULL
    GROUP BY
        building.source_registry_id,
        building.source_feature_type,
        building.source_feature_id
    HAVING count(*) > 1
),
relationships AS (
    SELECT
        count(*) FILTER (WHERE building.id IS NULL) AS orphan_buildings,
        count(*) FILTER (WHERE place.id IS NULL) AS orphan_places
    FROM core.core_place_buildings AS place_building
    LEFT JOIN core.core_buildings AS building
      ON building.id = place_building.building_id
    LEFT JOIN core.core_places AS place
      ON place.id = place_building.place_id
)
SELECT
    (SELECT count(*) FROM core.core_buildings) AS total_rows,
    (SELECT count(*) FROM region) AS region_rows,
    (
        SELECT coalesce(
            to_hex(
                bit_xor(
                    hashtextextended(
                        region.source_feature_type
                            || ':'
                            || region.source_feature_id::text,
                        0
                    )
                )
            ),
            '0'
        )
        FROM region
    ) AS identity_xor,
    (
        SELECT count(*)
        FROM region
        CROSS JOIN source
        WHERE region.source_snapshot_id <> source.source_snapshot_id
           OR region.source_feature_type NOT IN ('way', 'relation')
           OR region.source_feature_id IS NULL
    ) AS bad_identity_rows,
    (
        SELECT count(*)
        FROM region
        WHERE region.geom IS NULL
           OR ST_SRID(region.geom) <> 4326
           OR ST_IsEmpty(region.geom)
           OR NOT ST_IsValid(region.geom)
           OR GeometryType(region.geom) NOT IN ('POLYGON', 'MULTIPOLYGON')
    ) AS bad_geometry_rows,
    (SELECT count(*) FROM identity_duplicates) AS duplicate_identity_groups,
    (SELECT orphan_buildings FROM relationships) AS orphan_building_links,
    (SELECT orphan_places FROM relationships) AS orphan_place_links,
    (SELECT count(*) FROM core.core_building_names) AS name_rows,
    (SELECT count(*) FROM core.core_place_buildings) AS link_rows,
    (
        SELECT count(*)
        FROM region
        WHERE region.created_at >= :'import_started_at'::timestamptz
          AND (
              coalesce(region.normalized_data, '{}'::jsonb) <> '{}'::jsonb
              OR coalesce(region.source_refs, '{}'::jsonb) <> '{}'::jsonb
          )
    ) AS new_rows_with_legacy_json,
    (
        SELECT count(*)
        FROM search.v_search_buildings_source AS search_building
        JOIN region
          ON region.id = search_building.entity_id
        WHERE nullif(btrim(region.name), '') IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM core.core_building_names AS building_name
              WHERE building_name.building_id = region.id
                AND nullif(btrim(building_name.name), '') IS NOT NULL
          )
    ) AS unnamed_rows_in_search,
    (
        SELECT count(*)
        FROM tiles.tiles_buildings_v AS tile_building
        JOIN region
          ON region.id = tile_building.id
        WHERE region.is_active IS TRUE
          AND region.deleted_at IS NULL
    ) AS tile_rows
\gset observed_

SELECT
    :'observed_total_rows'::bigint AS total_rows,
    :'observed_region_rows'::bigint AS region_rows,
    :'observed_identity_xor'::text AS identity_xor,
    :'observed_bad_identity_rows'::bigint AS bad_identity_rows,
    :'observed_bad_geometry_rows'::bigint AS bad_geometry_rows,
    :'observed_duplicate_identity_groups'::bigint
        AS duplicate_identity_groups,
    :'observed_orphan_building_links'::bigint AS orphan_building_links,
    :'observed_orphan_place_links'::bigint AS orphan_place_links,
    :'observed_name_rows'::bigint AS name_rows,
    :'observed_link_rows'::bigint AS link_rows,
    :'observed_new_rows_with_legacy_json'::bigint
        AS new_rows_with_legacy_json,
    :'observed_unnamed_rows_in_search'::bigint AS unnamed_rows_in_search,
    :'observed_tile_rows'::bigint AS tile_rows;

SELECT
    (
        :'observed_total_rows'::bigint = :'expected_total_rows'::bigint
        AND :'observed_region_rows'::bigint = :'expected_region_rows'::bigint
        AND :'observed_name_rows'::bigint = :'expected_name_rows'::bigint
        AND :'observed_link_rows'::bigint = :'expected_link_rows'::bigint
        AND :'observed_identity_xor' = btrim(:'expected_identity_xor')
        AND :'observed_tile_rows'::bigint = :'observed_region_rows'::bigint
        AND :'observed_bad_identity_rows'::bigint = 0
        AND :'observed_bad_geometry_rows'::bigint = 0
        AND :'observed_duplicate_identity_groups'::bigint = 0
        AND :'observed_orphan_building_links'::bigint = 0
        AND :'observed_orphan_place_links'::bigint = 0
        AND :'observed_new_rows_with_legacy_json'::bigint = 0
        AND :'observed_unnamed_rows_in_search'::bigint = 0
    ) AS passed,
    jsonb_build_object(
        'total_rows', :'observed_total_rows'::bigint,
        'region_rows', :'observed_region_rows'::bigint,
        'identity_xor', :'observed_identity_xor',
        'bad_identity_rows', :'observed_bad_identity_rows'::bigint,
        'bad_geometry_rows', :'observed_bad_geometry_rows'::bigint,
        'duplicate_identity_groups',
            :'observed_duplicate_identity_groups'::bigint,
        'orphan_building_links', :'observed_orphan_building_links'::bigint,
        'orphan_place_links', :'observed_orphan_place_links'::bigint,
        'name_rows', :'observed_name_rows'::bigint,
        'link_rows', :'observed_link_rows'::bigint,
        'new_rows_with_legacy_json',
            :'observed_new_rows_with_legacy_json'::bigint,
        'unnamed_rows_in_search',
            :'observed_unnamed_rows_in_search'::bigint,
        'tile_rows', :'observed_tile_rows'::bigint
    )::text AS details
\gset verification_

\if :verification_passed
    \echo 'regional verification: PASS'
\else
    \echo 'regional verification: FAIL'
    \echo :verification_details
    SELECT 1 / 0;
\endif

ROLLBACK;
