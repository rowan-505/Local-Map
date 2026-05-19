-- =============================================================================
-- Prod mirror 01: setup_fdw
-- Local-only setup for postgres_fdw connection to Supabase production.
--
-- Scope:
--   - Creates/updates local extension, schemas, FDW server, and user mapping.
--   - Does not modify Supabase data or schema.
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SCHEMA IF NOT EXISTS supabase_fdw;
CREATE SCHEMA IF NOT EXISTS prod_mirror;

CREATE TEMP TABLE prod_mirror_fdw_params (
    db_host text,
    db_port text,
    db_name text,
    db_user text,
    db_password text,
    db_sslmode text
) ON COMMIT DROP;

INSERT INTO prod_mirror_fdw_params (
    db_host,
    db_port,
    db_name,
    db_user,
    db_password,
    db_sslmode
)
VALUES (
    NULLIF(btrim(:'supabase_db_host'), ''),
    coalesce(NULLIF(btrim(:'supabase_db_port'), ''), '5432'),
    coalesce(NULLIF(btrim(:'supabase_db_name'), ''), 'postgres'),
    NULLIF(btrim(:'supabase_db_user'), ''),
    :'supabase_db_password',
    coalesce(NULLIF(btrim(:'supabase_db_sslmode'), ''), 'require')
);

DO $setup_fdw$
DECLARE
    p prod_mirror_fdw_params%ROWTYPE;
BEGIN
    SELECT *
    INTO STRICT p
    FROM prod_mirror_fdw_params;

    IF p.db_host IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: supabase_db_host';
    END IF;
    IF p.db_user IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: supabase_db_user';
    END IF;
    IF p.db_password IS NULL OR p.db_password = '' THEN
        RAISE EXCEPTION 'missing psql variable: supabase_db_password';
    END IF;

    -- We drop/recreate the FDW server because PostgreSQL does not update CREATE SERVER IF NOT EXISTS options when env values change.
    DROP SERVER IF EXISTS supabase_prod_fdw CASCADE;

    EXECUTE format(
        'CREATE SERVER supabase_prod_fdw FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host %L, port %L, dbname %L, sslmode %L)',
        p.db_host,
        p.db_port,
        p.db_name,
        p.db_sslmode
    );

    EXECUTE format(
        'CREATE USER MAPPING FOR %I SERVER supabase_prod_fdw OPTIONS (user %L, password %L)',
        current_user,
        p.db_user,
        p.db_password
    );
END
$setup_fdw$;

SELECT
    'prod_mirror_fdw_setup' AS section,
    'supabase_prod_fdw' AS server_name,
    current_user AS local_user,
    'PASS' AS status,
    'FDW server and user mapping are configured locally.' AS note;

SELECT
    'prod_mirror_fdw_options' AS section,
    server_options.option_value AS host,
    port_options.option_value AS port,
    db_options.option_value AS dbname,
    ssl_options.option_value AS sslmode,
    user_options.option_value AS mapped_user
FROM pg_foreign_server AS server
LEFT JOIN LATERAL (
    SELECT split_part(option_text, '=', 2) AS option_value
    FROM unnest(server.srvoptions) AS option_text
    WHERE split_part(option_text, '=', 1) = 'host'
) AS server_options ON true
LEFT JOIN LATERAL (
    SELECT split_part(option_text, '=', 2) AS option_value
    FROM unnest(server.srvoptions) AS option_text
    WHERE split_part(option_text, '=', 1) = 'port'
) AS port_options ON true
LEFT JOIN LATERAL (
    SELECT split_part(option_text, '=', 2) AS option_value
    FROM unnest(server.srvoptions) AS option_text
    WHERE split_part(option_text, '=', 1) = 'dbname'
) AS db_options ON true
LEFT JOIN LATERAL (
    SELECT split_part(option_text, '=', 2) AS option_value
    FROM unnest(server.srvoptions) AS option_text
    WHERE split_part(option_text, '=', 1) = 'sslmode'
) AS ssl_options ON true
LEFT JOIN pg_user_mappings AS mapping
    ON mapping.srvname = server.srvname
   AND mapping.usename = current_user
LEFT JOIN LATERAL (
    SELECT split_part(option_text, '=', 2) AS option_value
    FROM unnest(mapping.umoptions) AS option_text
    WHERE split_part(option_text, '=', 1) = 'user'
) AS user_options ON true
WHERE server.srvname = 'supabase_prod_fdw';

COMMIT;
