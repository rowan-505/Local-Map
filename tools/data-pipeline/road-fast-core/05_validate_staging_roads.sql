-- =============================================================================
-- Stage 05: validate_staging_roads
-- Light validation summary for staging.staging_road_candidates (one snapshot).
--
-- psql variables: snapshot_version, staging_schema
-- ERROR rows block the pipeline; WARN rows are reported only.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

CREATE TEMP TABLE stage05_params (
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
);

INSERT INTO stage05_params (snapshot_version, staging_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE stage05_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL
);

CREATE TEMP TABLE stage05_validation_summary (
    check_name text NOT NULL,
    severity text NOT NULL,
    count bigint NOT NULL,
    action text NOT NULL
);

DO $stage05$
DECLARE
    p stage05_params%ROWTYPE;
    v_snapshot_id bigint;
    has_admin_area_id boolean;
    q text;
    v_total bigint;
    v_geom_null bigint;
    v_invalid_geom bigint;
    v_srid_issue bigint;
    v_external_id_blank bigint;
    v_duplicate_external_id bigint;
    v_road_class_null bigint;
    v_confidence_out_of_range bigint;
    v_canonical_name_missing bigint;
    v_surface_missing bigint;
    v_maxspeed_missing bigint;
    v_admin_area_null bigint;
    v_very_short_length bigint;
    v_construction_proposed bigint;
    v_error_total bigint;
    v_snap_version text;
BEGIN
    SELECT * INTO p FROM stage05_params;

    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    v_snap_version := p.snapshot_version;

    SELECT s.id
    INTO v_snapshot_id
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = v_snap_version
    ORDER BY s.captured_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

    IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'snapshot_version "%" not found', v_snap_version;
    END IF;

    INSERT INTO stage05_context (source_snapshot_id, snapshot_version)
    VALUES (v_snapshot_id, v_snap_version);

    SELECT exists (
        SELECT 1
        FROM information_schema.columns AS c
        WHERE c.table_schema = p.staging_schema
          AND c.table_name = 'staging_road_candidates'
          AND c.column_name = 'admin_area_id'
    )
    INTO has_admin_area_id;

    q := format(
        $q$
        WITH candidates AS (
            SELECT *
            FROM %I.staging_road_candidates
            WHERE source_snapshot_id = $1
        ),
        dup AS (
            SELECT coalesce(sum(cnt - 1), 0)::bigint AS duplicate_rows
            FROM (
                SELECT count(*)::bigint AS cnt
                FROM candidates
                WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
                GROUP BY external_id
                HAVING count(*) > 1
            ) AS g
        )
        SELECT
            (SELECT count(*)::bigint FROM candidates),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NULL),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)),
            (SELECT count(*)::bigint FROM candidates WHERE geom IS NOT NULL AND ST_SRID(geom) IS DISTINCT FROM 4326),
            (SELECT count(*)::bigint FROM candidates WHERE external_id IS NULL OR btrim(external_id) = ''),
            (SELECT duplicate_rows FROM dup),
            (SELECT count(*)::bigint FROM candidates WHERE road_class_id IS NULL),
            (SELECT count(*)::bigint FROM candidates WHERE confidence_score IS NULL OR confidence_score < 0 OR confidence_score > 100),
            (SELECT count(*)::bigint FROM candidates WHERE canonical_name IS NULL OR btrim(canonical_name) = '' OR canonical_name = external_id),
            (SELECT count(*)::bigint FROM candidates WHERE nullif(btrim(normalized_data->>'surface'), '') IS NULL),
            (SELECT count(*)::bigint FROM candidates WHERE nullif(btrim(normalized_data->>'maxspeed'), '') IS NULL),
            (SELECT count(*)::bigint FROM candidates WHERE length_m IS NOT NULL AND length_m < 1),
            (SELECT count(*)::bigint FROM candidates WHERE lower(btrim(coalesce(normalized_data->>'highway', class_code, ''))) IN ('construction', 'proposed'))
        $q$,
        p.staging_schema
    );

    EXECUTE q INTO
        v_total,
        v_geom_null,
        v_invalid_geom,
        v_srid_issue,
        v_external_id_blank,
        v_duplicate_external_id,
        v_road_class_null,
        v_confidence_out_of_range,
        v_canonical_name_missing,
        v_surface_missing,
        v_maxspeed_missing,
        v_very_short_length,
        v_construction_proposed;

    IF has_admin_area_id THEN
        q := format(
            'select count(*)::bigint from %I.staging_road_candidates where source_snapshot_id = $1 and admin_area_id is null',
            p.staging_schema
        );
        EXECUTE q INTO v_admin_area_null USING v_snapshot_id;
    ELSE
        v_admin_area_null := 0;
    END IF;

    INSERT INTO stage05_validation_summary (check_name, severity, count, action) VALUES
        ('staging_candidate_rows', 'WARN', v_total, 'ALLOW'),
        ('geom_null', 'ERROR', v_geom_null, 'BLOCK'),
        ('invalid_geometry', 'ERROR', v_invalid_geom, 'BLOCK'),
        ('srid_not_4326', 'ERROR', v_srid_issue, 'BLOCK'),
        ('external_id_null_or_blank', 'ERROR', v_external_id_blank, 'BLOCK'),
        ('duplicate_external_id_in_snapshot', 'ERROR', v_duplicate_external_id, 'BLOCK'),
        ('road_class_id_null', 'ERROR', v_road_class_null, 'BLOCK'),
        ('confidence_score_outside_0_100', 'ERROR', v_confidence_out_of_range, 'BLOCK'),
        ('canonical_name_missing', 'WARN', v_canonical_name_missing, 'ALLOW'),
        ('surface_missing', 'WARN', v_surface_missing, 'ALLOW'),
        ('maxspeed_missing', 'WARN', v_maxspeed_missing, 'ALLOW'),
        ('admin_area_id_null', 'WARN', v_admin_area_null, 'ALLOW'),
        ('length_under_1_meter', 'WARN', v_very_short_length, 'ALLOW'),
        ('construction_or_proposed_highway', 'WARN', v_construction_proposed, 'ALLOW');

    SELECT coalesce(sum(s.count), 0)::bigint
    INTO v_error_total
    FROM stage05_validation_summary AS s
    WHERE s.severity = 'ERROR'
      AND s.count > 0;

    IF v_total = 0 OR v_error_total > 0 THEN
        RAISE EXCEPTION
            'Stage 05 validate_staging_roads failed: % ERROR check(s) with count > 0 (see validation summary)',
            (SELECT count(*)::int FROM stage05_validation_summary WHERE severity = 'ERROR' AND count > 0);
    END IF;
END
$stage05$;

SELECT
    ctx.snapshot_version,
    ctx.source_snapshot_id,
    s.check_name,
    s.severity,
    s.count,
    s.action
FROM stage05_context AS ctx
CROSS JOIN stage05_validation_summary AS s
ORDER BY
    CASE s.severity WHEN 'ERROR' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    s.check_name;

SELECT
    severity,
    sum(count)::bigint AS total_issue_rows,
    count(*)::bigint AS checks_with_issues
FROM stage05_validation_summary
WHERE count > 0
GROUP BY severity
ORDER BY severity;
