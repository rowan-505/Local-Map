-- Prompt 5 — Road class inspect (READ-ONLY)

\echo '=== Ref road classes ==='
SELECT code, rank, min_zoom, default_width FROM ref.ref_road_classes ORDER BY rank;

\echo '=== Current road_class counts ==='
SELECT road_class, count(*) FROM core.core_streets WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC;

\echo '=== Text/FK mismatches ==='
SELECT s.road_class, rc.code AS ref_code, count(*)
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class IS DISTINCT FROM rc.code
GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '=== Source highway (tags) top values ==='
SELECT COALESCE(normalized_data->'tags'->>'highway', normalized_data->>'highway', '(null)') AS src_highway,
       count(*) AS n
FROM core.core_streets
WHERE deleted_at IS NULL
GROUP BY 1
ORDER BY n DESC
LIMIT 40;
