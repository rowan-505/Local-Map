-- Publish batch validation cancel + heartbeat (import-review promotion worker).

ALTER TABLE system.system_publish_batches
    ADD COLUMN IF NOT EXISTS validation_cancel_requested_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS validation_heartbeat_at timestamptz NULL;

COMMENT ON COLUMN system.system_publish_batches.validation_cancel_requested_at IS
    'Set by cancel-validation while status=validating; worker checks between chunks.';

COMMENT ON COLUMN system.system_publish_batches.validation_heartbeat_at IS
    'Updated during validation progress; used for stale-worker detection.';
