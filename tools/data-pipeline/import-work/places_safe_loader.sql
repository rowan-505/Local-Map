-- =============================================================================
-- Places safe loader wrapper
--   psql ... -v batch_code='...' -v dry_run=true  -f places_safe_loader.sql
--   psql ... -v batch_code='...' -v dry_run=false -f places_safe_loader.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?batch_code}
\else
\set batch_code ''
\endif

\if :{?dry_run}
\else
\set dry_run 'true'
\endif

BEGIN;

DROP TABLE IF EXISTS places_loader_params;
CREATE TEMP TABLE places_loader_params (
    batch_code text,
    dry_run boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO places_loader_params (batch_code, dry_run)
VALUES (
    NULLIF(btrim(:'batch_code'), ''),
    lower(btrim(:'dry_run')) IN ('1', 'true', 't', 'yes', 'y')
);

\ir places_safe_loader_body.sql

SELECT lower(btrim(:'dry_run')) IN ('1', 'true', 't', 'yes', 'y') AS is_dry_run
\gset

\if :is_dry_run
ROLLBACK;
\echo 'places_safe_loader: DRY RUN rolled back — no durable core writes'
\else
COMMIT;
\echo 'places_safe_loader: APPLIED and committed'
\endif
