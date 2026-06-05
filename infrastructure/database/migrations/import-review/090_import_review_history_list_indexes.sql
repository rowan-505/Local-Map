-- History list: fast publish-batch and publish-item filtering/sorting.

CREATE INDEX IF NOT EXISTS idx_system_publish_batches_created_at_desc
    ON system.system_publish_batches (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_system_publish_batches_status
    ON system.system_publish_batches (status);

CREATE INDEX IF NOT EXISTS idx_system_publish_batches_source_review_batch_id
    ON system.system_publish_batches (source_review_batch_id)
    WHERE source_review_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_publish_items_publish_batch_id
    ON system.system_publish_items (publish_batch_id);

CREATE INDEX IF NOT EXISTS idx_system_publish_items_batch_entity_family
    ON system.system_publish_items (publish_batch_id, entity_family);

CREATE INDEX IF NOT EXISTS idx_system_publish_items_publish_status
    ON system.system_publish_items (publish_batch_id, publish_status);

CREATE INDEX IF NOT EXISTS idx_import_review_review_batches_uploaded_at_desc
    ON import_review.review_batches (uploaded_at DESC, id DESC)
    WHERE status IS DISTINCT FROM 'archived';
