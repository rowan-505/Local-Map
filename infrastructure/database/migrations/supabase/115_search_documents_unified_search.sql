-- =============================================================================
-- Supabase migration 115: unified runtime search (search.search_documents)
-- =============================================================================
--
-- Adds a single, denormalized runtime search store the API can query directly
-- for unified search across places, streets, admin areas, bus routes/stops,
-- express routes/terminals, etc. One row per entity, rebuilt by an indexer.
--
-- ADDITIVE + idempotent. This migration:
--   * does NOT touch the existing search.search_names / search.search_addresses
--     / search.address_index tables (kept as-is for current pipelines),
--   * only CREATEs new objects guarded by IF NOT EXISTS.
--
-- Design constraints (see AGENTS.md):
--   * Database is the source of truth; this is a derived/denormalized index.
--   * No heavy geometry is stored here: only centroid (Point), bbox envelope,
--     geometry_type label, and a has_geometry flag. Full geometry stays in core.
--   * Scores use the 0-100 scale.
--   * Plus Codes are computed/decoded on demand (see apps/api lib/geo/plus-code);
--     supports_plus_code is a capability hint only -- we never store a plus_code
--     string here and never match search against a stored plus code.
--
-- New objects:
--   search.search_documents        -- one searchable row per entity
--   search.search_document_names   -- multilingual names + aliases per document
--   search.failed_search_logs      -- zero-result / failed query telemetry
--   search.search_index_runs       -- indexer run bookkeeping
-- =============================================================================

begin;

create schema if not exists search;

-- pg_trgm powers fuzzy / substring matching for both documents and names.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- search.search_documents
-- ---------------------------------------------------------------------------
create table if not exists search.search_documents (
    id bigserial primary key,

    -- Identity of the source entity this row was derived from.
    entity_type text not null,
    entity_id bigint not null,
    public_id text null,

    -- Display fields used directly by result cards.
    display_name text null,
    subtitle text null,

    -- Primary names per language family (Myanmar / English / undetermined).
    primary_name_my text null,
    primary_name_en text null,
    primary_name_und text null,

    -- Stable codes / external references for exact lookups.
    code text null,
    external_id text null,

    -- Category snapshot (denormalized from ref.* for fast result rendering).
    category_code text null,
    category_name_my text null,
    category_name_en text null,

    -- Admin context snapshot.
    admin_area_id bigint null,
    admin_area_name_my text null,
    admin_area_name_en text null,
    admin_hierarchy jsonb null,

    -- Address context (composed line + structured parts).
    address_text text null,
    address_parts jsonb null,

    -- Lightweight geometry only. Heavy geometry stays in core.* tables.
    geometry_type text null,
    centroid geometry(Point, 4326) null,
    bbox geometry(Geometry, 4326) null,
    has_geometry boolean not null default false,

    -- Capability hint only. We do NOT store a plus_code value and never match
    -- search against a stored plus code -- Plus Codes are decoded on demand.
    supports_plus_code boolean not null default false,

    -- Search payloads. search_vector is a generated tsvector over searchable_text
    -- using the 'simple' config (no English stemming -> safe for Myanmar text).
    searchable_text text null,
    search_vector tsvector generated always as (
        to_tsvector('simple', coalesce(searchable_text, ''))
    ) stored,
    trigram_text text null,

    -- Ranking inputs, all on the 0-100 scale.
    importance_score numeric not null default 0,
    popularity_score numeric not null default 0,
    confidence_score numeric not null default 0,
    boundary_confidence_score numeric not null default 0,

    -- Status flags.
    is_verified boolean not null default false,
    is_public boolean not null default true,
    is_active boolean not null default true,

    -- Provenance / freshness.
    source_updated_at timestamptz null,
    indexed_at timestamptz not null default now(),

    constraint search_documents_entity_uq unique (entity_type, entity_id),
    constraint search_documents_importance_score_chk
        check (importance_score >= 0 and importance_score <= 100),
    constraint search_documents_popularity_score_chk
        check (popularity_score >= 0 and popularity_score <= 100),
    constraint search_documents_confidence_score_chk
        check (confidence_score >= 0 and confidence_score <= 100),
    constraint search_documents_boundary_confidence_score_chk
        check (boundary_confidence_score >= 0 and boundary_confidence_score <= 100)
);

comment on table search.search_documents is
    'Unified runtime search index: one denormalized row per source entity. Rebuilt by the search indexer; never edited by hand.';
