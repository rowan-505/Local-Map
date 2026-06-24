-- =============================================================================
-- transport-fast-publish — Supabase SESSION temporary tables for transfer.
--
-- Created by the runner inside the publish psql session, BEFORE \copy loads the
-- exported local rows. These are PostgreSQL session temporary tables: they exist
-- only for the duration of the publish connection and are dropped automatically
-- when it closes. They are NOT permanent schemas and never persist in Supabase.
--
-- Column order MUST match the runner's export \copy column order exactly.
-- Geometry travels as hex EWKB (geom_hex) and is rebuilt with ::geometry.
-- =============================================================================

CREATE TEMP TABLE _pub_stops (
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
    source_refs             jsonb,
    normalized_data         jsonb,
    confidence_score        numeric,
    review_status           text,
    geom_hex                text
);

CREATE TEMP TABLE _pub_stop_names (
    external_id      text,
    stop_external_id text,
    source_kind      text,
    source_name      text,
    import_batch_key text,
    name             text,
    language_code    text,
    script_code      text,
    name_type        text,
    is_primary       boolean,
    search_weight    integer,
    source_refs      jsonb,
    normalized_data  jsonb,
    confidence_score numeric,
    review_status    text
);

CREATE TEMP TABLE _pub_terminals (
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
    source_refs             jsonb,
    normalized_data         jsonb,
    confidence_score        numeric,
    review_status           text,
    geom_hex                text
);

CREATE TEMP TABLE _pub_infrastructure_lines (
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
    source_refs            jsonb,
    normalized_data        jsonb,
    confidence_score       numeric,
    review_status          text,
    geom_hex               text
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
