-- Prompt 8 — Apply road attributes from normalized_data.tags
-- Fields: is_oneway, bridge, tunnel, layer, surface
-- Skip manual_override. Do not reverse geometry for oneway=-1.

SET statement_timeout = '45min';
SET work_mem = '256MB';

CREATE TABLE IF NOT EXISTS system.repair_streets_attrs_before_202607 (
  id bigint PRIMARY KEY,
  is_oneway boolean,
  bridge boolean,
  tunnel boolean,
  layer integer,
  surface text,
  manual_override boolean,
  is_verified boolean,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

-- Backup candidates (any of the five fields will change)
INSERT INTO system.repair_streets_attrs_before_202607 (
  id, is_oneway, bridge, tunnel, layer, surface, manual_override, is_verified, updated_at
)
SELECT s.id, s.is_oneway, s.bridge, s.tunnel, s.layer, s.surface,
       s.manual_override, s.is_verified, s.updated_at
FROM core.core_streets s
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND (
    (lower(coalesce(s.normalized_data->'tags'->>'oneway','')) IN ('yes','true','1','-1') AND s.is_oneway IS NOT TRUE)
    OR (lower(coalesce(s.normalized_data->'tags'->>'bridge','')) IN ('yes','viaduct','movable','covered','aqueduct') AND s.bridge IS NOT TRUE)
    OR (lower(coalesce(s.normalized_data->'tags'->>'tunnel','')) IN ('yes','building_passage','culvert','avalanche_protector') AND s.tunnel IS NOT TRUE)
    OR ((s.normalized_data->'tags'->>'layer') ~ '^-?[0-9]+$' AND s.layer IS DISTINCT FROM (s.normalized_data->'tags'->>'layer')::int)
    OR (
      nullif(btrim(s.normalized_data->'tags'->>'surface'),'') IS NOT NULL
      AND nullif(btrim(s.surface),'') IS DISTINCT FROM lower(nullif(btrim(s.normalized_data->'tags'->>'surface'),''))
    )
  )
ON CONFLICT (id) DO NOTHING;

BEGIN;
UPDATE core.core_streets s
SET is_oneway = true, updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND lower(coalesce(s.normalized_data->'tags'->>'oneway','')) IN ('yes','true','1','-1')
  AND s.is_oneway IS NOT TRUE;
COMMIT;

BEGIN;
UPDATE core.core_streets s
SET bridge = true, updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND lower(coalesce(s.normalized_data->'tags'->>'bridge','')) IN ('yes','viaduct','movable','covered','aqueduct')
  AND s.bridge IS NOT TRUE;
COMMIT;

BEGIN;
UPDATE core.core_streets s
SET tunnel = true, updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND lower(coalesce(s.normalized_data->'tags'->>'tunnel','')) IN ('yes','building_passage','culvert','avalanche_protector')
  AND s.tunnel IS NOT TRUE;
COMMIT;

BEGIN;
UPDATE core.core_streets s
SET layer = (s.normalized_data->'tags'->>'layer')::int, updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND (s.normalized_data->'tags'->>'layer') ~ '^-?[0-9]+$'
  AND s.layer IS DISTINCT FROM (s.normalized_data->'tags'->>'layer')::int;
COMMIT;

BEGIN;
UPDATE core.core_streets s
SET surface = lower(nullif(btrim(s.normalized_data->'tags'->>'surface'),'')),
    updated_at = now()
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND nullif(btrim(s.normalized_data->'tags'->>'surface'),'') IS NOT NULL
  AND nullif(btrim(s.surface),'') IS DISTINCT FROM lower(nullif(btrim(s.normalized_data->'tags'->>'surface'),''));
COMMIT;

SELECT 'backup_rows' AS metric, count(*)::text FROM system.repair_streets_attrs_before_202607;
