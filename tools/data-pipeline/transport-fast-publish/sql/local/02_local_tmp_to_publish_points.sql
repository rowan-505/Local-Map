-- =============================================================================
-- transport-fast-publish — Phase 3: local normalization (LOCAL ONLY)
--
-- Reads raw OSM extraction:
--   tmp_transport_import.osm_transport_points
--   tmp_transport_import.osm_transport_lines
--
-- Writes clean, export-ready rows into the local-only buffer:
--   local_transport_publish.stops
--   local_transport_publish.stop_names
--   local_transport_publish.terminals
--   local_transport_publish.infrastructure_lines
--   local_transport_publish.source_links
--   local_transport_publish.import_errors
--
-- This stage NEVER writes to Supabase. Schema names are fixed by the pipeline
-- contract (validated by the runner) and intentionally hardcoded here.
--
-- psql variables (passed by the runner; defaults below allow standalone runs):
--   source_name, pbf_sha256, snapshot_version, import_batch_key
-- =============================================================================

\set ON_ERROR_STOP on

-- Defaults so the file is runnable standalone (the runner always passes these).
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

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotent cleanup: scoped to the entities this stage owns so re-running it
-- alone does not disturb rows produced by other (future) stages.
-- -----------------------------------------------------------------------------
DELETE FROM local_transport_publish.stop_names           WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.stops                WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.terminals            WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.infrastructure_lines WHERE source_name = :'source_name';
DELETE FROM local_transport_publish.source_links         WHERE entity_type IN ('stop', 'terminal', 'infrastructure_line');
DELETE FROM local_transport_publish.import_errors        WHERE entity_type IN ('stop', 'terminal', 'infrastructure_line');

-- -----------------------------------------------------------------------------
-- Normalize POINTS into a temp table (all derived fields computed once).
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _pts ON COMMIT DROP AS
WITH base AS (
    SELECT
        p.osm_id,
        p.osm_feature_type,
        p.external_id,
        p.transport_kind,
        p.mode AS osm_mode,
        p.tags,
        p.geom,
        ST_SetSRID(ST_Force2D(p.geom), 4326) AS geom2d,
        (p.geom IS NOT NULL AND NOT ST_IsEmpty(p.geom)) AS geom_valid,
        NULLIF(p.tags->>'name:my', '') AS nm_my,
        NULLIF(p.tags->>'name', '')    AS nm,
        NULLIF(p.tags->>'name:en', '') AS nm_en,
        NULLIF(p.tags->>'ref', '')     AS ref
    FROM tmp_transport_import.osm_transport_points p
)
SELECT
    base.*,
    coalesce(nm_my, nm, nm_en, transport_kind || ' ' || external_id) AS name_final,
    (nm_my IS NOT NULL OR nm IS NOT NULL OR nm_en IS NOT NULL OR ref IS NOT NULL) AS has_name_or_ref,
    'osm_' || osm_feature_type AS src_kind,
    CASE transport_kind
        WHEN 'bus_stop'          THEN 'stop'
        WHEN 'bus_platform'      THEN 'platform'
        WHEN 'bus_stop_position' THEN 'stop_position'
        WHEN 'bus_station'       THEN 'terminal'
        WHEN 'bus_station_pt'    THEN 'station'
        WHEN 'railway_station'   THEN 'station'
        WHEN 'railway_halt'      THEN 'halt'
        WHEN 'railway_platform'  THEN 'platform'
        WHEN 'tram_stop'         THEN 'stop'
        WHEN 'subway_entrance'   THEN 'entrance'
        WHEN 'ferry_terminal'    THEN 'terminal'
        WHEN 'ferry_platform'    THEN 'platform'
        WHEN 'aerodrome'         THEN 'airport'
        WHEN 'airport_terminal'  THEN 'terminal'
        WHEN 'helipad'           THEN 'helipad'
        ELSE 'stop'
    END AS stop_type,
    (transport_kind IN ('bus_station', 'bus_station_pt', 'railway_station',
                        'ferry_terminal', 'aerodrome', 'airport_terminal')) AS is_terminal,
    CASE
        WHEN transport_kind IN ('bus_stop', 'bus_platform', 'bus_stop_position')
            THEN CASE WHEN (nm_my IS NOT NULL OR nm IS NOT NULL OR nm_en IS NOT NULL OR ref IS NOT NULL)
                      THEN 60 ELSE 50 END
        WHEN transport_kind IN ('bus_station', 'bus_station_pt') THEN 65
        WHEN transport_kind = 'railway_station'  THEN 75
        WHEN transport_kind = 'railway_halt'     THEN 70
        WHEN transport_kind = 'railway_platform' THEN 72
        WHEN transport_kind = 'tram_stop'        THEN 70
        WHEN transport_kind = 'subway_entrance'  THEN 70
        WHEN transport_kind = 'ferry_terminal'   THEN 65
        WHEN transport_kind = 'ferry_platform'   THEN 60
        WHEN transport_kind = 'aerodrome'        THEN 75
        WHEN transport_kind = 'airport_terminal' THEN 75
        WHEN transport_kind = 'helipad'          THEN 65
        ELSE 50
    END AS confidence,
    'https://www.openstreetmap.org/'
        || CASE osm_feature_type WHEN 'node' THEN 'node' WHEN 'way' THEN 'way' ELSE osm_feature_type END
        || '/' || osm_id AS source_url,
    jsonb_build_object(
        'osm_id', osm_id,
        'osm_feature_type', osm_feature_type,
        'external_id', external_id,
        'tags', tags,
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ) AS source_refs
FROM base;

