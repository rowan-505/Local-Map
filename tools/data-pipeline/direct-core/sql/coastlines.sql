-- National coastline loader for core.core_coastlines.
-- Dry-run: validate CSV + report production state; NEVER call replace_active_coastline.
-- Apply: call core.replace_active_coastline exactly once with region_code MM.
--
-- psql vars:
--   snapshot_version  (required)
--   dry_run           true|false
-- Env:
--   DIRECT_CORE_CSV   absolute path to coastline.national.csv
\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TEMP TABLE coastline_params (
  source_registry_id bigint NOT NULL,
  source_snapshot_id bigint NOT NULL,
  snapshot_version text NOT NULL,
  snapshot_ref text NOT NULL,
  dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO coastline_params
SELECT
  r.id,
  s.id,
  s.snapshot_version,
  s.snapshot_ref,
  :'dry_run'::boolean
FROM system.system_source_registry r
JOIN system.system_source_snapshots s
  ON s.source_registry_id = r.id
 AND s.snapshot_version = :'snapshot_version'
WHERE r.source_code = 'osm_myanmar'
  AND r.is_active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM coastline_params) THEN
    RAISE EXCEPTION 'coastlines: osm_myanmar + requested snapshot_version not found (or registry inactive)';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM coastline_params p
    JOIN system.system_source_snapshots s ON s.id = p.source_snapshot_id
    WHERE s.source_registry_id = p.source_registry_id
  ) THEN
    RAISE EXCEPTION 'coastlines: snapshot does not belong to resolved registry';
  END IF;
END $$;

CREATE TEMP TABLE coastline_raw (
  scope text,
  snapshot_version text,
  source_snapshot_id text,
  source_registry_id text,
  source_checksum text,
  source_way_count text,
  component_count text,
  length_km text,
  geom_ewkt text
) ON COMMIT DROP;

\copy coastline_raw FROM PROGRAM 'cat "$DIRECT_CORE_CSV"' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE coastline_stage AS
SELECT
  lower(nullif(btrim(scope), '')) AS scope,
  nullif(btrim(snapshot_version), '') AS artifact_snapshot_version,
  nullif(btrim(source_checksum), '') AS source_checksum,
  nullif(btrim(source_way_count), '')::bigint AS source_way_count,
  nullif(btrim(component_count), '')::bigint AS meta_component_count,
  nullif(btrim(length_km), '')::numeric AS meta_length_km,
  ST_Multi(
    ST_CollectionExtract(
      CASE
        WHEN ST_SRID(g) = 0 THEN ST_SetSRID(g, 4326)
        WHEN ST_SRID(g) = 4326 THEN g
        ELSE ST_Transform(g, 4326)
      END,
      2
    )
  )::geometry(MultiLineString, 4326) AS geom
FROM coastline_raw
CROSS JOIN LATERAL (
  SELECT ST_GeomFromEWKT(nullif(btrim(geom_ewkt), '')) AS g
) AS parsed;

DO $$
DECLARE
  v_n bigint;
  v_geom geometry;
  v_parts bigint;
  v_len numeric;
  v_meta_parts bigint;
  v_meta_len numeric;
  v_ways bigint;
BEGIN
  SELECT count(*) INTO v_n FROM coastline_stage;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'coastlines: expected exactly 1 CSV data row, got %', v_n;
  END IF;

  SELECT
    geom,
    ST_NumGeometries(geom),
    round((ST_Length(geom::geography) / 1000.0)::numeric, 2),
    meta_component_count,
    meta_length_km,
    source_way_count
  INTO v_geom, v_parts, v_len, v_meta_parts, v_meta_len, v_ways
  FROM coastline_stage;

  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RAISE EXCEPTION 'coastlines: geometry is null or empty';
  END IF;
  IF GeometryType(v_geom) <> 'MULTILINESTRING' THEN
    RAISE EXCEPTION 'coastlines: expected MultiLineString, got %', GeometryType(v_geom);
  END IF;
  IF ST_SRID(v_geom) <> 4326 THEN
    RAISE EXCEPTION 'coastlines: expected SRID 4326, got %', ST_SRID(v_geom);
  END IF;
  IF NOT ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'coastlines: invalid geometry: %', ST_IsValidReason(v_geom);
  END IF;

  IF v_meta_parts IS NOT NULL AND abs(v_parts - v_meta_parts) > 0 THEN
    RAISE EXCEPTION
      'coastlines: component mismatch measured=% meta=%', v_parts, v_meta_parts;
  END IF;
  IF v_meta_len IS NOT NULL AND abs(v_len - v_meta_len) > 0.05 THEN
    RAISE EXCEPTION
      'coastlines: length_km mismatch measured=% meta=%', v_len, v_meta_len;
  END IF;
  IF abs(v_parts - 58) > 0 OR abs(v_len - 8496.15) > 0.05 THEN
    RAISE EXCEPTION
      'coastlines: measured stats differ from approved dry-run (parts=% len=%); abort',
      v_parts, v_len;
  END IF;
  IF v_ways IS DISTINCT FROM 752 THEN
    RAISE EXCEPTION 'coastlines: source_way_count=% expected 752', v_ways;
  END IF;
