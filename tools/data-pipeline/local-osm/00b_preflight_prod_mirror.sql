-- =============================================================================
-- Pipeline preflight: prod_mirror freshness + required F2 tables.
-- Local read-only. Does not connect to Supabase.
--
-- psql vars:
--   mirror_max_age_hours  optional (default 168)
--   prod_mirror_schema    optional (default prod_mirror)
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?mirror_max_age_hours}
\else
\set mirror_max_age_hours 168
\endif
\if :{?prod_mirror_schema}
\else
\set prod_mirror_schema 'prod_mirror'
\endif

BEGIN;

CREATE TEMP TABLE preflight_prod_mirror_params (
    prod_mirror_schema text NOT NULL,
    mirror_max_age_hours numeric
) ON COMMIT DROP;

INSERT INTO preflight_prod_mirror_params (prod_mirror_schema, mirror_max_age_hours)
VALUES (
    coalesce(NULLIF(btrim(:'prod_mirror_schema'), ''), 'prod_mirror'),
    NULLIF(btrim(:'mirror_max_age_hours'), '')::numeric
);

DO $preflight_prod_mirror$
DECLARE
    v_schema text;
    v_max_age numeric;
    v_age_hours numeric;
    v_refreshed_at timestamptz;
    v_project_ref text;
    v_mode text;
    r text;
    v_missing text[] := ARRAY[]::text[];
BEGIN
    SELECT prod_mirror_schema, mirror_max_age_hours
    INTO v_schema, v_max_age
    FROM preflight_prod_mirror_params
    LIMIT 1;

    IF to_regnamespace(v_schema) IS NULL THEN
        RAISE EXCEPTION
            'prod_mirror schema "%" missing. Refresh local mirror before Stage 07 (tools/data-pipeline/prod-mirror/refresh_prod_mirror.sh).',
            v_schema;
    END IF;

    IF to_regclass(format('%I.mirror_meta', v_schema)) IS NULL THEN
        RAISE EXCEPTION
            '%.mirror_meta missing. Re-run slim prod_mirror refresh before Stage 07.',
            v_schema;
    END IF;

    EXECUTE format(
        'SELECT refreshed_at, source_project_ref, refresh_mode FROM %I.mirror_meta WHERE id = 1',
        v_schema
    ) INTO v_refreshed_at, v_project_ref, v_mode;

    IF v_refreshed_at IS NULL THEN
        RAISE EXCEPTION '%.mirror_meta has no refresh row', v_schema;
    END IF;

    v_age_hours := extract(epoch FROM (now() - v_refreshed_at)) / 3600.0;
    IF v_max_age IS NOT NULL AND v_age_hours > v_max_age THEN
        RAISE EXCEPTION
            'prod_mirror stale: age %.1f h > max %s h (refreshed_at=%, project_ref=%). Refresh before Stage 07.',
            v_age_hours, v_max_age, v_refreshed_at, coalesce(v_project_ref, '');
    END IF;

    FOREACH r IN ARRAY ARRAY['core_places', 'core_streets', 'core_map_buildings'] LOOP
        IF to_regclass(format('%I.%I', v_schema, r)) IS NULL THEN
            v_missing := array_append(v_missing, r);
        END IF;
    END LOOP;

    IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION
            'prod_mirror missing required F2 tables: %. Refresh mirror before Stage 07.',
            array_to_string(v_missing, ', ');
    END IF;

    RAISE NOTICE 'prod_mirror preflight PASS refreshed_at=% age_hours=% project_ref=% mode=%',
        v_refreshed_at, round(v_age_hours::numeric, 2), coalesce(v_project_ref, ''), coalesce(v_mode, '');
END
$preflight_prod_mirror$;

SELECT
    'preflight_prod_mirror' AS section,
    m.refreshed_at,
    m.source_project_ref,
    m.source_host,
    m.refresh_mode,
    round((extract(epoch FROM (now() - m.refreshed_at)) / 3600.0)::numeric, 2) AS age_hours,
    p.mirror_max_age_hours AS max_age_hours,
    'PASS' AS status
FROM prod_mirror.mirror_meta AS m
CROSS JOIN preflight_prod_mirror_params AS p
WHERE m.id = 1;

COMMIT;
