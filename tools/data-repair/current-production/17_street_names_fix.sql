-- Prompt 9 — Mark generated street names clearly (minimal, batched via client)
-- Distinguishing signals already present:
--   - normalized_data.generated_label
--   - canonical_name ~ '^road-[0-9]+$'
-- Search view search.v_search_street_groups_source already excludes road-N placeholders
-- and name_type = 'generated'. This sets name_is_generated for later rebuilds.
-- Do NOT rebuild search here.
--
-- Apply with: bash tools/data-repair/current-production/17_street_names_fix.sh
-- Or run the statements below in a client that commits each batch.

SET statement_timeout = '30min';

CREATE TABLE IF NOT EXISTS system.repair_street_names_before_202607 (
  id bigint PRIMARY KEY,
  street_id bigint,
  name_type text,
  is_primary boolean,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

BEGIN;
INSERT INTO system.repair_street_names_before_202607 (id, street_id, name_type, is_primary)
SELECT n.id, n.street_id, n.name_type, n.is_primary
FROM core.core_street_names n
WHERE n.name ~ '^road-[0-9]+$'
  AND lower(coalesce(n.name_type,'')) IS DISTINCT FROM 'generated'
ON CONFLICT (id) DO NOTHING;

UPDATE core.core_street_names n
SET name_type = 'generated',
    is_primary = false
WHERE n.name ~ '^road-[0-9]+$'
  AND lower(coalesce(n.name_type,'')) IS DISTINCT FROM 'generated';
COMMIT;

-- One batch template (shell script drives id ranges):
-- UPDATE core.core_streets s
-- SET normalized_data = coalesce(s.normalized_data, '{}'::jsonb)
--   || jsonb_build_object('name_is_generated', true),
--     updated_at = now()
-- WHERE s.id >= :lo AND s.id < :hi
--   AND s.deleted_at IS NULL
--   AND nullif(btrim(s.normalized_data->>'generated_label'), '') IS NOT NULL
--   AND coalesce((s.normalized_data->>'name_is_generated')::boolean, false) IS NOT TRUE
--   AND NOT COALESCE(s.manual_override, false);
