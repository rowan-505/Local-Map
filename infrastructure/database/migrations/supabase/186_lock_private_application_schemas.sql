-- CoreMap application data is private to the Fastify/Postgres service boundary.
-- Supabase client roles must not access these schemas or invoke their routines.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

REVOKE ALL ON SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  FROM PUBLIC, anon, authenticated;

-- Keep future objects private when created by the migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_auth, core, search, tiles, system, import_review, transport, routing
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;
