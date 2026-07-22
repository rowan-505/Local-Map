-- =============================================================================
-- Prod mirror 04: validate_prod_mirror
-- Local read-only checks: presence, counts, protection columns, duplicate IDs.
-- Also reconciles mirror counts with live FDW when foreign tables are present.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?mirror_max_age_hours}
\else
\set mirror_max_age_hours 168
\endif

BEGIN;

\ir pipeline_prod_mirror_helpers.sql

CREATE TEMP TABLE prod_mirror_validate_params (
    mirror_max_age_hours numeric
) ON COMMIT DROP;

INSERT INTO prod_mirror_validate_params (mirror_max_age_hours)
VALUES (NULLIF(btrim(:'mirror_max_age_hours'), '')::numeric);

CREATE TEMP TABLE prod_mirror_validation_manifest (
    table_name text PRIMARY KEY,
    required_for_f2 boolean NOT NULL DEFAULT false,
    strongly_recommended boolean NOT NULL DEFAULT false,
    expect_external_id boolean NOT NULL DEFAULT false,
    expect_manual_override boolean NOT NULL DEFAULT false,
    expect_is_verified boolean NOT NULL DEFAULT false,
    expect_verification_status boolean NOT NULL DEFAULT false,
    expect_deleted_at boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO prod_mirror_validation_manifest VALUES
    ('core_places', true, true, true, false, true, true, true),
    ('core_streets', true, true, true, true, true, true, true),
    ('core_map_buildings', true, true, true, false, true, true, true),
    ('core_admin_areas', false, true, true, false, true, true, true),
    ('core_map_landuse', false, true, true, true, true, true, true),
    ('core_map_water_lines', false, true, true, false, true, true, true),
    ('core_map_water_polygons', false, true, true, false, true, true, true),
    ('core_addresses', false, true, false, true, true, true, true),
    ('core_place_names', false, true, false, false, false, false, false),
    ('core_street_names', false, true, false, false, false, false, false),
    ('core_admin_area_names', false, true, false, false, false, false, false);

CREATE TEMP TABLE prod_mirror_validation_report (
    section text,
    table_name text,
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;

DO $validate$
DECLARE
    t record;
    v_count bigint;
    v_live bigint;
    v_dup_groups bigint;
    v_active bigint;
    v_deleted bigint;
    v_has boolean;
    v_age_hours numeric;
    v_max_age numeric;
    v_meta prod_mirror.mirror_meta%ROWTYPE;
BEGIN
    SELECT mirror_max_age_hours INTO v_max_age FROM prod_mirror_validate_params LIMIT 1;
    IF to_regnamespace('prod_mirror') IS NULL THEN
        INSERT INTO prod_mirror_validation_report
        VALUES ('schema', 'prod_mirror', 'exists', 0, 'FAIL', 'Schema missing.');
        RAISE EXCEPTION 'prod_mirror schema missing';
    END IF;

    IF to_regclass('prod_mirror.mirror_meta') IS NULL THEN
        INSERT INTO prod_mirror_validation_report
        VALUES ('meta', 'mirror_meta', 'exists', 0, 'FAIL', 'mirror_meta missing; refresh with slim 03.');
        RAISE EXCEPTION 'prod_mirror.mirror_meta missing';
    END IF;

    SELECT * INTO v_meta FROM prod_mirror.mirror_meta WHERE id = 1;
    IF NOT FOUND THEN
        INSERT INTO prod_mirror_validation_report
        VALUES ('meta', 'mirror_meta', 'row', 0, 'FAIL', 'No refresh metadata row.');
        RAISE EXCEPTION 'prod_mirror.mirror_meta has no row';
    END IF;

    v_age_hours := extract(epoch FROM (now() - v_meta.refreshed_at)) / 3600.0;
    INSERT INTO prod_mirror_validation_report
    VALUES (
        'meta', 'mirror_meta', 'age_hours', round(v_age_hours)::bigint,
        CASE WHEN v_max_age IS NOT NULL AND v_age_hours > v_max_age THEN 'FAIL' ELSE 'PASS' END,
        format(
            'refreshed_at=%s project_ref=%s host=%s mode=%s max_age_hours=%s',
            v_meta.refreshed_at,
            coalesce(v_meta.source_project_ref, ''),
            coalesce(v_meta.source_host, ''),
            v_meta.refresh_mode,
            coalesce(v_max_age::text, 'unlimited')
        )
    );

    IF v_max_age IS NOT NULL AND v_age_hours > v_max_age THEN
        RAISE EXCEPTION
            'prod_mirror is stale: age %.1f hours exceeds max %s hours (refreshed_at=%)',
            v_age_hours, v_max_age, v_meta.refreshed_at;
    END IF;

    FOR t IN SELECT * FROM prod_mirror_validation_manifest ORDER BY table_name LOOP
        IF to_regclass(format('prod_mirror.%I', t.table_name)) IS NULL THEN
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'table', t.table_name, 'exists', 0,
                CASE WHEN t.required_for_f2 THEN 'FAIL' ELSE 'WARN' END,
                CASE
                    WHEN t.required_for_f2 THEN 'Required F2 mirror table missing.'
                    ELSE 'Recommended/optional mirror table missing.'
                END
            );
            CONTINUE;
        END IF;

        EXECUTE format('SELECT count(*)::bigint FROM prod_mirror.%I', t.table_name) INTO v_count;
        INSERT INTO prod_mirror_validation_report
        VALUES (
            'table', t.table_name, 'mirror_rows', v_count,
            CASE WHEN v_count = 0 THEN 'WARN' ELSE 'PASS' END,
            CASE WHEN v_count = 0 THEN 'Zero rows.' ELSE 'Mirror table present.' END
        );

        -- Live FDW reconcile when foreign table still exists.
        IF to_regclass(format('supabase_fdw.%I', t.table_name)) IS NOT NULL THEN
            EXECUTE format('SELECT count(*)::bigint FROM supabase_fdw.%I', t.table_name) INTO v_live;
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'reconcile', t.table_name, 'live_minus_mirror', (v_live - v_count),
                CASE WHEN v_live = v_count THEN 'PASS' ELSE 'FAIL' END,
                format('live=%s mirror=%s', v_live, v_count)
            );
            IF v_live IS DISTINCT FROM v_count AND t.required_for_f2 THEN
                RAISE EXCEPTION
                    'mirror/live count mismatch for %: live=%s mirror=%s',
                    t.table_name, v_live, v_count;
            END IF;
        END IF;

        -- Protection / lifecycle columns.
        IF t.expect_manual_override THEN
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
                  AND column_name = 'manual_override'
            ) INTO v_has;
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'columns', t.table_name, 'manual_override', CASE WHEN v_has THEN 1 ELSE 0 END,
                CASE WHEN v_has THEN 'PASS' ELSE 'FAIL' END,
                CASE WHEN v_has THEN 'present' ELSE 'missing' END
            );
        END IF;

        IF t.expect_is_verified THEN
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
                  AND column_name = 'is_verified'
            ) INTO v_has;
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'columns', t.table_name, 'is_verified', CASE WHEN v_has THEN 1 ELSE 0 END,
                CASE WHEN v_has THEN 'PASS' ELSE 'FAIL' END,
                CASE WHEN v_has THEN 'present' ELSE 'missing' END
            );
        END IF;

        IF t.expect_verification_status THEN
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
                  AND column_name = 'verification_status'
            ) INTO v_has;
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'columns', t.table_name, 'verification_status', CASE WHEN v_has THEN 1 ELSE 0 END,
                CASE WHEN v_has THEN 'PASS' ELSE 'FAIL' END,
                CASE WHEN v_has THEN 'present' ELSE 'missing' END
            );
        END IF;

        IF t.expect_deleted_at THEN
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
                  AND column_name = 'deleted_at'
            ) INTO v_has;
            INSERT INTO prod_mirror_validation_report
            VALUES (
                'columns', t.table_name, 'deleted_at', CASE WHEN v_has THEN 1 ELSE 0 END,
                CASE WHEN v_has THEN 'PASS' ELSE 'FAIL' END,
                CASE WHEN v_has THEN 'present' ELSE 'missing' END
            );
            IF v_has THEN
                EXECUTE format(
                    $q$
                    SELECT
                        count(*) FILTER (WHERE deleted_at IS NULL)::bigint,
                        count(*) FILTER (WHERE deleted_at IS NOT NULL)::bigint
                    FROM prod_mirror.%I
                    $q$,
                    t.table_name
                ) INTO v_active, v_deleted;
                INSERT INTO prod_mirror_validation_report
                VALUES ('soft_delete', t.table_name, 'active_rows', v_active, 'PASS', 'deleted_at IS NULL');
                INSERT INTO prod_mirror_validation_report
                VALUES (
                    'soft_delete', t.table_name, 'deleted_rows', v_deleted, 'PASS',
                    'Included in mirror for soft-delete detection (current policy).'
                );
            END IF;
        END IF;

        -- Duplicate external_id report (non-null only).
        IF t.expect_external_id THEN
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
                  AND column_name = 'external_id'
            ) INTO v_has;
            IF v_has THEN
                EXECUTE format(
                    $q$
                    SELECT count(*)::bigint
                    FROM (
                        SELECT external_id
                        FROM prod_mirror.%I
                        WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
                        GROUP BY external_id
                        HAVING count(*) > 1
                    ) AS d
                    $q$,
                    t.table_name
                ) INTO v_dup_groups;
                INSERT INTO prod_mirror_validation_report
                VALUES (
                    'duplicates', t.table_name, 'duplicate_external_id_groups', v_dup_groups,
                    CASE WHEN v_dup_groups = 0 THEN 'PASS' ELSE 'WARN' END,
                    CASE
                        WHEN v_dup_groups = 0 THEN 'No duplicate external_id groups.'
                        ELSE 'Duplicate external_id groups present; F2 must stay identity-aware.'
                    END
                );
            ELSE
                INSERT INTO prod_mirror_validation_report
                VALUES (
                    'duplicates', t.table_name, 'external_id', 0, 'FAIL', 'external_id column missing.'
                );
            END IF;
        END IF;

        -- core_id / computed hashes
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'prod_mirror' AND table_name = t.table_name
              AND column_name = 'core_id'
        ) INTO v_has;
        INSERT INTO prod_mirror_validation_report
        VALUES (
            'columns', t.table_name, 'core_id', CASE WHEN v_has THEN 1 ELSE 0 END,
            CASE WHEN v_has THEN 'PASS' ELSE 'WARN' END,
            CASE WHEN v_has THEN 'present' ELSE 'missing (re-run slim refresh)' END
        );
    END LOOP;
