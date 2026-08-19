-- Pin application-defined functions to trusted schemas.
-- PostGIS/extension-owned functions are intentionally out of scope.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $block$
DECLARE
  target_schemas constant text[] := ARRAY[
    'core', 'search', 'tiles', 'system', 'import_review', 'transport', 'routing'
  ];
  trusted_schemas constant text[] := ARRAY[
    'extensions', 'core', 'ref', 'system', 'import_review',
    'search', 'transport', 'routing', 'tiles', 'app_auth'
  ];
  fn record;
  actual_count integer;
  unsafe_schema text;
BEGIN
  SELECT count(*) INTO actual_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ANY(target_schemas)
    AND p.prokind IN ('f', 'p');

  IF actual_count <> 85 THEN
    RAISE EXCEPTION
      '178 refused: application function set changed (expected 85, actual %)',
      actual_count;
  END IF;

  SELECT n.nspname INTO unsafe_schema
  FROM pg_namespace n
  LEFT JOIN LATERAL
    aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl ON true
  WHERE n.nspname = ANY(trusted_schemas)
  GROUP BY n.oid, n.nspname
  HAVING bool_or(acl.grantee = 0 AND acl.privilege_type = 'CREATE')
     OR has_schema_privilege('anon', n.oid, 'CREATE')
     OR has_schema_privilege('authenticated', n.oid, 'CREATE')
  LIMIT 1;

  IF unsafe_schema IS NOT NULL THEN
    RAISE EXCEPTION
      '178 refused: trusted search_path schema % is writable by a public client role',
      unsafe_schema;
  END IF;

  FOR fn IN
    SELECT p.oid, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ANY(target_schemas)
      AND p.prokind IN ('f', 'p')
    ORDER BY n.nspname, p.proname, p.oid
  LOOP
    IF fn.prokind = 'p' THEN
      EXECUTE format(
        'ALTER PROCEDURE %s SET search_path TO pg_catalog, extensions, core, ref, system, import_review, search, transport, routing, tiles, app_auth',
        fn.oid::regprocedure
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path TO pg_catalog, extensions, core, ref, system, import_review, search, transport, routing, tiles, app_auth',
        fn.oid::regprocedure
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO actual_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ANY(target_schemas)
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
      WHERE setting LIKE 'search_path=%'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION '178 failed: % application functions remain mutable', actual_count;
  END IF;
END
$block$;

COMMIT;
