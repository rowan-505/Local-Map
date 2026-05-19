-- =============================================================================
-- Stage 04: tmp_to_raw
-- Copy boundary-filtered tmp_import rows into raw.raw_osm_* for current snapshot.
--
-- Input psql variables:
--   snapshot_version
--   tmp_import_schema (optional; default tmp_import)
--   raw_schema        (optional; default raw)
--
-- Scope:
--   - Writes only raw.raw_osm_points / raw.raw_osm_lines / raw.raw_osm_polygons.
--   - Updates only the matching system.system_import_batches row after inserts succeed.
--   - Does not touch staging, core, or Supabase.
--   - Does not delete/truncate existing raw rows.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?tmp_import_schema}
\else
\set tmp_import_schema 'tmp_import'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS stage04_params (
    snapshot_version text NOT NULL,
    tmp_import_schema text NOT NULL,
    raw_schema text NOT NULL
);

TRUNCATE stage04_params;

INSERT INTO stage04_params (
    snapshot_version,
    tmp_import_schema,
    raw_schema
)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'tmp_import_schema'), ''), 'tmp_import'),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw')
);

CREATE TEMP TABLE IF NOT EXISTS stage04_context (
    source_snapshot_id bigint NOT NULL,
    import_batch_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text,
    boundary_id bigint,
    boundary_code text,
    boundary_geom geometry(MultiPolygon, 4326),
    tmp_import_schema text NOT NULL,
    raw_schema text NOT NULL
);

TRUNCATE stage04_context;

CREATE TEMP TABLE IF NOT EXISTS stage04_counts (
    section text NOT NULL,
    metric text NOT NULL,
    table_name text,
    value_n bigint,
    status text NOT NULL,
    note text
);

TRUNCATE stage04_counts;

DO $stage04_validate$
DECLARE
    v_snapshot_version text;
    v_tmp_schema text;
    v_raw_schema text;
