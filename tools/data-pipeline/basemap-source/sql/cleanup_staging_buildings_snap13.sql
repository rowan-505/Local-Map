-- =============================================================================
-- Clean temporary staging building rows for snapshot 13.
-- Run only after basemap_source.buildings is verified and backed up.
--
-- Default: dry-run (no deletes). Pass -v apply=true to delete.
-- Shell gate: EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND (enforced by runner).
--
-- Touches only: staging.staging_building_candidates WHERE source_snapshot_id = 13
-- Does NOT drop staging schema, raw, basemap_source, prod_mirror, or other families.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif

SELECT CASE WHEN lower(:'apply') IN ('true', 't', '1', 'yes') THEN true ELSE false END AS do_apply
\gset

SELECT
  'cleanup_precheck' AS section,
  (SELECT count(*) FROM staging.staging_building_candidates WHERE source_snapshot_id = 13) AS staging_snap13,
  (SELECT count(*) FROM basemap_source.buildings WHERE source_snapshot_id = 13) AS basemap_snap13,
  :'apply'::text AS apply_flag;

DO $$
DECLARE
  v_staging bigint;
  v_basemap bigint;
  v_expected constant bigint := 5578282;
BEGIN
  SELECT count(*) INTO v_staging
  FROM staging.staging_building_candidates WHERE source_snapshot_id = 13;
  SELECT count(*) INTO v_basemap
  FROM basemap_source.buildings WHERE source_snapshot_id = 13;

  IF v_basemap <> v_expected THEN
    RAISE EXCEPTION
      'cleanup refused: basemap_source.buildings snap13 count=% expected=%',
      v_basemap, v_expected;
  END IF;

  IF v_staging = 0 THEN
    RAISE NOTICE 'cleanup: staging snap13 already empty (nothing to delete)';
  ELSE
    RAISE NOTICE 'cleanup: staging snap13 rows=% basemap=%', v_staging, v_basemap;
  END IF;
END $$;

\if :do_apply
BEGIN;
DELETE FROM staging.staging_building_candidates
WHERE source_snapshot_id = 13;
COMMIT;
\echo cleanup APPLIED: deleted staging.staging_building_candidates snapshot 13
\else
\echo cleanup DRY-RUN: no rows deleted (pass -v apply=true with EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND)
\endif

SELECT
  'cleanup_postcheck' AS section,
  (SELECT count(*) FROM staging.staging_building_candidates WHERE source_snapshot_id = 13) AS staging_snap13,
  (SELECT count(*) FROM basemap_source.buildings WHERE source_snapshot_id = 13) AS basemap_snap13,
  (SELECT count(*) FROM staging.staging_building_candidates) AS staging_buildings_total;
