-- Build one national MultiLineString coastline artifact from staging ways.
-- Local only. Does not write Core / Supabase.
\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

CREATE TEMP TABLE coastline_export_context AS
SELECT id AS source_snapshot_id, snapshot_version, source_registry_id, checksum
FROM system.system_source_snapshots
WHERE snapshot_version = :'snapshot_version';

SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM coastline_export_context) THEN 1 ELSE 0 END
  AS snapshot_found;

CREATE TEMP TABLE coastline_export_geom AS
WITH ways AS (
  SELECT ST_CollectionExtract(ST_MakeValid(c.geom), 2) AS geom
  FROM :"staging_schema".staging_coastline_candidates AS c
  JOIN coastline_export_context AS x ON x.source_snapshot_id = c.source_snapshot_id
  WHERE c.geom IS NOT NULL
    AND NOT ST_IsEmpty(c.geom)
),
merged AS (
  SELECT ST_LineMerge(ST_UnaryUnion(ST_Collect(geom))) AS geom
  FROM ways
)
SELECT
  ST_Multi(
    ST_CollectionExtract(
      CASE
        WHEN GeometryType(geom) IN ('LINESTRING', 'MULTILINESTRING') THEN geom
        ELSE ST_CollectionExtract(geom, 2)
      END,
      2
    )
  )::geometry(MultiLineString, 4326) AS geom
FROM merged;

DO $$
DECLARE
  v_geom geometry;
  v_parts bigint;
  v_len_km numeric;
BEGIN
  SELECT geom INTO v_geom FROM coastline_export_geom;
  IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
    RAISE EXCEPTION 'coastline export: empty merged geometry';
  END IF;
  IF NOT ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'coastline export: invalid merged geometry: %', ST_IsValidReason(v_geom);
  END IF;
  v_parts := ST_NumGeometries(v_geom);
  v_len_km := round((ST_Length(v_geom::geography) / 1000.0)::numeric, 2);
  RAISE NOTICE 'coastline_export parts=% length_km=%', v_parts, v_len_km;
END $$;

CREATE TEMP TABLE coastline_export_rows AS
SELECT
  'national'::text AS scope,
  x.snapshot_version,
  x.source_snapshot_id,
  x.source_registry_id,
  x.checksum AS source_checksum,
  (
    SELECT count(*)::bigint
    FROM :"staging_schema".staging_coastline_candidates c
    WHERE c.source_snapshot_id = x.source_snapshot_id
  ) AS source_way_count,
  ST_NumGeometries(g.geom) AS component_count,
  round((ST_Length(g.geom::geography) / 1000.0)::numeric, 2) AS length_km,
  ST_AsEWKT(g.geom) AS geom_ewkt
FROM coastline_export_context x
CROSS JOIN coastline_export_geom g;

\copy coastline_export_rows TO :'output_path' WITH (FORMAT csv, HEADER true)

SELECT
  'coastline_export' AS section,
  source_way_count,
  component_count,
  length_km
FROM coastline_export_rows;
