-- =============================================================================
-- Supabase migration 137: OSM identity helpers for set-based loaders
-- =============================================================================
--
-- Purpose:
--   Install system.pipeline_osm_identity_key / matches on Supabase so import_work
--   loaders can upsert by canonical OSM identity (legacy osm:N|W|R: supported).
--
-- Safety:
--   CREATE OR REPLACE functions only. No core data changes.
--
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.pipeline_osm_feature_type_canonical(p_feature_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT CASE lower(btrim(p_feature_type))
        WHEN 'n' THEN 'node'
        WHEN 'node' THEN 'node'
        WHEN 'w' THEN 'way'
        WHEN 'way' THEN 'way'
        WHEN 'r' THEN 'relation'
        WHEN 'rel' THEN 'relation'
        WHEN 'relation' THEN 'relation'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_osm_identity_key(p_external_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_raw text := nullif(btrim(p_external_id), '');
    v_body text;
    v_type text;
    v_id text;
    v_parts text[];
BEGIN
    IF v_raw IS NULL THEN
        RETURN NULL;
    END IF;

    IF lower(v_raw) LIKE 'osm:%' THEN
        v_body := substr(v_raw, 5);
    ELSE
        v_body := v_raw;
    END IF;

    v_body := replace(v_body, '/', ':');
    v_parts := string_to_array(v_body, ':');

    IF array_length(v_parts, 1) < 2 THEN
        RETURN NULL;
    END IF;

    v_type := system.pipeline_osm_feature_type_canonical(v_parts[1]);
    v_id := nullif(btrim(v_parts[2]), '');

    IF v_type IS NULL OR v_id IS NULL OR v_id !~ '^[0-9]+$' THEN
        RETURN NULL;
    END IF;

    RETURN 'osm:' || v_type || ':' || v_id;
END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_osm_identity_matches(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_osm_identity_key(p_a) IS NOT NULL
       AND system.pipeline_osm_identity_key(p_a) = system.pipeline_osm_identity_key(p_b);
$$;

COMMENT ON FUNCTION system.pipeline_osm_identity_key(text) IS
    'Canonical OSM identity key; equates osm:way:123 and legacy osm:W:123.';

COMMIT;
