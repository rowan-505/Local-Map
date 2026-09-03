-- =============================================================================
-- Supabase migration 202: seed viewer + surveyor roles
-- =============================================================================
--
-- 110 seeds user / admin / super_admin only.
-- Current API dashboard allowlists also need `viewer` (read-only dashboard).
-- `surveyor` is the field-app role: existing Fastify auth, no dashboard access,
-- no canonical transport writes. Field-specific endpoints come in a later phase.
--
-- 200 already retires `editor` (dashboard writes are admin / super_admin).
-- Idempotent: ON CONFLICT (code) DO NOTHING.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

INSERT INTO app_auth.auth_roles (code, name, description, is_system)
VALUES
    (
        'viewer',
        'Viewer',
        'Read-only dashboard access. Cannot modify canonical data.',
        true
    ),
    (
        'surveyor',
        'Surveyor',
        'Field surveyor. Authenticates through app_auth. No dashboard access. '
        'No canonical transport writes. Use field-specific API endpoints only.',
        true
    )
ON CONFLICT (code) DO NOTHING;

COMMIT;
