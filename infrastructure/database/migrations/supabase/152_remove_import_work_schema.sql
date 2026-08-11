-- =============================================================================
-- Supabase migration 152: remove the retired import_work schema
-- =============================================================================
--
-- Preconditions enforced here:
--   - the schema and all eight expected tables still exist;
--   - every entity-row table is empty;
--   - exactly five audited batch headers remain;
--   - each header has a promoted durable publish record.
--
-- The useful batch-header history is copied into the summary of one existing
-- system.system_publish_batches row per header before the duplicate work-table
-- header is deleted. This migration does not remove or recreate either
-- system.system_import_batches or system.system_publish_batches.
--
-- Ordinary DROP dependency checks are intentional. Do not add CASCADE.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
    missing_tables text;
BEGIN
    IF to_regnamespace('import_work') IS NULL THEN
        RAISE EXCEPTION 'precondition failed: schema import_work does not exist';
    END IF;

    SELECT string_agg(expected_table, ', ' ORDER BY expected_table)
    INTO missing_tables
    FROM unnest(ARRAY[
        'import_work.import_batches',
        'import_work.place_rows',
        'import_work.building_rows',
        'import_work.landuse_rows',
        'import_work.water_line_rows',
        'import_work.water_polygon_rows',
        'import_work.routing_barrier_rows',
        'import_work.road_rows'
    ]) AS expected(expected_table)
    WHERE to_regclass(expected_table) IS NULL;

    IF missing_tables IS NOT NULL THEN
        RAISE EXCEPTION
            'precondition failed: expected import_work tables are missing: %',
            missing_tables;
    END IF;
END $$;

-- Hold a stable, fail-fast snapshot from validation through removal. Any active
-- reader/writer with a conflicting relation lock makes this statement time out.
LOCK TABLE
    import_work.place_rows,
    import_work.building_rows,
    import_work.landuse_rows,
    import_work.water_line_rows,
    import_work.water_polygon_rows,
    import_work.routing_barrier_rows,
    import_work.road_rows,
    import_work.import_batches
IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    nonempty_tables text;
    header_count bigint;
    headers_without_publish_history text;
BEGIN
    SELECT string_agg(table_name, ', ' ORDER BY table_name)
    INTO nonempty_tables
    FROM (
        SELECT 'import_work.place_rows' AS table_name
        WHERE EXISTS (SELECT 1 FROM import_work.place_rows)
        UNION ALL
        SELECT 'import_work.building_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.building_rows)
        UNION ALL
        SELECT 'import_work.landuse_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.landuse_rows)
        UNION ALL
        SELECT 'import_work.water_line_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.water_line_rows)
        UNION ALL
        SELECT 'import_work.water_polygon_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.water_polygon_rows)
        UNION ALL
        SELECT 'import_work.routing_barrier_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.routing_barrier_rows)
        UNION ALL
        SELECT 'import_work.road_rows'
        WHERE EXISTS (SELECT 1 FROM import_work.road_rows)
    ) AS populated;

    IF nonempty_tables IS NOT NULL THEN
        RAISE EXCEPTION
            'precondition failed: import_work entity-row tables are not empty: %',
            nonempty_tables;
    END IF;

    SELECT count(*)
    INTO header_count
    FROM import_work.import_batches;

    IF header_count <> 5 THEN
        RAISE EXCEPTION
            'precondition failed: expected 5 audited import_work batch headers, found %',
            header_count;
    END IF;

    SELECT string_agg(
        format('%s (id=%s)', ib.batch_code, ib.id),
        ', ' ORDER BY ib.id
    )
    INTO headers_without_publish_history
    FROM import_work.import_batches AS ib
    WHERE NOT EXISTS (
        SELECT 1
        FROM system.system_publish_batches AS pb
        WHERE pb.status = 'promoted'
          AND pb.summary ->> 'import_batch_id' = ib.id::text
          AND pb.summary ->> 'batch_code' = ib.batch_code
          AND pb.summary ->> 'entity_family' = ib.entity_family
    );

    IF headers_without_publish_history IS NOT NULL THEN
        RAISE EXCEPTION
            'precondition failed: batch headers lack promoted system publish history: %',
            headers_without_publish_history;
    END IF;
END $$;

-- These five headers contain useful validation and timing history. Archive the
-- full row in the newest matching promoted publish record instead of creating
-- another table or retaining a retired work schema.
WITH archive_targets AS (
    SELECT
        ib.id AS import_batch_id,
        to_jsonb(ib) AS legacy_header,
        (
            SELECT max(pb.id)
            FROM system.system_publish_batches AS pb
            WHERE pb.status = 'promoted'
              AND pb.summary ->> 'import_batch_id' = ib.id::text
              AND pb.summary ->> 'batch_code' = ib.batch_code
              AND pb.summary ->> 'entity_family' = ib.entity_family
        ) AS publish_batch_id
    FROM import_work.import_batches AS ib
)
UPDATE system.system_publish_batches AS pb
SET summary = jsonb_set(
    pb.summary,
    '{legacy_import_work_batch}',
    archive_targets.legacy_header,
    true
)
FROM archive_targets
WHERE pb.id = archive_targets.publish_batch_id;

DO $$
DECLARE
    archived_header_count bigint;
BEGIN
    SELECT count(*)
    INTO archived_header_count
    FROM system.system_publish_batches AS pb
    WHERE pb.summary ? 'legacy_import_work_batch'
      AND pb.summary -> 'legacy_import_work_batch' ->> 'id'
          IN (SELECT id::text FROM import_work.import_batches);

    IF archived_header_count <> 5 THEN
        RAISE EXCEPTION
            'archive failed: expected 5 archived import_work headers, found %',
            archived_header_count;
    END IF;
END $$;

-- Drop children explicitly. The batch header is deliberately last.
DROP TABLE import_work.place_rows;
DROP TABLE import_work.building_rows;
DROP TABLE import_work.landuse_rows;
DROP TABLE import_work.water_line_rows;
DROP TABLE import_work.water_polygon_rows;
DROP TABLE import_work.routing_barrier_rows;
DROP TABLE import_work.road_rows;
DROP TABLE import_work.import_batches;

DROP SCHEMA import_work;

COMMIT;
