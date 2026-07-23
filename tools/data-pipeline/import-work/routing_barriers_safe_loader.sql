-- =============================================================================
-- Routing barriers safe loader wrapper
--   psql ... -v batch_code='...' -v dry_run=true -f routing_barriers_safe_loader.sql
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

DROP TABLE IF EXISTS routing_barriers_loader_params;
CREATE TEMP TABLE routing_barriers_loader_params (
    batch_code text,
    dry_run boolean NOT NULL,
    sample_limit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO routing_barriers_loader_params (batch_code, dry_run, sample_limit)
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
    SELECT sample_limit, dry_run INTO v_limit, v_dry FROM routing_barriers_loader_params;
    IF v_limit > 0 THEN
        RAISE NOTICE 'routing_barriers_loader [0%%] SAMPLE MODE limit=% dry_run=%', v_limit, v_dry;
    END IF;
END $$;

\ir routing_barriers_safe_loader_body.sql

SELECT lower(btrim(:'dry_run')) IN ('1', 'true', 't', 'yes', 'y') AS is_dry_run
\gset

\if :is_dry_run
ROLLBACK;
\echo 'routing_barriers_safe_loader: DRY RUN rolled back — no durable core/IR writes'
\else
COMMIT;
\echo 'routing_barriers_safe_loader: APPLIED and committed'
\endif
