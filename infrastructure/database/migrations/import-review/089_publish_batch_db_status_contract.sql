-- Align system.system_publish_batches.status with DB-safe lifecycle (086-style).
-- Remaps legacy values from 088 (validated, dry_run_*) and partially_promoted.

DO $migration$
BEGIN
    IF to_regclass('system.system_publish_batches') IS NULL THEN
        RAISE NOTICE 'Skipped 089: system.system_publish_batches missing.';
        RETURN;
    END IF;

    ALTER TABLE system.system_publish_batches
        DROP CONSTRAINT IF EXISTS system_publish_batches_status_irr_chk;

    ALTER TABLE system.system_publish_batches
        DROP CONSTRAINT IF EXISTS system_publish_batches_status_allowed_chk;

    UPDATE system.system_publish_batches
    SET status = 'ready'
    WHERE status IN ('validated', 'dry_run_passed', 'dry_run_running', 'approved');

    UPDATE system.system_publish_batches
    SET status = 'partial'
    WHERE status IN ('partially_promoted', 'blocked');

    UPDATE system.system_publish_batches
    SET status = 'failed'
    WHERE status NOT IN (
        'draft',
        'validating',
        'ready',
        'partial',
        'promoting',
        'promoted',
        'failed',
        'blocked',
        'archived',
        'cancelled'
    );

    ALTER TABLE system.system_publish_batches
        ADD CONSTRAINT system_publish_batches_status_irr_chk
        CHECK (
            status IN (
                'draft',
                'validating',
                'ready',
                'partial',
                'promoting',
                'promoted',
                'failed',
                'blocked',
                'archived',
                'cancelled'
            )
        );
END;
$migration$;
