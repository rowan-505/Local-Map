-- =============================================================================
-- One-time: classify + dry-run / gated apply Core export → basemap_source.buildings
--
-- Prerequisites:
--   1) local migration 011 applied
--   2) CSV loaded into basemap_source.core_buildings_export
--
-- Variables (psql -v):
--   execute_merge = '0' (default dry-run) | '1' (apply)
--
-- Apply gate in shell: EXECUTE_CORE_BASEMAP_MERGE=I_UNDERSTAND → execute_merge=1
-- =============================================================================

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS basemap_source;

-- Persistent report of last classify/apply (overwrite each run).
DROP TABLE IF EXISTS basemap_source.core_buildings_merge_report;
CREATE TABLE basemap_source.core_buildings_merge_report (
  core_id            bigint PRIMARY KEY,
  core_public_id     uuid NOT NULL,
  external_id        text,
  action             text NOT NULL
    CHECK (action IN (
      'MERGED_EXISTING_OSM',
      'INSERTED_COREMAP_MANAGED',
      'ALREADY_IMPORTED',
      'MANUAL_REVIEW',
      'SKIPPED_SOFT_DELETED'
    )),
  reason             text NOT NULL,
  local_id           bigint,
  typed_local_id     bigint,
  canon_local_id     bigint,
  geom_hash_equal    boolean,
  core_geom_hash     text,
  local_geom_hash    text,
  is_soft_deleted    boolean NOT NULL DEFAULT false,
  classified_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS core_buildings_merge_report_action_idx
  ON basemap_source.core_buildings_merge_report (action);

-- ---------------------------------------------------------------------------
-- Classify every Core export row
-- ---------------------------------------------------------------------------
WITH export_norm AS (
  SELECT
    e.core_id,
    e.core_public_id,
    nullif(btrim(e.external_id), '') AS external_id,
    CASE
      WHEN lower(btrim(coalesce(e.source_feature_type, ''))) IN ('way', 'relation')
        AND nullif(btrim(e.source_feature_id), '') ~ '^[0-9]+$'
        AND nullif(btrim(e.source_feature_id), '')::bigint > 0
      THEN lower(btrim(e.source_feature_type))
      ELSE NULL
    END AS typed_ft,
    CASE
      WHEN lower(btrim(coalesce(e.source_feature_type, ''))) IN ('way', 'relation')
        AND nullif(btrim(e.source_feature_id), '') ~ '^[0-9]+$'
        AND nullif(btrim(e.source_feature_id), '')::bigint > 0
      THEN nullif(btrim(e.source_feature_id), '')::bigint
      ELSE NULL
    END AS typed_oid,
    system.pipeline_osm_identity_key(e.external_id) AS identity_key,
    CASE
      WHEN system.pipeline_osm_identity_key(e.external_id) IS NOT NULL
      THEN split_part(system.pipeline_osm_identity_key(e.external_id), ':', 2)
      ELSE NULL
    END AS canon_ft,
    CASE
      WHEN system.pipeline_osm_identity_key(e.external_id) IS NOT NULL
        AND split_part(system.pipeline_osm_identity_key(e.external_id), ':', 3) ~ '^[0-9]+$'
      THEN split_part(system.pipeline_osm_identity_key(e.external_id), ':', 3)::bigint
      ELSE NULL
    END AS canon_oid,
    e.geom_hash AS core_geom_hash,
    coalesce(e.is_soft_deleted, false) AS is_soft_deleted,
    coalesce(e.is_active, true) AS is_active
  FROM basemap_source.core_buildings_export e
),
typed_hits AS (
  SELECT
    n.core_id,
    count(b.id)::int AS hit_count,
    min(b.id) AS local_id
  FROM export_norm n
  JOIN basemap_source.buildings b
    ON n.typed_ft IS NOT NULL
   AND b.osm_feature_type = n.typed_ft
   AND b.osm_id = n.typed_oid
  GROUP BY n.core_id
),
canon_hits AS (
  SELECT
    n.core_id,
    count(b.id)::int AS hit_count,
    min(b.id) AS local_id
  FROM export_norm n
  JOIN basemap_source.buildings b
    ON n.canon_ft IS NOT NULL
   AND n.canon_oid IS NOT NULL
   AND b.osm_feature_type = n.canon_ft
   AND b.osm_id = n.canon_oid
  GROUP BY n.core_id
),
core_pub_hits AS (
  SELECT
    n.core_id,
    count(b.id)::int AS hit_count,
    min(b.id) AS local_id
  FROM export_norm n
  JOIN basemap_source.buildings b
    ON b.core_public_id = n.core_public_id
  GROUP BY n.core_id
),
resolved AS (
  SELECT
    n.*,
    coalesce(t.hit_count, 0) AS typed_hits,
    t.local_id AS typed_local_id,
    coalesce(c.hit_count, 0) AS canon_hits,
    c.local_id AS canon_local_id,
    coalesce(p.hit_count, 0) AS core_pub_hits,
    p.local_id AS core_pub_local_id,
    CASE
      WHEN coalesce(t.hit_count, 0) = 1 THEN t.local_id
      WHEN coalesce(t.hit_count, 0) = 0 AND coalesce(c.hit_count, 0) = 1 THEN c.local_id
      WHEN coalesce(t.hit_count, 0) = 0 AND coalesce(c.hit_count, 0) = 0
           AND coalesce(p.hit_count, 0) = 1 THEN p.local_id
      ELSE NULL
    END AS candidate_local_id,
    CASE
      WHEN coalesce(t.hit_count, 0) > 1 THEN 'typed_multi'
      WHEN coalesce(t.hit_count, 0) = 0 AND coalesce(c.hit_count, 0) > 1 THEN 'canon_multi'
      WHEN coalesce(t.hit_count, 0) = 1
           AND coalesce(c.hit_count, 0) = 1
           AND t.local_id IS DISTINCT FROM c.local_id THEN 'typed_canon_conflict'
      WHEN coalesce(t.hit_count, 0) = 0
           AND coalesce(c.hit_count, 0) = 0
           AND coalesce(p.hit_count, 0) > 1 THEN 'core_public_id_multi'
      WHEN coalesce(t.hit_count, 0) = 0
           AND coalesce(c.hit_count, 0) = 0
           AND coalesce(p.hit_count, 0) = 0
           AND n.typed_ft IS NULL
           AND n.identity_key IS NULL
           AND n.external_id IS NOT NULL
           AND lower(n.external_id) LIKE 'osm:%'
           AND system.pipeline_osm_identity_key(n.external_id) IS NULL
        THEN 'osm_like_unparseable'
      ELSE NULL
    END AS early_reject
  FROM export_norm n
  LEFT JOIN typed_hits t ON t.core_id = n.core_id
  LEFT JOIN canon_hits c ON c.core_id = n.core_id
  LEFT JOIN core_pub_hits p ON p.core_id = n.core_id
),
with_geom AS (
  SELECT
    r.*,
    CASE
      WHEN r.candidate_local_id IS NOT NULL
      THEN md5(ST_AsBinary(ST_Normalize(b.geom)))
      ELSE NULL
    END AS local_geom_hash,
    CASE
      WHEN r.candidate_local_id IS NOT NULL
        AND r.core_geom_hash IS NOT NULL
        AND r.core_geom_hash = md5(ST_AsBinary(ST_Normalize(b.geom)))
      THEN true
      WHEN r.candidate_local_id IS NOT NULL
        AND r.core_geom_hash IS NOT NULL
      THEN false
      ELSE NULL
    END AS geom_hash_equal,
    CASE
      WHEN r.candidate_local_id IS NOT NULL AND b.core_public_id IS NOT NULL
        AND b.core_public_id IS DISTINCT FROM r.core_public_id
      THEN true
      ELSE false
    END AS local_core_public_id_conflict
  FROM resolved r
  LEFT JOIN basemap_source.buildings b ON b.id = r.candidate_local_id
),
classified AS (
  SELECT
    g.core_id,
    g.core_public_id,
    g.external_id,
    CASE
      WHEN g.early_reject IS NOT NULL THEN 'MANUAL_REVIEW'
      WHEN g.local_core_public_id_conflict THEN 'MANUAL_REVIEW'
      WHEN g.typed_hits = 1 OR (g.typed_hits = 0 AND g.canon_hits = 1) THEN
        CASE
          WHEN g.geom_hash_equal IS TRUE THEN 'MERGED_EXISTING_OSM'
          ELSE 'MANUAL_REVIEW'
        END
      WHEN g.core_pub_hits = 1 THEN 'ALREADY_IMPORTED'
      WHEN g.is_soft_deleted OR NOT g.is_active THEN 'SKIPPED_SOFT_DELETED'
      ELSE 'INSERTED_COREMAP_MANAGED'
    END AS action,
    CASE
      WHEN g.early_reject IS NOT NULL THEN g.early_reject
      WHEN g.local_core_public_id_conflict THEN 'local_row_already_linked_other_core_public_id'
      WHEN g.typed_hits = 1 OR (g.typed_hits = 0 AND g.canon_hits = 1) THEN
        CASE
          WHEN g.geom_hash_equal IS TRUE THEN
            CASE WHEN g.typed_hits = 1 THEN 'typed_osm_match_geom_equal' ELSE 'canon_osm_match_geom_equal' END
          ELSE 'geom_hash_mismatch'
        END
      WHEN g.core_pub_hits = 1 THEN 'core_public_id_match'
      WHEN g.is_soft_deleted OR NOT g.is_active THEN 'soft_deleted_or_inactive_no_local_match'
      ELSE 'no_local_match_insert_managed'
    END AS reason,
    CASE
      WHEN g.early_reject IS NOT NULL THEN NULL
      WHEN g.local_core_public_id_conflict THEN NULL
      WHEN (g.typed_hits = 1 OR (g.typed_hits = 0 AND g.canon_hits = 1))
           AND g.geom_hash_equal IS TRUE THEN g.candidate_local_id
      WHEN g.core_pub_hits = 1 THEN g.candidate_local_id
      ELSE NULL
    END AS local_id,
    g.typed_local_id,
    g.canon_local_id,
    g.geom_hash_equal,
    g.core_geom_hash,
    g.local_geom_hash,
    g.is_soft_deleted
  FROM with_geom g
)
INSERT INTO basemap_source.core_buildings_merge_report (
  core_id, core_public_id, external_id, action, reason,
  local_id, typed_local_id, canon_local_id,
  geom_hash_equal, core_geom_hash, local_geom_hash, is_soft_deleted
)
SELECT
  core_id, core_public_id, external_id, action, reason,
  local_id, typed_local_id, canon_local_id,
  geom_hash_equal, core_geom_hash, local_geom_hash, is_soft_deleted
FROM classified;

-- ---------------------------------------------------------------------------
-- Dry-run summary
-- ---------------------------------------------------------------------------
\echo '=== CORE→BASEMAP MERGE DRY-RUN SUMMARY ==='

SELECT 'export_rows' AS metric, count(*)::text AS value
FROM basemap_source.core_buildings_export
UNION ALL
SELECT 'action=' || action, count(*)::text
FROM basemap_source.core_buildings_merge_report
GROUP BY action
UNION ALL
SELECT 'typed_exact_hits', count(*)::text
FROM basemap_source.core_buildings_merge_report
WHERE typed_local_id IS NOT NULL
UNION ALL
SELECT 'canon_exact_hits', count(*)::text
FROM basemap_source.core_buildings_merge_report
WHERE canon_local_id IS NOT NULL
UNION ALL
SELECT 'local_before', count(*)::text
FROM basemap_source.buildings
UNION ALL
SELECT 'osm_rows_before', count(*)::text
FROM basemap_source.buildings
WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
UNION ALL
SELECT 'to_insert', count(*)::text
FROM basemap_source.core_buildings_merge_report
WHERE action = 'INSERTED_COREMAP_MANAGED'
UNION ALL
SELECT 'expected_local_after',
  (
    (SELECT count(*) FROM basemap_source.buildings)
    + (SELECT count(*) FROM basemap_source.core_buildings_merge_report WHERE action = 'INSERTED_COREMAP_MANAGED')
  )::text
ORDER BY 1;

SELECT reason, count(*) AS n
FROM basemap_source.core_buildings_merge_report
WHERE action = 'MANUAL_REVIEW'
GROUP BY reason
ORDER BY n DESC, reason;

-- Gate checks (must all pass for apply)
DO $$
DECLARE
  v_typed_multi bigint;
  v_core_pub_multi bigint;
  v_identity_conflict bigint;
  v_bad_insert_geom bigint;
  v_execute text := current_setting('coremap.execute_merge', true);
BEGIN
  SELECT count(*) INTO v_typed_multi
  FROM basemap_source.core_buildings_merge_report
  WHERE reason = 'typed_multi';

  SELECT count(*) INTO v_core_pub_multi
  FROM basemap_source.core_buildings_merge_report
  WHERE reason = 'core_public_id_multi';

  SELECT count(*) INTO v_identity_conflict
  FROM basemap_source.core_buildings_merge_report
  WHERE reason IN ('typed_canon_conflict', 'local_row_already_linked_other_core_public_id');

  SELECT count(*) INTO v_bad_insert_geom
  FROM basemap_source.core_buildings_merge_report r
  JOIN basemap_source.core_buildings_export e ON e.core_id = r.core_id
  WHERE r.action = 'INSERTED_COREMAP_MANAGED'
    AND (
      e.geom_ewkt IS NULL
      OR e.geom_srid IS DISTINCT FROM 4326
      OR e.geom_type NOT IN ('ST_MultiPolygon', 'ST_Polygon')
      OR NOT ST_IsValid(ST_GeomFromEWKT(e.geom_ewkt))
      OR ST_IsEmpty(ST_GeomFromEWKT(e.geom_ewkt))
    );

  RAISE NOTICE 'gate typed_multi=% core_pub_multi=% identity_conflict=% bad_insert_geom=%',
    v_typed_multi, v_core_pub_multi, v_identity_conflict, v_bad_insert_geom;

  IF coalesce(v_execute, '0') <> '1' THEN
    RAISE NOTICE 'DRY-RUN only (execute_merge!=1). No writes applied.';
    RETURN;
  END IF;

  IF v_typed_multi > 0 THEN
    RAISE EXCEPTION 'APPLY BLOCKED: typed_multi=% (must be 0)', v_typed_multi;
  END IF;
  IF v_core_pub_multi > 0 THEN
    RAISE EXCEPTION 'APPLY BLOCKED: core_public_id_multi=% (must be 0)', v_core_pub_multi;
  END IF;
  IF v_identity_conflict > 0 THEN
    RAISE EXCEPTION 'APPLY BLOCKED: identity_conflict=% (must be 0)', v_identity_conflict;
  END IF;
  IF v_bad_insert_geom > 0 THEN
    RAISE EXCEPTION 'APPLY BLOCKED: bad_insert_geom=% (must be 0)', v_bad_insert_geom;
  END IF;

  -- A/C: merge + already imported metadata refresh
  UPDATE basemap_source.buildings b
  SET
    is_managed_in_core = true,
    core_id = e.core_id,
    core_public_id = e.core_public_id,
    source_type = coalesce(b.source_type, 'osm'),
    source_feature_type = coalesce(
      nullif(btrim(e.source_feature_type), ''),
      b.source_feature_type,
      b.osm_feature_type
    ),
    source_feature_id = coalesce(
      nullif(btrim(e.source_feature_id), ''),
      b.source_feature_id,
      b.osm_id::text
    ),
    core_metadata = jsonb_strip_nulls(jsonb_build_object(
      'building_type_code', e.building_type_code,
      'admin_area_id', e.admin_area_id,
      'levels', e.levels,
      'height_m', e.height_m,
      'confidence', e.confidence,
      'verification_status', e.verification_status,
      'is_active', e.is_active,
      'is_soft_deleted', e.is_soft_deleted,
      'deleted_at', e.deleted_at,
      'is_geometry_manually_edited', e.is_geometry_manually_edited,
      'is_attributes_manually_edited', e.is_attributes_manually_edited,
      'core_name', e.core_name,
      'source_refs', e.source_refs,
      'normalized_data', e.normalized_data,
      'names', e.names_json,
      'place_link_count', e.place_link_count,
      'geometry_hash_equal', r.geom_hash_equal,
      'merge_action', r.action,
      'merged_at', now()
    )),
    updated_at = now()
  FROM basemap_source.core_buildings_merge_report r
  JOIN basemap_source.core_buildings_export e ON e.core_id = r.core_id
  WHERE r.action IN ('MERGED_EXISTING_OSM', 'ALREADY_IMPORTED')
    AND r.local_id IS NOT NULL
    AND b.id = r.local_id;

  -- B: insert managed Core-only rows
  INSERT INTO basemap_source.buildings (
    external_id,
    osm_feature_type,
    osm_id,
    source_snapshot_id,
    class_code,
    canonical_name,
    normalized_data,
    source_refs,
    geom,
    geometry_hash,
    core_id,
    core_public_id,
    source_type,
    source_feature_type,
    source_feature_id,
    is_managed_in_core,
    core_metadata,
    imported_at,
    updated_at
  )
  SELECT
    'coremap:building:' || e.core_public_id::text,
    NULL,
    NULL,
    NULL,
    coalesce(nullif(btrim(e.building_type_code), ''), 'managed'),
    coalesce(
      nullif(btrim(e.core_name), ''),
      nullif(btrim((
        SELECT n->>'name'
        FROM jsonb_array_elements(coalesce(e.names_json, '[]'::jsonb)) WITH ORDINALITY AS t(n, ord)
        ORDER BY
          CASE WHEN (n->>'is_primary')::boolean IS TRUE THEN 0 ELSE 1 END,
          CASE n->>'language_code' WHEN 'my' THEN 0 WHEN 'en' THEN 1 ELSE 2 END,
          ord
        LIMIT 1
      )), '')
    ),
    coalesce(e.normalized_data, '{}'::jsonb),
    coalesce(e.source_refs, '{}'::jsonb)
      || jsonb_build_object(
        'core_public_id', e.core_public_id,
        'core_id', e.core_id,
        'source', 'coremap_managed'
      ),
    CASE
      WHEN GeometryType(ST_GeomFromEWKT(e.geom_ewkt)) = 'POLYGON'
      THEN ST_Multi(ST_GeomFromEWKT(e.geom_ewkt))
      ELSE ST_GeomFromEWKT(e.geom_ewkt)
    END::geometry(MultiPolygon, 4326),
    e.geom_hash,
    e.core_id,
    e.core_public_id,
    'coremap',
    'managed_building',
    e.core_public_id::text,
    true,
    jsonb_strip_nulls(jsonb_build_object(
      'building_type_code', e.building_type_code,
      'admin_area_id', e.admin_area_id,
      'levels', e.levels,
      'height_m', e.height_m,
      'confidence', e.confidence,
      'verification_status', e.verification_status,
      'is_active', e.is_active,
      'is_soft_deleted', e.is_soft_deleted,
      'is_geometry_manually_edited', e.is_geometry_manually_edited,
      'is_attributes_manually_edited', e.is_attributes_manually_edited,
      'core_name', e.core_name,
      'names', e.names_json,
      'place_link_count', e.place_link_count,
      'geometry_hash_equal', NULL,
      'merge_action', 'INSERTED_COREMAP_MANAGED',
      'merged_at', now()
    )),
    now(),
    now()
  FROM basemap_source.core_buildings_merge_report r
  JOIN basemap_source.core_buildings_export e ON e.core_id = r.core_id
  WHERE r.action = 'INSERTED_COREMAP_MANAGED'
  ON CONFLICT (external_id) DO NOTHING;

  -- Backfill local_id on report for inserted rows
  UPDATE basemap_source.core_buildings_merge_report r
  SET local_id = b.id
  FROM basemap_source.buildings b
  WHERE r.action = 'INSERTED_COREMAP_MANAGED'
    AND r.local_id IS NULL
    AND b.core_public_id = r.core_public_id;

  RAISE NOTICE 'APPLY COMPLETE';
END $$;

SELECT 'local_after' AS metric, count(*)::text AS value
FROM basemap_source.buildings
UNION ALL
SELECT 'osm_rows_after', count(*)::text
FROM basemap_source.buildings
WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
UNION ALL
SELECT 'managed_rows', count(*)::text
FROM basemap_source.buildings
WHERE source_type = 'coremap'
UNION ALL
SELECT 'linked_core_public_id', count(*)::text
FROM basemap_source.buildings
WHERE core_public_id IS NOT NULL;
