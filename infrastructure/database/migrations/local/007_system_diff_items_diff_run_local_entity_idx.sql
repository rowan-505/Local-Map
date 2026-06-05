-- Speed Stage 08 (and diff reads): DISTINCT ON (entity_family, local_entity_id) per diff_run_id.
CREATE INDEX IF NOT EXISTS system_diff_items_diff_run_local_entity_idx
    ON system.system_diff_items (diff_run_id, entity_family, local_entity_id)
    INCLUDE (id, external_id, diff_type, auto_action)
    WHERE local_entity_id IS NOT NULL;
