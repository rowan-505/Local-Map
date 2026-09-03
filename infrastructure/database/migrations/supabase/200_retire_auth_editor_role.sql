-- =============================================================================
-- Supabase migration 200: retire app_auth role `editor`
-- =============================================================================
--
-- Dashboard write access is now admin / super_admin (viewer stays read-only).
-- Merge any remaining editor assignments onto admin, then drop the role.
-- Idempotent: safe if `editor` was never inserted or is already gone.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

INSERT INTO app_auth.auth_user_roles (user_id, role_id)
SELECT ur.user_id, admin_role.id
FROM app_auth.auth_user_roles ur
JOIN app_auth.auth_roles editor_role
    ON editor_role.id = ur.role_id
   AND editor_role.code = 'editor'
JOIN app_auth.auth_roles admin_role
    ON admin_role.code = 'admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

DELETE FROM app_auth.auth_user_roles ur
USING app_auth.auth_roles r
WHERE ur.role_id = r.id
  AND r.code = 'editor';

DELETE FROM app_auth.auth_roles
WHERE code = 'editor';

COMMIT;
