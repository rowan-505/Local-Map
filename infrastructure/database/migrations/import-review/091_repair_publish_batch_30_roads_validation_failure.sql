-- One-off repair: batch #30 validation SQL failure (roads, review batch 2).
-- Closes the batch, marks pending publish items failed, releases batched candidates for retry.
-- Safe to re-run (idempotent coalesce / status filters).

BEGIN;

UPDATE system.system_publish_batches
SET
    status = 'failed',
    updated_at = now()
WHERE id = 30;

UPDATE system.system_publish_items AS spi
SET
    publish_status = 'failed',
    error_message = coalesce(
        nullif(trim(spi.error_message), ''),
        'Validation failed because backend SQL referenced alias spi outside valid scope.'
    ),
    after_data = coalesce(spi.after_data, '{}'::jsonb)
        || jsonb_build_object(
            'status',
            'failed',
            'error_code',
            coalesce(spi.after_data->>'error_code', 'VALIDATION_SQL_ERROR'),
            'message',
            coalesce(
                nullif(trim(spi.error_message), ''),
                'Validation failed because backend SQL referenced alias spi outside valid scope.'
            )
        )
WHERE spi.publish_batch_id = 30
  AND spi.entity_family = 'roads'
  AND spi.publish_status = 'pending';

UPDATE import_review.road_candidates AS rc
SET
    promotion_status = 'not_ready',
    updated_at = now()
WHERE rc.review_batch_id = 2
  AND rc.promotion_status = 'batched'
  AND rc.review_status = 'approved'
  AND rc.review_decision = 'approved'
  AND EXISTS (
      SELECT 1
      FROM system.system_publish_items AS spi
      WHERE spi.publish_batch_id = 30
        AND spi.entity_family = 'roads'
        AND spi.review_candidate_id = rc.id
        AND spi.publish_status = 'failed'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM system.system_publish_items AS ok
      WHERE ok.entity_family = 'roads'
        AND ok.review_candidate_id = rc.id
        AND ok.publish_status = 'success'
        AND ok.target_id IS NOT NULL
  );

COMMIT;
