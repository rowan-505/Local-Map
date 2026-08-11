-- =============================================================================
-- RETIRED (local Mode B cleanup)
--
-- Formerly created core.find_admin_area_* against local core.core_admin_areas.
-- Local labs no longer keep a core schema (avoids ID confusion with Supabase).
--
-- Use instead:
--   Stage 08c → pipeline_prod_admin_assign.sql (prod_mirror production IDs)
--
-- Do not \ir this file from the main local-osm runner.
-- =============================================================================

DO $retired$
BEGIN
    RAISE EXCEPTION
        'pipeline_township_assignment.sql is retired (local core schema removed). Use Stage 08c / pipeline_prod_admin_assign.sql (prod_mirror).';
END
$retired$;
