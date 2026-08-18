\set ON_ERROR_STOP on
\pset pager off

-- One-time sparse normalization. This file must run in one direct psql session:
-- TEMP state persists, while every generated batch SELECT autocommits separately.

SET statement_timeout = '5min';
SET lock_timeout = '15s';

DO $$
BEGIN
  IF current_setting('default_transaction_read_only')::boolean THEN
    RAISE EXCEPTION 'street routing cleanup refused: database is read-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'core'
      AND table_name = 'core_streets'
      AND column_name = 'travel_direction'
      AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'core'
      AND table_name = 'core_streets'
      AND column_name = 'access_rules'
      AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'street routing cleanup refused: migration 162 is not applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'core.core_streets'::regclass
      AND conname = 'core_streets_travel_direction_chk'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'street routing cleanup refused: direction CHECK is missing or unvalidated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'core.core_streets'::regclass
      AND t.tgname = 'core_streets_version_before_update'
      AND t.tgenabled <> 'D'
      AND pg_get_functiondef(p.oid) LIKE '%local_map.skip_street_version%'
  ) THEN
    RAISE EXCEPTION 'street routing cleanup refused: supported street-version bypass is unavailable';
  END IF;
END $$;

CREATE TEMP TABLE _core_street_routing_baseline ON COMMIT PRESERVE ROWS AS
SELECT
  clock_timestamp() AS captured_at,
  (SELECT count(*)::bigint FROM core.core_streets) AS street_total,
  (SELECT count(*)::bigint FROM core.core_streets WHERE deleted_at IS NULL AND is_active) AS active_streets,
  (SELECT count(*)::bigint FROM core.core_street_versions) AS street_version_rows,
  (SELECT count(*)::bigint FROM core.core_streets WHERE NOT ST_IsValid(geom)) AS invalid_geometry_rows,
  pg_relation_size('core.core_streets'::regclass)::bigint AS table_bytes,
  pg_indexes_size('core.core_streets'::regclass)::bigint AS index_bytes,
  pg_total_relation_size('core.core_streets'::regclass)::bigint AS total_bytes,
  pg_database_size(current_database())::bigint AS database_bytes,
  (SELECT coalesce(sum(size), 0)::bigint FROM pg_ls_waldir()) AS wal_directory_bytes,
  pg_current_wal_lsn() AS start_lsn;

SELECT jsonb_build_object(
  'event', 'baseline',
  'captured_at', captured_at,
  'street_total', street_total,
  'active_streets', active_streets,
  'street_version_rows', street_version_rows,
  'invalid_geometry_rows', invalid_geometry_rows,
  'table_bytes', table_bytes,
  'index_bytes', index_bytes,
  'total_bytes', total_bytes,
  'database_bytes', database_bytes,
  'wal_directory_bytes', wal_directory_bytes,
  'start_lsn', start_lsn::text
) AS baseline
FROM _core_street_routing_baseline;

