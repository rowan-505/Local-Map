-- =============================================================================
-- National routing turn-restriction dry-run (local only)
-- =============================================================================
-- Reads type=restriction relations from tmp_import.osm_restrictions (flex load),
-- normalizes members, resolves Core streets at via, classifies vs prod_mirror.
--
-- V1 simple structure:
--   exactly 1 from way + 1 to way + 1 via node
--   restriction in supported enum
--
-- Via-way / multi-member / unsupported type → skipped (unsupported) or review.
--
-- psql vars:
--   snapshot_id
--   snapshot_version
--   region_code
--   touch_m (default 5)
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?touch_m}
\else
\set touch_m 5
\endif

\ir pipeline_source_identity.sql

CREATE TEMP TABLE tr_params (
  snapshot_id bigint PRIMARY KEY,
  snapshot_version text NOT NULL,
  region_code text NOT NULL,
  touch_m double precision NOT NULL,
  touch_deg double precision NOT NULL
);

INSERT INTO tr_params (snapshot_id, snapshot_version, region_code, touch_m, touch_deg)
VALUES (
  :'snapshot_id'::bigint,
  :'snapshot_version',
  :'region_code',
  :'touch_m'::double precision,
  :'touch_m'::double precision / 111320.0
);

CREATE TEMP TABLE tr_supported_types (
  restriction_type text PRIMARY KEY
);

INSERT INTO tr_supported_types (restriction_type) VALUES
  ('no_left_turn'),
  ('no_right_turn'),
  ('no_u_turn'),
  ('no_straight_on'),
  ('only_left_turn'),
  ('only_right_turn'),
  ('only_u_turn'),
  ('only_straight_on'),
  ('no_entry'),
  ('no_exit');

-- ---------------------------------------------------------------------------
-- 1) Inventory every restriction relation from flex load
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tr_all AS
SELECT
  r.osm_id::bigint AS osm_relation_id,
  r.tags,
  r.members,
  system.pipeline_osm_external_id('relation', r.osm_id::text) AS external_id,
  coalesce(
    nullif(btrim(r.tags->>'restriction'), ''),
    nullif(btrim(r.tags->>'restriction:vehicle'), ''),
    nullif(btrim(r.tags->>'restriction:motorcar'), '')
  ) AS restriction_raw,
  nullif(btrim(r.tags->>'except'), '') AS except_raw,
  nullif(btrim(r.tags->>'type'), '') AS relation_type
FROM tmp_import.osm_restrictions AS r;

CREATE UNIQUE INDEX ON tr_all (external_id);
CREATE INDEX ON tr_all (osm_relation_id);

CREATE TEMP TABLE tr_members AS
SELECT
  a.external_id,
  a.osm_relation_id,
  ordinality AS member_ord,
  lower(btrim(m.elem->>'type')) AS member_type_raw,
  (m.elem->>'ref')::bigint AS member_ref,
  lower(btrim(m.elem->>'role')) AS member_role
FROM tr_all AS a
CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.members, '[]'::jsonb))
  WITH ORDINALITY AS m(elem, ordinality);

CREATE INDEX ON tr_members (external_id);
CREATE INDEX ON tr_members (member_role);

CREATE TEMP TABLE tr_parsed AS
SELECT
  a.external_id,
  a.osm_relation_id,
  a.tags,
  a.restriction_raw,
  a.except_raw,
  a.relation_type,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id AND m.member_role = 'from'
  ) AS from_count,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id AND m.member_role = 'to'
  ) AS to_count,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id AND m.member_role = 'via'
  ) AS via_count,
  (
    SELECT m.member_ref
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'from'
      AND m.member_type_raw IN ('w', 'way')
    ORDER BY m.member_ord
    LIMIT 1
  ) AS from_way_id,
  (
    SELECT m.member_ref
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'to'
      AND m.member_type_raw IN ('w', 'way')
    ORDER BY m.member_ord
    LIMIT 1
  ) AS to_way_id,
  (
    SELECT m.member_ref
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'via'
      AND m.member_type_raw IN ('n', 'node')
    ORDER BY m.member_ord
    LIMIT 1
  ) AS via_node_id,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'via'
      AND m.member_type_raw IN ('w', 'way')
  ) AS via_way_count,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'from'
      AND m.member_type_raw IN ('w', 'way')
  ) AS from_way_count,
  (
    SELECT count(*)::int
    FROM tr_members m
    WHERE m.external_id = a.external_id
      AND m.member_role = 'to'
      AND m.member_type_raw IN ('w', 'way')
  ) AS to_way_count