END
$validate$;

SELECT
    'prod_mirror_validation' AS section,
    section AS check_section,
    table_name,
    metric,
    value_n,
    status,
    note
FROM prod_mirror_validation_report
ORDER BY
    CASE status WHEN 'FAIL' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
    section,
    table_name,
    metric;

-- Duplicate external_id samples for primary OSM families (top 20 each).
SELECT 'dup_sample' AS section, 'core_streets' AS table_name, external_id, count(*)::bigint AS cnt
FROM prod_mirror.core_streets
WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
GROUP BY external_id
HAVING count(*) > 1
ORDER BY cnt DESC, external_id
LIMIT 20;

SELECT 'dup_sample' AS section, 'core_places' AS table_name, external_id, count(*)::bigint AS cnt
FROM prod_mirror.core_places
WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
GROUP BY external_id
HAVING count(*) > 1
ORDER BY cnt DESC, external_id
LIMIT 20;

SELECT 'dup_sample' AS section, 'core_map_buildings' AS table_name, external_id, count(*)::bigint AS cnt
FROM prod_mirror.core_map_buildings
WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
GROUP BY external_id
HAVING count(*) > 1
ORDER BY cnt DESC, external_id
LIMIT 20;

SELECT
    'prod_mirror_validation_summary' AS section,
    count(*) FILTER (WHERE status = 'FAIL') AS fail_count,
    count(*) FILTER (WHERE status = 'WARN') AS warn_count,
    count(*) FILTER (WHERE status = 'PASS') AS pass_count,
    CASE
        WHEN count(*) FILTER (WHERE status = 'FAIL') > 0 THEN 'FAIL'
        WHEN count(*) FILTER (WHERE status = 'WARN') > 0 THEN 'WARN'
        ELSE 'PASS'
    END AS status
FROM prod_mirror_validation_report;

DO $raise_fail$
BEGIN
    IF EXISTS (SELECT 1 FROM prod_mirror_validation_report WHERE status = 'FAIL') THEN
        RAISE EXCEPTION 'prod_mirror validation failed; see prod_mirror_validation report';
    END IF;
END
$raise_fail$;

COMMIT;