CREATE TEMP TABLE _core_street_routing_candidates (
  id bigint PRIMARY KEY,
  expected_travel_direction text,
  expected_access_rules jsonb,
  expected_is_oneway boolean NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO _core_street_routing_candidates (
  id,
  expected_travel_direction,
  expected_access_rules,
  expected_is_oneway
)
WITH source_rows AS MATERIALIZED (
  SELECT
    s.id,
    s.travel_direction,
    s.access_rules,
    s.is_oneway,
    s.normalized_data->'tags' AS tags,
    nullif(lower(btrim(s.normalized_data->'tags'->>'oneway')), '') AS oneway_value
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL
    AND s.is_active
),
derived AS (
  SELECT
    src.*,
    CASE
      WHEN src.oneway_value IN ('yes', '1', 'true') THEN 'forward'
      WHEN src.oneway_value IN ('-1', 'reverse') THEN 'reverse'
      WHEN src.oneway_value = 'reversible' THEN 'reversible'
      WHEN src.oneway_value = 'alternating' THEN 'alternating'
      WHEN src.oneway_value IN ('no', '0', 'false') THEN NULL
      WHEN src.oneway_value IS NOT NULL THEN 'unknown'
      WHEN lower(btrim(src.tags->>'junction')) = 'roundabout' THEN 'forward'
      WHEN lower(btrim(src.tags->>'highway')) = 'motorway' THEN 'forward'
      ELSE NULL
    END AS expected_direction,
    nullif(
      jsonb_strip_nulls(jsonb_build_object(
        'access', CASE WHEN jsonb_typeof(src.tags->'access') = 'string' THEN nullif(lower(btrim(src.tags->>'access')), '') END,
        'vehicle', CASE WHEN jsonb_typeof(src.tags->'vehicle') = 'string' THEN nullif(lower(btrim(src.tags->>'vehicle')), '') END,
        'motor_vehicle', CASE WHEN jsonb_typeof(src.tags->'motor_vehicle') = 'string' THEN nullif(lower(btrim(src.tags->>'motor_vehicle')), '') END,
        'motorcar', CASE WHEN jsonb_typeof(src.tags->'motorcar') = 'string' THEN nullif(lower(btrim(src.tags->>'motorcar')), '') END,
        'motorcycle', CASE WHEN jsonb_typeof(src.tags->'motorcycle') = 'string' THEN nullif(lower(btrim(src.tags->>'motorcycle')), '') END,
        'bicycle', CASE WHEN jsonb_typeof(src.tags->'bicycle') = 'string' THEN nullif(lower(btrim(src.tags->>'bicycle')), '') END,
        'foot', CASE WHEN jsonb_typeof(src.tags->'foot') = 'string' THEN nullif(lower(btrim(src.tags->>'foot')), '') END,
        'bus', CASE WHEN jsonb_typeof(src.tags->'bus') = 'string' THEN nullif(lower(btrim(src.tags->>'bus')), '') END,
        'hgv', CASE WHEN jsonb_typeof(src.tags->'hgv') = 'string' THEN nullif(lower(btrim(src.tags->>'hgv')), '') END
      )),
      '{}'::jsonb
    ) AS expected_access
  FROM source_rows src
),
candidate_projection AS (
  SELECT
    d.*,
    CASE
      WHEN d.expected_direction IN ('forward', 'reverse') THEN true
      WHEN d.expected_direction IN ('reversible', 'alternating') THEN false
      WHEN d.expected_direction IS NULL
       AND d.oneway_value IN ('no', '0', 'false') THEN false
      ELSE d.is_oneway
    END AS expected_oneway
  FROM derived d
  WHERE d.expected_direction IS NOT NULL
     OR d.expected_access IS NOT NULL
)
SELECT
  id,
  expected_direction,
  expected_access,
  expected_oneway
FROM candidate_projection
WHERE travel_direction IS DISTINCT FROM expected_direction
   OR access_rules IS DISTINCT FROM expected_access
   OR is_oneway IS DISTINCT FROM expected_oneway
ORDER BY id;

DO $$
DECLARE
  candidate_count bigint;
BEGIN
  SELECT count(*) INTO candidate_count
  FROM _core_street_routing_candidates;

  IF candidate_count >= 100000 THEN
    RAISE EXCEPTION 'street routing cleanup refused: candidate count % is unexpectedly large', candidate_count;
  END IF;

  RAISE NOTICE 'candidate_count=% planned_batches=% batch_size=500',
    candidate_count,
    ceil(candidate_count / 500.0)::bigint;
END $$;

SELECT jsonb_build_object(
  'event', 'candidate_set',
  'candidate_count', count(*),
  'planned_batches', ceil(count(*) / 500.0)::bigint,
  'forward', count(*) FILTER (WHERE expected_travel_direction = 'forward'),
  'reverse', count(*) FILTER (WHERE expected_travel_direction = 'reverse'),
  'reversible', count(*) FILTER (WHERE expected_travel_direction = 'reversible'),
  'alternating', count(*) FILTER (WHERE expected_travel_direction = 'alternating'),
  'unknown', count(*) FILTER (WHERE expected_travel_direction = 'unknown'),
  'access_rules', count(*) FILTER (WHERE expected_access_rules IS NOT NULL)
) AS candidate_set
FROM _core_street_routing_candidates;

CREATE TEMP TABLE _core_street_routing_batch_log (
  batch_no integer PRIMARY KEY,
  selected_rows integer NOT NULL,
  updated_rows integer NOT NULL,
  first_id bigint NOT NULL,
  last_id bigint NOT NULL,
  forward_rows integer NOT NULL,
  reverse_rows integer NOT NULL,
  reversible_rows integer NOT NULL,
  alternating_rows integer NOT NULL,
  unknown_rows integer NOT NULL,
  access_rows integer NOT NULL,
  remaining_rows integer NOT NULL,
  wal_before_bytes bigint NOT NULL,
  wal_after_bytes bigint NOT NULL,
  wal_lsn_delta_bytes numeric NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
) ON COMMIT PRESERVE ROWS;

CREATE OR REPLACE FUNCTION pg_temp.apply_core_street_routing_batch(
  p_batch_no integer,
  p_after_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_selected integer;
  v_updated integer;
  v_first_id bigint;
  v_last_id bigint;
  v_forward integer;
  v_reverse integer;
  v_reversible integer;
  v_alternating integer;
  v_unknown integer;
  v_access integer;
  v_remaining integer;
  v_initial_wal bigint;
  v_wal_before bigint;
  v_wal_after bigint;
  v_start_lsn pg_lsn;
  v_lsn_after pg_lsn;
BEGIN
  SELECT wal_directory_bytes, start_lsn
  INTO v_initial_wal, v_start_lsn
  FROM _core_street_routing_baseline;

  SELECT coalesce(sum(size), 0)::bigint
  INTO v_wal_before
  FROM pg_ls_waldir();

  IF v_wal_before > v_initial_wal + 536870912 THEN
    RAISE EXCEPTION
      'street routing cleanup stopped before batch %: WAL directory grew by % bytes',
      p_batch_no,
      v_wal_before - v_initial_wal;
  END IF;

  SELECT
    count(*)::integer,
    min(id),
    max(id),
    count(*) FILTER (WHERE expected_travel_direction = 'forward')::integer,
    count(*) FILTER (WHERE expected_travel_direction = 'reverse')::integer,
    count(*) FILTER (WHERE expected_travel_direction = 'reversible')::integer,
    count(*) FILTER (WHERE expected_travel_direction = 'alternating')::integer,
    count(*) FILTER (WHERE expected_travel_direction = 'unknown')::integer,
    count(*) FILTER (WHERE expected_access_rules IS NOT NULL)::integer
  INTO
    v_selected,
    v_first_id,
    v_last_id,
    v_forward,
    v_reverse,
    v_reversible,
    v_alternating,
    v_unknown,
    v_access
  FROM (
    SELECT *
    FROM _core_street_routing_candidates
    WHERE id > p_after_id
    ORDER BY id
    LIMIT 500
  ) batch;

  IF v_selected = 0 THEN
    RAISE EXCEPTION 'street routing cleanup internal error: empty batch %', p_batch_no;
  END IF;

  PERFORM set_config('lock_timeout', '10s', true);
  PERFORM set_config('statement_timeout', '2min', true);
  PERFORM set_config('local_map.skip_street_version', 'true', true);

  WITH batch AS MATERIALIZED (
    SELECT *
    FROM _core_street_routing_candidates
    WHERE id > p_after_id
    ORDER BY id
    LIMIT 500
  )
  UPDATE core.core_streets s
  SET
    travel_direction = b.expected_travel_direction,
    access_rules = b.expected_access_rules,
    is_oneway = b.expected_is_oneway
  FROM batch b
  WHERE s.id = b.id
    AND (
      s.travel_direction IS DISTINCT FROM b.expected_travel_direction
      OR s.access_rules IS DISTINCT FROM b.expected_access_rules
      OR s.is_oneway IS DISTINCT FROM b.expected_is_oneway
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*)::integer
  INTO v_remaining
  FROM _core_street_routing_candidates
  WHERE id > v_last_id;

  SELECT coalesce(sum(size), 0)::bigint
  INTO v_wal_after
  FROM pg_ls_waldir();
  v_lsn_after := pg_current_wal_lsn();

  INSERT INTO _core_street_routing_batch_log (
    batch_no, selected_rows, updated_rows, first_id, last_id,
    forward_rows, reverse_rows, reversible_rows, alternating_rows,
    unknown_rows, access_rows, remaining_rows,
    wal_before_bytes, wal_after_bytes, wal_lsn_delta_bytes
  ) VALUES (
    p_batch_no, v_selected, v_updated, v_first_id, v_last_id,
    v_forward, v_reverse, v_reversible, v_alternating,
    v_unknown, v_access, v_remaining,
    v_wal_before, v_wal_after, pg_wal_lsn_diff(v_lsn_after, v_start_lsn)
  );

  RETURN jsonb_build_object(
    'batch', p_batch_no,
    'selected', v_selected,
    'updated', v_updated,
    'first_id', v_first_id,
    'last_id', v_last_id,
    'forward', v_forward,
    'reverse', v_reverse,
    'reversible', v_reversible,
    'alternating', v_alternating,
    'unknown', v_unknown,
    'access_rules', v_access,
    'remaining', v_remaining,
    'wal_before_bytes', v_wal_before,
    'wal_after_bytes', v_wal_after,
    'wal_lsn_delta_bytes', pg_wal_lsn_diff(v_lsn_after, v_start_lsn)
  );
END;
$$;

-- Each generated SELECT is a separate autocommit transaction. The cursor is
-- the previous batch's maximum candidate id; OFFSET is never used.
WITH numbered AS (
  SELECT id, ((row_number() OVER (ORDER BY id) - 1) / 500 + 1)::integer AS batch_no
  FROM _core_street_routing_candidates
),
bounds AS (
  SELECT batch_no, min(id) AS first_id, max(id) AS last_id
  FROM numbered
  GROUP BY batch_no
),
commands AS (
  SELECT
    batch_no,
    format(
      'SELECT pg_temp.apply_core_street_routing_batch(%s, %s) AS batch_progress;',
      batch_no,
      coalesce(lag(last_id) OVER (ORDER BY batch_no), 0)
    ) AS command
  FROM bounds
)
SELECT command
FROM commands
ORDER BY batch_no
\gexec

SELECT jsonb_build_object(
  'event', 'batch_summary',
  'batches', count(*),
  'selected_rows', coalesce(sum(selected_rows), 0),
  'updated_rows', coalesce(sum(updated_rows), 0),
  'wal_start_bytes', min(wal_before_bytes),
  'wal_end_bytes', max(wal_after_bytes),
  'wal_directory_growth_bytes', max(wal_after_bytes) - min(wal_before_bytes),
  'wal_generated_lsn_bytes', max(wal_lsn_delta_bytes)
) AS batch_summary
FROM _core_street_routing_batch_log;

-- Exact final validation for active streets.
WITH active AS MATERIALIZED (
  SELECT
    s.*,
    s.normalized_data->'tags' AS tags,
    nullif(lower(btrim(s.normalized_data->'tags'->>'oneway')), '') AS oneway_value
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL AND s.is_active
),
expected AS MATERIALIZED (
  SELECT
    a.*,
    CASE
      WHEN a.oneway_value IN ('yes', '1', 'true') THEN 'forward'
      WHEN a.oneway_value IN ('-1', 'reverse') THEN 'reverse'
      WHEN a.oneway_value = 'reversible' THEN 'reversible'
      WHEN a.oneway_value = 'alternating' THEN 'alternating'
      WHEN a.oneway_value IN ('no', '0', 'false') THEN NULL
      WHEN a.oneway_value IS NOT NULL THEN 'unknown'
      WHEN lower(btrim(a.tags->>'junction')) = 'roundabout' THEN 'forward'
      WHEN lower(btrim(a.tags->>'highway')) = 'motorway' THEN 'forward'
      ELSE NULL
    END AS expected_direction,
    nullif(
      jsonb_strip_nulls(jsonb_build_object(
        'access', CASE WHEN jsonb_typeof(a.tags->'access') = 'string' THEN nullif(lower(btrim(a.tags->>'access')), '') END,
        'vehicle', CASE WHEN jsonb_typeof(a.tags->'vehicle') = 'string' THEN nullif(lower(btrim(a.tags->>'vehicle')), '') END,
        'motor_vehicle', CASE WHEN jsonb_typeof(a.tags->'motor_vehicle') = 'string' THEN nullif(lower(btrim(a.tags->>'motor_vehicle')), '') END,
        'motorcar', CASE WHEN jsonb_typeof(a.tags->'motorcar') = 'string' THEN nullif(lower(btrim(a.tags->>'motorcar')), '') END,
        'motorcycle', CASE WHEN jsonb_typeof(a.tags->'motorcycle') = 'string' THEN nullif(lower(btrim(a.tags->>'motorcycle')), '') END,
        'bicycle', CASE WHEN jsonb_typeof(a.tags->'bicycle') = 'string' THEN nullif(lower(btrim(a.tags->>'bicycle')), '') END,
        'foot', CASE WHEN jsonb_typeof(a.tags->'foot') = 'string' THEN nullif(lower(btrim(a.tags->>'foot')), '') END,
        'bus', CASE WHEN jsonb_typeof(a.tags->'bus') = 'string' THEN nullif(lower(btrim(a.tags->>'bus')), '') END,
        'hgv', CASE WHEN jsonb_typeof(a.tags->'hgv') = 'string' THEN nullif(lower(btrim(a.tags->>'hgv')), '') END
      )),
      '{}'::jsonb
    ) AS expected_access
  FROM active a
),
post AS (
  SELECT
    count(*)::bigint AS active_total,
    count(*) FILTER (WHERE travel_direction IS NULL)::bigint AS direction_null,
    count(*) FILTER (WHERE travel_direction = 'forward')::bigint AS direction_forward,
    count(*) FILTER (WHERE travel_direction = 'reverse')::bigint AS direction_reverse,
    count(*) FILTER (WHERE travel_direction = 'reversible')::bigint AS direction_reversible,
    count(*) FILTER (WHERE travel_direction = 'alternating')::bigint AS direction_alternating,
    count(*) FILTER (WHERE travel_direction = 'unknown')::bigint AS direction_unknown,
    count(*) FILTER (WHERE access_rules IS NOT NULL)::bigint AS access_not_null,
    count(*) FILTER (WHERE access_rules IS NULL)::bigint AS access_null,
    count(*) FILTER (
      WHERE oneway_value IS NOT NULL
        AND oneway_value NOT IN (
          'yes', '1', 'true', '-1', 'reverse', 'reversible',
          'alternating', 'no', '0', 'false'
        )
    )::bigint AS malformed_oneway,
    count(*) FILTER (
      WHERE travel_direction IS DISTINCT FROM expected_direction
    )::bigint AS direction_mismatches,
    count(*) FILTER (
      WHERE access_rules IS DISTINCT FROM expected_access
    )::bigint AS access_mismatches
  FROM expected
),
quality AS (
  SELECT
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM (VALUES
          ('access'), ('vehicle'), ('motor_vehicle'), ('motorcar'),
          ('motorcycle'), ('bicycle'), ('foot'), ('bus'), ('hgv')
        ) keys(key)
        WHERE expected.tags ? keys.key
          AND (
            jsonb_typeof(expected.tags->keys.key) IS DISTINCT FROM 'string'
            OR nullif(btrim(expected.tags->>keys.key), '') IS NULL
          )
      )
    )::bigint AS malformed_access_rows,
    count(*) FILTER (
      WHERE (expected_direction IS NOT NULL OR expected_access IS NOT NULL)
        AND NOT (
          (source_refs ? 'osm_id' AND upper(coalesce(source_refs->>'osm_feature_type', '')) = 'W')
          OR external_id ~ '^osm:W:[0-9]+$'
        )
    )::bigint AS candidates_missing_source_identity
  FROM expected
)
SELECT jsonb_build_object(
  'event', 'final_validation',
  'active_total', post.active_total,
  'travel_direction', jsonb_build_object(
    'null', post.direction_null,
    'forward', post.direction_forward,
    'reverse', post.direction_reverse,
    'reversible', post.direction_reversible,
    'alternating', post.direction_alternating,
    'unknown', post.direction_unknown
  ),
  'access', jsonb_build_object(
    'not_null', post.access_not_null,
    'null', post.access_null
  ),
  'quality', jsonb_build_object(
    'malformed_oneway_rows', post.malformed_oneway,
    'malformed_access_rows', quality.malformed_access_rows,
    'candidates_missing_source_identity', quality.candidates_missing_source_identity,
    'direction_mismatches', post.direction_mismatches,
    'access_mismatches', post.access_mismatches
  )
) AS final_validation
FROM post, quality;