comment on column search.search_documents.bbox is
    'Lightweight envelope (ST_Envelope of source geometry). Heavy geometry stays in core.*; fetch full geometry via the geometry endpoint.';
comment on column search.search_documents.supports_plus_code is
    'Capability hint only. No plus_code string is stored; Plus Codes are decoded on demand and never matched against stored values.';
comment on column search.search_documents.search_vector is
    'Generated tsvector over searchable_text using the simple config (no stemming) for multilingual safety.';

-- ---------------------------------------------------------------------------
-- search.search_documents indexes
-- ---------------------------------------------------------------------------
-- Full-text search.
create index if not exists search_documents_search_vector_gin
    on search.search_documents using gin (search_vector);

-- Fuzzy / substring matching (typo tolerance, partial names).
create index if not exists search_documents_trigram_text_trgm
    on search.search_documents using gin (trigram_text gin_trgm_ops);

-- Distance ranking / nearest lookups.
create index if not exists search_documents_centroid_gix
    on search.search_documents using gist (centroid);

-- Viewport / bbox intersection.
create index if not exists search_documents_bbox_gix
    on search.search_documents using gist (bbox);

-- Common filter path: by entity type, restricted to public+active rows.
create index if not exists search_documents_entity_public_active_idx
    on search.search_documents (entity_type, is_public, is_active);

-- Partial index for the hot public/active result path.
create index if not exists search_documents_public_active_partial_idx
    on search.search_documents (entity_type)
    where is_public = true and is_active = true;

-- Case-insensitive exact code lookups (e.g. bus route_code).
create index if not exists search_documents_lower_code_idx
    on search.search_documents (lower(code))
    where code is not null;

-- ---------------------------------------------------------------------------
-- search.search_document_names
-- ---------------------------------------------------------------------------
create table if not exists search.search_document_names (
    id bigserial primary key,
    search_document_id bigint not null
        references search.search_documents (id) on delete cascade,
    language_code text not null,
    script_code text null,
    name text not null,
    normalized_name text null,
    name_type text null,
    is_primary boolean not null default false,
    search_weight numeric not null default 0
);

comment on table search.search_document_names is
    'Multilingual names and aliases for search.search_documents rows. Rebuilt by the indexer.';

create index if not exists search_document_names_document_id_idx
    on search.search_document_names (search_document_id);

create index if not exists search_document_names_language_code_idx
    on search.search_document_names (language_code);

-- Language/name fuzzy matching for alias search.
create index if not exists search_document_names_normalized_name_trgm
    on search.search_document_names using gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- search.failed_search_logs
-- ---------------------------------------------------------------------------
create table if not exists search.failed_search_logs (
    id bigserial primary key,
    query text not null,
    normalized_query text null,
    lang text null,
    lat double precision null,
    lng double precision null,
    types text[] null,
    result_count integer not null default 0,
    created_at timestamptz not null default now()
);

comment on table search.failed_search_logs is
    'Telemetry for zero-result / failed search queries to drive data and ranking improvements.';

create index if not exists failed_search_logs_created_at_idx
    on search.failed_search_logs (created_at desc);

create index if not exists failed_search_logs_normalized_query_idx
    on search.failed_search_logs (lower(normalized_query))
    where normalized_query is not null;

-- ---------------------------------------------------------------------------
-- search.search_index_runs
-- ---------------------------------------------------------------------------
create table if not exists search.search_index_runs (
    id bigserial primary key,
    status text not null default 'running',
    started_at timestamptz not null default now(),
    finished_at timestamptz null,
    entity_counts jsonb null,
    error_message text null,
    constraint search_index_runs_status_chk
        check (status in ('pending', 'running', 'success', 'failed'))
);

comment on table search.search_index_runs is
    'Bookkeeping for search indexer runs (status, timing, per-entity counts, errors).';

create index if not exists search_index_runs_started_at_idx
    on search.search_index_runs (started_at desc);

commit;

-- =============================================================================
-- Rollback (manual; run only if reverting this migration):
--   begin;
--     drop table if exists search.search_index_runs;
--     drop table if exists search.failed_search_logs;
--     drop table if exists search.search_document_names;
--     drop table if exists search.search_documents;
--   commit;
-- Note: the pg_trgm extension is intentionally NOT dropped on rollback (it is a
-- shared dependency used by other search indexes). Existing search.search_names,
-- search.search_addresses, and search.address_index are untouched.
-- =============================================================================
-- End 115_search_documents_unified_search.sql
-- =============================================================================
