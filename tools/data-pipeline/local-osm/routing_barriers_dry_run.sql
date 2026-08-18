-- =============================================================================
-- National routing-barrier dry-run (local only)
-- =============================================================================
-- Rebuilds staging.staging_routing_barrier_candidates for one snapshot:
--   extract supported node barriers → normalize → match OSM highway parents
--   → resolve core.core_streets via prod_mirror → classify vs mirrored prod
--
-- psql vars:
--   snapshot_id
--   snapshot_version
--   region_code
--   touch_m          (default 5)
--   spatial_fallback_m (default 5)
--   unrelated_m      (default 25)
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?touch_m}
\else
\set touch_m 5
\endif
\if :{?spatial_fallback_m}
\else
\set spatial_fallback_m 5
\endif
\if :{?unrelated_m}
\else
\set unrelated_m 25
\endif

\ir pipeline_source_identity.sql

CREATE TEMP TABLE rb_params (
  snapshot_id bigint PRIMARY KEY,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  touch_m double precision NOT NULL,
  spatial_fallback_m double precision NOT NULL,
  unrelated_m double precision NOT NULL,
  touch_deg double precision NOT NULL,
  spatial_fallback_deg double precision NOT NULL,
  unrelated_deg double precision NOT NULL
);

INSERT INTO rb_params (
  snapshot_id, snapshot_version, region_code,
  touch_m, spatial_fallback_m, unrelated_m,
  touch_deg, spatial_fallback_deg, unrelated_deg
)
VALUES (
  :'snapshot_id'::bigint,
  :'snapshot_version',
  :'region_code',
  :'touch_m'::double precision,
  :'spatial_fallback_m'::double precision,
  :'unrelated_m'::double precision,
  :'touch_m'::double precision / 111320.0,
  :'spatial_fallback_m'::double precision / 111320.0,
  :'unrelated_m'::double precision / 111320.0
);

CREATE TEMP TABLE rb_supported_types (
  barrier_type text PRIMARY KEY
);

INSERT INTO rb_supported_types (barrier_type) VALUES
  ('gate'),
  ('lift_gate'),
  ('swing_gate'),
  ('bollard'),
  ('block'),
  ('chain'),
  ('cycle_barrier'),
  ('toll_booth'),
  ('border_control'),
  ('cattle_grid');

CREATE TEMP TABLE rb_access_keys (
  access_key text PRIMARY KEY
);

INSERT INTO rb_access_keys (access_key) VALUES
  ('access'),
  ('vehicle'),
  ('motor_vehicle'),
  ('motorcar'),
  ('motorcycle'),
  ('bicycle'),
  ('foot'),
  ('bus'),
  ('hgv');

-- ---------------------------------------------------------------------------
-- 1) Inventory every barrier=* node in this snapshot
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_all_nodes AS
SELECT
  r.id AS raw_id,
  r.osm_id,
  r.osm_feature_type,
  lower(btrim(r.tags->>'barrier')) AS barrier_type_raw,
  r.tags,
  r.geom
FROM raw.raw_osm_points AS r
CROSS JOIN rb_params AS p
WHERE r.source_snapshot_id = p.snapshot_id
  AND r.geom IS NOT NULL
  AND nullif(btrim(r.tags->>'barrier'), '') IS NOT NULL;

CREATE INDEX ON rb_all_nodes (barrier_type_raw);
CREATE INDEX ON rb_all_nodes USING GIST (geom);

CREATE TEMP TABLE rb_unsupported_stats AS
SELECT
  coalesce(nullif(barrier_type_raw, ''), '(empty)') AS barrier_type,
  count(*)::bigint AS n
FROM rb_all_nodes
WHERE barrier_type_raw IS NULL
   OR barrier_type_raw NOT IN (SELECT barrier_type FROM rb_supported_types)
GROUP BY 1
ORDER BY n DESC, barrier_type;

-- ---------------------------------------------------------------------------
-- 2) Supported candidates + normalize
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_supported AS
SELECT
  n.raw_id,
  n.osm_id,
  n.osm_feature_type,
  n.barrier_type_raw AS barrier_type,
  n.tags,
  ST_Force2D(n.geom)::geometry(Point, 4326) AS geom,
  (
    SELECT jsonb_object_agg(k.access_key, nullif(btrim(n.tags->>k.access_key), ''))
    FROM rb_access_keys AS k
    WHERE nullif(btrim(n.tags->>k.access_key), '') IS NOT NULL
  ) AS access_rules,
  system.pipeline_osm_external_id(n.osm_feature_type, n.osm_id) AS external_id
