-- Emergency rollback for migration 152 only.
--
-- This is not a normal operational migration and must never be included in the
-- forward migration sequence. It recreates an EMPTY import_work schema solely
-- by replaying the original historical DDL, which remains immutable.
--
-- It does not restore deleted entity rows or the five retired batch headers.
-- Those headers remain archived under legacy_import_work_batch in existing
-- system.system_publish_batches summaries.
--
-- Run from psql so \ir resolves paths relative to this file:
--   psql "$DATABASE_URL" \
--     -f infrastructure/database/verification/rollback_remove_import_work_schema.sql

\set ON_ERROR_STOP on

\ir ../migrations/supabase/136_import_work_places_pilot.sql
\ir ../migrations/supabase/141_import_work_buildings.sql
\ir ../migrations/supabase/142_import_work_landuse_water.sql
\ir ../migrations/supabase/143_import_work_routing_barriers.sql
\ir ../migrations/supabase/144_import_work_roads.sql
