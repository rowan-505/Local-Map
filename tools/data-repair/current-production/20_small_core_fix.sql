-- Prompt 10 — Small core mechanical fix (clear issues only)
-- No auto-merge, no invented external_ids, no auto-verify, no transport content cleanup.

SET statement_timeout = '10min';

CREATE TABLE IF NOT EXISTS system.repair_small_core_before_202607 (
  entity_family text NOT NULL,
  entity_id bigint NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_family, entity_id, field_name)
);

-- 1) Landuse class_code vs FK (tags say residential, FK was farmland)
BEGIN;
INSERT INTO system.repair_small_core_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'landuse', id, 'land_area_class_id', land_area_class_id::text, '7'
FROM core.core_land_areas
WHERE id = 30 AND deleted_at IS NULL AND land_area_class_id IS DISTINCT FROM 7
ON CONFLICT DO NOTHING;

UPDATE core.core_land_areas
SET land_area_class_id = 7,
    updated_at = now()
WHERE id = 30
  AND deleted_at IS NULL
  AND class_code = 'residential'
  AND land_area_class_id IS DISTINCT FROM 7
  AND NOT COALESCE(manual_override, false);
COMMIT;

-- 2) Place name language codes: mm -> my; blank -> my if Myanmar script else en
BEGIN;
INSERT INTO system.repair_small_core_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'place_name', id, 'language_code', coalesce(language_code, ''), 'my'
FROM core.core_place_names
WHERE language_code = 'mm'
ON CONFLICT DO NOTHING;

UPDATE core.core_place_names
SET language_code = 'my'
WHERE language_code = 'mm';

INSERT INTO system.repair_small_core_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'place_name', id, 'language_code', '',
  CASE WHEN name ~ '[\u1000-\u109F]' THEN 'my' ELSE 'en' END
FROM core.core_place_names
WHERE language_code IS NULL OR btrim(language_code) = ''
ON CONFLICT DO NOTHING;

UPDATE core.core_place_names
SET language_code = CASE
  WHEN name ~ '[\u1000-\u109F]' THEN 'my'
  ELSE 'en'
END
WHERE language_code IS NULL OR btrim(language_code) = '';
COMMIT;

-- 3) Places marked OSM source but no external_id -> manual source
BEGIN;
INSERT INTO system.repair_small_core_before_202607 (entity_family, entity_id, field_name, old_value, new_value)
SELECT 'place', id, 'source_type_id', source_type_id::text, '2'
FROM core.core_places
WHERE deleted_at IS NULL
  AND external_id IS NULL
  AND source_type_id = 1
ON CONFLICT DO NOTHING;

UPDATE core.core_places
SET source_type_id = 2,
    updated_at = now()
WHERE deleted_at IS NULL
  AND external_id IS NULL
  AND source_type_id = 1;
COMMIT;

SELECT entity_family, field_name, count(*) AS rows_backed_up
FROM system.repair_small_core_before_202607
GROUP BY 1, 2
ORDER BY 1, 2;
