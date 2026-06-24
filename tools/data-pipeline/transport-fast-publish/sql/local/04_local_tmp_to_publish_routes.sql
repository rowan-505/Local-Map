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

-- route_code, public_name, confidence, source_refs, normalized_data in a 2nd pass.
ALTER TABLE _rel ADD COLUMN route_code text;
ALTER TABLE _rel ADD COLUMN public_name text;
ALTER TABLE _rel ADD COLUMN confidence numeric;
ALTER TABLE _rel ADD COLUMN source_refs jsonb;
ALTER TABLE _rel ADD COLUMN normalized_data jsonb;

UPDATE _rel SET
    route_code = coalesce(ref, route_ref, external_id),
    public_name = coalesce(nm_my, nm, nm_en, ref, from_to, external_id),
    confidence = CASE WHEN has_strong_naming THEN 65 ELSE 55 END,
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
        'source', 'osm',
        'source_name', :'source_name',
        'source_kind', 'osm_relation',
        'import_batch_key', :'import_batch_key'
    );

-- -----------------------------------------------------------------------------
-- ROUTES (one per extracted relation).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.routes (
    external_id, source_kind, source_name, import_batch_key,
    route_code, public_name, mode, route_kind, origin_name, destination_name,
    description, source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, src_kind, :'source_name', :'import_batch_key',
    route_code, public_name, osm_mode, route_kind_norm, frm, dest,
    descr, source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _rel;

-- -----------------------------------------------------------------------------
-- ROUTE_NAMES (one row per actual localized name; fallback name is NOT stored).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_names (
    external_id, route_external_id, source_kind, source_name, import_batch_key,
    name, language_code, name_type, is_primary, search_weight,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    r.external_id, r.external_id, r.src_kind, :'source_name', :'import_batch_key',
    n.name, n.lang, 'primary', n.is_primary, n.weight,
    r.source_refs, r.normalized_data, r.confidence, 'imported_unreviewed'
FROM _rel r
CROSS JOIN LATERAL (
    VALUES
        (r.nm_my, 'my',  r.nm_my IS NOT NULL,                                   110),
        (r.nm,    'und', r.nm_my IS NULL AND r.nm IS NOT NULL,                   100),
        (r.nm_en, 'en',  r.nm_my IS NULL AND r.nm IS NULL AND r.nm_en IS NOT NULL, 90)
) AS n(name, lang, is_primary, weight)
WHERE n.name IS NOT NULL;

-- -----------------------------------------------------------------------------
-- ROUTE_VARIANTS (one default variant per relation).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.route_variants (
    external_id, route_external_id, source_kind, source_name, import_batch_key,
    variant_code, headsign, origin_name, destination_name,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id || ':variant:default', external_id, src_kind, :'source_name', :'import_batch_key',
    'osm_relation_' || osm_id, coalesce(dest, nm), frm, dest,
    source_refs,
    normalized_data || jsonb_build_object('variant_kind', 'default'),
    confidence, 'imported_unreviewed'
FROM _rel;

-- -----------------------------------------------------------------------------
-- SOURCE_LINKS (one per route, one per default variant).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'route', external_id, src_kind, :'source_name', :'import_batch_key',
    source_url, tags, true,
    source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _rel;

INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id || ':variant:default', 'route_variant', external_id || ':variant:default',
    src_kind, :'source_name', :'import_batch_key',
    source_url, tags, true,
    source_refs, normalized_data || jsonb_build_object('variant_kind', 'default'),
    confidence, 'imported_unreviewed'
FROM _rel;

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
