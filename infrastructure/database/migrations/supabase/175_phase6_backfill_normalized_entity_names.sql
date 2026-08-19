-- Phase 6a: preserve every legacy scalar Core feature name in the canonical
-- multilingual name tables. Scalar columns remain temporarily for deployed
-- API/tile compatibility and can be dropped only after those consumers ship.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $block$
DECLARE
  invalid_language_rows bigint;
  missing_building_names bigint;
BEGIN
  SELECT count(*) INTO invalid_language_rows
  FROM (
    SELECT language_code FROM core.core_building_names
    UNION ALL SELECT language_code FROM core.core_land_area_names
    UNION ALL SELECT language_code FROM core.core_water_line_names
    UNION ALL SELECT language_code FROM core.core_water_polygon_names
  ) AS names
  WHERE language_code NOT IN ('my', 'en', 'und');

  SELECT count(*) INTO missing_building_names
  FROM core.core_buildings AS b
  WHERE nullif(btrim(b.name), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.core_building_names AS n
      WHERE n.building_id = b.id AND n.name = b.name
    );

  IF invalid_language_rows <> 0 OR missing_building_names <> 0 THEN
    RAISE EXCEPTION
      '175 refused: invalid language rows=%, unrepresented building scalar names=%',
      invalid_language_rows, missing_building_names;
  END IF;
END
$block$;

INSERT INTO core.core_land_area_names (
  land_area_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT l.id, l.name, 'und', NULL, 'imported', FALSE, 50
FROM core.core_land_areas AS l
WHERE nullif(btrim(l.name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_land_area_names AS n
    WHERE n.land_area_id = l.id AND n.name = l.name
  );

INSERT INTO core.core_water_line_names (
  water_line_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT w.id, w.name, 'und', NULL, 'imported', FALSE, 50
FROM core.core_water_lines AS w
WHERE nullif(btrim(w.name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_water_line_names AS n
    WHERE n.water_line_id = w.id AND n.name = w.name
  );

INSERT INTO core.core_water_polygon_names (
  water_polygon_id, name, language_code, script_code, name_type, is_primary, search_weight
)
SELECT w.id, w.name, 'und', NULL, 'imported', FALSE, 50
FROM core.core_water_polygons AS w
WHERE nullif(btrim(w.name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.core_water_polygon_names AS n
    WHERE n.water_polygon_id = w.id AND n.name = w.name
  );

DO $block$
DECLARE
  missing_names bigint;
BEGIN
  SELECT sum(missing_count) INTO missing_names
  FROM (
    SELECT count(*) AS missing_count
    FROM core.core_land_areas AS e
    WHERE nullif(btrim(e.name), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.core_land_area_names n WHERE n.land_area_id=e.id AND n.name=e.name)
    UNION ALL
    SELECT count(*) FROM core.core_water_lines AS e
    WHERE nullif(btrim(e.name), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.core_water_line_names n WHERE n.water_line_id=e.id AND n.name=e.name)
    UNION ALL
    SELECT count(*) FROM core.core_water_polygons AS e
    WHERE nullif(btrim(e.name), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.core_water_polygon_names n WHERE n.water_polygon_id=e.id AND n.name=e.name)
  ) AS coverage;

  IF missing_names <> 0 THEN
    RAISE EXCEPTION '175 failed coverage assertion: % scalar names remain unrepresented', missing_names;
  END IF;
END
$block$;

COMMENT ON COLUMN core.core_buildings.name IS
  'DEPRECATED compatibility field. Authoritative multilingual names are in core.core_building_names.';
COMMENT ON COLUMN core.core_land_areas.name IS
  'DEPRECATED compatibility field. Authoritative multilingual names are in core.core_land_area_names.';
COMMENT ON COLUMN core.core_water_lines.name IS
  'DEPRECATED compatibility field. Authoritative multilingual names are in core.core_water_line_names.';
COMMENT ON COLUMN core.core_water_polygons.name IS
  'DEPRECATED compatibility field. Authoritative multilingual names are in core.core_water_polygon_names.';

COMMIT;
