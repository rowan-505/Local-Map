-- =============================================================================
-- 138: Expand import_review candidate CHECK constraints for three-axis status
-- -----------------------------------------------------------------------------
-- Goal:
--   Allow target review_decision + apply (promotion_status) values while keeping
--   legacy values for historical compatibility.
--
-- Does NOT:
--   - rewrite historical publish_batches / publish_items
--   - drop auto_action / review_status columns
--   - change publish batch/item status enums
--
-- Apply only after API/pipeline writers support the target values.
-- =============================================================================

DO $mig$
DECLARE
    r record;
    v_decision_sql text := $chk$
        CHECK (
            review_decision IS NULL
            OR review_decision IN (
                -- legacy
                'approved', 'rejected', 'needs_more_review', 'ignored', 'merged',
                -- target
                'pending',
                'keep_existing',
                'replace_existing',
                'merge_fields',
                'insert_separate',
                'ignore_import',
                'mark_duplicate',
                'confirm_soft_delete'
            )
        )
    $chk$;
    v_promotion_sql text := $chk$
        CHECK (
            promotion_status IN (
                -- legacy
                'not_ready', 'ready', 'batched', 'promoting', 'promoted', 'failed', 'skipped',
                -- target apply_status aliases
                'not_applied', 'applying', 'applied'
            )
        )
    $chk$;
BEGIN
    FOR r IN
        SELECT c.conname, c.conrelid::regclass AS tbl
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'import_review'
          AND c.contype = 'c'
          AND c.conname LIKE '%review_decision_chk'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I %s',
            r.tbl,
            r.conname,
            v_decision_sql
        );
        RAISE NOTICE 'updated % on %', r.conname, r.tbl;
    END LOOP;

    FOR r IN
        SELECT c.conname, c.conrelid::regclass AS tbl
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'import_review'
          AND c.contype = 'c'
          AND c.conname LIKE '%promotion_status_chk'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I %s',
            r.tbl,
            r.conname,
            v_promotion_sql
        );
        RAISE NOTICE 'updated % on %', r.conname, r.tbl;
    END LOOP;
END
$mig$;

COMMENT ON SCHEMA import_review IS
    'Import review candidates. Status model: match_status=comparison, review_decision=decision (NULL=pending), promotion_status=apply (legacy+target values). Publish history unchanged.';
