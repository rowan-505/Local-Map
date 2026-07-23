-- =============================================================================
-- Places safe loader wrapper
--   psql ... -v batch_code='...' -v dry_run=true  -f places_safe_loader.sql
--   psql ... -v batch_code='...' -v dry_run=false -f places_safe_loader.sql
-- Optional:
--   -v sample_limit=20   # smoke/dry-run: process first N work rows only
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

\if :{?sample_limit}
\else
\set sample_limit '0'
\endif

BEGIN;

DROP TABLE IF EXISTS places_loader_params;
CREATE TEMP TABLE places_loader_params (
    batch_code text,
    dry_run boolean NOT NULL,
    sample_limit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO places_loader_params (batch_code, dry_run, sample_limit)
VALUES (
    NULLIF(btrim(:'batch_code'), ''),
    lower(btrim(:'dry_run')) IN ('1', 'true', 't', 'yes', 'y'),
    greatest(coalesce(NULLIF(btrim(:'sample_limit'), '')::integer, 0), 0)
);

DO $$
DECLARE
    v_limit integer;
    v_dry boolean;
BEGIN
    SELECT sample_limit, dry_run INTO v_limit, v_dry FROM places_loader_params;
    IF v_limit > 0 THEN
        RAISE NOTICE 'places_loader [0%%] SAMPLE MODE limit=% dry_run=% (fast smoke test)',
            v_limit, v_dry;
    END IF;
END $$;

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