END $$;

CREATE TEMP TABLE coastline_before AS
SELECT
  count(*)::bigint AS total_rows,
  count(*) FILTER (
    WHERE is_active AND lower(coalesce(nullif(btrim(region_code), ''), 'national')) = 'mm'
  )::bigint AS active_mm_rows
FROM core.core_coastlines;

CREATE TEMP TABLE coastline_measured AS
SELECT
  GeometryType(geom) AS geom_type,
  ST_SRID(geom) AS srid,
  ST_NumGeometries(geom)::bigint AS component_count,
  round((ST_Length(geom::geography) / 1000.0)::numeric, 2) AS length_km,
  source_way_count,
  meta_component_count,
  meta_length_km,
  source_checksum
FROM coastline_stage;

SELECT
  'coastline_report' AS section,
  (SELECT dry_run FROM coastline_params) AS dry_run,
  1 AS artifact_rows,
  m.geom_type,
  m.srid,
  m.component_count,
  m.length_km,
  m.source_way_count,
  p.source_registry_id,
  p.source_snapshot_id,
  p.snapshot_version,
  p.snapshot_ref,
  b.total_rows AS prod_total_coastline_count,
  b.active_mm_rows AS prod_active_mm_count,
  CASE
    WHEN (SELECT dry_run FROM coastline_params)
      THEN format(
        'expected_action: insert 1 new active MM coastline; deactivate %s previous MM active rows; replace NOT called',
        b.active_mm_rows
      )
    ELSE 'apply: calling replace_active_coastline once'
  END AS expected_action
FROM coastline_measured m
CROSS JOIN coastline_params p
CROSS JOIN coastline_before b;

\if :dry_run
SELECT 'coastline_dryrun' AS section, 'replace_active_coastline NOT called'::text AS note;
ROLLBACK;
\else

DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('direct_core:coastlines:MM', 0));
END $$;

CREATE TEMP TABLE coastline_result AS
SELECT *
FROM core.replace_active_coastline(
  p_geom := (SELECT geom FROM coastline_stage),
  p_region_code := 'MM',
  p_source_registry_id := (SELECT source_registry_id FROM coastline_params),
  p_source_snapshot_id := (SELECT source_snapshot_id FROM coastline_params),
  p_source_refs := jsonb_build_object(
    'source', 'osm',
    'artifact', 'coastline.national.csv',
    'snapshot_version', (SELECT snapshot_version FROM coastline_params),
    'snapshot_ref', (SELECT snapshot_ref FROM coastline_params),
    'source_way_count', (SELECT source_way_count FROM coastline_stage),
    'merged_component_count', (SELECT meta_component_count FROM coastline_stage)
  )
);

CREATE TEMP TABLE coastline_after AS
SELECT
  count(*)::bigint AS total_rows,
  count(*) FILTER (
    WHERE is_active AND lower(coalesce(nullif(btrim(region_code), ''), 'national')) = 'mm'
  )::bigint AS active_mm_rows
FROM core.core_coastlines;

DO $$
DECLARE
  v_active bigint;
BEGIN
  SELECT active_mm_rows INTO v_active FROM coastline_after;
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'coastlines apply: expected exactly 1 active MM coastline, got %', v_active;
  END IF;
END $$;

SELECT
  'coastline_apply_result' AS section,
  r.coastline_id,
  r.coastline_public_id,
  r.deactivated_count,
  a.total_rows AS after_total,
  a.active_mm_rows AS after_active_mm,
  m.component_count,
  m.length_km
FROM coastline_result r
CROSS JOIN coastline_after a
CROSS JOIN coastline_measured m;

COMMIT;
\endif
