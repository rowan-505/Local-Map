-- =============================================================================
-- Stage 08b: assign final import_class (local only, no Supabase writes).
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif
\if :{?prod_mirror_schema}
\else
\set prod_mirror_schema 'prod_mirror'
\endif

BEGIN;

\ir pipeline_entity_families.sql
\ir pipeline_source_identity.sql
\ir pipeline_import_classification.sql

CREATE TEMP TABLE stage08b_params (
    snapshot_version text,
    staging_schema text NOT NULL,
    prod_mirror_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08b_params VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging'),
    coalesce(NULLIF(btrim(:'prod_mirror_schema'), ''), 'prod_mirror')
);

CREATE TEMP TABLE stage08b_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL,
    prod_mirror_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08b_context
SELECT s.id, s.snapshot_version, p.staging_schema, p.prod_mirror_schema
FROM system.system_source_snapshots s
JOIN stage08b_params p ON p.snapshot_version = s.snapshot_version;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stage08b_context) THEN
        RAISE EXCEPTION 'snapshot_version not found';
    END IF;
END $$;

CREATE TEMP TABLE stage08b_family (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08b_family VALUES
    ('places', 'staging_place_candidates'),
    ('roads', 'staging_road_candidates'),
    ('buildings', 'staging_building_candidates'),
    ('admin_areas', 'staging_admin_area_candidates'),
    ('landuse', 'staging_landuse_candidates'),
    ('water_lines', 'staging_water_line_candidates'),
    ('water_polygons', 'staging_water_polygon_candidates'),
    ('routing_barriers', 'staging_routing_barrier_candidates');

DELETE FROM stage08b_family f
WHERE NOT pg_temp.pipeline_entity_family_enabled(f.entity_family);

CREATE TEMP TABLE stage08b_report (
    entity_family text,
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

CREATE TEMP TABLE stage08b_f2 ON COMMIT DROP AS
SELECT DISTINCT ON (item.entity_family, item.local_entity_id)
    item.entity_family,
    item.local_entity_id,
    item.diff_type AS f2_diff_type,
    item.auto_action AS f2_auto_action,
    coalesce(item.after_data->'f2_comparison'->>'f2_result', '') AS f2_result,
    coalesce((item.after_data->'f2_comparison'->>'source_matched')::boolean, false) AS source_matched,
    coalesce((item.after_data->'f2_comparison'->>'spatial_matched')::boolean, false) AS spatial_matched,
    coalesce((item.after_data->'f2_comparison'->>'name_matched')::boolean, false) AS name_matched,
    coalesce((item.after_data->'f2_comparison'->>'fallback_matched')::boolean, false) AS fallback_matched,
    coalesce((item.after_data->'f2_comparison'->>'manual_protected')::boolean, false) AS f2_manual_protected,
    item.before_data AS prod_before
FROM system.system_diff_items AS item
INNER JOIN LATERAL (
    SELECT run.id
    FROM system.system_diff_runs AS run
    CROSS JOIN stage08b_context AS ctx
    WHERE run.current_snapshot_id = ctx.source_snapshot_id
      AND run.entity_family = item.entity_family
      AND run.status = 'completed'
      AND run.summary->>'comparison_type' = 'staging_vs_prod_mirror'
    ORDER BY run.finished_at DESC NULLS LAST, run.id DESC
    LIMIT 1
) AS latest ON latest.id = item.diff_run_id
WHERE item.local_entity_id IS NOT NULL
ORDER BY item.entity_family, item.local_entity_id, item.id DESC;

CREATE INDEX ON stage08b_f2 (entity_family, local_entity_id);

DO $stage08b_assign$
DECLARE
    ctx stage08b_context%ROWTYPE;
    f record;
    v_sql text;
    v_updated bigint;
    v_has_validation boolean;
    v_has_source_status boolean;
    v_val_expr text;
    v_src_expr text;
    v_src_lit_expr text;
BEGIN
    SELECT * INTO STRICT ctx FROM stage08b_context;

    FOR f IN SELECT * FROM stage08b_family ORDER BY entity_family LOOP
        IF to_regclass(format('%I.%I', ctx.staging_schema, f.staging_table)) IS NULL THEN
            INSERT INTO stage08b_report VALUES (f.entity_family, 'table_missing', 0, 'WARN', 'staging table missing');
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS import_class text NULL',
            ctx.staging_schema, f.staging_table
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS import_class_reason jsonb NULL',
            ctx.staging_schema, f.staging_table
        );

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema AND table_name = f.staging_table
              AND column_name = 'validation_status'
        ) INTO v_has_validation;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = ctx.staging_schema AND table_name = f.staging_table
              AND column_name = 'source_status'
        ) INTO v_has_source_status;

        v_val_expr := CASE WHEN v_has_validation THEN 'coalesce(s.validation_status, '''')' ELSE '''valid''' END;
        v_src_expr := CASE WHEN v_has_source_status THEN 's.source_status' ELSE 'NULL::text' END;
        v_src_lit_expr := CASE WHEN v_has_source_status THEN 'coalesce(s.source_status, '''')' ELSE '''''' END;

        v_sql := format(
            $u$
            WITH base AS (
                SELECT
                    s.id AS staging_id,
                    to_jsonb(s)->>'class_code' AS class_code,
                    %2$s AS validation_status,
                    %5$s AS source_status,
                    CASE
                        WHEN to_jsonb(s) ? 'eligible_for_core'
                            THEN nullif(to_jsonb(s)->>'eligible_for_core', '')::boolean
                        ELSE NULL
                    END AS eligible_for_core,
                    nullif(to_jsonb(s)->>'core_selection_reason', '') AS core_selection_reason,
                    nullif(to_jsonb(s)->>'pmtiles_only_reason', '') AS pmtiles_only_reason,
                    coalesce(
                        nullif(to_jsonb(s)->'normalized_data'->>'admin_area_id', '')::bigint,
                        nullif(to_jsonb(s)->'normalized_data'->>'core_admin_area_id', '')::bigint,
                        nullif(to_jsonb(s)->>'admin_area_candidate_id', '')::bigint
                    ) AS admin_area_id,
                    CASE WHEN to_jsonb(s) ? 'validation_notes' THEN to_jsonb(s)->'validation_notes' ELSE NULL END AS validation_notes,
                    f2.f2_result,
                    f2.f2_auto_action,
                    f2.source_matched,
                    f2.spatial_matched,
                    f2.name_matched,
                    f2.fallback_matched,
                    f2.prod_before,
                    f2.f2_diff_type,
                    f2.f2_manual_protected,
                    system.pipeline_decide_import_class(
                        %1$L,
                        %2$s,
                        coalesce(f2.f2_result, ''),
                        coalesce(f2.f2_auto_action, ''),
                        coalesce(f2.source_matched, false),
                        coalesce(f2.spatial_matched, false),
                        coalesce(f2.name_matched, false),
                        coalesce(f2.fallback_matched, false),
                        coalesce(
                            NULLIF(f2.prod_before->>'manual_override', '')::boolean,
                            f2.f2_manual_protected,
                            false
                        ),
                        coalesce(NULLIF(f2.prod_before->>'is_verified', '')::boolean, false),
                        CASE
                            WHEN f2.f2_diff_type = 'unchanged' THEN false
                            WHEN f2.f2_auto_action = 'ignore_unchanged' THEN false
                            WHEN f2.f2_diff_type = 'changed' THEN true
                            WHEN f2.f2_auto_action IN (
                                'update_candidate', 'protect_manual', 'needs_review', 'possible_duplicate'
                            ) THEN true
                            WHEN %3$s = 'source_unchanged' THEN false
                            WHEN %3$s = 'source_changed' THEN true
                            ELSE false
                        END,
                        CASE
                            WHEN %1$L = 'routing_barriers' THEN false
                            WHEN %1$L = 'admin_areas' THEN
                                coalesce(f2.f2_auto_action = 'update_candidate', false)
                                AND lower(btrim(coalesce(to_jsonb(s)->>'canonical_name', '')))
                                    IS DISTINCT FROM lower(btrim(coalesce(f2.prod_before->>'canonical_name', '')))
                                AND coalesce(to_jsonb(s)->>'admin_level_id', '')
                                    IS NOT DISTINCT FROM coalesce(f2.prod_before->>'admin_level_id', '')
                            WHEN f2.f2_auto_action IN ('update_candidate', 'ignore_unchanged') THEN true
                            ELSE true
                        END,
                        system.pipeline_is_osm_derived(
                            coalesce(f2.prod_before->>'external_id', s.external_id),
                            CASE WHEN f2.prod_before ? 'source_refs' THEN f2.prod_before->'source_refs' ELSE NULL END,
                            f2.prod_before->>'source_type'
                        )
                    ) AS base_import_class
                FROM %6$I.%7$I AS s
                LEFT JOIN stage08b_f2 AS f2
                    ON f2.entity_family = %1$L
                   AND f2.local_entity_id = s.id
                WHERE s.source_snapshot_id = $1
            ),
            settled AS (
                SELECT
                    b.*,
                    system.pipeline_decide_settlement_import_class(
                        b.base_import_class,
                        b.class_code,
                        b.validation_status,
                        b.admin_area_id
                    ) AS settled_import_class
                FROM base AS b
            ),
            decided AS (
                SELECT
                    s.staging_id,
                    CASE
                        WHEN s.settled_import_class = 'invalid' THEN 'invalid'
                        WHEN %1$L IN ('buildings', 'landuse', 'water_lines', 'water_polygons')
                             AND s.eligible_for_core IS FALSE
                            THEN 'pmtiles_only'
                        ELSE s.settled_import_class
                    END AS import_class,
                    jsonb_strip_nulls(jsonb_build_object(
                        'validation_status', s.validation_status,
                        'source_status', s.source_status,
                        'eligible_for_core', s.eligible_for_core,
                        'core_selection_reason', s.core_selection_reason,
                        'pmtiles_only_reason', s.pmtiles_only_reason,
                        'f2_result', s.f2_result,
                        'f2_auto_action', s.f2_auto_action,
                        'source_matched', s.source_matched,
                        'spatial_matched', s.spatial_matched,
                        'name_matched', s.name_matched,
                        'fallback_matched', s.fallback_matched,
                        'prod_manual_override', s.prod_before->>'manual_override',
                        'prod_is_verified', s.prod_before->>'is_verified',
                        'duplicate_threshold_m', CASE
                            WHEN %1$L = 'places' THEN system.pipeline_places_duplicate_threshold_m(s.class_code)
                            ELSE system.pipeline_duplicate_threshold_m(%1$L)
                        END,
                        'final_action', CASE
                            WHEN s.settled_import_class = 'invalid' THEN 'invalid'
                            WHEN %1$L IN ('buildings', 'landuse', 'water_lines', 'water_polygons')
                                 AND s.eligible_for_core IS FALSE
                                THEN 'skip'
                            ELSE system.pipeline_import_class_to_final_action(s.settled_import_class)
                        END,
                        'review_reason', system.pipeline_settlement_review_reason(
                            s.settled_import_class,
                            s.validation_notes,
                            s.class_code
                        ),
                        'auto_update_fields', to_jsonb(system.pipeline_auto_update_fields(%1$L))
                    )) AS import_class_reason
                FROM settled AS s
            )
            UPDATE %6$I.%7$I AS s
            SET
                import_class = d.import_class,
                import_class_reason = d.import_class_reason
            FROM decided AS d
            WHERE s.id = d.staging_id
            $u$,
            f.entity_family,
            v_val_expr,
            v_src_lit_expr,
            v_val_expr,
            v_src_expr,
            ctx.staging_schema,
            f.staging_table
        );

        EXECUTE v_sql USING ctx.source_snapshot_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        INSERT INTO stage08b_report VALUES (f.entity_family, 'classified_rows', v_updated, 'PASS', NULL);

        EXECUTE format(
            $m$
            INSERT INTO stage08b_report
            SELECT %L, 'import_class_' || coalesce(import_class, 'null'), count(*)::bigint, 'PASS', NULL
            FROM %I.%I
            WHERE source_snapshot_id = $1
            GROUP BY import_class
            $m$,
            f.entity_family, ctx.staging_schema, f.staging_table
        ) USING ctx.source_snapshot_id;
    END LOOP;
END
$stage08b_assign$;

SELECT
    'stage08b_import_class' AS section,
    entity_family,
    metric,
    value_n,
    status,
    note
FROM stage08b_report
ORDER BY entity_family, metric;

COMMIT;
