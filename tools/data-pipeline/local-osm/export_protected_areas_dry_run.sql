-- Print protected-areas dry-run summary JSON for snapshot_id.
-- CSVs are written by the shell wrapper (psql \copy TO STDOUT).

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

SELECT json_build_object(
  'snapshot_id', :'snapshot_id'::bigint,
  'raw_candidates', (
    SELECT count(*) FROM raw.raw_osm_polygons r
    WHERE r.source_snapshot_id = :'snapshot_id'::bigint
      AND system.pipeline_is_protected_area_candidate_tags(r.tags)
  ),
  'unique_source_candidates', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
  ),
  'valid_geometry', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND coalesce(s.validation_status, '') <> 'invalid'
  ),
  'invalid_geometry', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND s.validation_status = 'invalid'
  ),
  'class_distribution', (
    SELECT coalesce(json_object_agg(class_code, n), '{}'::json) FROM (
      SELECT class_code, count(*)::int AS n
      FROM staging.staging_protected_area_candidates
      WHERE source_snapshot_id = :'snapshot_id'::bigint
      GROUP BY 1
    ) s
  ),
  'import_class_distribution', (
    SELECT coalesce(json_object_agg(coalesce(import_class, 'null'), n), '{}'::json) FROM (
      SELECT import_class, count(*)::int AS n
      FROM staging.staging_protected_area_candidates
      WHERE source_snapshot_id = :'snapshot_id'::bigint
      GROUP BY 1
    ) s
  ),
  'named_count', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND nullif(btrim(s.canonical_name), '') IS NOT NULL
  ),
  'myanmar_name_count', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND nullif(btrim(s.normalized_data->>'name_mm'), '') IS NOT NULL
  ),
  'english_name_count', (
    SELECT count(*) FROM staging.staging_protected_area_candidates s
    WHERE s.source_snapshot_id = :'snapshot_id'::bigint
      AND nullif(btrim(s.normalized_data->>'name_en'), '') IS NOT NULL
  ),
  'top_unmapped_protect_class', (
    SELECT coalesce(json_agg(x), '[]'::json) FROM (
      SELECT tag_value, count(*)::int AS n
      FROM staging.staging_osm_unmapped_tags
      WHERE source_snapshot_id = :'snapshot_id'::bigint
        AND entity_family = 'protected_areas' AND tag_key = 'protect_class'
      GROUP BY 1 ORDER BY n DESC LIMIT 20
    ) x
  ),
  'top_unmapped_designation', (
    SELECT coalesce(json_agg(x), '[]'::json) FROM (
      SELECT tag_value, count(*)::int AS n
      FROM staging.staging_osm_unmapped_tags
      WHERE source_snapshot_id = :'snapshot_id'::bigint
        AND entity_family = 'protected_areas' AND tag_key = 'designation'
      GROUP BY 1 ORDER BY n DESC LIMIT 20
    ) x
  ),
  'top_unmapped_protection_title', (
    SELECT coalesce(json_agg(x), '[]'::json) FROM (
      SELECT tag_value, count(*)::int AS n
      FROM staging.staging_osm_unmapped_tags
      WHERE source_snapshot_id = :'snapshot_id'::bigint
        AND entity_family = 'protected_areas' AND tag_key = 'protection_title'
      GROUP BY 1 ORDER BY n DESC LIMIT 20
    ) x
  ),
  'spatial', json_build_object(
    'tiny_lt_100m2', (
      SELECT count(*) FROM staging.staging_protected_area_candidates s
      WHERE s.source_snapshot_id = :'snapshot_id'::bigint AND s.area_m2 < 100
    ),
    'huge_gt_5000km2', (
      SELECT count(*) FROM staging.staging_protected_area_candidates s
      WHERE s.source_snapshot_id = :'snapshot_id'::bigint AND s.area_m2 > 5e9
    ),
    'outside_land_bbox', (
      SELECT count(*) FROM staging.staging_protected_area_candidates s
      WHERE s.source_snapshot_id = :'snapshot_id'::bigint
        AND NOT system.pipeline_geom_in_myanmar_bounds(s.geom)
    ),
    'duplicate_source_ids', (
      SELECT count(*) FROM (
        SELECT external_id
        FROM staging.staging_protected_area_candidates
        WHERE source_snapshot_id = :'snapshot_id'::bigint
        GROUP BY 1 HAVING count(*) > 1
      ) d
    ),
    'invalid_multipolygon', (
      SELECT count(*) FROM staging.staging_protected_area_candidates s
      WHERE s.source_snapshot_id = :'snapshot_id'::bigint
        AND NOT ST_IsValid(s.geom)
    ),
    'duplicate_geometry', (
      SELECT count(*) FROM staging.staging_protected_area_candidates s
      WHERE s.source_snapshot_id = :'snapshot_id'::bigint
        AND EXISTS (
          SELECT 1 FROM staging.staging_protected_area_candidates o
          WHERE o.source_snapshot_id = s.source_snapshot_id
            AND o.id > s.id
            AND o.geom && s.geom
            AND ST_Equals(o.geom, s.geom)
        )
    )
  )
) AS dry_run_summary;
