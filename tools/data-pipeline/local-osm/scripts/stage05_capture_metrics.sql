-- Capture Stage 05 same-snapshot metrics for one pass label.
-- psql vars: snapshot_version, label

\pset pager off
\set ON_ERROR_STOP on

WITH snap AS (
    SELECT id
    FROM system.system_source_snapshots
    WHERE snapshot_version = :'snapshot_version'
)
SELECT
    :'label' AS pass_label,
    f.family,
    f.row_count,
    f.distinct_external_ids,
    f.null_external_ids,
    f.duplicate_external_id_groups,
    f.fingerprint
FROM (
    SELECT
        'admin_area'::text AS family,
        count(*)::bigint AS row_count,
        count(DISTINCT nullif(btrim(external_id), ''))::bigint AS distinct_external_ids,
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL)::bigint AS null_external_ids,
        (
            SELECT count(*)::bigint
            FROM (
                SELECT external_id
                FROM staging.staging_admin_area_candidates
                WHERE source_snapshot_id = (SELECT id FROM snap)
                  AND nullif(btrim(external_id), '') IS NOT NULL
                GROUP BY external_id
                HAVING count(*) > 1
            ) d
        ) AS duplicate_external_id_groups,
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), '')) AS fingerprint
    FROM staging.staging_admin_area_candidates
    WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'road', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_road_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_road_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'place', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_place_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_place_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'building', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_building_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_building_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'landuse', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_landuse_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_landuse_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'water_line', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_water_line_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_water_line_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'water_polygon', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_water_polygon_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_water_polygon_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT 'routing_barrier', count(*), count(DISTINCT nullif(btrim(external_id), '')),
        count(*) FILTER (WHERE nullif(btrim(external_id), '') IS NULL),
        (SELECT count(*)::bigint FROM (
            SELECT external_id FROM staging.staging_routing_barrier_candidates
            WHERE source_snapshot_id = (SELECT id FROM snap)
              AND nullif(btrim(external_id), '') IS NOT NULL
            GROUP BY external_id HAVING count(*) > 1
        ) d),
        md5(coalesce(string_agg(
            coalesce(nullif(btrim(external_id), ''), '<null>') || '=' || coalesce(normalized_hash, ''),
            E'\n' ORDER BY coalesce(nullif(btrim(external_id), ''), '<null>')
        ), ''))
    FROM staging.staging_routing_barrier_candidates WHERE source_snapshot_id = (SELECT id FROM snap)

    UNION ALL
    SELECT
        'other_snapshot_guard',
        (
            (SELECT count(*) FROM staging.staging_road_candidates WHERE source_snapshot_id <> (SELECT id FROM snap))
            + (SELECT count(*) FROM staging.staging_place_candidates WHERE source_snapshot_id <> (SELECT id FROM snap))
            + (SELECT count(*) FROM staging.staging_admin_area_candidates WHERE source_snapshot_id <> (SELECT id FROM snap))
            + (SELECT count(*) FROM staging.staging_building_candidates WHERE source_snapshot_id <> (SELECT id FROM snap))
        )::bigint,
        0::bigint, 0::bigint, 0::bigint, NULL::text
) AS f
ORDER BY f.family;