FROM rb_all_nodes AS n
WHERE n.barrier_type_raw IN (SELECT barrier_type FROM rb_supported_types)
  AND ST_IsValid(n.geom)
  AND ST_GeometryType(n.geom) = 'ST_Point'
  AND ST_SRID(n.geom) = 4326;

CREATE UNIQUE INDEX ON rb_supported (external_id);
CREATE INDEX ON rb_supported USING GIST (geom);
CREATE INDEX ON rb_supported (osm_id);

-- ---------------------------------------------------------------------------
-- 3) Parent OSM highway ways from local raw snapshot
--    Prefer ways that pass through the barrier node (tight geographic tolerance).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_highway_ways AS
SELECT
  l.id AS raw_line_id,
  l.osm_id AS osm_way_id,
  l.tags AS way_tags,
  ST_Force2D(
    CASE
      WHEN ST_GeometryType(l.geom) = 'ST_MultiLineString' THEN ST_LineMerge(l.geom)
      ELSE l.geom
    END
  ) AS geom
FROM raw.raw_osm_lines AS l
CROSS JOIN rb_params AS p
WHERE l.source_snapshot_id = p.snapshot_id
  AND l.geom IS NOT NULL
  AND l.tags ? 'highway'
  AND nullif(btrim(l.tags->>'highway'), '') IS NOT NULL
  AND lower(btrim(l.osm_feature_type)) IN ('way', 'w');

CREATE INDEX ON rb_highway_ways (osm_way_id);
CREATE INDEX ON rb_highway_ways USING GIST (geom);

CREATE TEMP TABLE rb_way_hits AS
SELECT
  s.external_id,
  w.osm_way_id,
  ST_Distance(s.geom::geography, w.geom::geography) AS dist_m
FROM rb_supported AS s
JOIN rb_highway_ways AS w
  ON w.geom && ST_Expand(s.geom, (SELECT touch_deg FROM rb_params))
 AND ST_DWithin(s.geom, w.geom, (SELECT touch_deg FROM rb_params));

CREATE INDEX ON rb_way_hits (external_id);

CREATE TEMP TABLE rb_way_choice AS
SELECT
  h.external_id,
  count(*)::int AS way_hit_count,
  min(h.dist_m) AS min_dist_m,
  CASE
    WHEN count(*) = 1 THEN min(h.osm_way_id)
    WHEN count(*) FILTER (WHERE h.dist_m <= 0.25) = 1
      THEN min(h.osm_way_id) FILTER (WHERE h.dist_m <= 0.25)
    ELSE NULL
  END AS osm_way_id,
  CASE
    WHEN count(*) = 1 THEN 'single_parent_way'
    WHEN count(*) FILTER (WHERE h.dist_m <= 0.25) = 1 THEN 'unique_touching_parent_way'
    WHEN count(*) > 1 THEN 'ambiguous_parent_ways'
    ELSE 'no_parent_way'
  END AS way_match_status
FROM rb_way_hits AS h
GROUP BY h.external_id;

-- Barriers with zero highway hits
INSERT INTO rb_way_choice (external_id, way_hit_count, min_dist_m, osm_way_id, way_match_status)
SELECT s.external_id, 0, NULL, NULL, 'no_parent_way'
FROM rb_supported AS s
WHERE NOT EXISTS (
  SELECT 1 FROM rb_way_choice AS c WHERE c.external_id = s.external_id
);

-- ---------------------------------------------------------------------------
-- 4) Resolve Core streets (prod_mirror.core_streets) by OSM way identity
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_street_by_way AS
SELECT
  c.external_id AS barrier_external_id,
  c.osm_way_id,
  s.id AS core_street_id,
  s.external_id AS street_external_id,
  ST_Distance(b.geom::geography, s.geom::geography) AS dist_m,
  (ST_DWithin(b.geom, s.geom, (SELECT touch_deg FROM rb_params))) AS touches
FROM rb_way_choice AS c
JOIN rb_supported AS b
  ON b.external_id = c.external_id
