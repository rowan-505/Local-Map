-- =============================================================================
-- transport-fast-publish — Phase 5 / step 10: create Supabase import batch.
--
-- Runs against SUPABASE_DIRECT_DATABASE_URL inside the publish session.
-- Inserts one transport.import_batches row (status='running') and captures the
-- new id into the psql variable :import_batch_id (used by steps 11 and 12).
--
-- psql variables (passed by the runner; defaults allow standalone runs):
--   source_name, source_kind, import_scope, snapshot_version, pbf_path, pbf_sha256
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?source_name}
\else
  \set source_name 'openstreetmap'
\endif
\if :{?source_kind}
\else
  \set source_kind 'osm_pbf'
\endif
\if :{?import_scope}
\else
  \set import_scope 'whole_country'
\endif
\if :{?snapshot_version}
\else
  \set snapshot_version 'unknown'
\endif
\if :{?pbf_path}
\else
  \set pbf_path ''
\endif
\if :{?pbf_sha256}
\else
  \set pbf_sha256 'unknown'
\endif

INSERT INTO transport.import_batches (
    source_name,
    source_kind,
    import_scope,
    import_mode,
    status,
    source_file_path,
    notes
)
VALUES (
    :'source_name',
    :'source_kind',
    :'import_scope',
    'local_validated_publish',
    'running',
    NULLIF(:'pbf_path', ''),
    format('snapshot_version=%s; pbf_sha256=%s', :'snapshot_version', :'pbf_sha256')
)
RETURNING id AS import_batch_id \gset

\echo '>>> transport.import_batches created: import_batch_id =' :import_batch_id