FROM tr_all AS a;

CREATE TEMP TABLE tr_shaped AS
SELECT
  p.*,
  CASE
    WHEN p.restriction_raw IS NULL
      OR p.restriction_raw NOT IN (SELECT restriction_type FROM tr_supported_types)
      THEN 'unsupported_type'
    WHEN p.from_count = 1
     AND p.to_count = 1
     AND p.via_count = 1
     AND p.from_way_count = 1
     AND p.to_way_count = 1
     AND p.via_node_id IS NOT NULL
     AND p.via_way_count = 0
      THEN 'v1_simple'
    WHEN p.via_way_count > 0
      OR (p.via_count > 1 AND p.via_node_id IS NOT NULL)
      THEN 'unsupported_via_ways'
    WHEN p.from_count <> 1
      OR p.to_count <> 1
      OR p.from_way_count <> 1
      OR p.to_way_count <> 1
      OR p.via_count = 0
      OR p.via_node_id IS NULL
      THEN 'unsupported_member_shape'
    ELSE 'unsupported_member_shape'
  END AS structure_class,
  CASE
    WHEN p.restriction_raw IN (SELECT restriction_type FROM tr_supported_types)
      THEN p.restriction_raw
    ELSE NULL
  END AS restriction_type
FROM tr_parsed AS p;

CREATE INDEX ON tr_shaped (structure_class);
CREATE INDEX ON tr_shaped (external_id);

-- ---------------------------------------------------------------------------
-- 2) Via node geometry + member way geometry from tmp_import
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tr_via_points AS
SELECT
  s.external_id,
  s.via_node_id,
  ST_Force2D(pt.geom)::geometry(Point, 4326) AS via_geom
FROM tr_shaped AS s
JOIN tmp_import.osm_points AS pt
  ON lower(btrim(pt.osm_feature_type::text)) IN ('node', 'n')
 AND pt.osm_id::text = s.via_node_id::text
WHERE s.structure_class = 'v1_simple'
  AND s.via_node_id IS NOT NULL
  AND pt.geom IS NOT NULL
  AND ST_IsValid(pt.geom);

-- osm2pgsql type_column may store N/W; identity helper still accepts those.

CREATE UNIQUE INDEX ON tr_via_points (external_id);
CREATE INDEX ON tr_via_points USING GIST (via_geom);

CREATE TEMP TABLE tr_ways AS
SELECT
  l.osm_id::bigint AS osm_way_id,
  ST_Force2D(
    CASE
      WHEN ST_GeometryType(l.geom) = 'ST_MultiLineString' THEN ST_LineMerge(l.geom)
      ELSE l.geom
    END
  ) AS geom
FROM tmp_import.osm_lines AS l
WHERE l.geom IS NOT NULL
  AND lower(btrim(l.osm_feature_type::text)) IN ('way', 'w');

CREATE UNIQUE INDEX ON tr_ways (osm_way_id);
CREATE INDEX ON tr_ways USING GIST (geom);

-- ---------------------------------------------------------------------------
-- 3) Resolve from/to Core streets at via (identity + nearest segment)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tr_street_by_way AS
SELECT
  s.external_id,
  role.role_name,
  role.osm_way_id,
  st.id AS core_street_id,
  st.external_id AS street_external_id,
  ST_Distance(v.via_geom::geography, st.geom::geography) AS dist_m,
  ST_DWithin(v.via_geom, st.geom, (SELECT touch_deg FROM tr_params)) AS touches
