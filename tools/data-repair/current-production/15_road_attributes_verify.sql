-- Prompt 8 verify
SELECT 'oneway_to_true' AS field_issue, count(*) AS n
FROM core.core_streets
WHERE deleted_at IS NULL AND NOT COALESCE(manual_override,false)
  AND lower(coalesce(normalized_data->'tags'->>'oneway','')) IN ('yes','true','1','-1')
  AND is_oneway IS NOT TRUE
UNION ALL
SELECT 'bridge_to_true', count(*)
FROM core.core_streets
WHERE deleted_at IS NULL AND NOT COALESCE(manual_override,false)
  AND lower(coalesce(normalized_data->'tags'->>'bridge','')) IN ('yes','viaduct','movable','covered','aqueduct')
  AND bridge IS NOT TRUE
UNION ALL
SELECT 'tunnel_to_true', count(*)
FROM core.core_streets
WHERE deleted_at IS NULL AND NOT COALESCE(manual_override,false)
  AND lower(coalesce(normalized_data->'tags'->>'tunnel','')) IN ('yes','building_passage','culvert','avalanche_protector')
  AND tunnel IS NOT TRUE
UNION ALL
SELECT 'layer_mismatch', count(*)
FROM core.core_streets
WHERE deleted_at IS NULL AND NOT COALESCE(manual_override,false)
  AND (normalized_data->'tags'->>'layer') ~ '^-?[0-9]+$'
  AND layer IS DISTINCT FROM (normalized_data->'tags'->>'layer')::int
UNION ALL
SELECT 'surface_mismatch', count(*)
FROM core.core_streets
WHERE deleted_at IS NULL AND NOT COALESCE(manual_override,false)
  AND nullif(btrim(normalized_data->'tags'->>'surface'),'') IS NOT NULL
  AND nullif(btrim(surface),'') IS DISTINCT FROM lower(nullif(btrim(normalized_data->'tags'->>'surface'),''));

SELECT count(*) FILTER (WHERE is_oneway) AS oneway_true,
       count(*) FILTER (WHERE bridge) AS bridge_true,
       count(*) FILTER (WHERE tunnel) AS tunnel_true
FROM core.core_streets WHERE deleted_at IS NULL;
