-- =============================================================================
-- Stage 04: raw_roads_to_staging
-- raw.raw_osm_lines (current snapshot) -> staging.staging_road_candidates
-- No prod mirror, no diff items.
--
-- psql variables: snapshot_version, raw_schema, staging_schema
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?raw_schema}
\else
\set raw_schema 'raw'
\endif
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE stage04_params (
    snapshot_version text NOT NULL,
    raw_schema text NOT NULL,
    staging_schema text NOT NULL
);

INSERT INTO stage04_params (snapshot_version, raw_schema, staging_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'raw_schema'), ''), 'raw'),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE stage04_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    raw_schema text NOT NULL,
    staging_schema text NOT NULL
);

CREATE TEMP TABLE stage04_result (
    raw_row_count bigint NOT NULL,
    inserted_count bigint NOT NULL,
    updated_count bigint NOT NULL,
    staging_row_count bigint NOT NULL
);

DO $stage04$
DECLARE
    p stage04_params%ROWTYPE;
    ctx stage04_context%ROWTYPE;
    q text;
    v_raw bigint;
    v_inserted bigint;
    v_updated bigint;
    v_staging bigint;
BEGIN
    SELECT * INTO p FROM stage04_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.staging_road_candidates', p.staging_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.staging_road_candidates', p.staging_schema;
    END IF;

    INSERT INTO stage04_context (source_snapshot_id, snapshot_version, raw_schema, staging_schema)
    SELECT s.id, s.snapshot_version, p.raw_schema, p.staging_schema
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found', p.snapshot_version;
    END IF;

    SELECT * INTO ctx FROM stage04_context;

    q := format(
        'select count(*)::bigint from %I.raw_osm_lines where source_snapshot_id = $1',
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw USING ctx.source_snapshot_id;

    q := format(
        $q$
        WITH raw_rows AS (
            SELECT
                raw.id AS raw_id,
                raw.osm_id,
                raw.geom,
                coalesce(raw.tags, '{}'::jsonb) AS tags,
                ('osm:W:' || btrim(raw.osm_id::text)) AS external_id,
                nullif(btrim(raw.tags->>'name:my'), '') AS name_my,
                nullif(btrim(raw.tags->>'name'), '') AS name_default,
                nullif(btrim(raw.tags->>'name:en'), '') AS name_en,
                lower(btrim(raw.tags->>'highway')) AS highway_raw,
                CASE lower(btrim(raw.tags->>'highway'))
                    WHEN 'motorway' THEN 'motorway'
                    WHEN 'trunk' THEN 'trunk'
                    WHEN 'primary' THEN 'primary'
                    WHEN 'secondary' THEN 'secondary'
                    WHEN 'tertiary' THEN 'tertiary'
                    WHEN 'residential' THEN 'residential'
                    WHEN 'service' THEN 'service'
                    WHEN 'track' THEN 'track'
                    WHEN 'path' THEN 'path'
                    WHEN 'footway' THEN 'path'
                    WHEN 'steps' THEN 'path'
                    WHEN 'pedestrian' THEN 'path'
                    WHEN 'unclassified' THEN 'unclassified'
                    WHEN 'road' THEN 'unclassified'
                    WHEN 'construction' THEN 'unclassified'
                    WHEN 'proposed' THEN 'unclassified'
                    ELSE 'unclassified'
                END AS road_class_code,
                CASE
                    WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('yes', 'true', '1') THEN true
                    WHEN lower(coalesce(raw.tags->>'oneway', '')) IN ('no', 'false', '0') THEN false
                    WHEN raw.tags->>'junction' = 'roundabout' THEN true
                    ELSE false
                END AS is_oneway,
                CASE
                    WHEN lower(btrim(raw.tags->>'highway')) IN ('construction', 'proposed') THEN 60::numeric
                    WHEN lower(btrim(raw.tags->>'highway')) IN (
                        'motorway', 'trunk', 'primary', 'secondary', 'tertiary'
                    ) THEN 80::numeric
                    ELSE 70::numeric
                END AS confidence_score
            FROM %I.raw_osm_lines AS raw
            WHERE raw.source_snapshot_id = $1
              AND raw.geom IS NOT NULL
              AND raw.osm_id IS NOT NULL
              AND btrim(raw.osm_id::text) <> ''
        ),
        src AS (
            SELECT
                r.*,
                coalesce(r.name_my, r.name_default, r.name_en, r.external_id) AS canonical_name,
                rc.id AS road_class_id,
                jsonb_strip_nulls(jsonb_build_object(
                    'highway', r.tags->>'highway',
                    'surface', r.tags->>'surface',
                    'maxspeed', r.tags->>'maxspeed',
                    'oneway', r.tags->>'oneway',
                    'bridge', r.tags->>'bridge',
                    'tunnel', r.tags->>'tunnel',
                    'layer', r.tags->>'layer',
                    'access', r.tags->>'access',
                    'lanes', r.tags->>'lanes',
                    'width', r.tags->>'width',
                    'service', r.tags->>'service',
                    'tracktype', r.tags->>'tracktype',
                    'smoothness', r.tags->>'smoothness'
                )) AS normalized_data,
                jsonb_build_object(
                    'source', 'osm',
                    'external_id', r.external_id,
                    'osm_id', r.osm_id,
                    'snapshot_version', $2
                ) AS source_refs
            FROM raw_rows AS r
            LEFT JOIN ref.ref_road_classes AS rc
                ON rc.code = r.road_class_code
        ),
        updated AS (
            UPDATE %I.staging_road_candidates AS t
            SET
                raw_id = s.raw_id,
                canonical_name = s.canonical_name,
                road_class_id = s.road_class_id,
                class_code = s.road_class_code,
                geom = s.geom,
                is_oneway = s.is_oneway,
                length_m = ST_Length(s.geom::geography),
                confidence_score = s.confidence_score,
                match_status = 'new_auto',
                review_status = 'pending',
                normalized_data = s.normalized_data,
                source_refs = s.source_refs,
                updated_at = now()
            FROM src AS s
            WHERE t.source_snapshot_id = $1
              AND t.external_id = s.external_id
            RETURNING 1
        ),
        inserted AS (
            INSERT INTO %I.staging_road_candidates (
                source_snapshot_id,
                raw_id,
                external_id,
                canonical_name,
                road_class_id,
                class_code,
                geom,
                is_oneway,
                length_m,
                confidence_score,
                match_status,
                review_status,
                normalized_data,
                source_refs
            )
            SELECT
                $1,
                s.raw_id,
                s.external_id,
                s.canonical_name,
                s.road_class_id,
                s.road_class_code,
                s.geom,
                s.is_oneway,
                ST_Length(s.geom::geography),
                s.confidence_score,
                'new_auto',
                'pending',
                s.normalized_data,
                s.source_refs
            FROM src AS s
            WHERE NOT EXISTS (
                SELECT 1
                FROM %I.staging_road_candidates AS existing
                WHERE existing.source_snapshot_id = $1
                  AND existing.external_id = s.external_id
            )
            RETURNING 1
        )
        SELECT
            (SELECT count(*)::bigint FROM updated),
            (SELECT count(*)::bigint FROM inserted)
        $q$,
        ctx.raw_schema,
        ctx.staging_schema,
        ctx.staging_schema,
        ctx.staging_schema
    );

    EXECUTE q INTO v_updated, v_inserted
    USING ctx.source_snapshot_id, ctx.snapshot_version;

    q := format(
        'select count(*)::bigint from %I.staging_road_candidates where source_snapshot_id = $1',
        ctx.staging_schema
    );
    EXECUTE q INTO v_staging USING ctx.source_snapshot_id;

    INSERT INTO stage04_result (raw_row_count, inserted_count, updated_count, staging_row_count)
    VALUES (v_raw, v_inserted, v_updated, v_staging);

    IF v_raw > 0 AND v_staging = 0 THEN
        RAISE EXCEPTION 'Stage 04: raw rows exist but no staging candidates for %', ctx.snapshot_version;
    END IF;
END
$stage04$;

SELECT
    ctx.source_snapshot_id,
    ctx.snapshot_version,
    r.raw_row_count,
    r.inserted_count,
    r.updated_count,
    r.staging_row_count,
    (r.inserted_count + r.updated_count) AS upserted_count
FROM stage04_context AS ctx
CROSS JOIN stage04_result AS r;

COMMIT;