FROM tr_shaped AS s
JOIN tr_via_points AS v
  ON v.external_id = s.external_id
CROSS JOIN LATERAL (
  VALUES
    ('from', s.from_way_id),
    ('to', s.to_way_id)
) AS role(role_name, osm_way_id)
JOIN prod_mirror.core_streets AS st
  ON st.deleted_at IS NULL
 AND role.osm_way_id IS NOT NULL
 AND st.external_id IN (
   'osm:W:' || role.osm_way_id::text,
   'osm:way:' || role.osm_way_id::text
 )
WHERE s.structure_class = 'v1_simple';

CREATE INDEX ON tr_street_by_way (external_id, role_name);

CREATE TEMP TABLE tr_street_choice AS
WITH ranked AS (
  SELECT
    w.*,
    count(*) OVER (PARTITION BY w.external_id, w.role_name) AS seg_count,
    count(*) FILTER (WHERE w.touches) OVER (PARTITION BY w.external_id, w.role_name) AS touch_count,
    row_number() OVER (
      PARTITION BY w.external_id, w.role_name
      ORDER BY
        CASE WHEN w.touches THEN 0 ELSE 1 END,
        w.dist_m NULLS LAST,
        w.core_street_id
    ) AS rn,
    row_number() OVER (
      PARTITION BY w.external_id, w.role_name
      ORDER BY w.dist_m NULLS LAST, w.core_street_id
    ) AS rn_near
  FROM tr_street_by_way AS w
),
picked AS (
  SELECT
    r.*,
    CASE
      WHEN r.seg_count = 1 THEN 'identity_single_segment'
      WHEN r.touch_count = 1 AND r.touches THEN 'identity_unique_touching_segment'
      WHEN r.seg_count > 1
           AND r.rn_near = 1
           AND r.dist_m <= (SELECT touch_m FROM tr_params)
           AND NOT EXISTS (
             SELECT 1
             FROM ranked AS o
             WHERE o.external_id = r.external_id
               AND o.role_name = r.role_name
               AND o.core_street_id <> r.core_street_id
               AND o.dist_m <= (SELECT touch_m FROM tr_params)
           )
        THEN 'identity_nearest_within_tolerance'
      WHEN r.seg_count > 1 THEN 'identity_ambiguous_segments'
      ELSE 'identity_unmatched'
    END AS street_match_status
  FROM ranked AS r
)
SELECT
  external_id,
  role_name,
  osm_way_id,
  CASE
    WHEN street_match_status IN (
      'identity_single_segment',
      'identity_unique_touching_segment',
      'identity_nearest_within_tolerance'
    ) THEN core_street_id
    ELSE NULL
  END AS core_street_id,
  CASE
    WHEN street_match_status IN (
      'identity_single_segment',
      'identity_unique_touching_segment',
      'identity_nearest_within_tolerance'
    ) THEN street_external_id
    ELSE NULL
  END AS street_external_id,
  dist_m,
  street_match_status,
  seg_count
FROM picked
WHERE rn = 1;

-- Fill missing roles for v1_simple with via geom
INSERT INTO tr_street_choice (
  external_id, role_name, osm_way_id, core_street_id, street_external_id,
  dist_m, street_match_status, seg_count
)
SELECT
  s.external_id,
  role.role_name,
  role.osm_way_id,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN role.osm_way_id IS NULL THEN 'missing_member_way'
    WHEN NOT EXISTS (SELECT 1 FROM tr_ways w WHERE w.osm_way_id = role.osm_way_id)
      THEN 'member_way_geom_missing'
    ELSE 'identity_unmatched'
  END,
  0
