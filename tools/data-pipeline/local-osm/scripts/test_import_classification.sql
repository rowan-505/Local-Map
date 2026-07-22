-- Unit checks for system.pipeline_decide_import_class (local only).
\set ON_ERROR_STOP on

\ir ../pipeline_source_identity.sql
\ir ../pipeline_import_classification.sql

DO $$
BEGIN
    -- invalid
    IF system.pipeline_decide_import_class(
        'places', 'invalid', 'prod_no_match', 'insert_candidate',
        false, false, false, false, false, false, true, true, true
    ) <> 'invalid' THEN
        RAISE EXCEPTION 'expected invalid';
    END IF;

    -- safe_new
    IF system.pipeline_decide_import_class(
        'places', 'valid', 'prod_no_match', 'insert_candidate',
        false, false, false, false, false, false, true, true, true
    ) <> 'safe_new' THEN
        RAISE EXCEPTION 'expected safe_new';
    END IF;

    -- duplicate (non-identity spatial)
    IF system.pipeline_decide_import_class(
        'places', 'valid', 'possible_duplicate', 'possible_duplicate',
        false, true, false, false, false, false, true, true, true
    ) <> 'duplicate' THEN
        RAISE EXCEPTION 'expected duplicate';
    END IF;

    -- roads: no spatial duplicate class → conflict/safe_update path with source
    IF system.pipeline_decide_import_class(
        'roads', 'valid', 'prod_conflict', 'update_candidate',
        true, true, false, false, false, false, true, true, true
    ) <> 'safe_update' THEN
        RAISE EXCEPTION 'expected roads safe_update';
    END IF;

    -- manual_protected beats duplicate
    IF system.pipeline_decide_import_class(
        'admin_areas', 'valid', 'manual_protected', 'protect_manual',
        false, false, true, true, true, false, true, true, true
    ) <> 'manual_protected' THEN
        RAISE EXCEPTION 'expected manual_protected before duplicate';
    END IF;

    -- verified_conflict
    IF system.pipeline_decide_import_class(
        'places', 'valid', 'prod_conflict', 'update_candidate',
        true, false, false, false, false, true, true, true, true
    ) <> 'verified_conflict' THEN
        RAISE EXCEPTION 'expected verified_conflict';
    END IF;

    -- unchanged
    IF system.pipeline_decide_import_class(
        'roads', 'valid', 'prod_match', 'ignore_unchanged',
        true, false, false, false, false, false, false, true, true
    ) <> 'unchanged' THEN
        RAISE EXCEPTION 'expected unchanged';
    END IF;

    -- routing_barriers never safe_update
    IF system.pipeline_decide_import_class(
        'routing_barriers', 'valid', 'prod_conflict', 'update_candidate',
        true, false, false, false, false, false, true, true, true
    ) <> 'conflict' THEN
        RAISE EXCEPTION 'expected routing_barriers conflict';
    END IF;

    RAISE NOTICE 'pipeline_decide_import_class tests PASS';
END $$;
