-- =============================================================================
-- transport-fast-publish — Supabase SESSION temporary tables for ROUTE PATH transfer.
--
-- Created by the runner inside the route-path publish psql session, BEFORE \copy
-- loads the exported local rows. These are PostgreSQL session temporary tables:
-- they exist only for the duration of the publish connection and are dropped
-- automatically when it closes. They are NOT permanent and never persist.
--
-- Column order MUST match the runner's export \copy column order exactly.
-- Geometry travels as hex EWKB in geom_hex.
-- =============================================================================

CREATE TEMP TABLE _pub_route_paths (
    external_id               text,
    route_variant_external_id text,
    source_kind               text,
    source_name               text,
    import_batch_key          text,
    path_kind                 text,
    distance_m                numeric,
    source_refs               jsonb,
    normalized_data           jsonb,
    confidence_score          numeric,
    review_status             text,
    geom_hex                  text
);

CREATE TEMP TABLE _pub_source_links (
    external_id        text,
    entity_type        text,
    entity_external_id text,
    source_kind        text,
    source_name        text,
    import_batch_key   text,
    source_url         text,
    source_payload     jsonb,
    is_primary         boolean,
    source_refs        jsonb,
    normalized_data    jsonb,
    confidence_score   numeric,
    review_status      text
);

CREATE TEMP TABLE _pub_import_errors (
    external_id      text,
    entity_type      text,
    source_kind      text,
    source_name      text,
    import_batch_key text,
    error_code       text,
    error_message    text,
    raw_payload      jsonb,
    source_refs      jsonb,
    normalized_data  jsonb,
    confidence_score numeric,
    review_status    text
);