-- normalized_data depends on stop_type computed above; add it in a second pass.
ALTER TABLE _pts ADD COLUMN normalized_data jsonb;
UPDATE _pts SET normalized_data = jsonb_build_object(
    'mode', osm_mode,
    'stop_type', stop_type,
    'transport_kind', transport_kind,
    'is_terminal', is_terminal,
    'source', 'osm',
    'source_name', :'source_name',
    'source_kind', src_kind,
    'import_batch_key', :'import_batch_key'
);

-- -----------------------------------------------------------------------------
-- Normalize LINES into a temp table.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _lns ON COMMIT DROP AS
WITH base AS (
    SELECT
        l.osm_id,
        l.osm_feature_type,
        l.external_id,
        l.transport_kind,
        l.mode AS osm_mode,
        l.line_type,
        l.tags,
        l.geom,
        ST_SetSRID(ST_Force2D(l.geom), 4326) AS geom2d,
        (l.geom IS NOT NULL AND NOT ST_IsEmpty(l.geom) AND ST_NPoints(l.geom) >= 2) AS geom_valid,
        NULLIF(l.tags->>'name:my', '') AS nm_my,
        NULLIF(l.tags->>'name', '')    AS nm,
        NULLIF(l.tags->>'name:en', '') AS nm_en
    FROM tmp_transport_import.osm_transport_lines l
    -- Route-member ways are staged only so Phase 10 can build route paths; they
    -- are not transport infrastructure and must not become infrastructure_lines
    -- (they carry mode=NULL and would trip the invalid_mode hard check in 03).
    WHERE l.transport_kind <> 'route_member_way'
)
SELECT
    base.*,
    coalesce(nm_my, nm, nm_en, transport_kind || ' ' || external_id) AS name_final,
    'osm_' || osm_feature_type AS src_kind,
    CASE
        WHEN transport_kind IN ('railway_rail', 'railway_light_rail', 'railway_subway',
                                'railway_tram', 'railway_narrow_gauge', 'railway_monorail') THEN 75
        WHEN transport_kind IN ('ferry_route', 'ferry_way')   THEN 60
        WHEN transport_kind = 'railway_construction'          THEN 45
        WHEN transport_kind = 'railway_disused'               THEN 45
        WHEN transport_kind = 'railway_abandoned'             THEN 40
        ELSE 50
    END AS confidence,
    'https://www.openstreetmap.org/way/' || osm_id AS source_url,
    jsonb_build_object(
        'osm_id', osm_id,
        'osm_feature_type', osm_feature_type,
        'external_id', external_id,
        'tags', tags,
        'pbf_sha256', :'pbf_sha256',
        'snapshot_version', :'snapshot_version'
    ) AS source_refs,
    jsonb_build_object(
        'mode', osm_mode,
        'line_type', line_type,
        'transport_kind', transport_kind,
        'source', 'osm',
        'source_name', :'source_name',
        'source_kind', 'osm_' || osm_feature_type,
        'import_batch_key', :'import_batch_key'
    ) AS normalized_data
FROM base;

-- -----------------------------------------------------------------------------
-- STOPS (every valid point becomes a stop).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.stops (
    external_id, source_kind, source_name, import_batch_key, stop_code,
    name, name_mm, name_en, mode, stop_type,
    source_refs, normalized_data, confidence_score, review_status, geom
)
SELECT
    external_id, src_kind, :'source_name', :'import_batch_key', ref,
    name_final, nm_my, nm_en, osm_mode, stop_type,
    source_refs, normalized_data, confidence, 'imported_unreviewed', geom2d
FROM _pts
WHERE geom_valid;

