-- =============================================================================
-- Stage 08d: re-apply settlement import_class after Stage 08c prod admin assign.
-- Settlements that still lack admin_area_id become conflict (after real lookup).
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

BEGIN;

\ir pipeline_entity_families.sql
\ir pipeline_settlements.sql
\ir pipeline_remote_review_conflict.sql

CREATE TEMP TABLE stage08d_params (
    snapshot_version text,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08d_params VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE stage08d_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    staging_schema text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage08d_context
SELECT s.id, s.snapshot_version, p.staging_schema
FROM system.system_source_snapshots s
JOIN stage08d_params p ON p.snapshot_version = s.snapshot_version;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM stage08d_context) THEN
        RAISE EXCEPTION 'snapshot_version not found';
    END IF;
END $$;

CREATE TEMP TABLE stage08d_report (
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

DO $stage08d$
DECLARE
    ctx stage08d_context%ROWTYPE;
    v_reclass bigint;
    v_still_null bigint;
    v_has_reason boolean;
    v_set_reason text;
BEGIN
    SELECT * INTO ctx FROM stage08d_context LIMIT 1;

    IF NOT pg_temp.pipeline_entity_family_enabled('places') THEN
        INSERT INTO stage08d_report VALUES (
            'skipped', 0, 'INFO', 'places family not enabled'
        );
        RETURN;
    END IF;

    IF to_regclass(format('%I.staging_place_candidates', ctx.staging_schema)) IS NULL THEN
        INSERT INTO stage08d_report VALUES (
            'skipped', 0, 'WARN', 'staging_place_candidates missing'
        );
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ctx.staging_schema
          AND table_name = 'staging_place_candidates'
          AND column_name = 'import_class_reason'
    ) INTO v_has_reason;

    IF v_has_reason THEN
        -- import_class_reason is jsonb (see Stage 08b); merge keys instead of text concat.
        v_set_reason := $r$
            import_class_reason = jsonb_strip_nulls(
                coalesce(s.import_class_reason, '{}'::jsonb)
                || jsonb_build_object(
                    'review_reason', CASE
                        WHEN d.new_class = 'conflict'
                             AND system.pipeline_settlement_requires_admin(d.class_code)
                            THEN 'settlement_admin_missing_after_prod_assign'
                        ELSE 'settlement_reclass_after_prod_admin'
                    END,
                    'final_action', system.pipeline_import_class_to_final_action(d.new_class),
                    'settlement_reclass_stage', '08d',
                    'settlement_reclass_from', d.base_class,
                    'settlement_reclass_to', d.new_class
                )
            ),
        $r$;
    ELSE
        v_set_reason := '';
    END IF;

    EXECUTE format(
        $u$
        WITH decided AS (
            SELECT
                s.id,
                s.import_class AS base_class,
                s.class_code,
                system.pipeline_decide_settlement_import_class(
                    s.import_class,
                    s.class_code,
                    s.validation_status,
                    coalesce(
                        nullif(s.normalized_data->>'admin_area_id', '')::bigint,
                        nullif(s.normalized_data->>'core_admin_area_id', '')::bigint
                    ),
                    false  -- enforce admin-required → conflict after Stage 08c
                ) AS new_class
            FROM %I.staging_place_candidates AS s
            WHERE s.source_snapshot_id = $1
              AND system.pipeline_is_settlement_place(s.class_code)
              AND s.import_class IS NOT NULL
              AND lower(btrim(s.import_class)) NOT IN ('invalid', 'pmtiles_only')
        ),
        upd AS (
            UPDATE %I.staging_place_candidates AS s
            SET
                import_class = d.new_class,
                %s
                updated_at = now()
            FROM decided AS d
            WHERE s.id = d.id
              AND d.new_class IS DISTINCT FROM d.base_class
            RETURNING s.id
        )
        SELECT count(*) FROM upd
        $u$,
        ctx.staging_schema,
        ctx.staging_schema,
        v_set_reason
    )
    INTO v_reclass
    USING ctx.source_snapshot_id;

    EXECUTE format(
        $n$
        SELECT count(*)
        FROM %I.staging_place_candidates AS s
        WHERE s.source_snapshot_id = $1
          AND system.pipeline_is_settlement_place(s.class_code)
          AND system.pipeline_settlement_requires_admin(s.class_code)
          AND nullif(s.normalized_data->>'admin_area_id', '') IS NULL
          AND lower(btrim(coalesce(s.import_class, ''))) IN (
              'safe_new', 'safe_update', 'unchanged'
          )
        $n$,
        ctx.staging_schema
    )
    INTO v_still_null
    USING ctx.source_snapshot_id;

    INSERT INTO stage08d_report VALUES (
        'settlement_reclassed', coalesce(v_reclass, 0), 'PASS',
        'import_class updated after prod township assign'
    );
    INSERT INTO stage08d_report VALUES (
        'settlements_still_safe_without_admin', coalesce(v_still_null, 0),
        CASE WHEN coalesce(v_still_null, 0) = 0 THEN 'PASS' ELSE 'FAIL' END,
        'must be 0 — Stage 08d should force conflict when admin required'
    );
END
$stage08d$;

SELECT * FROM stage08d_report ORDER BY metric;

COMMIT;
