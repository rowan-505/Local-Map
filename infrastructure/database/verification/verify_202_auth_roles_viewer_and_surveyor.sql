-- Expected codes after 110 + 200 + 202.
SELECT code, name, is_system
FROM app_auth.auth_roles
WHERE code IN ('user', 'viewer', 'surveyor', 'admin', 'super_admin', 'editor')
ORDER BY code;