FROM tr_shaped AS s
CROSS JOIN LATERAL (
  VALUES
    ('from', s.from_way_id),
    ('to', s.to_way_id)
) AS role(role_name, osm_way_id)
WHERE s.structure_class = 'v1_simple'
  AND EXISTS (SELECT 1 FROM tr_via_points v WHERE v.external_id = s.external_id)
  AND NOT EXISTS (
    SELECT 1
    FROM tr_street_choice c
    WHERE c.external_id = s.external_id
      AND c.role_name = role.role_name
  );

CREATE TEMP TABLE tr_resolved AS
SELECT
  s.external_id,
  s.osm_relation_id,
  s.tags,
  s.restriction_type,
  s.restriction_raw,
  s.except_raw,
  s.structure_class,
  s.from_way_id,
  s.to_way_id,
  s.via_node_id,
  v.via_geom,
  f.core_street_id AS from_street_id,
  f.street_external_id AS from_street_external_id,
  f.street_match_status AS from_street_match_status,
  f.dist_m AS from_dist_m,
  f.seg_count AS from_seg_count,
  t.core_street_id AS to_street_id,
  t.street_external_id AS to_street_external_id,
  t.street_match_status AS to_street_match_status,
  t.dist_m AS to_dist_m,
  t.seg_count AS to_seg_count
FROM tr_shaped AS s
LEFT JOIN tr_via_points AS v
  ON v.external_id = s.external_id
LEFT JOIN tr_street_choice AS f
  ON f.external_id = s.external_id AND f.role_name = 'from'
LEFT JOIN tr_street_choice AS t
  ON t.external_id = s.external_id AND t.role_name = 'to'
WHERE s.structure_class = 'v1_simple';

-- ---------------------------------------------------------------------------
-- 4) Compare to mirrored production turn restrictions
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tr_prod AS
SELECT
  p.id AS prod_id,
  p.restriction_type,
  p.from_street_id,
  p.to_street_id,
  p.via_node_external_id,
  p.via_geom,
  p.except_modes,
  p.is_active,
  p.is_verified,
  p.verification_status,
  p.external_id,
  p.source_refs,
  p.normalized_data,
  system.pipeline_osm_identity_key(
    coalesce(
      nullif(btrim(p.external_id), ''),
      nullif(btrim(p.source_refs->>'external_id'), ''),
      CASE
        WHEN nullif(btrim(p.source_refs->>'osm_id'), '') IS NOT NULL
          THEN 'osm:relation:' || btrim(p.source_refs->>'osm_id')
      END
    )
  ) AS identity_key
FROM prod_mirror.core_routing_turn_restrictions AS p
WHERE coalesce(p.is_active, true);

CREATE INDEX ON tr_prod (identity_key);

CREATE TEMP TABLE tr_prod_match AS
SELECT
  r.external_id,
  count(p.prod_id)::int AS prod_hit_count,
  (array_agg(p.prod_id ORDER BY p.prod_id))[1] AS prod_id,
  bool_or(coalesce(p.is_verified, false)) AS prod_verified,
  (array_agg(p.restriction_type ORDER BY p.prod_id))[1] AS prod_restriction_type,
  (array_agg(p.from_street_id ORDER BY p.prod_id))[1] AS prod_from_street_id,
  (array_agg(p.to_street_id ORDER BY p.prod_id))[1] AS prod_to_street_id,
  CASE
    WHEN count(p.prod_id) = 0 THEN 'new'
    WHEN count(p.prod_id) = 1 THEN 'matched'
    ELSE 'multi_prod'
  END AS prod_match_status,
  CASE
    WHEN count(p.prod_id) <> 1 THEN NULL
    WHEN (array_agg(p.restriction_type ORDER BY p.prod_id))[1]
         IS DISTINCT FROM r.restriction_type THEN true
    WHEN (array_agg(p.from_street_id ORDER BY p.prod_id))[1]
         IS DISTINCT FROM r.from_street_id THEN true
    WHEN (array_agg(p.to_street_id ORDER BY p.prod_id))[1]
         IS DISTINCT FROM r.to_street_id THEN true
    ELSE false
  END AS materially_changed
