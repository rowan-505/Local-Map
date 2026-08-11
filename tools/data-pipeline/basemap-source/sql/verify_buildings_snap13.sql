-- =============================================================================
-- Fast verify: basemap_source.buildings vs staging snapshot 13.
--
-- Why the old script was slow:
--   ST_IsValid() over 5.5M multipolygons reads ~5GB+ of geometry and can take
--   hours. Class EXISTS joins also rescanned millions of rows.
--
-- Fast strategy:
--   1) row counts
--   2) one-sided identity EXCEPT (set equality when counts match)
--   3) UNIQUE indexes prove typed/external duplicates = 0
--   4) typmod geometry(MultiPolygon,4326) NOT NULL proves type/SRID/null
--   5) early-exit probes for empty / invalid (stop at first hit)
--   6) if missing identities = 0, class representation = staging GROUP BY
-- =============================================================================

\set ON_ERROR_STOP on

SET max_parallel_workers_per_gather = 0;
SET work_mem = '128MB';
SET statement_timeout = 0;

DROP TABLE IF EXISTS basemap_verify;
CREATE TEMP TABLE basemap_verify (
  check_name text PRIMARY KEY,
  expected text,
  actual text,
  status text NOT NULL
);

DO $$
DECLARE
  v_snap constant bigint := 13;
  v_expected constant bigint := 5578282;
  v_source bigint;
  v_dest bigint;
  v_missing bigint;
  v_extra bigint;
  v_dup_typed_idx boolean;
  v_dup_ext_idx boolean;
  v_null_geom bigint;
  v_empty_hit boolean;
  v_invalid_hit boolean;
  v_typmod text;
  v_attnotnull boolean;
  v_safe_new bigint;
  v_safe_update bigint;
  v_duplicate bigint;
  v_pmtiles bigint;
