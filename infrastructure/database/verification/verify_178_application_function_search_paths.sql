-- Migration 178 verification. Read-only.

SELECT
  n.nspname AS schema_name,
  count(*) FILTER (WHERE p.prokind IN ('f', 'p')) AS function_count,
  count(*) FILTER (
    WHERE p.prokind IN ('f', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
        WHERE setting LIKE 'search_path=%'
      )
  ) AS mutable_search_path_count,
  count(*) FILTER (WHERE p.prosecdef) AS security_definer_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN (
  'core', 'search', 'tiles', 'system', 'import_review', 'transport', 'routing'
)
GROUP BY n.nspname
ORDER BY n.nspname;

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  array_to_string(p.proconfig, ', ') AS configuration
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN (
  'core', 'search', 'tiles', 'system', 'import_review', 'transport', 'routing'
)
  AND p.prokind IN ('f', 'p')
ORDER BY n.nspname, p.proname, p.oid;
