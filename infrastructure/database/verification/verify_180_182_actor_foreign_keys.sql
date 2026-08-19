-- Migrations 180-182 verification. Read-only.

SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  a.attname AS actor_column,
  c.conname AS constraint_name,
  c.convalidated,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a
  ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND c.confrelid = 'app_auth.auth_users'::regclass
  AND a.attname IN ('verified_by', 'created_by', 'updated_by', 'approved_by', 'assigned_to')
ORDER BY n.nspname, t.relname, a.attname;
