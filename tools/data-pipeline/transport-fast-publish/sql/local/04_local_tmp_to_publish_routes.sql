-- =============================================================================
-- transport-fast-publish — Phase 6: local route relation normalization (LOCAL ONLY)
--
-- Reads raw OSM route relation metadata:
--   tmp_transport_import.osm_transport_relations
--   tmp_transport_import.osm_transport_relation_members
--
-- Writes clean, export-ready rows into the local-only buffer:
--   local_transport_publish.routes
--   local_transport_publish.route_names
--   local_transport_publish.route_variants   (one default variant per relation)
--   local_transport_publish.source_links      (route + route_variant)
--
-- This stage NEVER writes to Supabase, and does NOT create route paths or route
-- stops yet (that is a later phase). Each extracted relation (route or
-- route_master) becomes one route + one default variant; relation_type is kept
-- in normalized_data so masters/children can be reconciled during later review.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, pbf_sha256, snapshot_version, import_batch_key, import_route_metadata
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif
\if :{?pbf_sha256}
\else
  \set pbf_sha256 'unknown'
\endif
\if :{?snapshot_version}
\else
  \set snapshot_version 'unknown'
\endif
\if :{?import_batch_key}
\else
  \set import_batch_key 'openstreetmap:osm_pbf:unknown'
\endif
\if :{?import_route_metadata}
\else
  \set import_route_metadata true
\endif

\if :import_route_metadata

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotent cleanup: scoped to the entities this stage owns.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.route_names    WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.route_variants  WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.routes          WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.source_links    WHERE entity_type IN ('route', 'route_variant');

-- -----------------------------------------------------------------------------
-- Normalize relations into a temp table (all derived fields computed once).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _rel ON COMMIT DROP AS
WITH member_counts AS (
    SELECT relation_external_id, count(*) AS member_count
    FROM tmp_transport_import.osm_transport_relation_members
    GROUP BY relation_external_id
),
base AS (
    SELECT
        r.osm_id,
        r.osm_feature_type,
        r.external_id,
        r.relation_type,
        r.mode AS osm_mode,
        r.route_kind AS osm_route_kind,
        r.tags,
        coalesce(mc.member_count, 0) AS member_count,
        NULLIF(r.tags->>'name:my', '')    AS nm_my,
        NULLIF(r.tags->>'name', '')       AS nm,
        NULLIF(r.tags->>'name:en', '')    AS nm_en,
        NULLIF(r.tags->>'ref', '')        AS ref,
        NULLIF(r.tags->>'route_ref', '')  AS route_ref,
        NULLIF(r.tags->>'from', '')       AS frm,
        NULLIF(r.tags->>'to', '')         AS dest,
        NULLIF(r.tags->>'description', '') AS descr
    FROM tmp_transport_import.osm_transport_relations r
    LEFT JOIN member_counts mc ON mc.relation_external_id = r.external_id
)
SELECT
    base.*,
    -- from → to fallback string for naming.
    CASE
        WHEN frm IS NOT NULL AND dest IS NOT NULL THEN frm || ' → ' || dest
        WHEN frm IS NOT NULL THEN frm
        WHEN dest IS NOT NULL THEN dest
        ELSE NULL
    END AS from_to,
    (nm_my IS NOT NULL OR nm IS NOT NULL OR nm_en IS NOT NULL
        OR ref IS NOT NULL OR route_ref IS NOT NULL
        OR frm IS NOT NULL OR dest IS NOT NULL) AS has_strong_naming,
    -- normalized route_kind for the buffer (mode-driven).
    CASE osm_mode
        WHEN 'bus'   THEN 'urban'
        WHEN 'train' THEN 'rail'
        WHEN 'ferry' THEN 'ferry'
        ELSE 'unknown'
    END AS route_kind_norm,
    'osm_relation' AS src_kind,
    'https://www.openstreetmap.org/relation/' || osm_id AS source_url
FROM base;

