-- Remove only the unused structures proven safe by the Phase 8 audit.
--
-- Archived before removal:
--   transport.route_unification_plan
--   SHA-256: cb58757e8eb7789c16a706625fe2c41ce12bdc888470609618dbcf4642589e03
--
-- search.search_names and search.search_addresses are empty migration-023
-- placeholders superseded by search.search_documents/search_document_names and
-- search.address_index respectively. No CASCADE is used: any new dependency must
-- make this migration fail.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $block$
DECLARE
  actual_count bigint;
  dependency_count bigint;
  referenced_in_function_count bigint;
BEGIN
  IF to_regclass('search.search_names') IS NULL
     OR to_regclass('search.search_addresses') IS NULL
     OR to_regclass('transport.route_unification_plan') IS NULL THEN
    RAISE EXCEPTION '177 refused: one or more audited removal targets are missing';
  END IF;

  IF to_regclass('search.search_documents') IS NULL
     OR to_regclass('search.search_document_names') IS NULL
     OR to_regclass('search.address_index') IS NULL THEN
    RAISE EXCEPTION '177 refused: a retained search source-of-truth table is missing';
  END IF;

  SELECT count(*) INTO actual_count FROM search.search_names;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '177 refused: search.search_names is no longer empty (% rows)', actual_count;
  END IF;

  SELECT count(*) INTO actual_count FROM search.search_addresses;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '177 refused: search.search_addresses is no longer empty (% rows)', actual_count;
  END IF;

  SELECT count(*) INTO actual_count FROM transport.route_unification_plan;
  IF actual_count <> 98 THEN
    RAISE EXCEPTION '177 refused: route_unification_plan changed after archive (expected 98, actual %)', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM transport.route_unification_plan
  WHERE applied_at IS NULL;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION '177 refused: route_unification_plan contains % unapplied rows', actual_count;
  END IF;

  WITH targets AS (
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname = 'search' AND c.relname IN ('search_names', 'search_addresses'))
       OR (n.nspname = 'transport' AND c.relname = 'route_unification_plan')
  )
  SELECT count(*) INTO dependency_count
  FROM targets t
  JOIN pg_constraint fk ON fk.confrelid = t.oid AND fk.contype = 'f'
  WHERE fk.conrelid <> t.oid;
  IF dependency_count <> 0 THEN
    RAISE EXCEPTION '177 refused: % inbound foreign keys found', dependency_count;
  END IF;

  WITH targets AS (
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname = 'search' AND c.relname IN ('search_names', 'search_addresses'))
       OR (n.nspname = 'transport' AND c.relname = 'route_unification_plan')
  )
  SELECT count(*) INTO dependency_count
  FROM targets t
  JOIN pg_depend d ON d.refobjid = t.oid
  JOIN pg_rewrite rw ON d.classid = 'pg_rewrite'::regclass AND rw.oid = d.objid
  WHERE rw.ev_class <> t.oid;
  IF dependency_count <> 0 THEN
    RAISE EXCEPTION '177 refused: % dependent view rules found', dependency_count;
  END IF;

  SELECT count(*) INTO referenced_in_function_count
  FROM pg_proc p
  WHERE p.prokind IN ('f', 'p')
    AND (
      pg_get_functiondef(p.oid) ILIKE '%search.search_names%'
      OR pg_get_functiondef(p.oid) ILIKE '%search.search_addresses%'
      OR pg_get_functiondef(p.oid) ILIKE '%transport.route_unification_plan%'
    );
  IF referenced_in_function_count <> 0 THEN
    RAISE EXCEPTION '177 refused: % function bodies reference removal targets', referenced_in_function_count;
  END IF;
END
$block$;

DROP TABLE search.search_names;
DROP TABLE search.search_addresses;
DROP TABLE transport.route_unification_plan;

COMMIT;
