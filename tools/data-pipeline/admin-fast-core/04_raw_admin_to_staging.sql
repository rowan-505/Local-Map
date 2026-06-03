-- =============================================================================
-- Stage 04: raw_admin_to_staging
-- raw.raw_osm_polygons (admin-fast-core) -> staging.staging_admin_area_candidates
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
    coalesce(nullif(trim(:'raw_schema'), ''), 'raw'),
    coalesce(nullif(trim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE stage04_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    raw_schema text NOT NULL,
    staging_schema text NOT NULL
);

CREATE TEMP TABLE stage04_result (
    raw_row_count bigint NOT NULL,
    deleted_count bigint NOT NULL,
    inserted_count bigint NOT NULL,
    skipped_no_name bigint NOT NULL,
    skipped_no_admin_level bigint NOT NULL
);

DO $stage04$
DECLARE
    p stage04_params%ROWTYPE;
    ctx stage04_context%ROWTYPE;
    q text;
    v_raw bigint := 0;
    v_deleted bigint := 0;
    v_inserted bigint := 0;
    v_skip_name bigint := 0;
    v_skip_level bigint := 0;
BEGIN
    SELECT * INTO p FROM stage04_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass(format('%I.raw_osm_polygons', p.raw_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.raw_osm_polygons', p.raw_schema;
    END IF;

    IF to_regclass(format('%I.staging_admin_area_candidates', p.staging_schema)) IS NULL THEN
        RAISE EXCEPTION 'missing table %.staging_admin_area_candidates', p.staging_schema;
    END IF;

    INSERT INTO stage04_context (source_snapshot_id, snapshot_version, raw_schema, staging_schema)
    SELECT s.id, s.snapshot_version, p.raw_schema, p.staging_schema
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'snapshot_version "%" not found in system.system_source_snapshots', p.snapshot_version;
    END IF;

    SELECT * INTO ctx FROM stage04_context;

    q := format(
        $q$
        SELECT count(*)::bigint
        FROM %I.raw_osm_polygons AS raw
        WHERE raw.source_snapshot_id = $1
          AND coalesce(raw.raw_payload->>'pipeline', '') = 'admin-fast-core'
          AND raw.geom IS NOT NULL
        $q$,
        ctx.raw_schema
    );
    EXECUTE q INTO v_raw USING ctx.source_snapshot_id;

    q := format(
        $q$
        DELETE FROM %I.staging_admin_area_candidates AS staging
        WHERE staging.source_snapshot_id = $1
          AND coalesce(staging.source_refs->>'pipeline', '') = 'admin-fast-core'
        $q$,
        ctx.staging_schema
    );
    EXECUTE q USING ctx.source_snapshot_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    q := format(
        $q$
        WITH raw_rows AS (
            SELECT
                raw.id AS raw_id,
                btrim(raw.osm_id::text) AS osm_id,
                btrim(raw.osm_feature_type::text) AS osm_feature_type,
                coalesce(raw.tags, '{}'::jsonb) AS tags,
                ST_Multi(ST_MakeValid(raw.geom))::geometry(MultiPolygon, 4326) AS geom,
                CASE lower(btrim(raw.osm_feature_type::text))
                    WHEN 'relation' THEN 'osm:R:' || btrim(raw.osm_id::text)
                    WHEN 'way' THEN 'osm:W:' || btrim(raw.osm_id::text)
                    ELSE 'osm:' || upper(substr(btrim(raw.osm_feature_type::text), 1, 1)) || ':' || btrim(raw.osm_id::text)
                END AS external_id,
                coalesce(
                    nullif(btrim(raw.tags->>'name:my'), ''),
                    nullif(btrim(raw.tags->>'name'), ''),
                    nullif(btrim(raw.tags->>'name:en'), ''),
                    nullif(btrim(raw.tags->>'official_name'), '')
                ) AS canonical_name,
                nullif(btrim(raw.tags->>'admin_level'), '') AS admin_level_tag
            FROM %I.raw_osm_polygons AS raw
            WHERE raw.source_snapshot_id = $1
              AND coalesce(raw.raw_payload->>'pipeline', '') = 'admin-fast-core'
              AND raw.geom IS NOT NULL
              AND raw.osm_id IS NOT NULL
              AND btrim(raw.osm_id::text) <> ''
              AND raw.osm_feature_type IS NOT NULL
              AND btrim(raw.osm_feature_type::text) <> ''
        ),
        osm_parsed AS (
            SELECT
                r.*,
                (
                    SELECT max(btrim(part.part_value)::integer)
                    FROM unnest(string_to_array(coalesce(r.admin_level_tag, ''), ';')) AS part(part_value)
                    WHERE btrim(part.part_value) ~ '^[0-9]+$'
                ) AS osm_admin_level
            FROM raw_rows AS r
        ),
        level_resolved AS (
            SELECT
                p.*,
                CASE p.osm_admin_level
                    WHEN 2 THEN 'country'
                    WHEN 4 THEN 'state_region'
                    WHEN 5 THEN 'district'
                    WHEN 6 THEN 'township'
                    WHEN 7 THEN 'ward_village_tract'
                    WHEN 8 THEN 'ward_village_tract'
                    WHEN 9 THEN 'ward_village_tract'
                    WHEN 10 THEN 'ward_village_tract'
                    ELSE NULL
                END AS osm_level_code,
                CASE
                    WHEN p.canonical_name ~ 'ခရိုင်'
                      OR p.canonical_name ~* '\mDistrict\M' THEN 'district'
                    WHEN p.canonical_name ~ 'မြို့နယ်'
                      OR p.canonical_name ~* '\mTownship\M' THEN 'township'
                    WHEN p.canonical_name ~ 'ရပ်ကွက်'
                      OR p.canonical_name ~ 'ကျေးရွာအုပ်စု'
                      OR p.canonical_name ~* '\mWard\M'
                      OR p.canonical_name ~* 'Village Tract' THEN 'ward_village_tract'
                    ELSE NULL
                END AS semantic_level_code
            FROM osm_parsed AS p
        ),
        mapped AS (
            SELECT
                lr.*,
                coalesce(lr.semantic_level_code, lr.osm_level_code) AS resolved_level_code,
                levels.id AS admin_level_id,
                levels.code AS mapped_admin_level_code,
                jsonb_strip_nulls(jsonb_build_object(
                    'admin_level', lr.admin_level_tag,
                    'osm_admin_level', lr.osm_admin_level::text,
                    'osm_level_code', lr.osm_level_code,
                    'semantic_level_code', lr.semantic_level_code,
                    'mapped_admin_level_code', levels.code,
                    'level_correction_applied',
                    (lr.semantic_level_code IS NOT NULL
                     AND lr.semantic_level_code IS DISTINCT FROM lr.osm_level_code),
                    'boundary', lr.tags->>'boundary',
                    'place', lr.tags->>'place',
                    'population', lr.tags->>'population',
                    'wikidata', lr.tags->>'wikidata',
                    'wikipedia', lr.tags->>'wikipedia',
                    'official_name', lr.tags->>'official_name',
                    'alt_name', lr.tags->>'alt_name'
                )) AS normalized_data,
                jsonb_build_object(
                    'pipeline', 'admin-fast-core',
                    'source', 'osm',
                    'external_id', lr.external_id,
                    'osm_id', lr.osm_id,
                    'osm_feature_type', lr.osm_feature_type,
                    'snapshot_version', $2
                ) AS source_refs
            FROM level_resolved AS lr
            LEFT JOIN ref.ref_admin_levels AS levels
                ON levels.code = coalesce(lr.semantic_level_code, lr.osm_level_code)
        ),
        tallies AS (
            SELECT
                count(*) FILTER (WHERE canonical_name IS NULL)::bigint AS skipped_no_name,
                count(*) FILTER (WHERE canonical_name IS NOT NULL AND admin_level_id IS NULL)::bigint AS skipped_no_admin_level
            FROM mapped
        ),
        inserted AS (
            INSERT INTO %I.staging_admin_area_candidates (
                source_snapshot_id,
                raw_id,
                external_id,
                canonical_name,
                class_code,
                admin_level_id,
                geom,
                centroid,
                confidence_score,
                match_status,
                review_status,
                normalized_data,
                source_refs
            )
            SELECT
                $1,
                m.raw_id,
                m.external_id,
                m.canonical_name,
                m.admin_level_tag,
                m.admin_level_id,
                m.geom,
                ST_PointOnSurface(m.geom),
                80::numeric,
                'new_auto',
                'pending',
                m.normalized_data,
                m.source_refs
            FROM mapped AS m
            WHERE m.canonical_name IS NOT NULL
              AND m.admin_level_id IS NOT NULL
            RETURNING 1
        )
        SELECT
            (SELECT skipped_no_name FROM tallies),
            (SELECT skipped_no_admin_level FROM tallies),
            count(*)::bigint
        FROM inserted
        $q$,
        ctx.raw_schema,
        ctx.staging_schema
    );
    EXECUTE q INTO v_skip_name, v_skip_level, v_inserted
        USING ctx.source_snapshot_id, ctx.snapshot_version;

    INSERT INTO stage04_result (
        raw_row_count,
        deleted_count,
        inserted_count,
        skipped_no_name,
        skipped_no_admin_level
    )
    VALUES (v_raw, v_deleted, v_inserted, v_skip_name, v_skip_level);

    IF v_raw > 0 AND v_inserted = 0 THEN
        RAISE EXCEPTION
            'Stage 04: % raw admin rows but inserted 0 staging candidates (skipped_no_name=%, skipped_no_admin_level=%)',
            v_raw,
            v_skip_name,
            v_skip_level;
    END IF;
END
$stage04$;

SELECT
    ctx.source_snapshot_id,
    ctx.snapshot_version,
    r.raw_row_count,
    r.deleted_count,
    r.inserted_count,
    r.skipped_no_name,
    r.skipped_no_admin_level
FROM stage04_context AS ctx
CROSS JOIN stage04_result AS r;

COMMIT;
