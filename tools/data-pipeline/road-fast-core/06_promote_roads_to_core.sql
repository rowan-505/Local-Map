-- =============================================================================
-- Stage 06: promote_roads_to_core
-- Upsert validated staging.staging_road_candidates -> core.core_streets
-- by external_id. Does not delete or soft-delete missing core rows.
--
-- psql variables: snapshot_version, staging_schema (default staging)
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

CREATE TEMP TABLE stage06_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
);

INSERT INTO stage06_params (snapshot_version, staging_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE stage06_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    osm_source_type_id bigint NOT NULL
);

CREATE TEMP TABLE stage06_result (
    staging_ready_count bigint NOT NULL,
    inserted_count bigint NOT NULL,
    updated_count bigint NOT NULL,
    skipped_manual_override_count bigint NOT NULL,
    manual_refs_only_count bigint NOT NULL
);

DO $stage06$
DECLARE
    p stage06_params%ROWTYPE;
    ctx stage06_context%ROWTYPE;
    q text;
    v_snapshot_id bigint;
    v_ready bigint;
    v_inserted bigint;
    v_updated bigint;
    v_skipped_manual bigint;
    v_refs_only bigint;
    v_has_confidence boolean;
    v_conf_upd text := '';
    v_conf_col text := '';
    v_conf_sel text := '';