JOIN prod_mirror.core_streets AS s
  ON s.deleted_at IS NULL
 AND c.osm_way_id IS NOT NULL
 AND s.external_id IN (
   'osm:W:' || c.osm_way_id::text,
   'osm:way:' || c.osm_way_id::text
 );

CREATE INDEX ON rb_street_by_way (barrier_external_id);

CREATE TEMP TABLE rb_street_choice AS
WITH ranked AS (
  SELECT
    w.barrier_external_id,
    w.osm_way_id,
    w.core_street_id,
    w.street_external_id,
    w.dist_m,
    w.touches,
    count(*) OVER (PARTITION BY w.barrier_external_id) AS seg_count,
    count(*) FILTER (WHERE w.touches) OVER (PARTITION BY w.barrier_external_id) AS touch_count,
    row_number() OVER (
      PARTITION BY w.barrier_external_id
      ORDER BY
        CASE WHEN w.touches THEN 0 ELSE 1 END,
        w.dist_m NULLS LAST,
        w.core_street_id
    ) AS rn,
    row_number() OVER (
      PARTITION BY w.barrier_external_id
      ORDER BY w.dist_m NULLS LAST, w.core_street_id
    ) AS rn_near
  FROM rb_street_by_way AS w
),
picked AS (
  SELECT
    r.*,
    CASE
      WHEN r.seg_count = 1 THEN 'identity_single_segment'
      WHEN r.touch_count = 1 AND r.touches THEN 'identity_unique_touching_segment'
      WHEN r.seg_count > 1
           AND r.rn_near = 1
           AND r.dist_m <= (SELECT touch_m FROM rb_params)
           AND NOT EXISTS (
             SELECT 1
             FROM ranked AS o
             WHERE o.barrier_external_id = r.barrier_external_id
               AND o.core_street_id <> r.core_street_id
               AND o.dist_m <= (SELECT touch_m FROM rb_params)
           )
        THEN 'identity_nearest_within_tolerance'
      WHEN r.seg_count > 1 THEN 'identity_ambiguous_segments'
      ELSE 'identity_unmatched'
    END AS street_match_status
  FROM ranked AS r
)
SELECT
  barrier_external_id AS external_id,
  osm_way_id,
  CASE
    WHEN street_match_status IN (
      'identity_single_segment',
      'identity_unique_touching_segment',
      'identity_nearest_within_tolerance'
    )
      THEN core_street_id
    ELSE NULL
  END AS core_street_id,
  CASE
    WHEN street_match_status IN (
      'identity_single_segment',
      'identity_unique_touching_segment',
      'identity_nearest_within_tolerance'
    )
      THEN street_external_id
    ELSE NULL
  END AS street_external_id,
  dist_m,
  street_match_status,
  seg_count
FROM picked
WHERE rn = 1;

INSERT INTO rb_street_choice (
  external_id, osm_way_id, core_street_id, street_external_id, dist_m, street_match_status, seg_count
)
SELECT
  c.external_id,
  c.osm_way_id,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN c.way_match_status = 'ambiguous_parent_ways' THEN 'ambiguous_parent_ways'
    WHEN c.osm_way_id IS NOT NULL THEN 'identity_unmatched'
    ELSE 'no_parent_way'
  END,
  0
FROM rb_way_choice AS c
WHERE NOT EXISTS (
  SELECT 1 FROM rb_street_choice AS s WHERE s.external_id = c.external_id
);

-- ---------------------------------------------------------------------------
-- 5) Spatial-only fallback (exactly one street within tight tolerance)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_spatial_hits AS
SELECT
  s.external_id,
  st.id AS core_street_id,
  st.external_id AS street_external_id,
  ST_Distance(s.geom::geography, st.geom::geography) AS dist_m
FROM rb_supported AS s
JOIN rb_street_choice AS c
  ON c.external_id = s.external_id
JOIN prod_mirror.core_streets AS st
  ON st.deleted_at IS NULL
 AND st.geom && ST_Expand(s.geom, (SELECT spatial_fallback_deg FROM rb_params))
 AND ST_DWithin(s.geom, st.geom, (SELECT spatial_fallback_deg FROM rb_params))
WHERE c.core_street_id IS NULL
  AND c.street_match_status IN ('no_parent_way', 'identity_unmatched');

