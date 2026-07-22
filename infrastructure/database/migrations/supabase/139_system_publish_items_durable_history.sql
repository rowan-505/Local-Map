-- Durable apply-run fields on system_publish_items.
-- Prefer these columns over joining temporary import_review.*_candidates.
-- Keep historical rows; backfill from existing before_data / validation_result JSON.

ALTER TABLE system.system_publish_items
    ADD COLUMN IF NOT EXISTS review_decision text NULL,
    ADD COLUMN IF NOT EXISTS applied_by bigint NULL,
    ADD COLUMN IF NOT EXISTS source_snapshot_version text NULL;

COMMENT ON COLUMN system.system_publish_items.review_decision IS
    'Review decision at apply-run create time (survives candidate cleanup).';
COMMENT ON COLUMN system.system_publish_items.applied_by IS
    'User id that applied this item (set on success/skip bookkeeping).';
COMMENT ON COLUMN system.system_publish_items.source_snapshot_version IS
    'Denormalized snapshot for History after candidates are deleted.';

-- Backfill from candidate summary stored in before_data at batch create.
UPDATE system.system_publish_items
SET
    review_decision = COALESCE(
        review_decision,
        NULLIF(btrim(before_data ->> 'review_decision'), ''),
        NULLIF(btrim(before_data -> 'candidate_summary' ->> 'review_decision'), ''),
        NULLIF(btrim(validation_result ->> 'review_decision'), ''),
        NULLIF(btrim(after_data ->> 'review_decision'), '')
    ),
    source_snapshot_version = COALESCE(
        source_snapshot_version,
        NULLIF(btrim(before_data ->> 'source_snapshot_version'), ''),
        NULLIF(btrim(before_data -> 'candidate_summary' ->> 'source_snapshot_version'), ''),
        NULLIF(btrim(validation_result ->> 'source_snapshot_version'), '')
    ),
    applied_by = COALESCE(
        applied_by,
        NULLIF(btrim(after_data ->> 'applied_by'), '')::bigint,
        NULLIF(btrim(after_data ->> 'promoted_by'), '')::bigint
    )
WHERE review_decision IS NULL
   OR source_snapshot_version IS NULL
   OR applied_by IS NULL;

CREATE INDEX IF NOT EXISTS system_publish_items_review_decision_irr_idx
    ON system.system_publish_items (publish_batch_id, review_decision);

CREATE INDEX IF NOT EXISTS system_publish_items_snapshot_irr_idx
    ON system.system_publish_items (source_snapshot_version);
