-- =============================================================================
-- Read-only OSM source-identity audit
--
-- Reports per-family counts for:
--   total / canonical_long / legacy_short / null_or_blank / other / duplicate keys
--
-- Uses pg_temp helpers only (inside a rolled-back transaction) so a production
-- run does not leave durable DDL behind.
--
-- Does NOT write core or import_review data.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f tools/data-pipeline/local-osm/16_source_identity_audit.sql
--
-- Optional:
--   -v target_schema=core          (default)
--   -v include_deleted=false       (default; set true to include soft-deleted)
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?target_schema}
\else
\set target_schema 'core'
\endif

\if :{?include_deleted}
\else
\set include_deleted 'false'
\endif

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.audit_osm_feature_type_canonical(p_feature_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
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

CREATE OR REPLACE FUNCTION pg_temp.audit_osm_identity_key(p_external_id text)
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

    v_type := pg_temp.audit_osm_feature_type_canonical(v_parts[1]);
    v_id := nullif(btrim(v_parts[2]), '');
    IF v_type IS NULL OR v_id IS NULL OR v_id !~ '^[0-9]+$' THEN
        RETURN NULL;
    END IF;

    RETURN 'osm:' || v_type || ':' || v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.audit_osm_classify_identity(p_external_id text)
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

CREATE OR REPLACE FUNCTION pg_temp.audit_osm_external_id(p_feature_type text, p_osm_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN pg_temp.audit_osm_feature_type_canonical(p_feature_type) IS NULL THEN NULL
        WHEN nullif(btrim(p_osm_id), '') IS NULL THEN NULL
        WHEN btrim(p_osm_id) !~ '^[0-9]+$' THEN NULL
        ELSE 'osm:' || pg_temp.audit_osm_feature_type_canonical(p_feature_type) || ':' || btrim(p_osm_id)
    END;
$$;

CREATE TEMP TABLE source_identity_audit_params (
    target_schema text NOT NULL,
    include_deleted boolean NOT NULL
);

INSERT INTO source_identity_audit_params (target_schema, include_deleted)
VALUES (
    coalesce(nullif(btrim(:'target_schema'), ''), 'core'),
    lower(coalesce(nullif(btrim(:'include_deleted'), ''), 'false')) IN ('true', '1', 'yes')
);

CREATE TEMP TABLE source_identity_audit (
    family text NOT NULL,
    source_table text NOT NULL,
    total_rows bigint NOT NULL,
    canonical_identity_count bigint NOT NULL,
    legacy_identity_count bigint NOT NULL,
    null_identity_count bigint NOT NULL,
    other_identity_count bigint NOT NULL,
    duplicate_identity_count bigint NOT NULL,
    notes text
);

DO $audit$
DECLARE
    v_schema text;
    v_include_deleted boolean;
    r record;
    v_deleted_pred text;
    v_sql text;
BEGIN
    SELECT p.target_schema, p.include_deleted
    INTO v_schema, v_include_deleted
    FROM source_identity_audit_params AS p
    LIMIT 1;

    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'target_schema is required';
    END IF;

    v_deleted_pred := CASE
        WHEN v_include_deleted THEN 'TRUE'
        ELSE 'deleted_at IS NULL'
    END;

    FOR r IN
        SELECT *
        FROM (
            VALUES
                ('roads', 'core_streets', 'external_id column; unique index present in production'),
                ('admin_areas', 'core_admin_areas', 'external_id column; unique index present in production'),
                ('places', 'core_places', 'external_id column; index only (not unique)'),
                ('buildings', 'core_buildings', 'external_id column; index only (not unique)'),
                ('landuse', 'core_land_areas', 'external_id column; index only (not unique)'),
                ('water_lines', 'core_water_lines', 'external_id column; index only (not unique)'),
                ('water_polygons', 'core_water_polygons', 'external_id column; index only (not unique)')
        ) AS t(family, table_name, notes)
    LOOP
        IF to_regclass(format('%I.%I', v_schema, r.table_name)) IS NULL THEN
            INSERT INTO source_identity_audit
            VALUES (r.family, format('%I.%I', v_schema, r.table_name), 0, 0, 0, 0, 0, 0, 'table missing');
            CONTINUE;
        END IF;

        v_sql := format(
            $q$
            WITH base AS (
                SELECT external_id
                FROM %I.%I
                WHERE %s
            ),
            keyed AS (
                SELECT
                    pg_temp.audit_osm_classify_identity(external_id) AS cls,
                    pg_temp.audit_osm_identity_key(external_id) AS identity_key
                FROM base
            ),
            dup AS (
                SELECT identity_key, count(*) AS c
                FROM keyed
                WHERE identity_key IS NOT NULL
                GROUP BY identity_key
                HAVING count(*) > 1
            )
            INSERT INTO source_identity_audit (
                family, source_table, total_rows,
                canonical_identity_count, legacy_identity_count,
                null_identity_count, other_identity_count,
                duplicate_identity_count, notes
            )
            SELECT
                %L,
                %L,
                count(*),
                count(*) FILTER (WHERE cls = 'canonical_long'),
                count(*) FILTER (WHERE cls = 'legacy_short'),
                count(*) FILTER (WHERE cls = 'null_or_blank'),
                count(*) FILTER (WHERE cls = 'other'),
                coalesce((SELECT sum(c - 1) FROM dup), 0),
                %L
            FROM keyed
            $q$,
            v_schema,
            r.table_name,
            v_deleted_pred,
            r.family,
            format('%I.%I', v_schema, r.table_name),
            r.notes
        );
        EXECUTE v_sql;
    END LOOP;

    IF to_regclass('routing.routing_barriers') IS NOT NULL THEN
        INSERT INTO source_identity_audit
        SELECT
            'routing_barriers',
            'routing.routing_barriers',
            count(*),
            count(*) FILTER (
                WHERE pg_temp.audit_osm_classify_identity(
                    coalesce(source_refs->>'external_id', source_refs->>'osm_external_id')
                ) = 'canonical_long'
            ),
            count(*) FILTER (
                WHERE pg_temp.audit_osm_classify_identity(
                    coalesce(source_refs->>'external_id', source_refs->>'osm_external_id')
                ) = 'legacy_short'
            ),
            count(*) FILTER (
                WHERE coalesce(
                    nullif(btrim(source_refs->>'external_id'), ''),
                    nullif(btrim(source_refs->>'osm_external_id'), '')
                ) IS NULL
            ),
            count(*) FILTER (
                WHERE coalesce(source_refs->>'external_id', source_refs->>'osm_external_id') IS NOT NULL
                  AND pg_temp.audit_osm_classify_identity(
                      coalesce(source_refs->>'external_id', source_refs->>'osm_external_id')
                  ) = 'other'
            ),
            0,
            'no external_id column; identity lives in source_refs when present'
        FROM routing.routing_barriers;
    ELSE
        INSERT INTO source_identity_audit
        VALUES (
            'routing_barriers',
            'routing.routing_barriers',
            0, 0, 0, 0, 0, 0,
            'table missing'
        );
    END IF;
END;
$audit$;

SELECT
    family,
    source_table,
    total_rows,
    canonical_identity_count,
    legacy_identity_count,
    null_identity_count,
    other_identity_count,
    duplicate_identity_count,
    notes
FROM source_identity_audit
ORDER BY family;

SELECT
    'identity_adapter_smoke' AS section,
    pg_temp.audit_osm_external_id('node', '123') AS node_id,
    pg_temp.audit_osm_external_id('way', '123') AS way_id,
    pg_temp.audit_osm_external_id('relation', '123') AS relation_id,
    (pg_temp.audit_osm_identity_key('osm:way:123') = pg_temp.audit_osm_identity_key('osm:W:123')) AS legacy_match,
    (pg_temp.audit_osm_identity_key('osm:node:123') = pg_temp.audit_osm_identity_key('osm:W:123')) AS type_collision_blocked;

ROLLBACK;
