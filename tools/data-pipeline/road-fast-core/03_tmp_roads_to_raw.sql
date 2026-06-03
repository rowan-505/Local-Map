-- =============================================================================
-- Stage 03: tmp_roads_to_raw
-- Copy tmp_road_import.osm_road_lines -> raw.raw_osm_lines for one snapshot.
-- Does not touch raw_osm_points or raw_osm_polygons.
--
-- psql variables:
--   snapshot_version
--   tmp_road_import_schema (default tmp_road_import)
--   raw_schema (default raw)
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?tmp_road_import_schema}
\else
\set tmp_road_import_schema 'tmp_road_import'
\endif
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif

BEGIN;

CREATE TEMP TABLE stage03_params (
    snapshot_version text NOT NULL,
    tmp_schema text NOT NULL,
    raw_schema text NOT NULL
);

INSERT INTO stage03_params (snapshot_version, tmp_schema, raw_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'tmp_road_import_schema'), ''), 'tmp_road_import'),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw')
);

CREATE TEMP TABLE stage03_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    tmp_schema text NOT NULL,
    raw_schema text NOT NULL
);

CREATE TEMP TABLE stage03_result (
    tmp_row_count bigint NOT NULL,
    inserted_count bigint NOT NULL,
    raw_row_count bigint NOT NULL
);

DO $stage03$
DECLARE
    p stage03_params%ROWTYPE;
    ctx stage03_context%ROWTYPE;
    q text;
    v_tmp bigint;
    v_inserted bigint;
    v_raw bigint;
BEGIN
    SELECT * INTO p FROM stage03_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.osm_road_lines', p.tmp_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.osm_road_lines', p.tmp_schema;
    END IF;

    IF to_regclass(format('%I.raw_osm_lines', p.raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.raw_osm_lines', p.raw_schema;
    END IF;

    INSERT INTO stage03_context (source_snapshot_id, snapshot_version, tmp_schema, raw_schema)
    SELECT s.id, s.snapshot_version, p.tmp_schema, p.raw_schema
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', p.snapshot_version;
    END IF;

    SELECT * INTO ctx FROM stage03_context;

    q := format('select count(*)::bigint from %I.osm_road_lines', ctx.tmp_schema);
    EXECUTE q INTO v_tmp;

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
                'way'::text,
                btrim(tmp.osm_id::text),
                ST_Multi(ST_Force2D(tmp.geom))::geometry(MultiLineString, 4326),
                coalesce(tmp.tags, '{}'::jsonb),
                jsonb_build_object(
                    'osm_id', tmp.osm_id,
                    'osm_feature_type', 'way',
                    'tags', coalesce(tmp.tags, '{}'::jsonb),
                    'source', 'osm_roads_fast'
                )
            FROM %I.osm_road_lines AS tmp
            CROSS JOIN stage03_context AS ctx
            WHERE tmp.geom IS NOT NULL
              AND tmp.osm_id IS NOT NULL
              AND btrim(tmp.osm_id::text) <> ''
            ON CONFLICT ON CONSTRAINT raw_osm_lines_source_snapshot_id_osm_feature_type_osm_id_key
            DO NOTHING
            RETURNING 1
        )
        SELECT count(*)::bigint FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.tmp_schema
    );
    EXECUTE q INTO v_inserted;

    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_lines AS raw
        WHERE raw.source_snapshot_id = $1
        $q$,
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw USING ctx.source_snapshot_id;

    INSERT INTO stage03_result (tmp_row_count, inserted_count, raw_row_count)
    VALUES (v_tmp, v_inserted, v_raw);

    IF v_tmp > 0 AND v_raw = 0 THEN
        RAISE EXCEPTION
            'Stage 03: tmp has % rows but raw.raw_osm_lines has 0 for snapshot %',
            v_tmp,
            ctx.snapshot_version;
    END IF;
END
$stage03$;

SELECT
    ctx.source_snapshot_id,
    ctx.snapshot_version,
    r.tmp_row_count,
    r.inserted_count,
    r.raw_row_count
FROM stage03_context AS ctx
CROSS JOIN stage03_result AS r;

COMMIT;
