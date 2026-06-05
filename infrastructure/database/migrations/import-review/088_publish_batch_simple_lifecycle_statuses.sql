-- Simple publish-batch lifecycle: draft → validating → validated → dry_run_* → promoting → promoted | failed | cancelled
-- Drop legacy status CHECK before remapping rows (old constraint does not allow 'validated').

DO $migration$
BEGIN
    IF to_regclass('system.system_publish_batches') IS NULL THEN
        RAISE NOTICE 'Skipped 088: system.system_publish_batches missing.';
        RETURN;
    END IF;

    ALTER TABLE system.system_publish_batches
        DROP CONSTRAINT IF EXISTS system_publish_batches_status_irr_chk;

    ALTER TABLE system.system_publish_batches
        DROP CONSTRAINT IF EXISTS system_publish_batches_status_allowed_chk;

    UPDATE system.system_publish_batches
    SET status = 'validated'
    WHERE status IN ('ready', 'partial', 'blocked');

    UPDATE system.system_publish_batches
    SET status = 'promoted'
    WHERE status = 'partially_promoted';

    -- Legacy local tracking statuses (if present from early migrations).
    UPDATE system.system_publish_batches
    SET status = 'draft'
    WHERE status IN ('pending');

    UPDATE system.system_publish_batches
    SET status = 'validated'
    WHERE status IN ('approved');

    UPDATE system.system_publish_batches
    SET status = 'promoted'
    WHERE status IN ('published');

    UPDATE system.system_publish_batches
    SET status = 'failed'
    WHERE status NOT IN (
        'draft',
        'validating',
        'validated',
        'dry_run_running',
        'dry_run_passed',
        'promoting',
        'promoted',
        'failed',
        'cancelled',
        'archived'
    );

    ALTER TABLE system.system_publish_batches
        ADD CONSTRAINT system_publish_batches_status_irr_chk
        CHECK (
            status IN (
                'draft',
                'validating',
                'validated',
                'dry_run_running',
                'dry_run_passed',
                'promoting',
                'promoted',
                'failed',
                'cancelled',
                'archived'
            )
        );
END;
$migration$;
