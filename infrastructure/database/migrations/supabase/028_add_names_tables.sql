BEGIN;

CREATE TABLE IF NOT EXISTS core.core_map_building_names (
  id bigserial PRIMARY KEY,
  building_id bigint NOT NULL REFERENCES core.core_map_buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  language_code text NOT NULL DEFAULT 'und',
  script_code text,
  name_type text NOT NULL DEFAULT 'official',
  is_primary boolean NOT NULL DEFAULT false,
  search_weight integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_map_building_names_language_code_chk
    CHECK (language_code IN ('mm', 'en', 'und')),
  CONSTRAINT core_map_building_names_name_type_chk
    CHECK (name_type IN ('official', 'alternate', 'short', 'local', 'old', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_map_building_names_one_primary_per_lang_type_uidx
ON core.core_map_building_names(building_id, language_code, name_type)
WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS core_map_building_names_building_id_idx
ON core.core_map_building_names(building_id);

CREATE INDEX IF NOT EXISTS core_map_building_names_language_code_idx
ON core.core_map_building_names(language_code);

CREATE TABLE IF NOT EXISTS core.core_map_landuse_names (
  id bigserial PRIMARY KEY,
  landuse_id bigint NOT NULL REFERENCES core.core_map_landuse(id) ON DELETE CASCADE,
  name text NOT NULL,
  language_code text NOT NULL DEFAULT 'und',
  script_code text,
  name_type text NOT NULL DEFAULT 'official',
  is_primary boolean NOT NULL DEFAULT false,
  search_weight integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_map_landuse_names_language_code_chk
    CHECK (language_code IN ('mm', 'en', 'und')),
  CONSTRAINT core_map_landuse_names_name_type_chk
    CHECK (name_type IN ('official', 'alternate', 'short', 'local', 'old', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_map_landuse_names_one_primary_per_lang_type_uidx
ON core.core_map_landuse_names(landuse_id, language_code, name_type)
WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS core_map_landuse_names_landuse_id_idx
ON core.core_map_landuse_names(landuse_id);

CREATE TABLE IF NOT EXISTS core.core_map_water_line_names (
  id bigserial PRIMARY KEY,
  water_line_id bigint NOT NULL REFERENCES core.core_map_water_lines(id) ON DELETE CASCADE,
  name text NOT NULL,
  language_code text NOT NULL DEFAULT 'und',
  script_code text,
  name_type text NOT NULL DEFAULT 'official',
  is_primary boolean NOT NULL DEFAULT false,
  search_weight integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_map_water_line_names_language_code_chk
    CHECK (language_code IN ('mm', 'en', 'und')),
  CONSTRAINT core_map_water_line_names_name_type_chk
    CHECK (name_type IN ('official', 'alternate', 'short', 'local', 'old', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_map_water_line_names_one_primary_per_lang_type_uidx
ON core.core_map_water_line_names(water_line_id, language_code, name_type)
WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS core_map_water_line_names_water_line_id_idx
ON core.core_map_water_line_names(water_line_id);

CREATE TABLE IF NOT EXISTS core.core_map_water_polygon_names (
  id bigserial PRIMARY KEY,
  water_polygon_id bigint NOT NULL REFERENCES core.core_map_water_polygons(id) ON DELETE CASCADE,
  name text NOT NULL,
  language_code text NOT NULL DEFAULT 'und',
  script_code text,
  name_type text NOT NULL DEFAULT 'official',
  is_primary boolean NOT NULL DEFAULT false,
  search_weight integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_map_water_polygon_names_language_code_chk
    CHECK (language_code IN ('mm', 'en', 'und')),
  CONSTRAINT core_map_water_polygon_names_name_type_chk
    CHECK (name_type IN ('official', 'alternate', 'short', 'local', 'old', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_map_water_polygon_names_one_primary_per_lang_type_uidx
ON core.core_map_water_polygon_names(water_polygon_id, language_code, name_type)
WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS core_map_water_polygon_names_water_polygon_id_idx
ON core.core_map_water_polygon_names(water_polygon_id);

COMMIT;


INSERT INTO core.core_map_building_names
(building_id, name, language_code, script_code, name_type, is_primary, search_weight)
SELECT id, name, 'und', NULL, 'imported', true, 50
FROM core.core_map_buildings
WHERE name IS NOT NULL
  AND trim(name) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO core.core_map_landuse_names
(landuse_id, name, language_code, script_code, name_type, is_primary, search_weight)
SELECT id, name, 'und', NULL, 'imported', true, 50
FROM core.core_map_landuse
WHERE name IS NOT NULL
  AND trim(name) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO core.core_map_water_line_names
(water_line_id, name, language_code, script_code, name_type, is_primary, search_weight)
SELECT id, name, 'und', NULL, 'imported', true, 50
FROM core.core_map_water_lines
WHERE name IS NOT NULL
  AND trim(name) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO core.core_map_water_polygon_names
(water_polygon_id, name, language_code, script_code, name_type, is_primary, search_weight)
SELECT id, name, 'und', NULL, 'imported', true, 50
FROM core.core_map_water_polygons
WHERE name IS NOT NULL
  AND trim(name) <> ''
ON CONFLICT DO NOTHING;