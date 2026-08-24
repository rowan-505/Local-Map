-- Tiny local sample: settlement promotion routing only.
-- Does not write production. Does not apply supabase migration 192.
-- Rollback at the end.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE settlement_sample_candidates (
  import_class text NOT NULL,
  external_id text NOT NULL,
  canonical_name text,
  class_code text,
  township_id bigint,
  point_geom geometry,
  validation_status text
) ON COMMIT DROP;

INSERT INTO settlement_sample_candidates VALUES
  ('safe_new', 'osm:node:1', 'A', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.3, 16.7), 4326), 'valid'),
  ('safe_update', 'osm:node:2', 'B', 'town', 10,
   ST_SetSRID(ST_MakePoint(96.31, 16.71), 4326), 'valid'),
  ('unchanged', 'osm:node:3', 'C', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.32, 16.72), 4326), 'valid'),
  ('conflict', 'osm:node:4', 'D', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.33, 16.73), 4326), 'valid'),
  ('needs_review', 'osm:node:5', 'E', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.34, 16.74), 4326), 'valid'),
  ('duplicate', 'osm:node:6', 'F', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.35, 16.75), 4326), 'valid'),
  ('invalid', 'osm:node:7', 'G', 'village', 10,
   ST_SetSRID(ST_MakePoint(96.36, 16.76), 4326), 'invalid'),
  ('safe_new', 'osm:node:8', 'No Township', 'village', NULL,
   ST_SetSRID(ST_MakePoint(96.37, 16.77), 4326), 'valid');

CREATE TEMP TABLE settlement_sample_export AS
SELECT *
FROM settlement_sample_candidates
WHERE import_class IN ('safe_new', 'safe_update')
  AND coalesce(validation_status, 'valid') NOT IN ('invalid', 'blocked', 'failed')
  AND township_id IS NOT NULL
  AND point_geom IS NOT NULL
  AND ST_IsValid(point_geom)
  AND GeometryType(point_geom) = 'POINT';

DO $$
DECLARE n_export integer;
DECLARE n_safe integer;
BEGIN
  SELECT count(*) INTO n_export FROM settlement_sample_export;
  SELECT count(*) INTO n_safe
  FROM settlement_sample_candidates
  WHERE import_class IN ('safe_new', 'safe_update')
    AND township_id IS NOT NULL
    AND coalesce(validation_status, 'valid') = 'valid';

  IF n_export <> 2 OR n_safe <> 2 THEN
    RAISE EXCEPTION
      'settlement tiny sample: expected 2 exportable rows, export=% safe=%',
      n_export, n_safe;
  END IF;

  IF EXISTS (
    SELECT 1 FROM settlement_sample_export
    WHERE import_class NOT IN ('safe_new', 'safe_update')
  ) THEN
    RAISE EXCEPTION 'settlement tiny sample: non-automatic class leaked into export';
  END IF;

  IF EXISTS (
    SELECT 1 FROM settlement_sample_export
    WHERE external_id IN ('osm:node:4', 'osm:node:5', 'osm:node:6', 'osm:node:7', 'osm:node:8')
  ) THEN
    RAISE EXCEPTION 'settlement tiny sample: conflict/review/invalid/unresolved row was exported';
  END IF;
END $$;

SELECT
  'settlement_tiny_sample' AS section,
  import_class,
  count(*) AS n
FROM settlement_sample_candidates
GROUP BY import_class
ORDER BY import_class;

SELECT
  'settlement_tiny_sample_export' AS section,
  external_id,
  import_class,
  class_code
FROM settlement_sample_export
ORDER BY external_id;

ROLLBACK;
