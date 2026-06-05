-- =============================================================================
-- Local pipeline ENTITY_FAMILIES helpers (system schema)
--
-- Replaces session-local temp tables used by tools/data-pipeline/local-osm/
-- pipeline_entity_families.sql. Each pipeline stage runs in its own psql session
-- with autocommit ON; temp tables declared ON COMMIT DROP vanish immediately.
--
-- Apply:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/006_pipeline_entity_families_functions.sql
-- =============================================================================

\ir ../../../../tools/data-pipeline/local-osm/pipeline_entity_families_functions.sql
