-- =============================================================================
-- Phase 1b verification: typed columns from 082a (read-only)
-- =============================================================================
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/import-review/002_review-overrides-column-alignment-verify.sql
--
-- =============================================================================

\set ON_ERROR_STOP on

\echo '=== Phase 1b column alignment verify ==='

SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable
FROM information_schema.columns AS c
WHERE c.table_schema = 'import_review'
  AND (
      (c.table_name = 'road_candidates' AND c.column_name IN (
          'name_mm', 'name_en', 'admin_area_id', 'access', 'speed_kph'
      ))
      OR (c.table_name = 'building_candidates' AND c.column_name IN ('name_mm', 'name_en'))
      OR (c.table_name = 'place_candidates' AND c.column_name IN ('name_mm', 'name_en'))
  )
ORDER BY c.table_name, c.column_name;

DO $$
DECLARE
    expected constant jsonb := '[
        {"table":"building_candidates","columns":["name_mm","name_en"]},
        {"table":"place_candidates","columns":["name_mm","name_en"]},
        {"table":"road_candidates","columns":["name_mm","name_en","admin_area_id","access","speed_kph"]},
        {"table":"admin_area_candidates","columns":["name_mm","name_en"]},
        {"table":"water_line_candidates","columns":["name_mm","name_en"]},
        {"table":"water_polygon_candidates","columns":["name_mm","name_en"]},
        {"table":"bus_stop_candidates","columns":["name_mm","name_en"]},
        {"table":"bus_route_candidates","columns":["name_mm","name_en"]},
        {"table":"landuse_candidates","columns":["name_mm","name_en"]}
    ]'::jsonb;
    rec record;
    missing text[] := array[]::text[];
BEGIN
    FOR rec IN
        SELECT
            e->>'table' AS table_name,
            jsonb_array_elements_text(e->'columns') AS column_name
        FROM jsonb_array_elements(expected) AS e
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns AS c
            WHERE c.table_schema = 'import_review'
              AND c.table_name = rec.table_name
              AND c.column_name = rec.column_name
        ) THEN
            missing := array_append(missing, format('import_review.%s.%s', rec.table_name, rec.column_name));
        END IF;
    END LOOP;

    IF coalesce(array_length(missing, 1), 0) > 0 THEN
        RAISE EXCEPTION '082a verify failed: %', array_to_string(missing, ', ');
    END IF;
END $$;

\echo '=== Phase 1b verification passed ==='