SELECT jsonb_build_object(
  'event', 'access_key_distribution',
  'key_counts', (
    SELECT jsonb_object_agg(key, rows ORDER BY key)
    FROM (
      SELECT key, count(*)::bigint AS rows
      FROM core.core_streets s
      CROSS JOIN LATERAL jsonb_object_keys(s.access_rules) AS keys(key)
      WHERE s.deleted_at IS NULL AND s.is_active AND s.access_rules IS NOT NULL
      GROUP BY key
    ) x
  ),
  'distinct_values', (
    SELECT jsonb_object_agg(key, values ORDER BY key)
    FROM (
      SELECT key, jsonb_agg(value ORDER BY value) AS values
      FROM (
        SELECT DISTINCT key, s.access_rules->>key AS value
        FROM core.core_streets s
        CROSS JOIN LATERAL jsonb_object_keys(s.access_rules) AS keys(key)
        WHERE s.deleted_at IS NULL AND s.is_active AND s.access_rules IS NOT NULL
      ) distinct_key_values
      GROUP BY key
    ) y
  )
) AS access_distribution;

WITH after_state AS (
  SELECT
    clock_timestamp() AS captured_at,
    (SELECT count(*)::bigint FROM core.core_streets) AS street_total,
    (SELECT count(*)::bigint FROM core.core_street_versions) AS street_version_rows,
    (SELECT count(*)::bigint FROM core.core_streets WHERE NOT ST_IsValid(geom)) AS invalid_geometry_rows,
    pg_relation_size('core.core_streets'::regclass)::bigint AS table_bytes,
    pg_indexes_size('core.core_streets'::regclass)::bigint AS index_bytes,
    pg_total_relation_size('core.core_streets'::regclass)::bigint AS total_bytes,
    pg_database_size(current_database())::bigint AS database_bytes,
    (SELECT coalesce(sum(size), 0)::bigint FROM pg_ls_waldir()) AS wal_directory_bytes,
    pg_current_wal_lsn() AS end_lsn
)
SELECT jsonb_build_object(
  'event', 'before_after',
  'street_total_before', b.street_total,
  'street_total_after', a.street_total,
  'street_version_rows_before', b.street_version_rows,
  'street_version_rows_after', a.street_version_rows,
  'invalid_geometry_before', b.invalid_geometry_rows,
  'invalid_geometry_after', a.invalid_geometry_rows,
  'table_bytes_before', b.table_bytes,
  'table_bytes_after', a.table_bytes,
  'table_bytes_change', a.table_bytes - b.table_bytes,
  'index_bytes_before', b.index_bytes,
  'index_bytes_after', a.index_bytes,
  'index_bytes_change', a.index_bytes - b.index_bytes,
  'total_bytes_before', b.total_bytes,
  'total_bytes_after', a.total_bytes,
  'total_bytes_change', a.total_bytes - b.total_bytes,
  'database_bytes_before', b.database_bytes,
  'database_bytes_after', a.database_bytes,
  'database_bytes_change', a.database_bytes - b.database_bytes,
  'wal_directory_bytes_before', b.wal_directory_bytes,
  'wal_directory_bytes_after', a.wal_directory_bytes,
  'wal_directory_bytes_change', a.wal_directory_bytes - b.wal_directory_bytes,
  'wal_generated_lsn_bytes', pg_wal_lsn_diff(a.end_lsn, b.start_lsn)
) AS before_after
FROM _core_street_routing_baseline b, after_state a;

