-- =============================================================================
-- transport-fast-publish — Phase 0: prepare local transport import
--
-- LOCAL POSTGRES ONLY. Do NOT run against Supabase.
--
-- Architecture:
--   * Heavy OSM extraction happens only in local Postgres.
--   * Supabase receives only final normalized rows into transport.*.
--   * Supabase must never hold tmp_transport_import / raw OSM / staging data.
--
-- This script creates two local-only schemas:
--   1. tmp_transport_import   — osm2pgsql output only (dropped + recreated each run).
--   2. local_transport_publish — clean, export-ready rows buffered before publish
--                                to Supabase transport.* (truncated each run).
--
-- The local publish tables are NOT production tables. They are a clean export
-- buffer. Supabase final id values are not known locally, so relationships are
-- linked by *_external_id text fields during publish (no cross-table FKs here).
--
-- Idempotency:
--   * Re-running this script is safe.
--   * tmp_transport_import is dropped + recreated (osm2pgsql tables wiped).
--   * local_transport_publish tables are created-if-missing then truncated.
--
-- Deliberately NOT created here: raw / staging / import_review / promotion
-- schemas, and nothing in Supabase. No deleted legacy schema names are used
-- (core_transport, import_transport, gtfs_export, core.core_bus_*, import_review.bus_*).
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- PostGIS is required for the geometry columns below; present on local geo_core.
CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- 1. tmp_transport_import — osm2pgsql output only.
--    Fully dropped + recreated each run so stale osm2pgsql tables never linger.
-- -----------------------------------------------------------------------------
DROP SCHEMA IF EXISTS tmp_transport_import CASCADE;
CREATE SCHEMA tmp_transport_import;
COMMENT ON SCHEMA tmp_transport_import IS
    'Local-only osm2pgsql output for transport extraction. Dropped/recreated each run. Never published to Supabase.';

-- -----------------------------------------------------------------------------
-- 2. local_transport_publish — clean export buffer.
--    Created-if-missing (preserves table shape), then truncated below.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS local_transport_publish;
COMMENT ON SCHEMA local_transport_publish IS
    'Local-only clean export buffer of normalized transport rows ready to publish to Supabase transport.*. Linked by external_id, not by Supabase ids.';