-- -----------------------------------------------------------------------------
-- STOP_NAMES (one row per actual localized name; fallback name is NOT stored).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.stop_names (
    external_id, stop_external_id, source_kind, source_name, import_batch_key,
    name, language_code, name_type, is_primary, search_weight,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    p.external_id, p.external_id, p.src_kind, :'source_name', :'import_batch_key',
    n.name, n.lang, 'primary', n.is_primary, n.weight,
    p.source_refs, p.normalized_data, p.confidence, 'imported_unreviewed'
FROM _pts p
CROSS JOIN LATERAL (
    VALUES
        (p.nm_my, 'my',  p.nm_my IS NOT NULL,                                              110),
        (p.nm,    'und', p.nm_my IS NULL AND p.nm IS NOT NULL,                              100),
        (p.nm_en, 'en',  p.nm_my IS NULL AND p.nm IS NULL AND p.nm_en IS NOT NULL,           90)
) AS n(name, lang, is_primary, weight)
WHERE p.geom_valid
  AND n.name IS NOT NULL;

-- -----------------------------------------------------------------------------
-- TERMINALS (station/terminal-class points; linked to their stop by external_id).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.terminals (
    external_id, source_kind, source_name, import_batch_key,
    linked_stop_external_id, terminal_code, name, name_mm, name_en, mode, terminal_role,
    source_refs, normalized_data, confidence_score, review_status, geom
)
SELECT
    external_id, src_kind, :'source_name', :'import_batch_key',
    external_id, ref, name_final, nm_my, nm_en, osm_mode, 'terminal',
    source_refs, normalized_data || jsonb_build_object('terminal_role', 'terminal'),
    confidence, 'imported_unreviewed', geom2d
FROM _pts
WHERE geom_valid
  AND is_terminal;

-- -----------------------------------------------------------------------------
-- INFRASTRUCTURE_LINES (every valid line).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.infrastructure_lines (
    external_id, source_kind, source_name, import_batch_key,
    mode, line_type, name, name_mm, name_en,
    source_refs, normalized_data, confidence_score, review_status, geom
)
SELECT
    external_id, src_kind, :'source_name', :'import_batch_key',
    osm_mode, line_type, name_final, nm_my, nm_en,
    source_refs, normalized_data, confidence, 'imported_unreviewed', geom2d
FROM _lns
WHERE geom_valid;

-- -----------------------------------------------------------------------------
-- SOURCE_LINKS (one per normalized entity: stop, terminal, infrastructure_line).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'stop', external_id, src_kind, :'source_name', :'import_batch_key',
    source_url, tags, true,
    source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _pts
WHERE geom_valid;

INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'terminal', external_id, src_kind, :'source_name', :'import_batch_key',
    source_url, tags, true,
    source_refs, normalized_data || jsonb_build_object('terminal_role', 'terminal'),
    confidence, 'imported_unreviewed'
FROM _pts
WHERE geom_valid
  AND is_terminal;

INSERT INTO local_transport_publish.source_links (
    external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key,
    source_url, source_payload, is_primary,
    source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'infrastructure_line', external_id, src_kind, :'source_name', :'import_batch_key',
    source_url, tags, true,
    source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _lns
WHERE geom_valid;

-- -----------------------------------------------------------------------------
-- IMPORT_ERRORS (null/invalid geometry only; missing name is NOT an error).
-- -----------------------------------------------------------------------------
INSERT INTO local_transport_publish.import_errors (
    external_id, entity_type, source_kind, source_name, import_batch_key,
    error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'stop', src_kind, :'source_name', :'import_batch_key',
    'invalid_geometry',
    format('point %s has null or empty geometry', external_id),
    tags, source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _pts
WHERE NOT geom_valid;

INSERT INTO local_transport_publish.import_errors (
    external_id, entity_type, source_kind, source_name, import_batch_key,
    error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status
)
SELECT
    external_id, 'infrastructure_line', src_kind, :'source_name', :'import_batch_key',
    'invalid_geometry',
    format('line %s has null/empty geometry or fewer than 2 points', external_id),
    tags, source_refs, normalized_data, confidence, 'imported_unreviewed'
FROM _lns
WHERE NOT geom_valid;

COMMIT;

-- -----------------------------------------------------------------------------
-- Report.
-- -----------------------------------------------------------------------------
SELECT 'stops'                AS table_name, count(*) AS rows FROM local_transport_publish.stops                WHERE source_name = :'source_name'
UNION ALL
SELECT 'stop_names',          count(*) FROM local_transport_publish.stop_names           WHERE source_name = :'source_name'
UNION ALL
SELECT 'terminals',           count(*) FROM local_transport_publish.terminals            WHERE source_name = :'source_name'
UNION ALL
SELECT 'infrastructure_lines', count(*) FROM local_transport_publish.infrastructure_lines WHERE source_name = :'source_name'
UNION ALL
SELECT 'source_links',        count(*) FROM local_transport_publish.source_links         WHERE entity_type IN ('stop','terminal','infrastructure_line')
UNION ALL
SELECT 'import_errors',       count(*) FROM local_transport_publish.import_errors        WHERE entity_type IN ('stop','terminal','infrastructure_line')
ORDER BY table_name;