-- route_code, public_name, confidence, source_refs, normalized_data plus the
-- canonical grouping fields, computed in a 2nd pass.
ALTER TABLE _rel ADD COLUMN route_code text;
ALTER TABLE _rel ADD COLUMN public_name text;
ALTER TABLE _rel ADD COLUMN confidence numeric;
ALTER TABLE _rel ADD COLUMN source_refs jsonb;
ALTER TABLE _rel ADD COLUMN normalized_data jsonb;
ALTER TABLE _rel ADD COLUMN normalized_code text;  -- trimmed/normalized OSM ref
ALTER TABLE _rel ADD COLUMN group_key text;        -- mode|route_kind|lower(code)
ALTER TABLE _rel ADD COLUMN osm_id_num bigint;     -- numeric osm id for ordering

UPDATE _rel SET
    normalized_code = local_transport_publish.normalize_route_code(coalesce(ref, route_ref)),
    osm_id_num = NULLIF(regexp_replace(osm_id, '\D', '', 'g'), '')::bigint;

UPDATE _rel SET
    route_code = coalesce(normalized_code, external_id),
    public_name = coalesce(nm_my, nm, nm_en, ref, from_to, external_id),
    confidence = CASE WHEN has_strong_naming THEN 65 ELSE 55 END,
    -- Canonical grouping key. Only defined when a real route code exists, so
    -- relations without a ref are never heuristically merged. mode + route_kind
    -- keep bus/train/ferry/express distinct even when codes collide.
    group_key = CASE
        WHEN normalized_code IS NOT NULL
        THEN osm_mode || '|' || route_kind_norm || '|' || lower(normalized_code)
        ELSE NULL
    END,
    source_refs = jsonb_build_object(
        'osm_id', osm_id,
        'osm_feature_type', osm_feature_type,
        'external_id', external_id,
        'tags', tags,
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ),
    normalized_data = jsonb_build_object(
        'mode', osm_mode,
        'route_kind', route_kind_norm,
        'osm_route_kind', osm_route_kind,
        'relation_type', relation_type,
        'member_count', member_count,
        'normalized_route_code', normalized_code,
        'source', 'osm',
        'source_name', :'source_name',
        'source_kind', 'osm_relation',
        'import_batch_key', :'import_batch_key'
    );

-- =============================================================================
-- CANONICAL ROUTE GROUPING
-- -----------------------------------------------------------------------------
-- OSM models each direction (and sometimes each branch) as a SEPARATE route
-- relation, which previously produced one transport.routes row per relation
-- (e.g. "YBS - 33" -> two routes). We collapse relations into ONE canonical
-- route with multiple direction variants, but ONLY when confident:
--   * route_master present -> the master IS the route; its child route
--                             relations become the variants.
--   * exact reverse pair   -> exactly two relations sharing the canonical key
--                             whose from/to are mirror images.
-- Anything else that merely shares a code (3+, branch text, non-mirrored) is
-- left as separate routes and flagged for duplicate review in stage 05. Exactly
-- one variant per relation is always kept, so route paths/stops (stages 06/07,
-- keyed on "<relation>:variant:default") are unaffected.
-- =============================================================================

-- route_master -> present child route relations (each child mapped to ONE master).
CREATE TEMP TABLE _master_child ON COMMIT DROP AS
WITH cand AS (
    SELECT m.external_id AS master_external_id,
           m.osm_id_num  AS master_osm_id_num,
           rm.member_external_id AS child_external_id
    FROM _rel m
    JOIN tmp_transport_import.osm_transport_relation_members rm
      ON rm.relation_external_id = m.external_id
    WHERE m.relation_type = 'route_master'
      AND rm.member_type = 'relation'
      AND rm.member_external_id IS NOT NULL
),
present AS (
    SELECT c.*
    FROM cand c
    JOIN _rel ch ON ch.external_id = c.child_external_id AND ch.relation_type = 'route'
),
ranked AS (
    SELECT child_external_id, master_external_id,
           row_number() OVER (PARTITION BY child_external_id
                              ORDER BY master_osm_id_num, master_external_id) AS rn
    FROM present
)
SELECT child_external_id, master_external_id FROM ranked WHERE rn = 1;