-- stops -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.stops (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id             text,
    source_kind             text,
    source_name             text,
    import_batch_key        text,
    stop_code               text,
    name                    text,
    name_mm                 text,
    name_en                 text,
    mode                    text,
    stop_type               text,
    parent_stop_external_id text,
    admin_area_external_id  text,
    source_refs             jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data         jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score        numeric NOT NULL DEFAULT 50,
    review_status           text    NOT NULL DEFAULT 'imported_unreviewed',
    geom                    geometry(Point, 4326),
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- stop_names ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.stop_names (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id      text,
    stop_external_id text,
    source_kind      text,
    source_name      text,
    import_batch_key text,
    name             text,
    language_code    text    NOT NULL DEFAULT 'und',
    script_code      text,
    name_type        text    NOT NULL DEFAULT 'primary',
    is_primary       boolean NOT NULL DEFAULT false,
    search_weight    integer NOT NULL DEFAULT 100,
    source_refs      jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data  jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score numeric NOT NULL DEFAULT 50,
    review_status    text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- terminals -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.terminals (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id             text,
    source_kind             text,
    source_name             text,
    import_batch_key        text,
    linked_stop_external_id text,
    operator_external_id    text,
    terminal_code           text,
    name                    text,
    name_mm                 text,
    name_en                 text,
    mode                    text,
    terminal_role           text,
    admin_area_external_id  text,
    source_refs             jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data         jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score        numeric NOT NULL DEFAULT 50,
    review_status           text    NOT NULL DEFAULT 'imported_unreviewed',
    geom                    geometry(Point, 4326),
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- infrastructure_lines --------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.infrastructure_lines (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id            text,
    source_kind            text,
    source_name            text,
    import_batch_key       text,
    mode                   text,
    line_type              text,
    name                   text,
    name_mm                text,
    name_en                text,
    admin_area_external_id text,
    source_refs            jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data        jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score       numeric NOT NULL DEFAULT 50,
    review_status          text    NOT NULL DEFAULT 'imported_unreviewed',
    geom                   geometry(LineString, 4326),
    created_at             timestamptz NOT NULL DEFAULT now()
);

-- routes ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.routes (
    id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id                     text,
    source_kind                     text,
    source_name                     text,
    import_batch_key                text,
    operator_external_id            text,
    route_code                      text,
    public_name                     text,
    mode                            text,
    route_kind                      text,
    origin_name                     text,
    destination_name                text,
    origin_admin_area_external_id   text,
    destination_admin_area_external_id text,
    description                     text,
    source_refs                     jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data                 jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score                numeric NOT NULL DEFAULT 50,
    review_status                   text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at                      timestamptz NOT NULL DEFAULT now()
);

-- route_names -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.route_names (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id       text,
    route_external_id text,
    source_kind       text,
    source_name       text,
    import_batch_key  text,
    name              text,
    language_code     text    NOT NULL DEFAULT 'und',
    script_code       text,
    name_type         text    NOT NULL DEFAULT 'primary',
    is_primary        boolean NOT NULL DEFAULT false,
    search_weight     integer NOT NULL DEFAULT 100,
    source_refs       jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data   jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score  numeric NOT NULL DEFAULT 50,
    review_status     text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- route_variants --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.route_variants (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id                 text,
    route_external_id           text,
    source_kind                 text,
    source_name                 text,
    import_batch_key            text,
    variant_code                text,
    direction_name              text,
    direction_id                smallint,
    headsign                    text,
    origin_stop_external_id     text,
    destination_stop_external_id text,
    origin_name                 text,
    destination_name            text,
    distance_m                  numeric,
    estimated_duration_min      integer,
    source_refs                 jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data             jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score            numeric NOT NULL DEFAULT 50,
    review_status               text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at                  timestamptz NOT NULL DEFAULT now()
);

-- route_paths -----------------------------------------------------------------
-- geom kept as LineString to match final transport.route_paths. OSM route
-- relations must already be merged into a single LineString before landing here.
CREATE TABLE IF NOT EXISTS local_transport_publish.route_paths (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id               text,
    route_variant_external_id text,
    source_kind               text,
    source_name               text,
    import_batch_key          text,
    path_kind                 text,
    distance_m                numeric,
    source_refs               jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data           jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score          numeric NOT NULL DEFAULT 50,
    review_status             text    NOT NULL DEFAULT 'imported_unreviewed',
    geom                      geometry(LineString, 4326),
    created_at                timestamptz NOT NULL DEFAULT now()
);

-- route_stops -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.route_stops (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id               text,
    route_variant_external_id text,
    stop_external_id          text,
    source_kind               text,
    source_name               text,
    import_batch_key          text,
    stop_sequence             integer,
    distance_from_start_m     numeric,
    pickup_type               smallint,
    drop_off_type             smallint,
    arrival_offset_seconds    integer,
    departure_offset_seconds  integer,
    is_timing_point           boolean,
    source_refs               jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data           jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score          numeric NOT NULL DEFAULT 50,
    review_status             text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at                timestamptz NOT NULL DEFAULT now()
);

-- source_links ----------------------------------------------------------------
-- Linked to its owning entity by (entity_type, entity_external_id).
CREATE TABLE IF NOT EXISTS local_transport_publish.source_links (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id         text,
    entity_type         text,
    entity_external_id  text,
    source_kind         text,
    source_name         text,
    import_batch_key    text,
    source_url          text,
    source_payload      jsonb   NOT NULL DEFAULT '{}'::jsonb,
    is_primary          boolean NOT NULL DEFAULT false,
    source_refs         jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data     jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score    numeric NOT NULL DEFAULT 50,
    review_status       text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- import_errors ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_transport_publish.import_errors (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id      text,
    entity_type      text,
    source_kind      text,
    source_name      text,
    import_batch_key text,
    error_code       text,
    error_message    text,
    raw_payload      jsonb   NOT NULL DEFAULT '{}'::jsonb,
    source_refs      jsonb   NOT NULL DEFAULT '{}'::jsonb,
    normalized_data  jsonb   NOT NULL DEFAULT '{}'::jsonb,
    confidence_score numeric NOT NULL DEFAULT 50,
    review_status    text    NOT NULL DEFAULT 'imported_unreviewed',
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Helpful (non-unique) lookup indexes for external_id-based publish joins.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ltp_stops_external_id_idx                 ON local_transport_publish.stops (external_id);
CREATE INDEX IF NOT EXISTS ltp_stop_names_stop_external_id_idx       ON local_transport_publish.stop_names (stop_external_id);
CREATE INDEX IF NOT EXISTS ltp_terminals_external_id_idx             ON local_transport_publish.terminals (external_id);
CREATE INDEX IF NOT EXISTS ltp_infrastructure_lines_external_id_idx  ON local_transport_publish.infrastructure_lines (external_id);
CREATE INDEX IF NOT EXISTS ltp_routes_external_id_idx                ON local_transport_publish.routes (external_id);
CREATE INDEX IF NOT EXISTS ltp_route_names_route_external_id_idx     ON local_transport_publish.route_names (route_external_id);
CREATE INDEX IF NOT EXISTS ltp_route_variants_route_external_id_idx  ON local_transport_publish.route_variants (route_external_id);
CREATE INDEX IF NOT EXISTS ltp_route_paths_variant_external_id_idx   ON local_transport_publish.route_paths (route_variant_external_id);
CREATE INDEX IF NOT EXISTS ltp_route_stops_variant_external_id_idx   ON local_transport_publish.route_stops (route_variant_external_id);
CREATE INDEX IF NOT EXISTS ltp_route_stops_stop_external_id_idx      ON local_transport_publish.route_stops (stop_external_id);
CREATE INDEX IF NOT EXISTS ltp_source_links_entity_idx              ON local_transport_publish.source_links (entity_type, entity_external_id);

-- -----------------------------------------------------------------------------
-- Truncate the export buffer so each prepare run starts clean.
-- No cross-table FKs exist, so order does not matter; RESTART IDENTITY resets ids.
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    local_transport_publish.stops,
    local_transport_publish.stop_names,
    local_transport_publish.terminals,
    local_transport_publish.infrastructure_lines,
    local_transport_publish.routes,
    local_transport_publish.route_names,
    local_transport_publish.route_variants,
    local_transport_publish.route_paths,
    local_transport_publish.route_stops,
    local_transport_publish.source_links,
    local_transport_publish.import_errors
RESTART IDENTITY;

COMMIT;

-- Verification: list the prepared local schemas + publish tables.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('tmp_transport_import', 'local_transport_publish')
ORDER BY table_schema, table_name;
