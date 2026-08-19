-- Phase 5 read-only production audit: duplicated state-of-truth fields.
-- Safe to run with psql. This file performs SELECT statements only.

SET statement_timeout = '90s';
SET lock_timeout = '5s';

-- Column shape, defaults and comments.
SELECT
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position) AS comment
FROM information_schema.columns AS c
WHERE c.table_schema = 'core'
  AND c.column_name IN (
    'is_oneway', 'travel_direction',
    'is_verified', 'verification_status', 'verified_at', 'verified_by', 'verification_note',
    'edit_status', 'routing_status'
  )
ORDER BY c.table_name, c.ordinal_position;

-- Street direction/lifecycle distributions and compatibility mismatches.
SELECT
  travel_direction,
  is_oneway,
  edit_status,
  routing_status,
  count(*)::bigint AS row_count
FROM core.core_streets
GROUP BY travel_direction, is_oneway, edit_status, routing_status
ORDER BY row_count DESC, travel_direction NULLS FIRST, is_oneway;

SELECT
  count(*)::bigint AS total_rows,
  count(*) FILTER (WHERE travel_direction IS NULL)::bigint AS direction_null,
  count(*) FILTER (WHERE travel_direction = 'both')::bigint AS direction_both,
  count(*) FILTER (WHERE travel_direction = 'forward')::bigint AS direction_forward,
  count(*) FILTER (WHERE travel_direction = 'reverse')::bigint AS direction_reverse,
  count(*) FILTER (WHERE travel_direction = 'reversible')::bigint AS direction_reversible,
  count(*) FILTER (WHERE travel_direction = 'alternating')::bigint AS direction_alternating,
  count(*) FILTER (WHERE travel_direction = 'unknown')::bigint AS direction_unknown,
  count(*) FILTER (
    WHERE is_oneway IS DISTINCT FROM CASE
      WHEN travel_direction IN ('forward', 'reverse') THEN true
      WHEN travel_direction = 'both' THEN false
      ELSE false
    END
  )::bigint AS derived_oneway_mismatch
FROM core.core_streets;

-- Generate one verification distribution query per Core table that owns both
-- status and compatibility boolean. psql executes the generated SELECTs.
SELECT format(
  $sql$
  SELECT %L AS object,
    verification_status,
    is_verified,
    count(*)::bigint AS row_count,
    count(*) FILTER (WHERE verified_at IS NOT NULL)::bigint AS with_verified_at,
    count(*) FILTER (WHERE verified_by IS NOT NULL)::bigint AS with_verified_by,
    count(*) FILTER (WHERE nullif(btrim(verification_note), '') IS NOT NULL)::bigint AS with_verification_note
  FROM %I.%I
  GROUP BY verification_status, is_verified
  ORDER BY row_count DESC, verification_status NULLS FIRST, is_verified NULLS FIRST;
  $sql$,
  c.table_schema || '.' || c.table_name,
  c.table_schema,
  c.table_name
)
FROM information_schema.columns AS c
WHERE c.table_schema = 'core'
  AND c.column_name = 'verification_status'
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns AS b
    WHERE b.table_schema = c.table_schema
      AND b.table_name = c.table_name
      AND b.column_name = 'is_verified'
  )
ORDER BY c.table_name
\gexec

-- Summarize status/boolean disagreement without assuming every table has the
-- audit metadata columns.
SELECT format(
  $sql$
  SELECT %L AS object,
    count(*)::bigint AS total_rows,
    count(*) FILTER (
      WHERE is_verified IS DISTINCT FROM (verification_status = 'verified')
    )::bigint AS compatibility_mismatch
  FROM %I.%I;
  $sql$,
  c.table_schema || '.' || c.table_name,
  c.table_schema,
  c.table_name
)
FROM information_schema.columns AS c
WHERE c.table_schema = 'core'
  AND c.column_name = 'verification_status'
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns AS b
    WHERE b.table_schema = c.table_schema
      AND b.table_name = c.table_name
      AND b.column_name = 'is_verified'
  )
ORDER BY c.table_name
\gexec

-- Constraints and indexes that mention Phase 5 fields.
SELECT
  con.conrelid::regclass AS source_table,
  con.conname,
  con.contype,
  con.convalidated,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint AS con
WHERE con.connamespace = 'core'::regnamespace
  AND pg_get_constraintdef(con.oid) ~* '\m(is_oneway|travel_direction|is_verified|verification_status|verified_at|verified_by|verification_note|edit_status|routing_status)\M'
ORDER BY con.conrelid::regclass::text, con.conname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'core'
  AND indexdef ~* '\m(is_oneway|travel_direction|is_verified|verification_status|verified_at|verified_by|verification_note|edit_status|routing_status)\M'
ORDER BY tablename, indexname;

-- Stored SQL dependencies and triggers.
SELECT 'view' AS kind, schemaname AS schema_name, viewname AS object_name
FROM pg_views
WHERE definition ~* '\m(is_oneway|travel_direction|is_verified|verification_status|verified_at|verified_by|verification_note|edit_status|routing_status)\M'
UNION ALL
SELECT 'materialized view', schemaname, matviewname
FROM pg_matviews
WHERE definition ~* '\m(is_oneway|travel_direction|is_verified|verification_status|verified_at|verified_by|verification_note|edit_status|routing_status)\M'
UNION ALL
SELECT 'function', n.nspname,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prokind <> 'a'
  AND pg_get_functiondef(p.oid) ~* '\m(is_oneway|travel_direction|is_verified|verification_status|verified_at|verified_by|verification_note|edit_status|routing_status)\M'
ORDER BY kind, schema_name, object_name;

SELECT
  t.tgrelid::regclass AS source_table,
  t.tgname,
  p.oid::regprocedure AS trigger_function,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger AS t
JOIN pg_proc AS p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND t.tgrelid IN (
    SELECT format('%I.%I', c.table_schema, c.table_name)::regclass
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'core'
      AND c.column_name IN ('is_oneway', 'is_verified', 'edit_status', 'routing_status')
  )
ORDER BY t.tgrelid::regclass::text, t.tgname;

-- Low-selectivity estimates and physical widths.
SELECT schemaname, tablename, attname, null_frac, avg_width, n_distinct,
  most_common_vals, most_common_freqs
FROM pg_stats
WHERE schemaname = 'core'
  AND attname IN (
    'is_oneway', 'travel_direction', 'is_verified', 'verification_status',
    'edit_status', 'routing_status'
  )
ORDER BY tablename, attname;

-- Routing build/job state is the replacement for global build lifecycle.
SELECT 'routing.routing_build_jobs' AS object, status, count(*)::bigint AS row_count
FROM routing.routing_build_jobs
GROUP BY status
UNION ALL
SELECT 'routing.routing_builds', status, count(*)::bigint
FROM routing.routing_builds
GROUP BY status
ORDER BY object, status;
