-- =============================================================================
-- transport-fast-publish — Supabase SESSION temporary tables for ROUTE transfer.
--
-- Created by the runner inside the route publish psql session, BEFORE \copy
-- loads the exported local rows. These are PostgreSQL session temporary tables:
-- they exist only for the duration of the publish connection and are dropped
-- automatically when it closes. They are NOT permanent and never persist.
--
-- Column order MUST match the runner's export \copy column order exactly.
-- Routes/variants/names carry no geometry.
-- =============================================================================

CREATE TEMP TABLE _pub_routes (
    external_id      text,
    source_kind      text,
    source_name      text,
    import_batch_key text,
    route_code       text,
    public_name      text,
    mode             text,
    route_kind       text,
    origin_name      text,
    destination_name text,
    description      text,
    source_refs      jsonb,
    normalized_data  jsonb,
    confidence_score numeric,
    review_status    text
);

CREATE TEMP TABLE _pub_route_names (
    external_id       text,
    route_external_id text,
    source_kind       text,
    source_name       text,
    import_batch_key  text,
    name              text,
    language_code     text,
    script_code       text,
    name_type         text,
    is_primary        boolean,
    search_weight     integer,
    source_refs       jsonb,
    normalized_data   jsonb,
    confidence_score  numeric,
    review_status     text
);

CREATE TEMP TABLE _pub_route_variants (
    external_id                  text,
    route_external_id            text,
    source_kind                  text,
    source_name                  text,
    import_batch_key             text,
    variant_code                 text,
    direction_name               text,
    direction_id                 smallint,
    headsign                     text,
    origin_stop_external_id      text,
    destination_stop_external_id text,
    origin_name                  text,
    destination_name             text,
    distance_m                   numeric,
    estimated_duration_min       integer,
    source_refs                  jsonb,
    normalized_data              jsonb,
    confidence_score             numeric,
    review_status                text
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