CREATE TEMP TABLE rb_spatial_choice AS
SELECT
  h.external_id,
  count(*)::int AS hit_count,
  CASE WHEN count(*) = 1 THEN min(h.core_street_id) ELSE NULL END AS core_street_id,
  CASE WHEN count(*) = 1 THEN min(h.street_external_id) ELSE NULL END AS street_external_id,
  min(h.dist_m) AS dist_m,
  CASE
    WHEN count(*) = 1 THEN 'spatial_unique_fallback'
    WHEN count(*) > 1 THEN 'spatial_ambiguous'
    ELSE 'spatial_none'
  END AS street_match_status
FROM rb_spatial_hits AS h
GROUP BY h.external_id;

UPDATE rb_street_choice AS c
SET
  core_street_id = sc.core_street_id,
  street_external_id = sc.street_external_id,
  dist_m = sc.dist_m,
  street_match_status = sc.street_match_status
FROM rb_spatial_choice AS sc
WHERE c.external_id = sc.external_id
  AND sc.street_match_status = 'spatial_unique_fallback'
  AND c.core_street_id IS NULL;

UPDATE rb_street_choice AS c
SET street_match_status = sc.street_match_status
FROM rb_spatial_choice AS sc
WHERE c.external_id = sc.external_id
  AND sc.street_match_status = 'spatial_ambiguous'
  AND c.core_street_id IS NULL;

-- Far from network → mark unrelated (skip later)
UPDATE rb_street_choice AS c
SET street_match_status = 'unrelated_no_network'
WHERE c.core_street_id IS NULL
  AND c.street_match_status IN ('no_parent_way', 'identity_unmatched', 'spatial_none')
  AND NOT EXISTS (
    SELECT 1
    FROM rb_supported AS s
    JOIN prod_mirror.core_streets AS st
      ON st.deleted_at IS NULL
     AND st.geom && ST_Expand(s.geom, (SELECT unrelated_deg FROM rb_params))
     AND ST_DWithin(s.geom, st.geom, (SELECT unrelated_deg FROM rb_params))
    WHERE s.external_id = c.external_id
  );

-- ---------------------------------------------------------------------------
-- 6) Compare to mirrored production barriers (source identity first)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_prod AS
SELECT
  b.id AS prod_id,
  b.barrier_type,
  b.core_street_id,
  b.geom,
  b.is_active,
  b.is_verified,
  b.verification_status,
  b.source_refs,
  b.normalized_data,
  system.pipeline_osm_identity_key(
    coalesce(
      nullif(btrim(b.source_refs->>'external_id'), ''),
      CASE
        WHEN nullif(btrim(b.source_refs->>'osm_id'), '') IS NOT NULL
          THEN 'osm:'
            || coalesce(nullif(btrim(b.source_refs->>'osm_feature_type'), ''), 'node')
            || ':'
            || btrim(b.source_refs->>'osm_id')
      END
    )
  ) AS identity_key,
  CASE
    WHEN jsonb_typeof(b.source_refs->'access_tags') = 'object'
      THEN b.source_refs->'access_tags'
    WHEN jsonb_typeof(b.normalized_data->'access_tags') = 'object'
      THEN b.normalized_data->'access_tags'
    WHEN jsonb_typeof(b.normalized_data->'access_rules') = 'object'
      THEN b.normalized_data->'access_rules'
    ELSE '{}'::jsonb
  END AS access_rules
FROM prod_mirror.core_routing_barriers AS b
WHERE coalesce(b.is_active, true);

CREATE INDEX ON rb_prod (identity_key);

CREATE TEMP TABLE rb_prod_match AS
SELECT
  s.external_id,
  count(p.prod_id)::int AS prod_hit_count,
  (array_agg(p.prod_id ORDER BY p.prod_id))[1] AS prod_id,
  bool_or(coalesce(p.is_verified, false)) AS prod_verified,
  (array_agg(p.barrier_type ORDER BY p.prod_id))[1] AS prod_barrier_type,
  (array_agg(p.core_street_id ORDER BY p.prod_id))[1] AS prod_core_street_id,
  (array_agg(p.geom ORDER BY p.prod_id))[1] AS prod_geom,
  (array_agg(p.access_rules ORDER BY p.prod_id))[1] AS prod_access_rules,
  CASE
    WHEN count(p.prod_id) = 0 THEN 'new'
    WHEN count(p.prod_id) = 1 THEN 'matched'
    ELSE 'multi_prod'
  END AS prod_match_status
