-- =============================================================================
-- Supabase migration 201: canonical transport schema name
-- =============================================================================
--
-- History (do not rewrite 066–079):
--   066–079 created and documented `core_transport` / `import_transport`.
--   Live production and API code since ~101 use `transport` as the SoT.
--   There is no tracked RENAME in 080–200. The live schema was aligned outside
--   that numbered CREATE, then later migrations targeted `transport.*`.
--
-- This file does NOT:
--   - move or rewrite existing `transport.*` tables/data
--   - bootstrap missing transport tables (out of scope)
--   - drop `core_transport` if both schemas somehow exist
--
-- This file DOES:
--   - rename `core_transport` → `transport` only when `transport` is absent
--     (fresh replay of 067–079 before any `transport` schema exists)
--   - create an empty `transport` schema if neither name exists
--   - stamp the canonical schema comment
--
-- A full empty-database replay of 066–101 still cannot recreate the current
-- live table set (import_batches, infrastructure_lines, …). That bootstrap is
-- a separate, confirmed piece of work. New migrations must use `transport.*`.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

DO $align$
DECLARE
    has_core_transport boolean;
    has_transport boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = 'core_transport'
    ) INTO has_core_transport;

    SELECT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = 'transport'
    ) INTO has_transport;

    IF has_core_transport AND NOT has_transport THEN
        EXECUTE 'ALTER SCHEMA core_transport RENAME TO transport';
    ELSIF NOT has_core_transport AND NOT has_transport THEN
        EXECUTE 'CREATE SCHEMA transport';
    END IF;
END
$align$;

COMMENT ON SCHEMA transport IS
    'Canonical production transport network. Historical migrations 066–079 used the name core_transport; that name is not current. API and new migrations must use transport.* only.';

COMMIT;
