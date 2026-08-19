-- Production PostGIS is installed in public, not extensions. Migration 178's
-- validation exposed unqualified PostGIS calls in the existing tile functions.
-- public has no CREATE privilege for PUBLIC, anon, or authenticated, so it is a
-- trusted resolution schema in this project. Keep it fixed (never caller-mutable).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $block$
DECLARE
  target_schemas constant text[] := ARRAY[
    'core', 'search', 'tiles', 'system', 'import_review', 'transport', 'routing'
  ];
  fn record;
  actual_count integer;
  public_is_writable boolean;
BEGIN
  SELECT
    coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'CREATE'), false)
      OR has_schema_privilege('anon', n.oid, 'CREATE')
      OR has_schema_privilege('authenticated', n.oid, 'CREATE')
  INTO public_is_writable
  FROM pg_namespace n
  LEFT JOIN LATERAL
    aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl ON true
  WHERE n.nspname = 'public'
  GROUP BY n.oid;

  IF coalesce(public_is_writable, true) THEN
    RAISE EXCEPTION '179 refused: public schema is missing or writable by a public client role';
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = ANY(target_schemas)
    AND p.prokind IN ('f', 'p');

  IF actual_count <> 85 THEN
    RAISE EXCEPTION
      '179 refused: application function set changed (expected 85, actual %)',
      actual_count;
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
        'ALTER PROCEDURE %s SET search_path TO pg_catalog, public, extensions, core, ref, system, import_review, search, transport, routing, tiles, app_auth',
        fn.oid::regprocedure
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions, core, ref, system, import_review, search, transport, routing, tiles, app_auth',
        fn.oid::regprocedure
      );
    END IF;
  END LOOP;
END
$block$;

COMMIT;