BEGIN
    SELECT p.snapshot_version, p.tmp_import_schema, p.raw_schema
    INTO v_snapshot_version, v_tmp_schema, v_raw_schema
    FROM stage04_params AS p;

    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.osm_points', v_tmp_schema)) IS NULL THEN
        RAISE EXCEPTION 'required tmp table %.osm_points does not exist', v_tmp_schema;
    END IF;
    IF to_regclass(format('%I.osm_lines', v_tmp_schema)) IS NULL THEN
        RAISE EXCEPTION 'required tmp table %.osm_lines does not exist', v_tmp_schema;
    END IF;
    IF to_regclass(format('%I.osm_polygons', v_tmp_schema)) IS NULL THEN
        RAISE EXCEPTION 'required tmp table %.osm_polygons does not exist', v_tmp_schema;
    END IF;

    IF to_regclass(format('%I.raw_osm_points', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_points does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_lines', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_lines does not exist', v_raw_schema;
    END IF;
    IF to_regclass(format('%I.raw_osm_polygons', v_raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'required raw table %.raw_osm_polygons does not exist', v_raw_schema;
    END IF;

    INSERT INTO stage04_context (
        source_snapshot_id,
        import_batch_id,
        snapshot_version,
        region_code,
        boundary_id,
        boundary_code,
        boundary_geom,
        tmp_import_schema,
        raw_schema
    )
    SELECT
        snapshot.id AS source_snapshot_id,
        snapshot.import_batch_id,
        snapshot.snapshot_version,
        snapshot.region_code,
        snapshot.boundary_id,
        boundary.boundary_code,
        boundary.geom,
        v_tmp_schema,
        v_raw_schema
    FROM system.system_source_snapshots AS snapshot
    LEFT JOIN system.system_import_boundaries AS boundary
        ON boundary.id = snapshot.boundary_id
    WHERE snapshot.snapshot_version = v_snapshot_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', v_snapshot_version;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM system.system_source_snapshots AS snapshot
        WHERE snapshot.snapshot_version = v_snapshot_version
          AND snapshot.boundary_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Current snapshot has no boundary_id. Register boundary before tmp_to_raw.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM stage04_context) THEN
        RAISE EXCEPTION 'boundary row for snapshot_version "%" was not found', v_snapshot_version;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM stage04_context AS ctx
        WHERE ctx.boundary_geom IS NULL
    ) THEN
        RAISE EXCEPTION 'boundary geometry for snapshot_version "%" is NULL', v_snapshot_version;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM stage04_context AS ctx
        WHERE ST_SRID(ctx.boundary_geom) <> 4326
    ) THEN
        RAISE EXCEPTION 'boundary geometry for snapshot_version "%" must use SRID 4326', v_snapshot_version;
    END IF;
END
$stage04_validate$;

SELECT
    'stage04_header' AS section,
    'tmp_to_raw boundary-filtered archive' AS message,
    now() AS started_at;

SELECT
    'stage04_snapshot' AS section,
    source_snapshot_id,
    snapshot_version,
    region_code,
    boundary_id,
    boundary_code,
    import_batch_id
FROM stage04_context;

SELECT
    'stage04_column_types' AS section,
    cols.table_schema,
    cols.table_name,
    cols.column_name,
    cols.data_type,
    cols.udt_name
FROM information_schema.columns AS cols
JOIN stage04_context AS ctx
    ON cols.table_schema IN (ctx.tmp_import_schema, ctx.raw_schema)
WHERE (
        cols.table_schema = ctx.tmp_import_schema
        AND cols.table_name IN ('osm_points', 'osm_lines', 'osm_polygons')
        AND cols.column_name IN ('osm_id', 'osm_feature_type')
    )
    OR (
        cols.table_schema = ctx.raw_schema
        AND cols.table_name IN ('raw_osm_points', 'raw_osm_lines', 'raw_osm_polygons')
        AND cols.column_name = 'osm_id'
    )
ORDER BY cols.table_schema, cols.table_name, cols.column_name;

DO $stage04_counts_before$
DECLARE
    ctx stage04_context%ROWTYPE;
    q text;
    v_points_total bigint;
    v_lines_total bigint;
    v_polygons_total bigint;
    v_points_null bigint;
    v_lines_null bigint;
    v_polygons_null bigint;
    v_points_inside bigint;
    v_lines_inside bigint;
    v_polygons_inside bigint;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage04_context;

    q := format('select count(*)::bigint from %I.osm_points', ctx.tmp_import_schema);
    EXECUTE q INTO v_points_total;

    q := format('select count(*)::bigint from %I.osm_lines', ctx.tmp_import_schema);
    EXECUTE q INTO v_lines_total;

    q := format('select count(*)::bigint from %I.osm_polygons', ctx.tmp_import_schema);
    EXECUTE q INTO v_polygons_total;

    q := format('select count(*)::bigint from %I.osm_points where geom is null', ctx.tmp_import_schema);
    EXECUTE q INTO v_points_null;

    q := format('select count(*)::bigint from %I.osm_lines where geom is null', ctx.tmp_import_schema);
    EXECUTE q INTO v_lines_null;

    q := format('select count(*)::bigint from %I.osm_polygons where geom is null', ctx.tmp_import_schema);
    EXECUTE q INTO v_polygons_null;

    q := format(
        'select count(*)::bigint
         from %I.osm_points AS tmp
         join stage04_context AS ctx ON true
         where tmp.geom is not null
           and tmp.geom && ctx.boundary_geom
           and ST_Intersects(tmp.geom, ctx.boundary_geom)',
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_points_inside;

    q := format(
        'select count(*)::bigint
         from %I.osm_lines AS tmp
         join stage04_context AS ctx ON true
         where tmp.geom is not null
           and tmp.geom && ctx.boundary_geom
           and ST_Intersects(tmp.geom, ctx.boundary_geom)',
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_lines_inside;

    q := format(
        'select count(*)::bigint
         from %I.osm_polygons AS tmp
         join stage04_context AS ctx ON true
         where tmp.geom is not null
           and tmp.geom && ctx.boundary_geom
           and ST_Intersects(tmp.geom, ctx.boundary_geom)',
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_polygons_inside;

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES
        ('tmp_total', 'tmp_import.osm_points total', 'osm_points', v_points_total, 'PASS', NULL),
        ('tmp_total', 'tmp_import.osm_lines total', 'osm_lines', v_lines_total, 'PASS', NULL),
        ('tmp_total', 'tmp_import.osm_polygons total', 'osm_polygons', v_polygons_total, 'PASS', NULL),
        ('tmp_null_geom', 'tmp points null geom', 'osm_points', v_points_null, CASE WHEN v_points_null = 0 THEN 'PASS' ELSE 'WARN' END, 'NULL geometry rows are skipped by Stage D'),
        ('tmp_null_geom', 'tmp lines null geom', 'osm_lines', v_lines_null, CASE WHEN v_lines_null = 0 THEN 'PASS' ELSE 'WARN' END, 'NULL geometry rows are skipped by Stage D'),
        ('tmp_null_geom', 'tmp polygons null geom', 'osm_polygons', v_polygons_null, CASE WHEN v_polygons_null = 0 THEN 'PASS' ELSE 'WARN' END, 'NULL geometry rows are skipped by Stage D'),
        ('boundary_filtered', 'points inside boundary', 'osm_points', v_points_inside, CASE WHEN v_points_inside = 0 THEN 'WARN' ELSE 'PASS' END, NULL),
        ('boundary_filtered', 'lines inside boundary', 'osm_lines', v_lines_inside, CASE WHEN v_lines_inside = 0 THEN 'WARN' ELSE 'PASS' END, NULL),
        ('boundary_filtered', 'polygons inside boundary', 'osm_polygons', v_polygons_inside, CASE WHEN v_polygons_inside = 0 THEN 'WARN' ELSE 'PASS' END, NULL);

    IF (v_points_inside + v_lines_inside + v_polygons_inside) = 0 THEN
        RAISE WARNING 'Stage D: boundary-filtered counts are all zero. Check BOUNDARY_GEOJSON_PATH, boundary_id, and PBF region.';
    END IF;
END
$stage04_counts_before$;

SELECT
    section,
    metric,
    table_name,
    value_n,
    status,
    note
FROM stage04_counts
WHERE section IN ('tmp_total', 'tmp_null_geom', 'boundary_filtered')
ORDER BY
    CASE section
        WHEN 'tmp_total' THEN 1
        WHEN 'tmp_null_geom' THEN 2
        WHEN 'boundary_filtered' THEN 3
        ELSE 99
    END,
    table_name;

DO $stage04_insert$
DECLARE
    ctx stage04_context%ROWTYPE;
    q text;
    v_inserted bigint;
    v_raw_total bigint;
    v_filtered bigint;
BEGIN
    SELECT *
    INTO STRICT ctx
    FROM stage04_context;

    -- osm_id can be bigint in osm2pgsql output; do not btrim bigint values.
    q := format(
        $q$
        WITH inserted AS (
            INSERT INTO %I.raw_osm_points (
                source_snapshot_id,
                osm_feature_type,
                osm_id,
                geom,
                tags,
                raw_payload
            )
            SELECT
                ctx.source_snapshot_id,
                tmp.osm_feature_type::text,
                tmp.osm_id::text,
                tmp.geom,
                coalesce(tmp.tags, '{}'::jsonb),
                jsonb_build_object(
                    'source_table', 'tmp_import.osm_points',
                    'osm_id', tmp.osm_id,
                    'osm_feature_type', tmp.osm_feature_type,
                    'tags', coalesce(tmp.tags, '{}'::jsonb),
                    'snapshot_version', ctx.snapshot_version,
                    'source_snapshot_id', ctx.source_snapshot_id,
                    'region_code', ctx.region_code,
                    'boundary_id', ctx.boundary_id
                )
            FROM %I.osm_points AS tmp
            JOIN stage04_context AS ctx ON true
            WHERE tmp.geom IS NOT NULL
              AND tmp.osm_id IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_id)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_id::text) <> ''
                    ELSE true
                  END
              AND tmp.osm_feature_type IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_feature_type)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_feature_type::text) <> ''
                    ELSE true
                  END
              AND tmp.geom && ctx.boundary_geom
              AND ST_Intersects(tmp.geom, ctx.boundary_geom)
            ON CONFLICT ON CONSTRAINT raw_osm_points_source_snapshot_id_osm_feature_type_osm_id_key
            DO NOTHING
            RETURNING 1
        )
        SELECT count(*)::bigint FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_inserted;

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES ('inserted', 'inserted rows', 'raw_osm_points', v_inserted, 'PASS', NULL);

    q := format(
        $q$
        WITH inserted AS (
            INSERT INTO %I.raw_osm_lines (
                source_snapshot_id,
                osm_feature_type,
                osm_id,
                geom,
                tags,
                raw_payload
            )
            SELECT
                ctx.source_snapshot_id,
                tmp.osm_feature_type::text,
                tmp.osm_id::text,
                tmp.geom,
                coalesce(tmp.tags, '{}'::jsonb),
                jsonb_build_object(
                    'source_table', 'tmp_import.osm_lines',
                    'osm_id', tmp.osm_id,
                    'osm_feature_type', tmp.osm_feature_type,
                    'tags', coalesce(tmp.tags, '{}'::jsonb),
                    'snapshot_version', ctx.snapshot_version,
                    'source_snapshot_id', ctx.source_snapshot_id,
                    'region_code', ctx.region_code,
                    'boundary_id', ctx.boundary_id
                )
            FROM %I.osm_lines AS tmp
            JOIN stage04_context AS ctx ON true
            WHERE tmp.geom IS NOT NULL
              AND tmp.osm_id IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_id)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_id::text) <> ''
                    ELSE true
                  END
              AND tmp.osm_feature_type IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_feature_type)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_feature_type::text) <> ''
                    ELSE true
                  END
              AND tmp.geom && ctx.boundary_geom
              AND ST_Intersects(tmp.geom, ctx.boundary_geom)
            ON CONFLICT ON CONSTRAINT raw_osm_lines_source_snapshot_id_osm_feature_type_osm_id_key
            DO NOTHING
            RETURNING 1
        )
        SELECT count(*)::bigint FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_inserted;

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES ('inserted', 'inserted rows', 'raw_osm_lines', v_inserted, 'PASS', NULL);

    q := format(
        $q$
        WITH inserted AS (
            INSERT INTO %I.raw_osm_polygons (
                source_snapshot_id,
                osm_feature_type,
                osm_id,
                geom,
                tags,
                raw_payload
            )
            SELECT
                ctx.source_snapshot_id,
                tmp.osm_feature_type::text,
                tmp.osm_id::text,
                tmp.geom,
                coalesce(tmp.tags, '{}'::jsonb),
                jsonb_build_object(
                    'source_table', 'tmp_import.osm_polygons',
                    'osm_id', tmp.osm_id,
                    'osm_feature_type', tmp.osm_feature_type,
                    'tags', coalesce(tmp.tags, '{}'::jsonb),
                    'snapshot_version', ctx.snapshot_version,
                    'source_snapshot_id', ctx.source_snapshot_id,
                    'region_code', ctx.region_code,
                    'boundary_id', ctx.boundary_id
                )
            FROM %I.osm_polygons AS tmp
            JOIN stage04_context AS ctx ON true
            WHERE tmp.geom IS NOT NULL
              AND tmp.osm_id IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_id)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_id::text) <> ''
                    ELSE true
                  END
              AND tmp.osm_feature_type IS NOT NULL
              AND CASE
                    WHEN pg_typeof(tmp.osm_feature_type)::text IN ('text', 'character varying', 'character', 'citext')
                        THEN btrim(tmp.osm_feature_type::text) <> ''
                    ELSE true
                  END
              AND tmp.geom && ctx.boundary_geom
              AND ST_Intersects(tmp.geom, ctx.boundary_geom)
            ON CONFLICT ON CONSTRAINT raw_osm_polygons_source_snapshot_id_osm_feature_type_osm_id_key
            DO NOTHING
            RETURNING 1
        )
        SELECT count(*)::bigint FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.tmp_import_schema
    );
    EXECUTE q INTO v_inserted;

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES ('inserted', 'inserted rows', 'raw_osm_polygons', v_inserted, 'PASS', NULL);

    q := format(
        'select count(*)::bigint from %I.raw_osm_points where source_snapshot_id = $1',
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw_total USING ctx.source_snapshot_id;

    SELECT value_n
    INTO v_filtered
    FROM stage04_counts
    WHERE section = 'boundary_filtered'
      AND table_name = 'osm_points';

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES (
        'raw_total_after',
        'raw rows for current snapshot after insert',
        'raw_osm_points',
        v_raw_total,
        CASE WHEN v_raw_total > v_filtered THEN 'WARN' ELSE 'PASS' END,
        CASE WHEN v_raw_total > v_filtered THEN format('raw_total (%s) exceeds boundary_filtered (%s)', v_raw_total, v_filtered) ELSE NULL END
    );

    q := format(
        'select count(*)::bigint from %I.raw_osm_lines where source_snapshot_id = $1',
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw_total USING ctx.source_snapshot_id;

    SELECT value_n
    INTO v_filtered
    FROM stage04_counts
    WHERE section = 'boundary_filtered'
      AND table_name = 'osm_lines';

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES (
        'raw_total_after',
        'raw rows for current snapshot after insert',
        'raw_osm_lines',
        v_raw_total,
        CASE WHEN v_raw_total > v_filtered THEN 'WARN' ELSE 'PASS' END,
        CASE WHEN v_raw_total > v_filtered THEN format('raw_total (%s) exceeds boundary_filtered (%s)', v_raw_total, v_filtered) ELSE NULL END
    );

    q := format(
        'select count(*)::bigint from %I.raw_osm_polygons where source_snapshot_id = $1',
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw_total USING ctx.source_snapshot_id;

    SELECT value_n
    INTO v_filtered
    FROM stage04_counts
    WHERE section = 'boundary_filtered'
      AND table_name = 'osm_polygons';

    INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
    VALUES (
        'raw_total_after',
        'raw rows for current snapshot after insert',
        'raw_osm_polygons',
        v_raw_total,
        CASE WHEN v_raw_total > v_filtered THEN 'WARN' ELSE 'PASS' END,
        CASE WHEN v_raw_total > v_filtered THEN format('raw_total (%s) exceeds boundary_filtered (%s)', v_raw_total, v_filtered) ELSE NULL END
    );
END
$stage04_insert$;

SELECT
    section,
    metric,
    table_name,
    value_n,
    status,
    note
FROM stage04_counts
WHERE section IN ('inserted', 'raw_total_after')
ORDER BY
    CASE section
        WHEN 'inserted' THEN 1
        WHEN 'raw_total_after' THEN 2
        ELSE 99
    END,
    table_name;

UPDATE system.system_import_batches AS batch
SET
    status = 'completed',
    finished_at = now(),
    note = concat_ws(
        E'\n',
        batch.note,
        format('Stage 04 tmp_to_raw completed for snapshot_version=%s at %s', ctx.snapshot_version, now())
    )
FROM stage04_context AS ctx
WHERE batch.id = ctx.import_batch_id;

WITH totals AS (
    SELECT
        coalesce(sum(value_n) FILTER (WHERE section = 'boundary_filtered'), 0) AS boundary_filtered_total,
        coalesce(sum(value_n) FILTER (WHERE section = 'inserted'), 0) AS inserted_total,
        coalesce(sum(value_n) FILTER (WHERE section = 'raw_total_after'), 0) AS raw_total_after,
        bool_or(status = 'WARN') AS has_warn
    FROM stage04_counts
)
INSERT INTO stage04_counts (section, metric, table_name, value_n, status, note)
SELECT
    'summary',
    'FINAL_SUMMARY',
    NULL,
    raw_total_after,
    CASE
        WHEN boundary_filtered_total = 0 THEN 'WARN'
        WHEN has_warn THEN 'WARN'
        ELSE 'PASS'
    END,
    format(
        'boundary_filtered_total=%s inserted_total=%s raw_total_after=%s',
        boundary_filtered_total,
        inserted_total,
        raw_total_after
    )
FROM totals;

SELECT
    section,
    metric,
    table_name,
    value_n,
    status,
    note
FROM stage04_counts
WHERE section = 'summary';

SELECT
    'stage04_import_batch' AS section,
    batch.id AS import_batch_id,
    batch.status,
    batch.finished_at
FROM system.system_import_batches AS batch
JOIN stage04_context AS ctx
    ON ctx.import_batch_id = batch.id;

COMMIT;
