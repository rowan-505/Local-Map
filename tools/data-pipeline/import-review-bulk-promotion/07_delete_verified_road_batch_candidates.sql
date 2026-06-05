-- =============================================================================
-- Delete fully promoted import_review.road_candidates for one batch
--
-- Prerequisites (enforced in-script):
--   - Same hard-verify gates as 06_hard_verify_road_promotion.sql
--
-- Does NOT delete core.core_streets or import_review.review_batches.
--
-- psql variables:
--   -v review_batch_id=<bigint>              required
--   -v confirm_delete=DELETE_FULLY_PROMOTED_BATCH   required (exact match)
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v review_batch_id=2 \
--     -v confirm_delete=DELETE_FULLY_PROMOTED_BATCH \
--     -f tools/data-pipeline/import-review-bulk-promotion/07_delete_verified_road_batch_candidates.sql
-- =============================================================================

\set ON_ERROR_STOP on

\ir _psql_default_vars.sql

\echo ''
\echo '=== Running 06_hard_verify_road_promotion.sql (must pass) ==='

\ir 06_hard_verify_road_promotion.sql

BEGIN;

DROP TABLE IF EXISTS bulk_road_delete_result;
DROP TABLE IF EXISTS bulk_road_delete_params;

CREATE TEMP TABLE bulk_road_delete_params (
    review_batch_id bigint NOT NULL,
    confirm_delete text NOT NULL
);

INSERT INTO bulk_road_delete_params (review_batch_id, confirm_delete)
VALUES (
    NULLIF(btrim(:'review_batch_id'), '')::bigint,
    coalesce(:'confirm_delete', '')
);

CREATE TEMP TABLE bulk_road_delete_result (
    review_batch_id bigint NOT NULL,
    before_count bigint NOT NULL DEFAULT 0,
    deleted_count bigint NOT NULL DEFAULT 0,
    after_count bigint NOT NULL DEFAULT 0,
    review_batch_updated boolean NOT NULL DEFAULT false
);

DO $preflight$
DECLARE
    p bulk_road_delete_params%ROWTYPE;
    v_batch_exists boolean;
    v_before bigint;
BEGIN
    SELECT * INTO p FROM bulk_road_delete_params;

    IF p.review_batch_id IS NULL THEN
        RAISE EXCEPTION 'review_batch_id is required (psql -v review_batch_id=...)';
    END IF;

    IF p.confirm_delete IS DISTINCT FROM 'DELETE_FULLY_PROMOTED_BATCH' THEN
        RAISE EXCEPTION
            'confirm_delete must be exactly DELETE_FULLY_PROMOTED_BATCH (got %)',
            coalesce(nullif(btrim(p.confirm_delete), ''), '<empty>');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM import_review.review_batches AS rb
        WHERE rb.id = p.review_batch_id
    )
    INTO v_batch_exists;

    IF NOT v_batch_exists THEN
        RAISE EXCEPTION 'import_review.review_batches id=% not found', p.review_batch_id;
    END IF;

    SELECT count(*)::bigint
    INTO v_before
    FROM import_review.road_candidates AS rc
    WHERE rc.review_batch_id = p.review_batch_id;

    IF v_before = 0 THEN
        RAISE EXCEPTION
            'refusing delete: review_batch_id=% has zero road_candidates',
            p.review_batch_id;
    END IF;

    INSERT INTO bulk_road_delete_result (review_batch_id, before_count)
    VALUES (p.review_batch_id, v_before);

    RAISE NOTICE 'Preflight OK: review_batch_id=% before_count=% — running road promotion hard verify',
        p.review_batch_id, v_before;
END;
$preflight$;

DO $delete$
DECLARE
    p bulk_road_delete_params%ROWTYPE;
    r bulk_road_delete_result%ROWTYPE;
    v_deleted bigint;
    v_after bigint;
    v_status_cleaned_allowed boolean;
    v_cleanup jsonb;
BEGIN
    SELECT * INTO p FROM bulk_road_delete_params;
    SELECT * INTO r FROM bulk_road_delete_result;

    DELETE FROM import_review.road_candidates AS rc
    WHERE rc.review_batch_id = p.review_batch_id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    SELECT count(*)::bigint
    INTO v_after
    FROM import_review.road_candidates AS rc
    WHERE rc.review_batch_id = p.review_batch_id;

    UPDATE bulk_road_delete_result
    SET
        deleted_count = v_deleted,
        after_count = v_after;

    v_cleanup := jsonb_build_object(
        'cleaned_at', to_jsonb(now()),
        'review_batch_id', p.review_batch_id,
        'entity_family', 'roads',
        'deleted_candidate_count', v_deleted,
        'before_count', r.before_count,
        'after_count', v_after,
        'script', 'tools/data-pipeline/import-review-bulk-promotion/07_delete_verified_road_batch_candidates.sql'
    );

    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint AS con
        INNER JOIN pg_class AS rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'import_review'
          AND rel.relname = 'review_batches'
          AND con.conname = 'review_batches_status_chk'
          AND pg_get_constraintdef(con.oid) ILIKE '%cleaned%'
    )
    INTO v_status_cleaned_allowed;

    IF v_status_cleaned_allowed THEN
        UPDATE import_review.review_batches AS rb
        SET
            summary = coalesce(rb.summary, '{}'::jsonb)
                || jsonb_build_object(
                    'cleaned_at', to_jsonb(now()),
                    'bulk_road_promotion_cleanup', v_cleanup
                ),
            status = 'cleaned',
            total_candidate_count = 0,
            updated_at = now()
        WHERE rb.id = p.review_batch_id;
    ELSE
        UPDATE import_review.review_batches AS rb
        SET
            summary = coalesce(rb.summary, '{}'::jsonb)
                || jsonb_build_object(
                    'cleaned_at', to_jsonb(now()),
                    'bulk_road_promotion_cleanup', v_cleanup
                ),
            total_candidate_count = 0,
            updated_at = now()
        WHERE rb.id = p.review_batch_id;
    END IF;

    IF FOUND THEN
        UPDATE bulk_road_delete_result
        SET review_batch_updated = true;
    END IF;

    IF v_after <> 0 THEN
        RAISE EXCEPTION
            'delete incomplete: review_batch_id=% after_count=% (expected 0)',
            p.review_batch_id,
            v_after;
    END IF;

    RAISE NOTICE 'Deleted road_candidates: review_batch_id=% before=% deleted=% after=% batch_metadata_updated=%',
        p.review_batch_id,
        r.before_count,
        v_deleted,
        v_after,
        (SELECT review_batch_updated FROM bulk_road_delete_result LIMIT 1);
END;
$delete$;

\echo ''
\echo '=== delete verified road batch candidates — result ==='

SELECT
    p.review_batch_id,
    r.before_count,
    r.deleted_count,
    r.after_count,
    r.review_batch_updated,
    rb.status AS review_batch_status,
    rb.summary->'bulk_road_promotion_cleanup' AS cleanup_summary
FROM bulk_road_delete_params AS p
CROSS JOIN bulk_road_delete_result AS r
LEFT JOIN import_review.review_batches AS rb ON rb.id = p.review_batch_id;

COMMIT;

\echo ''
\echo 'DELETE_COMMITTED road_candidates removed; core rows and review_batches row preserved (summary updated).'