FROM rb_supported AS s
LEFT JOIN rb_prod AS p
  ON p.identity_key = system.pipeline_osm_identity_key(s.external_id)
GROUP BY s.external_id;

CREATE TEMP TABLE rb_prod_match_enriched AS
SELECT
  pm.*,
  sc.core_street_id AS candidate_core_street_id,
  s.barrier_type AS candidate_barrier_type,
  coalesce(s.access_rules, '{}'::jsonb) AS candidate_access_rules,
  s.geom AS candidate_geom,
  CASE
    WHEN pm.prod_match_status <> 'matched' THEN NULL
    WHEN lower(btrim(pm.prod_barrier_type)) IS DISTINCT FROM s.barrier_type THEN true
    WHEN pm.prod_core_street_id IS DISTINCT FROM sc.core_street_id THEN true
    WHEN coalesce(pm.prod_access_rules, '{}'::jsonb)
         IS DISTINCT FROM coalesce(s.access_rules, '{}'::jsonb) THEN true
    WHEN ST_Distance(s.geom::geography, pm.prod_geom::geography) > 1.0 THEN true
    ELSE false
  END AS materially_changed
FROM rb_prod_match AS pm
JOIN rb_supported AS s
  ON s.external_id = pm.external_id
JOIN rb_street_choice AS sc
  ON sc.external_id = pm.external_id;

-- ---------------------------------------------------------------------------
-- 7) Classify
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rb_classified AS
SELECT
  s.raw_id,
  s.osm_id,
  s.barrier_type,
  s.geom,
  s.tags,
  coalesce(s.access_rules, '{}'::jsonb) AS access_rules,
  s.external_id,
  wc.way_match_status,
  wc.way_hit_count,
  wc.osm_way_id,
  sc.street_match_status,
  sc.core_street_id,
  sc.street_external_id,
  sc.dist_m AS street_dist_m,
  sc.seg_count,
  pm.prod_match_status,
  pm.prod_hit_count,
  pm.prod_id,
  pm.prod_verified,
  pm.materially_changed,
  CASE
    WHEN sc.street_match_status = 'unrelated_no_network' THEN 'skipped'
    WHEN sc.street_match_status IN (
      'ambiguous_parent_ways',
      'identity_ambiguous_segments',
      'spatial_ambiguous'
    ) THEN 'review'
    WHEN sc.core_street_id IS NULL THEN 'review'
    WHEN pm.prod_match_status = 'multi_prod' THEN 'conflict'
    WHEN pm.prod_match_status = 'matched'
         AND coalesce(pm.prod_verified, false)
         AND coalesce(pm.materially_changed, false) THEN 'conflict'
    WHEN pm.prod_match_status = 'matched'
         AND NOT coalesce(pm.materially_changed, false) THEN 'unchanged'
    WHEN pm.prod_match_status = 'matched'
         AND coalesce(pm.materially_changed, false) THEN 'safe_update'
    WHEN pm.prod_match_status = 'new' THEN 'safe_new'
    ELSE 'review'
  END AS import_class,
  CASE
    WHEN sc.street_match_status = 'unrelated_no_network'
      THEN 'no parent highway and no Core street within unrelated tolerance'
    WHEN sc.street_match_status = 'ambiguous_parent_ways'
      THEN 'multiple OSM highway parents at barrier node'
    WHEN sc.street_match_status = 'identity_ambiguous_segments'
      THEN 'one OSM way maps to multiple Core segments near barrier'
    WHEN sc.street_match_status = 'spatial_ambiguous'
      THEN 'spatial fallback found multiple Core streets'
    WHEN sc.core_street_id IS NULL
      THEN 'supported barrier but Core street unresolved'
    WHEN pm.prod_match_status = 'multi_prod'
      THEN 'source identity matches multiple production barriers'
    WHEN pm.prod_match_status = 'matched'
         AND coalesce(pm.prod_verified, false)
         AND coalesce(pm.materially_changed, false)
      THEN 'verified production barrier conflicts with candidate'
    WHEN pm.prod_match_status = 'matched'
         AND NOT coalesce(pm.materially_changed, false)
      THEN 'identical to production by identity'
    WHEN pm.prod_match_status = 'matched'
      THEN 'source identity match with material change'
    WHEN pm.prod_match_status = 'new'
      THEN 'new supported barrier with one confident Core street'
    ELSE 'needs review'
  END AS import_class_reason
