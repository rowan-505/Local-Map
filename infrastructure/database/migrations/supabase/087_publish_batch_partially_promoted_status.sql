-- Allow publish batches that promoted some items while others remain blocked/pending.

DO $$
BEGIN
    IF to_regclass('system.system_publish_batches') IS NULL THEN
        RAISE NOTICE 'Skipped partially_promoted status: system.system_publish_batches missing.';
        RETURN;
    END IF;

    ALTER TABLE system.system_publish_batches
        DROP CONSTRAINT IF EXISTS system_publish_batches_status_irr_chk;

    IF NOT EXISTS (
        SELECT 1
        FROM system.system_publish_batches
        WHERE status NOT IN (
            'draft', 'validating', 'ready', 'partial', 'promoting', 'promoted',
            'partially_promoted', 'failed', 'blocked', 'archived'
        )
    ) THEN
        ALTER TABLE system.system_publish_batches
            ADD CONSTRAINT system_publish_batches_status_irr_chk
            CHECK (
                status IN (
                    'draft', 'validating', 'ready', 'partial', 'promoting', 'promoted',
                    'partially_promoted', 'failed', 'blocked', 'archived'
                )
            );
    ELSE
        RAISE NOTICE 'Skipped system_publish_batches_status_irr_chk: incompatible status values.';
    END IF;
END $$;
