-- Isolate the large core_streets validation from other actor FK work.
-- VALIDATE reads existing rows but does not update or rewrite them.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $block$
DECLARE
  orphan_count bigint;
BEGIN
  IF to_regclass('app_auth.auth_users') IS NULL
     OR to_regclass('core.core_streets') IS NULL THEN
    RAISE EXCEPTION '181 refused: required table is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'core.core_streets'::regclass
      AND c.contype = 'f'
      AND a.attname = 'verified_by'
  ) THEN
    RAISE EXCEPTION '181 refused: core.core_streets.verified_by already has a foreign key';
  END IF;

  SELECT count(*) INTO orphan_count
  FROM core.core_streets s
  WHERE s.verified_by IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app_auth.auth_users u WHERE u.id = s.verified_by
    );

  IF orphan_count <> 0 THEN
    RAISE EXCEPTION '181 refused: core.core_streets.verified_by has % orphan values', orphan_count;
  END IF;

  ALTER TABLE core.core_streets
    ADD CONSTRAINT core_streets_verified_by_auth_users_fk
    FOREIGN KEY (verified_by)
    REFERENCES app_auth.auth_users(id)
    ON DELETE SET NULL
    NOT VALID;

  ALTER TABLE core.core_streets
    VALIDATE CONSTRAINT core_streets_verified_by_auth_users_fk;
END
$block$;

COMMIT;
