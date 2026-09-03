-- Expect zero rows: role `editor` must be gone after 200.
SELECT code, name
FROM app_auth.auth_roles
WHERE code = 'editor';
