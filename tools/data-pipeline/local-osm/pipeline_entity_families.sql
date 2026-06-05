-- =============================================================================
-- pipeline_entity_families.sql
-- Shared ENTITY_FAMILIES filter for local-osm SQL stages.
--
-- psql variable:
--   entity_families  optional; default "all". Examples:
--     all | * | (empty)  → process every configured family
--     admin_areas        → single family
--     admin_areas,roads  → comma-separated subset
--
-- After include, use session wrappers (delegate to stable system.* helpers):
--   pg_temp.pipeline_entity_family_enabled('roads')  → boolean
--   pg_temp.pipeline_entity_families_is_all()        → boolean
-- =============================================================================

\if :{?entity_families}
\else
\set entity_families 'all'
\endif

\ir pipeline_entity_families_functions.sql

CREATE TEMP TABLE IF NOT EXISTS _pipeline_entity_families_ctx (
    entity_families text NOT NULL
);

TRUNCATE _pipeline_entity_families_ctx;

INSERT INTO _pipeline_entity_families_ctx (entity_families)
SELECT system.pipeline_validate_entity_families(
    coalesce(nullif(btrim(:'entity_families'), ''), 'all')
);

DO $pipeline_entity_families_wrappers$
DECLARE
    v_ef text;
BEGIN
    SELECT c.entity_families INTO v_ef FROM _pipeline_entity_families_ctx AS c LIMIT 1;

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_entity_families_is_all()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_entity_families_is_all(%L);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_entity_family_enabled(p_family text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_family_enabled(%L, p_family);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_entity_family_enabled_any(p_families text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_family_enabled_any(%L, p_families);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_stage11_family_enabled(p_family text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_stage11_family_enabled(%L, p_family);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_stage05_extraction_enabled(p_stage05_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_stage05_extraction_enabled(%L, p_stage05_key);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_stage05_extraction_any_enabled(p_stage05_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_stage05_extraction_any_enabled(%L, p_stage05_keys);
$fn$;
$fmt$, v_ef);

    EXECUTE format($fmt$
CREATE OR REPLACE FUNCTION pg_temp.pipeline_stage15_manifest_enabled(p_manifest_family text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
    SELECT system.pipeline_stage15_manifest_enabled(%L, p_manifest_family);
$fn$;
$fmt$, v_ef);
END;
$pipeline_entity_families_wrappers$;

SELECT
    'pipeline_entity_families' AS section,
    ctx.entity_families AS raw_filter,
    system.pipeline_entity_families_is_all(ctx.entity_families) AS filter_all,
    CASE
        WHEN system.pipeline_entity_families_is_all(ctx.entity_families) THEN
            system.pipeline_entity_family_registry()
        ELSE
            system.pipeline_selected_entity_families(ctx.entity_families)
    END AS selected_families
FROM _pipeline_entity_families_ctx AS ctx;
