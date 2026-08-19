-- Expect zero rows. Direct Supabase client roles must not access private schemas.
WITH target_schemas(schema_name) AS (
  VALUES
    ('app_auth'), ('core'), ('search'), ('tiles'), ('system'),
    ('import_review'), ('transport'), ('routing')
),
target_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT r.role_name, s.schema_name, privilege
FROM target_roles r
CROSS JOIN target_schemas s
CROSS JOIN LATERAL (
  VALUES
    ('USAGE', has_schema_privilege(r.role_name, s.schema_name, 'USAGE')),
    ('CREATE', has_schema_privilege(r.role_name, s.schema_name, 'CREATE'))
) p(privilege, allowed)
WHERE p.allowed
ORDER BY r.role_name, s.schema_name, privilege;

-- Expect zero rows.
WITH target_schemas(schema_name) AS (
  VALUES
    ('app_auth'), ('core'), ('search'), ('tiles'), ('system'),
    ('import_review'), ('transport'), ('routing')
),
target_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT r.role_name, n.nspname, c.relname, p.privilege
FROM target_roles r
JOIN target_schemas s ON true
JOIN pg_namespace n ON n.nspname = s.schema_name
JOIN pg_class c ON c.relnamespace = n.oid
CROSS JOIN LATERAL (
  VALUES
    ('SELECT', has_table_privilege(r.role_name, c.oid, 'SELECT')),
    ('INSERT', has_table_privilege(r.role_name, c.oid, 'INSERT')),
    ('UPDATE', has_table_privilege(r.role_name, c.oid, 'UPDATE')),
    ('DELETE', has_table_privilege(r.role_name, c.oid, 'DELETE'))
) p(privilege, allowed)
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND p.allowed
ORDER BY r.role_name, n.nspname, c.relname, p.privilege;

-- Expect zero rows.
WITH target_schemas(schema_name) AS (
  VALUES
    ('app_auth'), ('core'), ('search'), ('tiles'), ('system'),
    ('import_review'), ('transport'), ('routing')
),
target_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT r.role_name, n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM target_roles r
JOIN target_schemas s ON true
JOIN pg_namespace n ON n.nspname = s.schema_name
JOIN pg_proc p ON p.pronamespace = n.oid
WHERE has_function_privilege(r.role_name, p.oid, 'EXECUTE')
ORDER BY r.role_name, n.nspname, p.proname, arguments;
