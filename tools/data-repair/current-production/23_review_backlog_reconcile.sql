-- Prompt 11 — Reconcile backlog without deletes or promotes
-- import_review candidates are already empty on production.
-- Classify leftover publish history using existing statuses only:
--   pending + external already in core → skipped (already_represented_in_core)
--   clear smoke/test/obsolete failed/blocked batches → archived

SET statement_timeout = '15min';

CREATE TABLE IF NOT EXISTS system.repair_review_backlog_before_202607 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id, field_name)
);

-- Archive obsolete smoke/test/failed publish batches (candidates gone; core already loaded via fast-core)
BEGIN;
INSERT INTO system.repair_review_backlog_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'publish_batch', id, 'status', status, 'archived'
FROM system.system_publish_batches
WHERE status IN ('failed', 'blocked', 'draft', 'ready')
  AND (
    batch_name ILIKE 'smoke-%'
    OR batch_name ILIKE 'test-%'
    OR batch_name ILIKE 'multi-publish-%'
    OR batch_name ILIKE 'retry-%'
    OR (status IN ('failed', 'blocked') AND batch_name ILIKE 'roads-publish-%')
    OR (status = 'ready' AND batch_name ILIKE 'roads-publish-%' AND coalesce(failed_count,0) > 0)
    OR id IN (6,7,8,22) -- leftover test/ready landuse already represented
  )
  AND status IS DISTINCT FROM 'archived'
ON CONFLICT DO NOTHING;

UPDATE system.system_publish_batches b
SET status = 'archived',
    note = trim(both FROM coalesce(note,'') || ' | archived:current_production_review_backlog_reconcile')
WHERE EXISTS (
  SELECT 1 FROM system.repair_review_backlog_before_202607 r
  WHERE r.entity_family = 'publish_batch' AND r.entity_id = b.id AND r.field_name = 'status'
)
AND b.status IS DISTINCT FROM 'archived';
COMMIT;

-- Mark pending publish items already represented in core as skipped
BEGIN;
CREATE TEMP TABLE tmp_skip_items ON COMMIT DROP AS
SELECT i.id
FROM system.system_publish_items i
WHERE i.publish_status = 'pending'
  AND i.external_id IS NOT NULL
  AND (
    (i.entity_family = 'roads' AND EXISTS (
      SELECT 1 FROM core.core_streets s WHERE s.external_id = i.external_id AND s.deleted_at IS NULL))
    OR (i.entity_family = 'places' AND EXISTS (
      SELECT 1 FROM core.core_places p WHERE p.external_id = i.external_id AND p.deleted_at IS NULL))
    OR (i.entity_family = 'buildings' AND EXISTS (
      SELECT 1 FROM core.core_buildings b WHERE b.external_id = i.external_id AND b.deleted_at IS NULL))
    OR (i.entity_family = 'landuse' AND EXISTS (
      SELECT 1 FROM core.core_land_areas l WHERE l.external_id = i.external_id AND l.deleted_at IS NULL))
  );

INSERT INTO system.repair_review_backlog_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'publish_item', id, 'publish_status', 'pending', 'skipped'
FROM tmp_skip_items
ON CONFLICT DO NOTHING;

UPDATE system.system_publish_items i
SET publish_status = 'skipped',
    error_message = 'already_represented_in_core:current_production_review_backlog_reconcile'
FROM tmp_skip_items t
WHERE i.id = t.id
  AND i.publish_status = 'pending';
COMMIT;

SELECT entity_family, field_name, count(*) AS backed_up
FROM system.repair_review_backlog_before_202607
GROUP BY 1, 2
ORDER BY 1, 2;