FROM tr_resolved AS r
LEFT JOIN tr_prod AS p
  ON p.identity_key = system.pipeline_osm_identity_key(r.external_id)
GROUP BY
  r.external_id,
  r.restriction_type,
  r.from_street_id,
  r.to_street_id;

-- ---------------------------------------------------------------------------
-- 5) Classify V1 simple + unsupported buckets
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tr_classified AS
SELECT
  r.*,
  coalesce(pm.prod_match_status, 'new') AS prod_match_status,
  coalesce(pm.prod_hit_count, 0) AS prod_hit_count,
  pm.prod_id,
  coalesce(pm.prod_verified, false) AS prod_verified,
  pm.materially_changed,
  CASE
    WHEN r.via_geom IS NULL THEN 'review'
    WHEN r.from_street_match_status IN ('identity_ambiguous_segments')
      OR r.to_street_match_status IN ('identity_ambiguous_segments')
      THEN 'review'
    WHEN r.from_street_id IS NULL OR r.to_street_id IS NULL THEN 'review'
    WHEN coalesce(pm.prod_match_status, 'new') = 'multi_prod' THEN 'conflict'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
         AND coalesce(pm.prod_verified, false)
         AND coalesce(pm.materially_changed, false) THEN 'conflict'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
         AND NOT coalesce(pm.materially_changed, false) THEN 'unchanged'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
         AND coalesce(pm.materially_changed, false) THEN 'safe_update'
    WHEN coalesce(pm.prod_match_status, 'new') = 'new' THEN 'safe_new'
    ELSE 'review'
  END AS import_class,
  CASE
    WHEN r.via_geom IS NULL THEN 'via node geometry missing from extract'
    WHEN r.from_street_match_status = 'identity_ambiguous_segments'
      THEN 'from OSM way maps to multiple Core segments near via'
    WHEN r.to_street_match_status = 'identity_ambiguous_segments'
      THEN 'to OSM way maps to multiple Core segments near via'
    WHEN r.from_street_id IS NULL
      THEN 'from Core street unresolved (' || coalesce(r.from_street_match_status, 'unknown') || ')'
    WHEN r.to_street_id IS NULL
      THEN 'to Core street unresolved (' || coalesce(r.to_street_match_status, 'unknown') || ')'
    WHEN coalesce(pm.prod_match_status, 'new') = 'multi_prod'
      THEN 'source identity matches multiple production turn restrictions'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
         AND coalesce(pm.prod_verified, false)
         AND coalesce(pm.materially_changed, false)
      THEN 'verified production turn restriction conflicts with candidate'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
         AND NOT coalesce(pm.materially_changed, false)
      THEN 'identical to production by identity'
    WHEN coalesce(pm.prod_match_status, 'new') = 'matched'
      THEN 'source identity match with material change'
    WHEN coalesce(pm.prod_match_status, 'new') = 'new'
      THEN 'new V1-simple restriction with resolved from/to Core streets'
    ELSE 'needs review'
  END AS import_class_reason
FROM tr_resolved AS r
LEFT JOIN tr_prod_match AS pm
  ON pm.external_id = r.external_id;

CREATE INDEX ON tr_classified (import_class);

-- ---------------------------------------------------------------------------
-- 6) Write staging rows
-- ---------------------------------------------------------------------------
DELETE FROM staging.staging_routing_turn_restriction_candidates AS s
USING tr_params AS p
WHERE s.source_snapshot_id = p.snapshot_id;

