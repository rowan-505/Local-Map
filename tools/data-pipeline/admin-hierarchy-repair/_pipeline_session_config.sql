-- Apply pipeline GUCs from psql variables (set by run_admin_hierarchy_repair.sh -v flags).
-- Inline normalize so stage 01 works before stage 03 functions exist.

\ir _psql_session_defaults.sql

SELECT set_config(
    'coremap.dry_run',
    CASE
        WHEN lower(trim(coalesce(nullif(trim(:'dry_run'), ''), 'false'))) IN (
            'true', 't', '1', 'yes', 'on'
        ) THEN 'true'
        ELSE 'false'
    END,
    false
);

SELECT set_config(
    'coremap.force_recalculate_verified',
    CASE
        WHEN lower(trim(coalesce(nullif(trim(:'force_recalculate_verified'), ''), 'false'))) IN (
            'true', 't', '1', 'yes', 'on'
        ) THEN 'true'
        ELSE 'false'
    END,
    false
);

SELECT set_config(
    'coremap.force_manual_override',
    CASE
        WHEN lower(trim(coalesce(nullif(trim(:'force_manual_override'), ''), 'false'))) IN (
            'true', 't', '1', 'yes', 'on'
        ) THEN 'true'
        ELSE 'false'
    END,
    false
);

SELECT set_config(
    'coremap.limit_rows',
    coalesce(nullif(trim(:'limit_rows'), ''), '1000'),
    false
);

SELECT set_config(
    'coremap.last_id',
    coalesce(nullif(trim(:'last_id'), ''), '0'),
    false
);

SELECT set_config(
    'coremap.write_admin_repair_metadata',
    CASE
        WHEN lower(trim(coalesce(nullif(trim(:'write_admin_repair_metadata'), ''), 'false'))) IN (
            'true', 't', '1', 'yes', 'on'
        ) THEN 'true'
        ELSE 'false'
    END,
    false
);

\echo ''
\echo '=== Pipeline session flags (resolved) ==='

SELECT
    current_setting('coremap.dry_run', true) AS coremap_dry_run,
    current_setting('coremap.force_recalculate_verified', true) AS coremap_force_recalculate_verified,
    current_setting('coremap.force_manual_override', true) AS coremap_force_manual_override,
    current_setting('coremap.limit_rows', true) AS coremap_limit_rows,
    current_setting('coremap.write_admin_repair_metadata', true) AS coremap_write_admin_repair_metadata,
    lower(trim(coalesce(current_setting('coremap.dry_run', true), 'false'))) IN (
        'true', 't', '1', 'yes', 'on'
    ) AS dry_run_active,
    lower(trim(coalesce(current_setting('coremap.force_recalculate_verified', true), 'false'))) IN (
        'true', 't', '1', 'yes', 'on'
    ) AS force_recalculate_verified_active,
    lower(trim(coalesce(current_setting('coremap.force_manual_override', true), 'false'))) IN (
        'true', 't', '1', 'yes', 'on'
    ) AS force_manual_override_active,
    lower(trim(coalesce(current_setting('coremap.write_admin_repair_metadata', true), 'false'))) IN (
        'true', 't', '1', 'yes', 'on'
    ) AS write_admin_repair_metadata_active;
