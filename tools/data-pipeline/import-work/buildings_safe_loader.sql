-- =============================================================================
-- Buildings safe loader wrapper
--   psql ... -v batch_code='...' -v dry_run=true  -f buildings_safe_loader.sql
-- Optional: -v sample_limit=N
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

DROP TABLE IF EXISTS buildings_loader_params;
CREATE TEMP TABLE buildings_loader_params (
    batch_code text,
    dry_run boolean NOT NULL,
    sample_limit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO buildings_loader_params (batch_code, dry_run, sample_limit)
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
    SELECT sample_limit, dry_run INTO v_limit, v_dry FROM buildings_loader_params;
    IF v_limit > 0 THEN
        RAISE NOTICE 'buildings_loader [0%%] SAMPLE MODE limit=% dry_run=%',
            v_limit, v_dry;
    END IF;
END $$;

\ir buildings_safe_loader_body.sql

SELECT lower(btrim(:'dry_run')) IN ('1', 'true', 't', 'yes', 'y') AS is_dry_run
\gset

\if :is_dry_run
ROLLBACK;
\echo 'buildings_safe_loader: DRY RUN rolled back — no durable core writes'
\else
COMMIT;
\echo 'buildings_safe_loader: APPLIED and committed'
\endif