INSERT INTO staging.staging_routing_turn_restriction_candidates (
  source_snapshot_id,
  external_id,
  restriction_type,
  from_external_id,
  via_external_id,
  to_external_id,
  raw_relation_id,
  relation_tags,
  source_refs,
  normalized_data,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  import_class,
  import_class_reason,
  via_geom,
  created_at,
  updated_at
)
SELECT
  p.snapshot_id,
  c.external_id,
  c.restriction_type,
  system.pipeline_osm_external_id('way', c.from_way_id),
  system.pipeline_osm_external_id('node', c.via_node_id),
  system.pipeline_osm_external_id('way', c.to_way_id),
  c.osm_relation_id::text,
  c.tags,
  jsonb_build_object(
    'source_snapshot_id', p.snapshot_id,
    'snapshot_version', p.snapshot_version,
    'region_code', p.region_code,
    'osm_id', c.osm_relation_id,
    'osm_feature_type', 'relation',
    'external_id', c.external_id,
    'from_way_id', c.from_way_id,
    'to_way_id', c.to_way_id,
    'via_node_id', c.via_node_id,
    'from_street_id', c.from_street_id,
    'to_street_id', c.to_street_id,
    'prod_turn_restriction_id', c.prod_id
  ),
  jsonb_build_object(
    'structure_class', c.structure_class,
    'restriction_raw', c.restriction_raw,
    'except_raw', c.except_raw,
    'except_modes', CASE
      WHEN c.except_raw IS NULL THEN '[]'::jsonb
      ELSE to_jsonb(string_to_array(c.except_raw, ';'))
    END,
    'from_street_match_status', c.from_street_match_status,
    'to_street_match_status', c.to_street_match_status,
    'from_dist_m', c.from_dist_m,
    'to_dist_m', c.to_dist_m,
    'from_seg_count', c.from_seg_count,
    'to_seg_count', c.to_seg_count,
    'prod_match_status', c.prod_match_status,
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
    WHEN c.import_class = 'safe_new' THEN 'new_candidate'
    WHEN c.import_class IN ('safe_update', 'unchanged', 'conflict') THEN 'matched_prod'
    ELSE 'needs_review'
  END,
  CASE
    WHEN c.import_class IN ('safe_new', 'safe_update') THEN 'promote_candidate'
    WHEN c.import_class = 'unchanged' THEN 'ignore_unchanged'
    ELSE 'needs_review'
  END,
  CASE
    WHEN c.import_class IN ('safe_new', 'safe_update', 'unchanged') THEN 'approved'
    ELSE 'needs_review'
  END,
  c.import_class,
  jsonb_build_object('reason', c.import_class_reason),
  c.via_geom,
  now(),
  now()
FROM tr_classified AS c
CROSS JOIN tr_params AS p;

-- Unsupported / non-V1 structures → skipped staging rows
INSERT INTO staging.staging_routing_turn_restriction_candidates (
  source_snapshot_id,
  external_id,
  restriction_type,
  from_external_id,
  via_external_id,
  to_external_id,
  raw_relation_id,
  relation_tags,
  source_refs,
  normalized_data,
  confidence_score,
  match_status,
  auto_action,
  review_status,
  import_class,
  import_class_reason,
  via_geom,
  created_at,
  updated_at
)
SELECT
  p.snapshot_id,
  s.external_id,
  s.restriction_type,
  system.pipeline_osm_external_id('way', s.from_way_id),
  CASE
    WHEN s.via_node_id IS NOT NULL THEN system.pipeline_osm_external_id('node', s.via_node_id)
    ELSE NULL
  END,
  system.pipeline_osm_external_id('way', s.to_way_id),
  s.osm_relation_id::text,
  s.tags,
  jsonb_build_object(
    'source_snapshot_id', p.snapshot_id,
    'snapshot_version', p.snapshot_version,
    'region_code', p.region_code,
    'osm_id', s.osm_relation_id,
    'osm_feature_type', 'relation',
    'external_id', s.external_id,
    'from_way_id', s.from_way_id,
    'to_way_id', s.to_way_id,
    'via_node_id', s.via_node_id,
    'via_way_count', s.via_way_count,
    'unsupported', true
  ),
  jsonb_build_object(
    'structure_class', s.structure_class,
    'restriction_raw', s.restriction_raw,
    'except_raw', s.except_raw,
    'from_count', s.from_count,
    'to_count', s.to_count,
    'via_count', s.via_count,
    'unsupported', true,
    'import_class_reason', CASE s.structure_class
      WHEN 'unsupported_type' THEN 'unsupported restriction type for V1'
      WHEN 'unsupported_via_ways' THEN 'V1 skips via-way / multi-via restrictions'
      ELSE 'V1 requires exactly one from way, one to way, and one via node'
    END
  ),
  10,
  'skipped',
  'skip',
  'ignored',
  'skipped',
  jsonb_build_object(
    'reason', CASE s.structure_class
      WHEN 'unsupported_type' THEN 'unsupported restriction type for V1'
      WHEN 'unsupported_via_ways' THEN 'V1 skips via-way / multi-via restrictions'
      ELSE 'V1 requires exactly one from way, one to way, and one via node'
    END,
    'structure_class', s.structure_class
  ),
  NULL,
  now(),
  now()
FROM tr_shaped AS s
CROSS JOIN tr_params AS p
WHERE s.structure_class <> 'v1_simple';

-- ---------------------------------------------------------------------------
-- 7) Summary JSON
-- ---------------------------------------------------------------------------
SELECT jsonb_build_object(
  'snapshot_id', p.snapshot_id,
  'snapshot_version', p.snapshot_version,
  'total_restriction_relations', (SELECT count(*) FROM tr_all),
  'v1_simple_candidates', (SELECT count(*) FROM tr_shaped WHERE structure_class = 'v1_simple'),
  'unsupported_skipped', (SELECT count(*) FROM tr_shaped WHERE structure_class <> 'v1_simple'),
  'by_structure_class', (
    SELECT coalesce(jsonb_object_agg(structure_class, n), '{}'::jsonb)
    FROM (
      SELECT structure_class, count(*)::int AS n
      FROM tr_shaped
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'by_restriction_type_all', (
    SELECT coalesce(jsonb_object_agg(restriction_type, n), '{}'::jsonb)
    FROM (
      SELECT coalesce(restriction_raw, '(none)') AS restriction_type, count(*)::int AS n
      FROM tr_all
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'by_restriction_type_v1_simple', (
    SELECT coalesce(jsonb_object_agg(restriction_type, n), '{}'::jsonb)
    FROM (
      SELECT restriction_type, count(*)::int AS n
      FROM tr_shaped
      WHERE structure_class = 'v1_simple'
      GROUP BY 1
      ORDER BY n DESC
    ) x
  ),
  'with_via_geom', (SELECT count(*) FROM tr_via_points),
  'missing_via_geom', (
    SELECT count(*) FROM tr_shaped s
    WHERE s.structure_class = 'v1_simple'
      AND NOT EXISTS (SELECT 1 FROM tr_via_points v WHERE v.external_id = s.external_id)
  ),
  'from_resolved', (
    SELECT count(*) FROM tr_classified WHERE from_street_id IS NOT NULL
  ),
  'to_resolved', (
    SELECT count(*) FROM tr_classified WHERE to_street_id IS NOT NULL
  ),
  'both_streets_resolved', (
    SELECT count(*) FROM tr_classified
    WHERE from_street_id IS NOT NULL AND to_street_id IS NOT NULL
  ),
  'import_class', (
    SELECT coalesce(jsonb_object_agg(import_class, n), '{}'::jsonb)
    FROM (
      SELECT import_class, count(*)::int AS n
      FROM staging.staging_routing_turn_restriction_candidates s
      CROSS JOIN tr_params pp
      WHERE s.source_snapshot_id = pp.snapshot_id
      GROUP BY 1
    ) x
  ),
  'prod_mirror_turn_restrictions', (
    SELECT count(*) FROM prod_mirror.core_routing_turn_restrictions
  ),
  'prod_mirror_streets', (
    SELECT count(*) FROM prod_mirror.core_streets WHERE deleted_at IS NULL
  )
)
FROM tr_params AS p;
