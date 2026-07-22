-- =============================================================================
-- Prod mirror helpers (local only).
-- Read-only comparison copies under prod_mirror.*.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS prod_mirror;

-- Single-row refresh metadata (upsert id = 1).
CREATE TABLE IF NOT EXISTS prod_mirror.mirror_meta (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    refreshed_at timestamptz NOT NULL,
    source_project_ref text,
    source_host text,
    source_database text,
    source_user text,
    refresh_mode text NOT NULL DEFAULT 'slim_family_columns',
    table_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    live_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prod_mirror.fdw_columns(p_table text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(array_agg(c.column_name::text ORDER BY c.ordinal_position), ARRAY[]::text[])
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'supabase_fdw'
      AND c.table_name = p_table;
$$;

CREATE OR REPLACE FUNCTION prod_mirror.intersect_columns(p_available text[], p_wanted text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(
        array_agg(w ORDER BY ord),
        ARRAY[]::text[]
    )
    FROM unnest(p_wanted) WITH ORDINALITY AS u(w, ord)
    WHERE w = ANY (p_available);
$$;

CREATE OR REPLACE FUNCTION prod_mirror.quote_ident_list(p_cols text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_cols IS NULL OR cardinality(p_cols) = 0 THEN NULL
        ELSE (
            SELECT string_agg(format('%I', c), ', ' ORDER BY ord)
            FROM unnest(p_cols) WITH ORDINALITY AS u(c, ord)
        )
    END;
$$;

-- Geometry fingerprint used for comparison (local compute; not from core).
CREATE OR REPLACE FUNCTION prod_mirror.geometry_hash(p_geom geometry)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL THEN NULL
        ELSE md5(encode(ST_AsBinary(ST_SnapToGrid(ST_Force2D(p_geom), 0.0000001)), 'hex'))
    END;
$$;

-- Compact content hash for mirror rows (identity + name + class + geom + protection).
CREATE OR REPLACE FUNCTION prod_mirror.source_content_hash(
    p_external_id text,
    p_name text,
    p_class_key text,
    p_geom geometry,
    p_manual_override boolean,
    p_is_verified boolean,
    p_verification_status text,
    p_deleted_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT md5(
        coalesce(nullif(btrim(p_external_id), ''), '')
        || E'\n'
        || coalesce(nullif(btrim(p_name), ''), '')
        || E'\n'
        || coalesce(nullif(btrim(p_class_key), ''), '')
        || E'\n'
        || coalesce(prod_mirror.geometry_hash(p_geom), '')
        || E'\n'
        || coalesce(p_manual_override::text, '')
        || E'\n'
        || coalesce(p_is_verified::text, '')
        || E'\n'
        || coalesce(nullif(btrim(p_verification_status), ''), '')
        || E'\n'
        || coalesce(p_deleted_at::text, '')
    );
$$;
