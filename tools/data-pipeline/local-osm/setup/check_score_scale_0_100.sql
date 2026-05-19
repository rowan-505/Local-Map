-- Read-only validation: staging candidate confidence_score scale (0–100) and constraints.
-- Does not modify data or schema.

\pset pager off
\set ON_ERROR_STOP on

DO $$
DECLARE
  tbl text;
  fq text;
  min_v numeric;
  max_v numeric;
  avg_v numeric;
  bad_range bigint;
  suspicious_frac bigint;
  r record;
BEGIN
  RAISE NOTICE '=== confidence_score stats (staging *candidates*) ===';

  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'staging'
      AND c.column_name = 'confidence_score'
      AND c.table_name ~ '^staging_.*_candidates$'
    ORDER BY c.table_name
  LOOP
    fq := format('staging.%I', tbl);
    EXECUTE format(
      'SELECT min(confidence_score), max(confidence_score), avg(confidence_score), '
      || 'count(*) FILTER (WHERE confidence_score IS NOT NULL AND (confidence_score < 0 OR confidence_score > 100)), '
      || 'count(*) FILTER (WHERE confidence_score IS NOT NULL AND confidence_score > 0 AND confidence_score < 1) '
      || 'FROM staging.%I',
      tbl
    )
    INTO min_v, max_v, avg_v, bad_range, suspicious_frac;

    RAISE NOTICE '% | min=% max=% avg=% | rows_outside_0_100=% | rows_strict_(0,1)=%',
      fq, min_v, max_v, avg_v, bad_range, suspicious_frac;
  END LOOP;

  RAISE NOTICE '=== CHECK constraints mentioning confidence_score and literal 1 (possible legacy 0–1 cap) ===';

  FOR r IN
    SELECT n.nspname AS schema_name,
           rel.relname AS table_name,
           c.conname AS constraint_name,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%confidence_score%'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%<= (1)%'
        OR pg_get_constraintdef(c.oid) ILIKE '%<=(1)%'
      )
    ORDER BY n.nspname, rel.relname, c.conname
  LOOP
    RAISE NOTICE '%.% | % | %',
      r.schema_name, r.table_name, r.constraint_name, r.def;
  END LOOP;
END $$;
