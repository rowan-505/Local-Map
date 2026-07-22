-- Prompt 9 verify
SELECT name_type, count(*) FROM core.core_street_names GROUP BY 1 ORDER BY 2 DESC;

SELECT
  count(*) FILTER (WHERE coalesce((normalized_data->>'name_is_generated')::boolean, false)) AS flagged_generated,
  count(*) FILTER (WHERE canonical_name ~ '^road-[0-9]+$') AS canonical_placeholder,
  count(*) FILTER (WHERE nullif(btrim(normalized_data->'tags'->>'name'),'') IS NOT NULL) AS has_osm_name
FROM core.core_streets WHERE deleted_at IS NULL;