-- Masters that actually own at least one present child route relation.
CREATE TEMP TABLE _master_with_children ON COMMIT DROP AS
SELECT DISTINCT master_external_id FROM _master_child;

-- Exact reverse pairs among route relations NOT already owned by a master.
-- out_ext (smaller osm id) = outbound; in_ext = inbound; canonical id = out_ext.
CREATE TEMP TABLE _reverse_pairs ON COMMIT DROP AS
WITH cand AS (
    SELECT r.external_id, r.group_key, r.osm_id_num,
           lower(btrim(r.frm)) AS frm_n, lower(btrim(r.dest)) AS dest_n
    FROM _rel r
    WHERE r.relation_type = 'route'
      AND r.group_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _master_child mc WHERE mc.child_external_id = r.external_id)
),
grp AS (SELECT group_key, count(*) AS n FROM cand GROUP BY group_key)
SELECT a.group_key, a.external_id AS out_ext, b.external_id AS in_ext
FROM cand a
JOIN cand b ON b.group_key = a.group_key AND a.osm_id_num < b.osm_id_num
JOIN grp  g ON g.group_key = a.group_key AND g.n = 2
WHERE a.frm_n IS NOT NULL AND a.dest_n IS NOT NULL
  AND b.frm_n IS NOT NULL AND b.dest_n IS NOT NULL
  AND a.frm_n = b.dest_n AND a.dest_n = b.frm_n;

-- Masters whose EXACTLY TWO children form a clean reverse pair (for 0/1 direction).
CREATE TEMP TABLE _master_pairs ON COMMIT DROP AS
WITH ch AS (
    SELECT mc.master_external_id, r.external_id, r.osm_id_num,
           lower(btrim(r.frm)) AS frm_n, lower(btrim(r.dest)) AS dest_n
    FROM _master_child mc
    JOIN _rel r ON r.external_id = mc.child_external_id
),
cnt AS (SELECT master_external_id, count(*) AS n FROM ch GROUP BY master_external_id)
SELECT a.master_external_id, a.external_id AS out_ext, b.external_id AS in_ext
FROM ch a
JOIN ch b ON b.master_external_id = a.master_external_id AND a.osm_id_num < b.osm_id_num
JOIN cnt c ON c.master_external_id = a.master_external_id AND c.n = 2
WHERE a.frm_n IS NOT NULL AND a.dest_n IS NOT NULL
  AND b.frm_n IS NOT NULL AND b.dest_n IS NOT NULL
  AND a.frm_n = b.dest_n AND a.dest_n = b.frm_n;

-- Canonical keys shared by 2+ non-master route relations that are NOT a clean
-- reverse pair: possible branches -> never auto-merged, flagged in stage 05.
CREATE TEMP TABLE _dup_keys ON COMMIT DROP AS
WITH cand AS (
    SELECT r.group_key
    FROM _rel r
    WHERE r.relation_type = 'route'
      AND r.group_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _master_child mc WHERE mc.child_external_id = r.external_id)
),
grp AS (SELECT group_key, count(*) AS n FROM cand GROUP BY group_key)
SELECT group_key FROM grp
WHERE n >= 2 AND group_key NOT IN (SELECT group_key FROM _reverse_pairs);