WITH source AS MATERIALIZED (
  SELECT
    s.id,
    s.external_id,
    s.source_refs->>'osm_id' AS osm_id,
    s.normalized_data->'tags' AS tags,
    s.travel_direction,
    s.is_oneway,
    s.access_rules,
    nullif(lower(btrim(s.normalized_data->'tags'->>'oneway')), '') AS oneway_value
  FROM core.core_streets s
  WHERE s.deleted_at IS NULL AND s.is_active
),
sample_ids AS (
  SELECT 'oneway=yes -> forward'::text AS sample, min(id) FILTER (WHERE oneway_value = 'yes' AND travel_direction = 'forward') AS id FROM source
  UNION ALL SELECT 'oneway=-1 -> reverse', min(id) FILTER (WHERE oneway_value = '-1' AND travel_direction = 'reverse') FROM source
  UNION ALL SELECT 'roundabout implicit -> forward', min(id) FILTER (WHERE oneway_value IS NULL AND lower(btrim(tags->>'junction')) = 'roundabout' AND travel_direction = 'forward') FROM source
  UNION ALL SELECT 'ordinary two-way -> NULL', min(id) FILTER (WHERE oneway_value IS NULL AND coalesce(lower(btrim(tags->>'junction')), '') <> 'roundabout' AND coalesce(lower(btrim(tags->>'highway')), '') <> 'motorway' AND travel_direction IS NULL) FROM source
  UNION ALL SELECT 'malformed oneway -> unknown', min(id) FILTER (WHERE travel_direction = 'unknown') FROM source
  UNION ALL SELECT 'access=private', min(id) FILTER (WHERE access_rules->>'access' = 'private') FROM source
  UNION ALL SELECT 'access=destination', min(id) FILTER (WHERE access_rules->>'access' = 'destination') FROM source
  UNION ALL SELECT 'motor_vehicle=no + foot=yes', min(id) FILTER (WHERE access_rules->>'motor_vehicle' = 'no' AND access_rules->>'foot' = 'yes') FROM source
  UNION ALL SELECT 'access=private + foot=yes', min(id) FILTER (WHERE access_rules->>'access' = 'private' AND access_rules->>'foot' = 'yes') FROM source
)
SELECT
  i.sample,
  s.id,
  s.external_id,
  s.osm_id,
  jsonb_strip_nulls(jsonb_build_object(
    'oneway', s.tags->'oneway',
    'junction', s.tags->'junction',
    'highway', s.tags->'highway',
    'access', s.tags->'access',
    'vehicle', s.tags->'vehicle',
    'motor_vehicle', s.tags->'motor_vehicle',
    'motorcar', s.tags->'motorcar',
    'motorcycle', s.tags->'motorcycle',
    'bicycle', s.tags->'bicycle',
    'foot', s.tags->'foot',
    'bus', s.tags->'bus',
    'hgv', s.tags->'hgv'
  )) AS raw_relevant_tags,
  s.travel_direction,
  s.is_oneway,
  s.access_rules
FROM sample_ids i
LEFT JOIN source s ON s.id = i.id
ORDER BY i.sample;

SELECT jsonb_build_object(
  'event', 'completion',
  'completed_at', clock_timestamp(),
  'candidate_rows', (SELECT count(*) FROM _core_street_routing_candidates),
  'batches', (SELECT count(*) FROM _core_street_routing_batch_log),
  'rows_touched', (SELECT coalesce(sum(updated_rows), 0) FROM _core_street_routing_batch_log),
  'remaining_candidate_rows', (
    SELECT count(*)
    FROM _core_street_routing_candidates c
    JOIN core.core_streets s USING (id)
    WHERE s.travel_direction IS DISTINCT FROM c.expected_travel_direction
       OR s.access_rules IS DISTINCT FROM c.expected_access_rules
       OR s.is_oneway IS DISTINCT FROM c.expected_is_oneway
  )
) AS completion;
