-- Prompt 9 — Street name inspect (READ-ONLY)
SELECT
  count(*) FILTER (WHERE nullif(btrim(normalized_data->>'generated_label'),'') IS NOT NULL) AS generated_label_present,
  count(*) FILTER (WHERE nullif(btrim(normalized_data->'tags'->>'name'),'') IS NOT NULL) AS has_osm_name,
  count(*) FILTER (WHERE canonical_name ~ '^road-[0-9]+$') AS canonical_road_placeholder,
  count(*) FILTER (WHERE nullif(btrim(normalized_data->>'generated_label'),'') IS NULL
                     AND nullif(btrim(normalized_data->'tags'->>'name'),'') IS NOT NULL) AS real_named
FROM core.core_streets WHERE deleted_at IS NULL;

SELECT count(*) AS street_names_road_placeholder
FROM core.core_street_names WHERE name ~ '^road-[0-9]+$';