-- Per-relation decision: which canonical route it belongs to, whether it OWNS
-- that route (its attributes define it), whether it produces a variant, and its
-- direction. Exactly one owner exists per canonical route external_id.
CREATE TEMP TABLE _decision ON COMMIT DROP AS
SELECT
    r.external_id AS relation_external_id,
    CASE
        WHEN r.relation_type = 'route_master'   THEN r.external_id
        WHEN mc.master_external_id IS NOT NULL   THEN mc.master_external_id
        WHEN rp_out.out_ext IS NOT NULL         THEN rp_out.out_ext
        WHEN rp_in.out_ext  IS NOT NULL         THEN rp_in.out_ext
        ELSE r.external_id
    END AS route_external_id,
    CASE
        WHEN r.relation_type = 'route_master'   THEN true
        WHEN mc.master_external_id IS NOT NULL   THEN false
        WHEN rp_in.out_ext IS NOT NULL          THEN false
        ELSE true
    END AS is_route_owner,
    CASE
        WHEN r.relation_type = 'route_master'
             AND mwc.master_external_id IS NOT NULL THEN false
        ELSE true
    END AS makes_variant,
    CASE
        WHEN rp_out.out_ext IS NOT NULL            THEN 0
        WHEN rp_in.out_ext  IS NOT NULL            THEN 1
        WHEN mp_out.master_external_id IS NOT NULL  THEN 0
        WHEN mp_in.master_external_id  IS NOT NULL  THEN 1
        ELSE NULL
    END::smallint AS direction_id,
    CASE
        WHEN rp_out.out_ext IS NOT NULL OR mp_out.master_external_id IS NOT NULL THEN 'outbound'
        WHEN rp_in.out_ext  IS NOT NULL OR mp_in.master_external_id  IS NOT NULL THEN 'inbound'
        ELSE NULL
    END AS direction_name,
    -- A relation grouped under a master but without a clear direction is left
    -- NULL and marked needs_review (per the spec for unclear direction).
    CASE
        WHEN mc.master_external_id IS NOT NULL
             AND mp_out.master_external_id IS NULL
             AND mp_in.master_external_id  IS NULL
            THEN 'needs_review'
        ELSE 'imported_unreviewed'
    END AS variant_review_status,
    CASE
        WHEN r.relation_type = 'route_master'
             AND mwc.master_external_id IS NOT NULL THEN 'route_master'
        WHEN r.relation_type = 'route_master'      THEN 'master_no_children'
        WHEN mc.master_external_id IS NOT NULL      THEN 'master_child'
        WHEN rp_out.out_ext IS NOT NULL OR rp_in.out_ext IS NOT NULL THEN 'reverse_pair'
        WHEN r.group_key IN (SELECT group_key FROM _dup_keys)        THEN 'possible_duplicate'
        ELSE 'single'
    END AS decision_tag
FROM _rel r
LEFT JOIN _master_child         mc     ON mc.child_external_id    = r.external_id
LEFT JOIN _master_with_children mwc    ON mwc.master_external_id  = r.external_id
LEFT JOIN _reverse_pairs        rp_out ON rp_out.out_ext          = r.external_id
LEFT JOIN _reverse_pairs        rp_in  ON rp_in.in_ext            = r.external_id
LEFT JOIN _master_pairs         mp_out ON mp_out.out_ext          = r.external_id
LEFT JOIN _master_pairs         mp_in  ON mp_in.in_ext            = r.external_id;

-- -----------------------------------------------------------------------------
-- ROUTES (one per canonical group; the owner relation defines the attributes).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.routes (
    external_id, source_kind, source_name, import_batch_key,
    route_code, public_name, mode, route_kind, origin_name, destination_name,
    description, source_refs, normalized_data, confidence_score, review_status
)
SELECT
    d.route_external_id, r.src_kind, :'source_name', :'import_batch_key',
    r.route_code, r.public_name, r.osm_mode, r.route_kind_norm, r.frm, r.dest,
    r.descr, r.source_refs,
    r.normalized_data || jsonb_build_object(
        'route_group_key', r.group_key,
        'route_group_kind', d.decision_tag
    ),
    r.confidence, 'imported_unreviewed'
FROM _decision d
JOIN _rel r ON r.external_id = d.relation_external_id
WHERE d.is_route_owner;

