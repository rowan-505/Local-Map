-- RETIRED (local Mode B cleanup).
-- This diagnostic required local core.core_admin_areas + core.find_admin_area_*.
-- Local labs no longer keep a core schema.
--
-- Use instead:
--   reports/myanmar_national_admin_assignment_report.sql (prod_mirror)
--   Stage 08c / pipeline_prod_admin_assign.sql
\set ON_ERROR_STOP on

DO $retired$
BEGIN
    RAISE EXCEPTION
        'yangon_admin_assignment_report.sql is retired (local core removed). Use myanmar_national_admin_assignment_report.sql / Stage 08c prod_mirror helpers.';
END
$retired$;