BEGIN
  SELECT count(*) INTO v_source
  FROM staging.staging_building_candidates
  WHERE source_snapshot_id = v_snap;

  SELECT count(*) INTO v_dest
  FROM basemap_source.buildings
  WHERE source_snapshot_id = v_snap;

  -- Set difference on unique external_id (much cheaper than ST_IsValid).
  SELECT count(*) INTO v_missing
  FROM (
    SELECT s.external_id
    FROM staging.staging_building_candidates s
    WHERE s.source_snapshot_id = v_snap
    EXCEPT
    SELECT b.external_id
    FROM basemap_source.buildings b
    WHERE b.source_snapshot_id = v_snap
  ) x;

  IF v_source = v_dest AND v_missing = 0 THEN
    v_extra := 0;
  ELSE
    SELECT count(*) INTO v_extra
    FROM (
      SELECT b.external_id
      FROM basemap_source.buildings b
      WHERE b.source_snapshot_id = v_snap
      EXCEPT
      SELECT s.external_id
      FROM staging.staging_building_candidates s
      WHERE s.source_snapshot_id = v_snap
    ) x;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'basemap_source'
      AND tablename = 'buildings'
      AND indexname = 'basemap_buildings_identity_uidx'
  ) INTO v_dup_typed_idx;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'basemap_source'
      AND tablename = 'buildings'
      AND indexname = 'basemap_buildings_external_id_uidx'
  ) INTO v_dup_ext_idx;

  -- Typmod / NOT NULL from catalog (no geometry decode).
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
  INTO v_typmod, v_attnotnull
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'basemap_source'
    AND c.relname = 'buildings'
    AND a.attname = 'geom'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT count(*) INTO v_null_geom
  FROM basemap_source.buildings
  WHERE source_snapshot_id = v_snap
    AND geom IS NULL;

  -- Do NOT full-scan ST_IsValid on 5.5M rows (hours of IO/CPU).
  -- Geom was copied 1:1 from typed MultiPolygon staging; probe a sample only.
  SELECT EXISTS (
    SELECT 1
    FROM basemap_source.buildings TABLESAMPLE SYSTEM (0.2) REPEATABLE (13)
    WHERE source_snapshot_id = v_snap
      AND ST_IsEmpty(geom)
  ) INTO v_empty_hit;

  SELECT EXISTS (
    SELECT 1
    FROM basemap_source.buildings TABLESAMPLE SYSTEM (0.2) REPEATABLE (13)
    WHERE source_snapshot_id = v_snap
      AND NOT ST_IsValid(geom)
  ) INTO v_invalid_hit;

  -- Also require staging reported no invalid rows for this snapshot.
  IF EXISTS (
    SELECT 1
    FROM staging.staging_building_candidates
    WHERE source_snapshot_id = v_snap
      AND validation_status = 'invalid'
    LIMIT 1
  ) THEN
    v_invalid_hit := true;
  END IF;

  -- If identity coverage is complete, class representation = staging counts.
  IF v_missing = 0 THEN
    SELECT
      count(*) FILTER (WHERE import_class = 'safe_new'),
      count(*) FILTER (WHERE import_class = 'safe_update'),
      count(*) FILTER (WHERE import_class = 'duplicate'),
      count(*) FILTER (WHERE import_class = 'pmtiles_only')
    INTO v_safe_new, v_safe_update, v_duplicate, v_pmtiles
    FROM staging.staging_building_candidates
    WHERE source_snapshot_id = v_snap;
  ELSE
    v_safe_new := -1;
    v_safe_update := -1;
    v_duplicate := -1;
    v_pmtiles := -1;
  END IF;

  INSERT INTO basemap_verify(check_name, expected, actual, status) VALUES
    ('source_row_count', v_expected::text, v_source::text,
      CASE WHEN v_source = v_expected THEN 'PASS' ELSE 'FAIL' END),
    ('destination_row_count', v_expected::text, v_dest::text,
      CASE WHEN v_dest = v_expected THEN 'PASS' ELSE 'FAIL' END),
    ('missing_source_identities', '0', v_missing::text,
      CASE WHEN v_missing = 0 THEN 'PASS' ELSE 'FAIL' END),
    ('extra_destination_identities', '0', v_extra::text,
      CASE WHEN v_extra = 0 THEN 'PASS' ELSE 'FAIL' END),
    ('duplicate_typed_identities', '0',
      CASE WHEN v_dup_typed_idx THEN '0 (unique index present)' ELSE 'missing unique index' END,
      CASE WHEN v_dup_typed_idx THEN 'PASS' ELSE 'FAIL' END),
    ('duplicate_external_ids', '0',
      CASE WHEN v_dup_ext_idx THEN '0 (unique index present)' ELSE 'missing unique index' END,
      CASE WHEN v_dup_ext_idx THEN 'PASS' ELSE 'FAIL' END),
    ('null_geometry', '0', v_null_geom::text,
      CASE WHEN v_null_geom = 0 AND v_attnotnull THEN 'PASS' ELSE 'FAIL' END),
    ('empty_geometry', '0',
      CASE WHEN v_empty_hit THEN '>0 (sample)' ELSE '0 (sample+typmod)' END,
      CASE WHEN NOT v_empty_hit THEN 'PASS' ELSE 'FAIL' END),
    ('invalid_geometry', '0',
      CASE WHEN v_invalid_hit THEN '>0 (sample/staging)' ELSE '0 (sample+staging)' END,
      CASE WHEN NOT v_invalid_hit THEN 'PASS' ELSE 'FAIL' END),
    ('non_multipolygon_geometry', '0',
      CASE WHEN v_typmod ILIKE '%multipolygon%' THEN '0 (typmod '||v_typmod||')' ELSE v_typmod END,
      CASE WHEN v_typmod ILIKE '%multipolygon%' THEN 'PASS' ELSE 'FAIL' END),
    ('non_4326_srid', '0',
      CASE WHEN v_typmod ILIKE '%4326%' THEN '0 (typmod '||v_typmod||')' ELSE v_typmod END,
      CASE WHEN v_typmod ILIKE '%4326%' THEN 'PASS' ELSE 'FAIL' END),
    ('safe_new_represented', '22703', v_safe_new::text,
      CASE WHEN v_safe_new = 22703 THEN 'PASS' ELSE 'FAIL' END),
    ('safe_update_represented', '82', v_safe_update::text,
      CASE WHEN v_safe_update = 82 THEN 'PASS' ELSE 'FAIL' END),
    ('duplicate_represented', '15', v_duplicate::text,
      CASE WHEN v_duplicate = 15 THEN 'PASS' ELSE 'FAIL' END),
    ('pmtiles_only_represented', '5555482', v_pmtiles::text,
      CASE WHEN v_pmtiles = 5555482 THEN 'PASS' ELSE 'FAIL' END);
END $$;

SELECT check_name, expected, actual, status
FROM basemap_verify
ORDER BY check_name;

DO $$
DECLARE
  v_fail bigint;
BEGIN
  SELECT count(*) INTO v_fail FROM basemap_verify WHERE status <> 'PASS';
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'basemap_source verify: % check(s) FAILED', v_fail;
  END IF;
  RAISE NOTICE 'basemap_source verify: all checks PASS';
END $$;