-- -----------------------------------------------------------------------------
-- ROUTE_NAMES (localized names from EVERY relation in the group, deduped by
-- name+language with the highest search_weight winning; fallback NOT stored).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_names (
    external_id, route_external_id, source_kind, source_name, import_batch_key,
    name, language_code, name_type, is_primary, search_weight,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT DISTINCT ON (d.route_external_id, n.name, n.lang)
    d.route_external_id || ':name:' || n.lang || ':' || left(md5(n.name), 8),
    d.route_external_id, r.src_kind, :'source_name', :'import_batch_key',
    n.name, n.lang, 'primary', n.is_primary, n.weight,
    r.source_refs, r.normalized_data, r.confidence, 'imported_unreviewed'
FROM _decision d
JOIN _rel r ON r.external_id = d.relation_external_id
CROSS JOIN LATERAL (
    VALUES
        (r.nm_my, 'my',  r.nm_my IS NOT NULL,                                   110),
        (r.nm,    'und', r.nm_my IS NULL AND r.nm IS NOT NULL,                   100),
        (r.nm_en, 'en',  r.nm_my IS NULL AND r.nm IS NULL AND r.nm_en IS NOT NULL, 90)
) AS n(name, lang, is_primary, weight)
WHERE n.name IS NOT NULL
ORDER BY d.route_external_id, n.name, n.lang, n.weight DESC;

-- -----------------------------------------------------------------------------
-- ROUTE_VARIANTS (one per relation; route_external_id points at the canonical
-- route; direction_id/direction_name come from the grouping decision).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_variants (
    external_id, route_external_id, source_kind, source_name, import_batch_key,
    variant_code, direction_name, direction_id, headsign, origin_name, destination_name,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    r.external_id || ':variant:default', d.route_external_id, r.src_kind,
    :'source_name', :'import_batch_key',
    'osm_relation_' || r.osm_id, d.direction_name, d.direction_id,
    coalesce(r.dest, r.nm), r.frm, r.dest,
    r.source_refs,
    r.normalized_data || jsonb_build_object(
        'variant_kind', 'default',
        'direction_decision', d.decision_tag
    ),
    r.confidence, d.variant_review_status
FROM _decision d
JOIN _rel r ON r.external_id = d.relation_external_id
WHERE d.makes_variant;

-- -----------------------------------------------------------------------------
-- SOURCE_LINKS (one per canonical route owner, one per default variant).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    d.route_external_id, 'route', d.route_external_id, r.src_kind, :'source_name', :'import_batch_key',
    r.source_url, r.tags, true,
    r.source_refs, r.normalized_data, r.confidence, 'imported_unreviewed'
FROM _decision d
JOIN _rel r ON r.external_id = d.relation_external_id
WHERE d.is_route_owner;

INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    r.external_id || ':variant:default', 'route_variant', r.external_id || ':variant:default',
    r.src_kind, :'source_name', :'import_batch_key',
    r.source_url, r.tags, true,
    r.source_refs, r.normalized_data || jsonb_build_object('variant_kind', 'default'),
    r.confidence, 'imported_unreviewed'
FROM _decision d
JOIN _rel r ON r.external_id = d.relation_external_id
WHERE d.makes_variant;

COMMIT;

-- -----------------------------------------------------------------------------
-- Report.
-- -----------------------------------------------------------------------------
SELECT 'routes'         AS table_name, count(*) AS rows FROM local_transport_publish.routes         WHERE source_name = :'source_name'
UNION ALL
SELECT 'route_names',    count(*) FROM local_transport_publish.route_names    WHERE source_name = :'source_name'
UNION ALL
SELECT 'route_variants', count(*) FROM local_transport_publish.route_variants WHERE source_name = :'source_name'
UNION ALL
SELECT 'source_links',   count(*) FROM local_transport_publish.source_links   WHERE entity_type IN ('route','route_variant')
ORDER BY table_name;

\else
\echo '>>> 04 skipped: import_route_metadata is not true (route metadata import disabled)'
\endif
