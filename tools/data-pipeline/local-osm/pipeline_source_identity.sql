-- =============================================================================
-- Shared OSM source-identity helpers (system schema).
-- Idempotent — safe to \ir before Stage 05 / 07 / audit scripts.
--
-- Canonical NEW pipeline identity:
--   osm:node:<id> | osm:way:<id> | osm:relation:<id>
--
-- Legacy production identity (do not rewrite in bulk):
--   osm:N:<id> | osm:W:<id> | osm:R:<id>
--
-- Matching uses pipeline_osm_identity_key() so both forms equate.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- Map any accepted OSM type token → node | way | relation.
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

-- Build canonical external_id for new staging / package rows.
-- Accepts osm_id as text or numeric string; rejects empty / non-digit ids.
CREATE OR REPLACE FUNCTION system.pipeline_osm_external_id(p_feature_type text, p_osm_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN system.pipeline_osm_feature_type_canonical(p_feature_type) IS NULL THEN NULL
        WHEN nullif(btrim(p_osm_id), '') IS NULL THEN NULL
        WHEN btrim(p_osm_id) !~ '^[0-9]+$' THEN NULL
        ELSE 'osm:'
            || system.pipeline_osm_feature_type_canonical(p_feature_type)
            || ':'
            || btrim(p_osm_id)
    END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_osm_external_id(p_feature_type text, p_osm_id bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT system.pipeline_osm_external_id(p_feature_type, p_osm_id::text);
$$;

-- Normalize any known OSM external_id (canonical or legacy short) to canonical key.
-- Also accepts osm:node/<id> and bare type/id variants used in older tests.
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

-- Classify stored identity for audits.
--   canonical_long | legacy_short | null_or_blank | other
CREATE OR REPLACE FUNCTION system.pipeline_osm_classify_identity(p_external_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_external_id IS NULL OR btrim(p_external_id) = '' THEN 'null_or_blank'
        WHEN btrim(p_external_id) ~ '^osm:(node|way|relation):[0-9]+$' THEN 'canonical_long'
        WHEN btrim(p_external_id) ~ '^osm:[NWR]:[0-9]+$' THEN 'legacy_short'
        ELSE 'other'
    END;
$$;

SELECT
    'pipeline_source_identity' AS section,
    'loaded' AS status,
    system.pipeline_osm_external_id('way', 123) AS sample_canonical,
    system.pipeline_osm_identity_key('osm:W:123') AS sample_legacy_key,
    system.pipeline_osm_identity_matches('osm:way:123', 'osm:W:123') AS sample_match;