FROM rb_supported AS s
JOIN rb_way_choice AS wc
  ON wc.external_id = s.external_id
JOIN rb_street_choice AS sc
  ON sc.external_id = s.external_id
JOIN rb_prod_match_enriched AS pm
  ON pm.external_id = s.external_id;

CREATE INDEX ON rb_classified (import_class);
CREATE INDEX ON rb_classified (barrier_type);

-- ---------------------------------------------------------------------------
-- 8) Write staging rows (supported + skipped unsupported)
-- ---------------------------------------------------------------------------
DELETE FROM staging.staging_routing_barrier_candidates AS s
USING rb_params AS p
WHERE s.source_snapshot_id = p.snapshot_id;

INSERT INTO staging.staging_routing_barrier_candidates (
  source_snapshot_id,
  raw_table,
  raw_id,
  external_id,
  barrier_type,
  access_tags,
  point_geom,
  geom,
  source_refs,
  normalized_data,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  validation_status,
  import_class,
  import_class_reason,
  created_at,
  updated_at
)
SELECT
  p.snapshot_id,
  'raw_osm_points',
  c.raw_id,
  c.external_id,
  c.barrier_type,
  c.access_rules,
  c.geom,
  c.geom,
  jsonb_build_object(
    'source_snapshot_id', p.snapshot_id,
    'snapshot_version', p.snapshot_version,
    'region_code', p.region_code,
    'raw_table', 'raw_osm_points',
    'raw_id', c.raw_id,
    'osm_id', c.osm_id,
    'osm_feature_type', 'node',
    'external_id', c.external_id,
    'osm_way_id', c.osm_way_id,
    'core_street_id', c.core_street_id,
    'prod_barrier_id', c.prod_id
  ),
  jsonb_build_object(
    'tags', c.tags,
    'access_rules', c.access_rules,
    'barrier_type', c.barrier_type,
    'way_match_status', c.way_match_status,
    'way_hit_count', c.way_hit_count,
    'street_match_status', c.street_match_status,
    'street_dist_m', c.street_dist_m,
    'seg_count', c.seg_count,
    'prod_match_status', c.prod_match_status,
    'prod_verified', c.prod_verified,
    'materially_changed', c.materially_changed,
    'import_class_reason', c.import_class_reason
  ),
  CASE
    WHEN c.import_class IN ('safe_new', 'safe_update', 'unchanged') THEN 90
    WHEN c.import_class = 'review' THEN 50
    WHEN c.import_class = 'conflict' THEN 40
    ELSE 20
  END,
  CASE
    WHEN c.import_class IN ('safe_new') THEN 'new_candidate'
    WHEN c.import_class IN ('safe_update', 'unchanged', 'conflict') THEN 'matched_prod'
    ELSE 'needs_review'
  END,
  CASE
    WHEN c.import_class IN ('safe_new', 'safe_update') THEN 'promote_candidate'
    WHEN c.import_class = 'unchanged' THEN 'ignore_unchanged'
    WHEN c.import_class = 'skipped' THEN 'skip'
    ELSE 'needs_review'
  END,
  CASE
    WHEN c.import_class IN ('safe_new', 'safe_update', 'unchanged') THEN 'approved'
    WHEN c.import_class = 'skipped' THEN 'ignored'
    ELSE 'needs_review'
  END,
  'valid',
  c.import_class,
  jsonb_build_object('reason', c.import_class_reason),
  now(),
  now()
FROM rb_classified AS c
CROSS JOIN rb_params AS p;

