-- =============================================================================
-- Apply candidate validation to an existing snapshot (local only).
-- Run from tools/data-pipeline/local-osm:
--   psql "$LOCAL_DATABASE_URL" -v snapshot_version=... -f scripts/apply_validation_only.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off
\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

BEGIN;

\ir ../pipeline_entity_families.sql
\ir ../pipeline_source_identity.sql
\ir ../pipeline_candidate_validation.sql

CREATE TEMP TABLE IF NOT EXISTS stage05_params (
    snapshot_version text,
    staging_schema text NOT NULL
) ON COMMIT DROP;
TRUNCATE stage05_params;
INSERT INTO stage05_params (snapshot_version, staging_schema)
VALUES (
    NULLIF(btrim(:'snapshot_version'), ''),
    coalesce(NULLIF(btrim(:'staging_schema'), ''), 'staging')
);

CREATE TEMP TABLE IF NOT EXISTS stage05_context (
    source_snapshot_id bigint NOT NULL,
    snapshot_version text
) ON COMMIT DROP;
TRUNCATE stage05_context;

INSERT INTO stage05_context (source_snapshot_id, snapshot_version)
SELECT id, snapshot_version
FROM system.system_source_snapshots
WHERE snapshot_version = (SELECT snapshot_version FROM stage05_params);

CREATE TEMP TABLE IF NOT EXISTS stage05_report (
    section text,
    entity_family text,
    target_table text,
    metric text,
    value_n bigint,
    status text,
    note text
) ON COMMIT DROP;
TRUNCATE stage05_report;

\ir ../pipeline_stage05b_validate.sql

SELECT section, entity_family, metric, value_n, status
FROM stage05_report
WHERE section = 'candidate_validation'
ORDER BY entity_family, metric;

COMMIT;
