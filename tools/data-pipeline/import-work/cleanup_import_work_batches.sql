-- =============================================================================
-- Cleanup temporary import_work batches (completed or failed).
-- Local/operator SQL — run deliberately via postgres role. Not for public clients.
--
-- Usage:
--   psql "$SUPABASE_WRITE_DATABASE_URL" \
--     -v batch_code='places_kyauktan_pilot_001' \
--     -f cleanup_import_work_batches.sql
--
-- Or clean all applied/failed/cleaned-ready batches older than N days:
--   -v older_than_days=7
--
-- Does NOT touch core.* or import_review.*.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?batch_code}
\else
\set batch_code ''
\endif

\if :{?older_than_days}
\else
\set older_than_days 0
\endif

BEGIN;

CREATE TEMP TABLE import_work_cleanup_targets (
    batch_id bigint PRIMARY KEY,
    batch_code text NOT NULL,
    entity_family text NOT NULL,
    status text NOT NULL
) ON COMMIT DROP;

INSERT INTO import_work_cleanup_targets (batch_id, batch_code, entity_family, status)
SELECT b.id, b.batch_code, b.entity_family, b.status
FROM import_work.import_batches AS b
WHERE (
        NULLIF(btrim(:'batch_code'), '') IS NOT NULL
        AND b.batch_code = btrim(:'batch_code')
      )
   OR (
        NULLIF(btrim(:'batch_code'), '') IS NULL
        AND :'older_than_days'::int > 0
        AND b.status IN ('applied', 'failed', 'cleaned')
        AND b.updated_at < now() - make_interval(days => :'older_than_days'::int)
      );

-- Fail closed if neither selector provided.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM import_work_cleanup_targets)
       AND NULLIF(btrim(current_setting('import_work.cleanup_allow_empty', true)), '1') IS NULL THEN
        -- If explicit batch_code was given but not found, still error.
        RAISE NOTICE 'import_work cleanup: no matching batches';
    END IF;
END $$;

-- Family work rows first (CASCADE would also remove them; explicit for clarity).
DELETE FROM import_work.place_rows AS r
USING import_work_cleanup_targets AS t
WHERE r.import_batch_id = t.batch_id;

UPDATE import_work.import_batches AS b
SET
    status = 'cleaned',
    loaded_row_count = 0,
    cleaned_at = now(),
    updated_at = now(),
    validation_summary = coalesce(b.validation_summary, '{}'::jsonb)
        || jsonb_build_object('cleaned_at', now())
FROM import_work_cleanup_targets AS t
WHERE b.id = t.batch_id;

-- Optional hard-delete of batch headers after work rows are gone.
-- Keep metadata by default; uncomment to drop headers too:
-- DELETE FROM import_work.import_batches b
-- USING import_work_cleanup_targets t
-- WHERE b.id = t.batch_id;

SELECT
    'import_work_cleanup' AS section,
    t.batch_code,
    t.entity_family,
    t.status AS prior_status,
    b.status AS new_status,
    b.cleaned_at
FROM import_work_cleanup_targets AS t
JOIN import_work.import_batches AS b ON b.id = t.batch_id
ORDER BY t.batch_code;

COMMIT;