-- Unsupported → skipped staging rows (for artifact/report completeness)
INSERT INTO staging.staging_routing_barrier_candidates (
  source_snapshot_id,
  raw_table,
  raw_id,
  external_id,
  barrier_type,
  access_tags,
  point_geom,
  geom,
  source_refs,
  normalized_data,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  validation_status,
  import_class,
  import_class_reason,
  created_at,
  updated_at
)
SELECT
  p.snapshot_id,
  'raw_osm_points',
  n.raw_id,
  system.pipeline_osm_external_id(n.osm_feature_type, n.osm_id),
  n.barrier_type_raw,
  '{}'::jsonb,
  ST_Force2D(n.geom)::geometry(Point, 4326),
  ST_Force2D(n.geom)::geometry(Point, 4326),
  jsonb_build_object(
    'source_snapshot_id', p.snapshot_id,
    'snapshot_version', p.snapshot_version,
    'region_code', p.region_code,
    'raw_table', 'raw_osm_points',
    'raw_id', n.raw_id,
    'osm_id', n.osm_id,
    'osm_feature_type', 'node',
    'unsupported_barrier', true
  ),
  jsonb_build_object(
    'tags', n.tags,
    'unsupported_barrier_type', true,
    'import_class_reason', 'unsupported barrier type for V1 routing import'
  ),
  10,
  'skipped',
  'skip',
  'ignored',
  'valid',
  'skipped',
  jsonb_build_object('reason', 'unsupported barrier type for V1 routing import'),
  now(),
  now()
FROM rb_all_nodes AS n
CROSS JOIN rb_params AS p
WHERE n.barrier_type_raw IS NULL
   OR n.barrier_type_raw NOT IN (SELECT barrier_type FROM rb_supported_types);

-- ---------------------------------------------------------------------------
-- 9) Summary JSON (printed for the shell wrapper)
-- ---------------------------------------------------------------------------
SELECT jsonb_build_object(
  'snapshot_id', p.snapshot_id,
  'snapshot_version', p.snapshot_version,
  'total_barrier_nodes', (SELECT count(*) FROM rb_all_nodes),
  'supported_candidates', (SELECT count(*) FROM rb_supported),
  'unsupported_skipped', (SELECT coalesce(sum(n), 0) FROM rb_unsupported_stats),
  'by_barrier_type_all', (
    SELECT coalesce(jsonb_object_agg(barrier_type, n), '{}'::jsonb)
    FROM (
      SELECT coalesce(barrier_type_raw, '(empty)') AS barrier_type, count(*)::int AS n
      FROM rb_all_nodes
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'by_barrier_type_supported', (
    SELECT coalesce(jsonb_object_agg(barrier_type, n), '{}'::jsonb)
    FROM (
      SELECT barrier_type, count(*)::int AS n
      FROM rb_supported
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'unsupported_by_type', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('barrier_type', barrier_type, 'n', n) ORDER BY n DESC), '[]'::jsonb)
    FROM rb_unsupported_stats
  ),
  'with_source_road', (
    SELECT count(*) FROM rb_way_choice WHERE osm_way_id IS NOT NULL
  ),
  'without_source_road', (
    SELECT count(*) FROM rb_way_choice WHERE osm_way_id IS NULL
  ),
  'matched_exact_one_core_street', (
    SELECT count(*) FROM rb_classified WHERE core_street_id IS NOT NULL AND import_class <> 'skipped'
  ),
  'ambiguous_core_match', (
    SELECT count(*) FROM rb_classified
    WHERE street_match_status IN (
      'ambiguous_parent_ways',
      'identity_ambiguous_segments',
      'spatial_ambiguous'
    )
  ),
  'unmatched_core_street', (
    SELECT count(*) FROM rb_classified
    WHERE core_street_id IS NULL
      AND import_class <> 'skipped'
  ),
  'import_class', (
    SELECT coalesce(jsonb_object_agg(import_class, n), '{}'::jsonb)
    FROM (
      SELECT import_class, count(*)::int AS n
      FROM staging.staging_routing_barrier_candidates s
      CROSS JOIN rb_params pp
      WHERE s.source_snapshot_id = pp.snapshot_id
      GROUP BY 1
    ) x
  ),
  'access_key_distribution', (
    SELECT coalesce(jsonb_object_agg(access_key, n), '{}'::jsonb)
    FROM (
      SELECT k.access_key, count(*)::int AS n
      FROM rb_supported AS s
      CROSS JOIN rb_access_keys AS k
      WHERE s.access_rules ? k.access_key
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'prod_mirror_barriers', (SELECT count(*) FROM prod_mirror.core_routing_barriers),
  'prod_mirror_streets', (SELECT count(*) FROM prod_mirror.core_streets WHERE deleted_at IS NULL)
)
FROM rb_params AS p;