BEGIN
    SELECT * INTO p FROM stage06_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    IF to_regclass('core.core_streets') IS NULL THEN
        RAISE EXCEPTION 'core.core_streets does not exist';
    END IF;

    SELECT s.id
    INTO v_snapshot_id
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'snapshot_version "%" not found', p.snapshot_version;
    END IF;

    INSERT INTO stage06_context (source_snapshot_id, snapshot_version, osm_source_type_id)
    SELECT
        v_snapshot_id,
        p.snapshot_version,
        st.id
    FROM ref.ref_source_types AS st
    WHERE st.code = 'osm';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ref.ref_source_types row with code=osm is required';
    END IF;

    SELECT * INTO ctx FROM stage06_context;

    SELECT exists (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'core'
          AND c.table_name = 'core_streets'
          AND c.column_name = 'confidence_score'
    )
    INTO v_has_confidence;

    IF v_has_confidence THEN
        v_conf_upd := E',\n                confidence_score = r.confidence_score';
        v_conf_col := E',\n                confidence_score';
        v_conf_sel := E',\n                r.confidence_score';
    END IF;

    q := format(
        $q$
        WITH staging_rows AS (
            SELECT
                c.id AS staging_id,
                c.external_id,
                c.canonical_name,
                c.road_class_id,
                coalesce(nullif(btrim(c.class_code), ''), 'unclassified') AS road_class_code,
                c.confidence_score,
                coalesce(c.is_oneway, false) AS is_oneway,
                coalesce(c.normalized_data, '{}'::jsonb) AS normalized_data,
                coalesce(c.source_refs, '{}'::jsonb) AS source_refs,
                CASE
                    WHEN c.geom IS NULL THEN NULL::geometry(LineString, 4326)
                    WHEN ST_GeometryType(c.geom) = 'ST_LineString'
                        THEN ST_Force2D(c.geom)::geometry(LineString, 4326)
                    WHEN ST_GeometryType(c.geom) = 'ST_MultiLineString' THEN (
                        SELECT ST_Force2D(d.geom)::geometry(LineString, 4326)
                        FROM ST_Dump(c.geom) AS d
                        ORDER BY ST_Length(d.geom::geography) DESC
                        LIMIT 1
                    )
                    ELSE NULL::geometry(LineString, 4326)
                END AS geom_line,
                nullif(btrim(c.normalized_data->>'surface'), '') AS surface_text,
                CASE
                    WHEN lower(coalesce(c.normalized_data->>'bridge', '')) IN ('yes', 'true', '1') THEN true
                    ELSE false
                END AS bridge_flag,
                CASE
                    WHEN lower(coalesce(c.normalized_data->>'tunnel', '')) IN ('yes', 'true', '1') THEN true
                    ELSE false
                END AS tunnel_flag,
                coalesce(nullif(btrim(c.normalized_data->>'layer'), '')::int, 0) AS layer_no,
                c.normalized_data AS source_tags
            FROM %I.staging_road_candidates AS c
            WHERE c.source_snapshot_id = $1
        ),
        ready AS (
            SELECT
                s.*,
                $2::bigint AS source_type_id,
                s.source_refs || jsonb_build_object(
                    'promoted_by', 'road-fast-core',
                    'promoted_at', to_jsonb(now()),
                    'staging_id', s.staging_id
                ) AS merged_source_refs,
                s.normalized_data || jsonb_build_object(
                    'promotion', jsonb_build_object(
                        'pipeline', 'road-fast-core',
                        'snapshot_version', $3
                    )
                ) AS merged_normalized_data
            FROM staging_rows AS s
            WHERE s.geom_line IS NOT NULL
              AND ST_IsValid(s.geom_line)
              AND NOT ST_IsEmpty(s.geom_line)
              AND ST_SRID(s.geom_line) = 4326
              AND s.external_id IS NOT NULL
              AND btrim(s.external_id) <> ''
              AND s.road_class_id IS NOT NULL
        ),
        skipped_manual AS (
            SELECT count(*)::bigint AS n
            FROM ready AS r
            JOIN core.core_streets AS cs ON cs.external_id = r.external_id
            WHERE coalesce(cs.manual_override, false) = true
        ),
        updated_full AS (
            UPDATE core.core_streets AS cs
            SET
                canonical_name = r.canonical_name,
                geom = r.geom_line,
                road_class_id = r.road_class_id,
                road_class = r.road_class_code,
                surface = r.surface_text,
                travel_direction = CASE WHEN r.is_oneway THEN 'forward' ELSE NULL END,
                bridge = r.bridge_flag,
                tunnel = r.tunnel_flag,
                layer = r.layer_no,
                source_type_id = r.source_type_id,
                source_tags = r.source_tags,
                source_refs = coalesce(cs.source_refs, '{}'::jsonb) || r.merged_source_refs,
                normalized_data = coalesce(cs.normalized_data, '{}'::jsonb) || r.merged_normalized_data,
                is_active = true,
                verification_status = 'unverified',
                updated_at = now()%s
            FROM ready AS r
            WHERE cs.external_id = r.external_id
              AND coalesce(cs.manual_override, false) = false
            RETURNING cs.id
        ),
        updated_manual_refs AS (
            UPDATE core.core_streets AS cs
            SET
                source_refs = coalesce(cs.source_refs, '{}'::jsonb) || r.merged_source_refs,
                normalized_data = coalesce(cs.normalized_data, '{}'::jsonb) || r.merged_normalized_data,
                updated_at = now()
            FROM ready AS r
            WHERE cs.external_id = r.external_id
              AND coalesce(cs.manual_override, false) = true
            RETURNING cs.id
        ),
        inserted AS (
            INSERT INTO core.core_streets (
                external_id,
                canonical_name,
                geom,
                road_class_id,
                road_class,
                surface,
                travel_direction,
                bridge,
                tunnel,
                layer,
                source_type_id,
                source_tags,
                source_refs,
                normalized_data,
                is_active,
                verification_status,
                manual_override,
                created_at,
                updated_at%s
            )
            SELECT
                r.external_id,
                r.canonical_name,
                r.geom_line,
                r.road_class_id,
                r.road_class_code,
                r.surface_text,
                CASE WHEN r.is_oneway THEN 'forward' ELSE NULL END,
                r.bridge_flag,
                r.tunnel_flag,
                r.layer_no,
                r.source_type_id,
                r.source_tags,
                r.merged_source_refs,
                r.merged_normalized_data,
                true,
                'unverified',
                false,
                now(),
                now()%s
            FROM ready AS r
            WHERE NOT EXISTS (
                SELECT 1 FROM core.core_streets AS cs WHERE cs.external_id = r.external_id
            )
            RETURNING id
        )
        SELECT
            (SELECT count(*)::bigint FROM ready),
            (SELECT count(*)::bigint FROM inserted),
            (SELECT count(*)::bigint FROM updated_full),
            (SELECT n FROM skipped_manual),
            (SELECT count(*)::bigint FROM updated_manual_refs)
        $q$,
        p.staging_schema,
        v_conf_upd,
        v_conf_col,
        v_conf_sel
    );

    EXECUTE q INTO v_ready, v_inserted, v_updated, v_skipped_manual, v_refs_only
    USING ctx.source_snapshot_id, ctx.osm_source_type_id, ctx.snapshot_version;

    q := format(
        $q$
        UPDATE %I.staging_road_candidates AS c
        SET matched_core_edge_id = cs.id,
            updated_at = now()
        FROM core.core_streets AS cs
        WHERE c.source_snapshot_id = $1
          AND cs.external_id = c.external_id
        $q$,
        p.staging_schema
    );
    EXECUTE q USING ctx.source_snapshot_id;

    INSERT INTO stage06_result (
        staging_ready_count,
        inserted_count,
        updated_count,
        skipped_manual_override_count,
        manual_refs_only_count
    )
    VALUES (v_ready, v_inserted, v_updated, v_skipped_manual, v_refs_only);

    IF v_ready = 0 THEN
        RAISE EXCEPTION 'Stage 06: no valid staging road candidates for snapshot %', ctx.snapshot_version;
    END IF;
END
$stage06$;

SELECT
    ctx.snapshot_version,
    ctx.source_snapshot_id,
    r.staging_ready_count,
    r.inserted_count,
    r.updated_count,
    r.skipped_manual_override_count,
    r.manual_refs_only_count
FROM stage06_context AS ctx
CROSS JOIN stage06_result AS r;

COMMIT;
