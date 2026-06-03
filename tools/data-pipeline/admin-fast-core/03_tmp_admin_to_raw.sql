-- =============================================================================
-- Stage 03: tmp_admin_to_raw
-- Copy tmp_admin_import.osm_admin_polygons -> raw.raw_osm_polygons for one snapshot.
-- Replaces only prior admin-fast-core polygon rows for this snapshot (not points/lines).
--
-- psql variables: snapshot_version, tmp_admin_schema, raw_schema
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?tmp_admin_schema}
\else
\set tmp_admin_schema 'tmp_admin_import'
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
    coalesce(nullif(trim(:'tmp_admin_schema'), ''), 'tmp_admin_import'),
    coalesce(nullif(trim(:'raw_schema'), ''), 'raw')
);

CREATE TEMP TABLE stage03_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    tmp_schema text NOT NULL,
    raw_schema text NOT NULL
);

CREATE TEMP TABLE stage03_result (
    deleted_count bigint NOT NULL,
    tmp_row_count bigint NOT NULL,
    inserted_count bigint NOT NULL
);

DO $stage03$
DECLARE
    p stage03_params%ROWTYPE;
    ctx stage03_context%ROWTYPE;
    q text;
    v_deleted bigint := 0;
    v_tmp bigint := 0;
    v_inserted bigint := 0;
BEGIN
    SELECT * INTO p FROM stage03_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.osm_admin_polygons', p.tmp_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.osm_admin_polygons', p.tmp_schema;
    END IF;

    IF to_regclass(format('%I.raw_osm_polygons', p.raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.raw_osm_polygons', p.raw_schema;
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

    q := format(
        $q$
        DELETE FROM %I.raw_osm_polygons AS raw
        WHERE raw.source_snapshot_id = $1
          AND coalesce(raw.raw_payload->>'pipeline', '') = 'admin-fast-core'
        $q$,
        ctx.raw_schema
    );
    EXECUTE q USING ctx.source_snapshot_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    q := format('select count(*)::bigint from %I.osm_admin_polygons', ctx.tmp_schema);
    EXECUTE q INTO v_tmp;

    q := format(
        $q$
        WITH inserted AS (
            INSERT INTO %I.raw_osm_polygons (
                source_snapshot_id,
                osm_feature_type,
                osm_id,
                geom,
                tags,
                raw_payload,
                ingested_at
            )
            SELECT
                ctx.source_snapshot_id,
                btrim(tmp.osm_feature_type::text),
                btrim(tmp.osm_id::text),
                ST_Multi(ST_Force2D(tmp.geom))::geometry(MultiPolygon, 4326),
                coalesce(tmp.tags, '{}'::jsonb),
                jsonb_build_object(
                    'pipeline', 'admin-fast-core',
                    'entity_family', 'admin_areas',
                    'osm_id', tmp.osm_id,
                    'osm_feature_type', tmp.osm_feature_type,
                    'tags', coalesce(tmp.tags, '{}'::jsonb),
                    'snapshot_version', ctx.snapshot_version
                ),
                now()
            FROM %I.osm_admin_polygons AS tmp
            CROSS JOIN stage03_context AS ctx
            WHERE tmp.geom IS NOT NULL
              AND tmp.osm_id IS NOT NULL
              AND btrim(tmp.osm_id::text) <> ''
              AND tmp.osm_feature_type IS NOT NULL
              AND btrim(tmp.osm_feature_type::text) <> ''
            RETURNING 1
        )
        SELECT count(*)::bigint FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.tmp_schema
    );
    EXECUTE q INTO v_inserted;

    INSERT INTO stage03_result (deleted_count, tmp_row_count, inserted_count)
    VALUES (v_deleted, v_tmp, v_inserted);

    IF v_tmp > 0 AND v_inserted = 0 THEN
        RAISE EXCEPTION
            'Stage 03: tmp has % rows but inserted 0 raw_osm_polygons for snapshot %',
            v_tmp,
            ctx.snapshot_version;
    END IF;
END
$stage03$;

SELECT
    ctx.source_snapshot_id,
    ctx.snapshot_version,
    r.deleted_count,
    r.tmp_row_count,
    r.inserted_count
FROM stage03_context AS ctx
CROSS JOIN stage03_result AS r;

COMMIT;
