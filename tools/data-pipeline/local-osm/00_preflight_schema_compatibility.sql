-- =============================================================================
-- Preflight: local OSM pipeline schema compatibility (confidence_score 0–100)
--
-- Read-only against catalog + information_schema (temp report tables only).
-- Fails fast before Stage 00 when score columns still use legacy 0–1 scale.
--
-- psql variables:
--   staging_schema  optional, default staging
--   system_schema   optional, default system
--
-- Fix:
--   infrastructure/database/migrations/local/005_local_confidence_score_scale_0_100.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif
\if :{?system_schema}
\else
\set system_schema 'system'
\endif
\if :{?entity_families}
\else
\set entity_families 'all'
\endif

\set fix_migration 'infrastructure/database/migrations/local/005_local_confidence_score_scale_0_100.sql'

CREATE TEMP TABLE preflight_params (
    staging_schema text NOT NULL,
    system_schema text NOT NULL
);

INSERT INTO preflight_params (staging_schema, system_schema)
VALUES (
    lower(btrim(coalesce(nullif(btrim(:'staging_schema'), ''), 'staging'))),
    lower(btrim(coalesce(nullif(btrim(:'system_schema'), ''), 'system')))
);

CREATE TEMP TABLE preflight_score_report (
    section text NOT NULL,
    object_name text NOT NULL,
    check_name text NOT NULL,
    status text NOT NULL,
    detail text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.preflight_numeric_can_store_100(
    p_data_type text,
    p_precision integer,
    p_scale integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_max numeric;
BEGIN
    IF p_data_type IN ('double precision', 'real') THEN
        RETURN true;
    END IF;

    IF p_data_type IN ('integer', 'bigint', 'smallint') THEN
        RETURN true;
    END IF;

    IF p_data_type <> 'numeric' THEN
        RETURN false;
    END IF;

    IF p_precision IS NULL THEN
        RETURN true;
    END IF;

    IF p_scale IS NULL THEN
        RETURN p_precision >= 3;
    END IF;

    v_max := power(10::numeric, (p_precision - p_scale)) - power(10::numeric, -p_scale);
    RETURN v_max >= 100;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.preflight_type_label(
    p_data_type text,
    p_precision integer,
    p_scale integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN $1 = 'numeric' AND $2 IS NOT NULL AND $3 IS NOT NULL THEN format('numeric(%s,%s)', $2, $3)
        WHEN $1 = 'numeric' AND $2 IS NOT NULL THEN format('numeric(%s)', $2)
        ELSE $1
    END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.preflight_is_legacy_confidence_check(p_def text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce($1, '') ~* 'confidence_score'
        AND (
            (
                $1 ~* '<=\s*\(?\s*1(\.0+)?\s*\)?(\s|and|\)|$|,|;)'
                AND $1 !~* '<=\s*\(?\s*1[0-9]'
            )
            OR (
                $1 ~* 'between\s*\(?\s*0(\.0+)?\s*\)?\s+and\s+\(?\s*1(\.0+)?\s*\)?(\s|\)|$|;)'
                AND $1 !~* 'and\s+\(?\s*1[0-9]'
            )
        );
$$;

DO $preflight_score_checks$
DECLARE
    p preflight_params%ROWTYPE;
    v_system_diff_fq text;
    v_staging_schema text;
    v_col record;
    v_con record;
    v_type_label text;
    v_fix text := 'Apply fix: psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f infrastructure/database/migrations/local/005_local_confidence_score_scale_0_100.sql';
BEGIN
    SELECT *
    INTO STRICT p
    FROM preflight_params;

    v_staging_schema := p.staging_schema;
    v_system_diff_fq := format('%I.system_diff_items', p.system_schema);

    IF to_regclass(v_system_diff_fq) IS NULL THEN
        INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
        VALUES (
            'system_diff_items',
            v_system_diff_fq,
            'table_exists',
            'FAIL',
            format('Required table %s is missing.', v_system_diff_fq)
        );
    ELSE
        SELECT
            c.data_type,
            c.numeric_precision,
            c.numeric_scale
        INTO v_col
        FROM information_schema.columns AS c
        WHERE c.table_schema = p.system_schema
          AND c.table_name = 'system_diff_items'
          AND c.column_name = 'confidence_score';

        IF NOT FOUND THEN
            INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
            VALUES (
                'system_diff_items',
                v_system_diff_fq,
                'column_exists',
                'FAIL',
                'Column confidence_score is missing on system.system_diff_items.'
            );
        ELSE
            v_type_label := pg_temp.preflight_type_label(
                v_col.data_type,
                v_col.numeric_precision,
                v_col.numeric_scale
            );

            IF NOT pg_temp.preflight_numeric_can_store_100(
                v_col.data_type,
                v_col.numeric_precision,
                v_col.numeric_scale
            ) THEN
                INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
                VALUES (
                    'system_diff_items',
                    v_system_diff_fq || '.confidence_score',
                    'numeric_range',
                    'FAIL',
                    format(
                        'Type %s cannot store pipeline confidence_score=100 (legacy 0–1 scale). %s',
                        v_type_label,
                        v_fix
                    )
                );
            ELSE
                INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
                VALUES (
                    'system_diff_items',
                    v_system_diff_fq || '.confidence_score',
                    'numeric_range',
                    'PASS',
                    format(
                        'Type %s supports 0–100 scores%s.',
                        v_type_label,
                        CASE
                            WHEN v_col.data_type = 'numeric'
                                 AND v_col.numeric_precision IS NOT NULL
                                 AND v_col.numeric_scale IS NOT NULL
                                 AND v_col.numeric_precision >= 6
                                 AND v_col.numeric_scale <= 2
                            THEN ' (preferred numeric(6,2) or wider)'
                            ELSE ''
                        END
                    )
                );
            END IF;

            FOR v_con IN
                SELECT c.conname AS constraint_name,
                       pg_get_constraintdef(c.oid) AS def
                FROM pg_constraint AS c
                JOIN pg_class AS rel ON rel.oid = c.conrelid
                JOIN pg_namespace AS n ON n.oid = rel.relnamespace
                WHERE n.nspname = p.system_schema
                  AND rel.relname = 'system_diff_items'
                  AND c.contype = 'c'
                  AND pg_temp.preflight_is_legacy_confidence_check(pg_get_constraintdef(c.oid))
            LOOP
                INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
                VALUES (
                    'system_diff_items',
                    v_system_diff_fq,
                    'legacy_check',
                    'FAIL',
                    format(
                        'Constraint %I caps confidence_score at 0–1: %s. %s',
                        v_con.constraint_name,
                        v_con.def,
                        v_fix
                    )
                );
            END LOOP;
        END IF;
    END IF;

    FOR v_col IN
        SELECT
            c.table_name,
            c.data_type,
            c.numeric_precision,
            c.numeric_scale
        FROM information_schema.columns AS c
        WHERE c.table_schema = v_staging_schema
          AND c.column_name = 'confidence_score'
          AND c.table_name ~ '^staging_.*_candidates$'
        ORDER BY c.table_name
    LOOP
        v_type_label := pg_temp.preflight_type_label(
            v_col.data_type,
            v_col.numeric_precision,
            v_col.numeric_scale
        );

        IF NOT pg_temp.preflight_numeric_can_store_100(
            v_col.data_type,
            v_col.numeric_precision,
            v_col.numeric_scale
        ) THEN
            INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
            VALUES (
                'staging_candidates',
                format('%I.%I', v_staging_schema, v_col.table_name) || '.confidence_score',
                'numeric_range',
                'FAIL',
                format(
                    'Type %s cannot store pipeline confidence_score=100 (legacy 0–1 scale). %s',
                    v_type_label,
                    v_fix
                )
            );
        ELSE
            INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
            VALUES (
                'staging_candidates',
                format('%I.%I', v_staging_schema, v_col.table_name) || '.confidence_score',
                'numeric_range',
                'PASS',
                format('Type %s supports 0–100 scores.', v_type_label)
            );
        END IF;

        FOR v_con IN
            SELECT c.conname AS constraint_name,
                   pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint AS c
            JOIN pg_class AS rel ON rel.oid = c.conrelid
            JOIN pg_namespace AS n ON n.oid = rel.relnamespace
            WHERE n.nspname = v_staging_schema
              AND rel.relname = v_col.table_name
              AND c.contype = 'c'
              AND pg_temp.preflight_is_legacy_confidence_check(pg_get_constraintdef(c.oid))
        LOOP
            INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
            VALUES (
                'staging_candidates',
                format('%I.%I', v_staging_schema, v_col.table_name),
                'legacy_check',
                'FAIL',
                format(
                    'Constraint %I caps confidence_score at 0–1: %s. %s',
                    v_con.constraint_name,
                    v_con.def,
                    v_fix
                )
            );
        END LOOP;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM preflight_score_report
        WHERE section = 'staging_candidates'
    ) THEN
        INSERT INTO preflight_score_report (section, object_name, check_name, status, detail)
        VALUES (
            'staging_candidates',
            format('%I.staging_*_candidates', v_staging_schema),
            'columns_found',
            'SKIP',
            'No staging candidate confidence_score columns found yet (staging DDL may run on first import).'
        );
    END IF;
END
$preflight_score_checks$;

SELECT
    'preflight_schema_compatibility' AS section,
    object_name,
    check_name,
    status,
    detail
FROM preflight_score_report
ORDER BY
    CASE section
        WHEN 'system_diff_items' THEN 1
        WHEN 'staging_candidates' THEN 2
        ELSE 9
    END,
    object_name,
    check_name;

SELECT
    'preflight_schema_compatibility_summary' AS section,
    count(*) FILTER (WHERE status = 'PASS') AS pass_count,
    count(*) FILTER (WHERE status = 'FAIL') AS fail_count,
    count(*) FILTER (WHERE status = 'SKIP') AS skip_count
FROM preflight_score_report;

DO $preflight_score_fail$
DECLARE
    v_fail_count integer;
BEGIN
    SELECT count(*)::integer
    INTO v_fail_count
    FROM preflight_score_report
    WHERE status = 'FAIL';

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION
            'preflight schema compatibility failed: % score column/check issue(s). Apply migration infrastructure/database/migrations/local/005_local_confidence_score_scale_0_100.sql then re-run the pipeline.',
            v_fail_count;
    END IF;
END
$preflight_score_fail$;
