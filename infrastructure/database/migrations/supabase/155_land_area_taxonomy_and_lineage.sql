-- =============================================================================
-- Supabase migration 155: unified land-area taxonomy + OSM lineage
-- =============================================================================
--
-- Scope:
--   1) Rename ref.ref_landuse_classes → ref.ref_land_area_classes
--   2) Rename columns:
--        core.core_land_areas.landuse_class_id → land_area_class_id
--        core.core_land_area_names.landuse_id → land_area_id
--        import_review.landuse_candidates → land_area_candidates
--        import_review.land_area_candidates.landuse_class_id → land_area_class_id
--   3) Normalize class hierarchy under landuse / landcover / wetland roots
--      (preserve existing IDs/codes; add missing codes only)
--   4) Add buildings-style OSM lineage columns to core.core_land_areas
--   5) Backfill lineage from source_refs using stable source_code / snapshot_version
--      (never hardcode environment-local numeric IDs)
--   6) Refresh search.v_search_landuse_source (view name unchanged)
--
-- Does NOT:
--   - create core_landcover / core_wetlands tables
--   - drop legacy class_code or main-table name
--   - change RLS
--   - change Martin/PMTiles source-layer names
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

-- ---------------------------------------------------------------------------
-- 0) Before counts
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _m155_before ON COMMIT DROP AS
SELECT
  (SELECT count(*)::bigint FROM core.core_land_areas) AS land_areas,
  (SELECT count(*)::bigint FROM core.core_land_area_names) AS land_area_names,
  (SELECT count(*)::bigint FROM ref.ref_landuse_classes) AS ref_classes,
  (SELECT count(*)::bigint FROM import_review.landuse_candidates) AS candidates,
  (SELECT count(*)::bigint FROM core.core_land_areas WHERE landuse_class_id IS NOT NULL) AS with_class_fk;

DO $$
BEGIN
  RAISE NOTICE '155 before: %', (SELECT row_to_json(b) FROM _m155_before b);
END $$;

-- ---------------------------------------------------------------------------
-- 1) Rename ref table + sequence / constraints / indexes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('ref.ref_landuse_classes') IS NOT NULL
     AND to_regclass('ref.ref_land_area_classes') IS NULL THEN
    ALTER TABLE ref.ref_landuse_classes RENAME TO ref_land_area_classes;
  ELSIF to_regclass('ref.ref_land_area_classes') IS NULL THEN
    RAISE EXCEPTION '155: ref.ref_land_area_classes missing';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('ref.ref_landuse_classes_id_seq') IS NOT NULL
     AND to_regclass('ref.ref_land_area_classes_id_seq') IS NULL THEN
    ALTER SEQUENCE ref.ref_landuse_classes_id_seq RENAME TO ref_land_area_classes_id_seq;
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname AS old_name,
           replace(con.conname, 'ref_landuse_classes', 'ref_land_area_classes') AS new_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ref'
      AND c.relname = 'ref_land_area_classes'
      AND con.conname LIKE 'ref_landuse_classes%'
  LOOP
    EXECUTE format(
      'ALTER TABLE ref.ref_land_area_classes RENAME CONSTRAINT %I TO %I',
      r.old_name, r.new_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS old_name,
           replace(c.relname, 'ref_landuse_classes', 'ref_land_area_classes') AS new_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ref'
      AND c.relkind = 'i'
      AND c.relname LIKE 'ref_landuse_classes%'
  LOOP
    EXECUTE format('ALTER INDEX ref.%I RENAME TO %I', r.old_name, r.new_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Rename core.core_land_areas.landuse_class_id → land_area_class_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_areas' AND column_name='landuse_class_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_areas' AND column_name='land_area_class_id'
  ) THEN
    ALTER TABLE core.core_land_areas RENAME COLUMN landuse_class_id TO land_area_class_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'core_land_areas_landuse_class_id_fkey'
      AND conrelid = 'core.core_land_areas'::regclass
  ) THEN
    ALTER TABLE core.core_land_areas
      RENAME CONSTRAINT core_land_areas_landuse_class_id_fkey
      TO core_land_areas_land_area_class_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='core' AND c.relname='core_land_areas_landuse_class_id_idx'
  ) THEN
    ALTER INDEX core.core_land_areas_landuse_class_id_idx
      RENAME TO core_land_areas_land_area_class_id_idx;
  END IF;
END $$;

-- Keep active_class index name meaningful if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='core' AND c.relname='core_land_areas_active_class_idx'
  ) THEN
    -- definition already follows renamed column via OID; name stays OK
    NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Rename core.core_land_area_names.landuse_id → land_area_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_area_names' AND column_name='landuse_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core' AND table_name='core_land_area_names' AND column_name='land_area_id'
  ) THEN
    ALTER TABLE core.core_land_area_names RENAME COLUMN landuse_id TO land_area_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'core_land_area_names_landuse_id_fkey'
      AND conrelid = 'core.core_land_area_names'::regclass
  ) THEN
    ALTER TABLE core.core_land_area_names
      RENAME CONSTRAINT core_land_area_names_landuse_id_fkey
      TO core_land_area_names_land_area_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='core' AND c.relname='core_land_area_names_landuse_id_idx'
  ) THEN
    ALTER INDEX core.core_land_area_names_landuse_id_idx
      RENAME TO core_land_area_names_land_area_id_idx;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Rename import_review.landuse_candidates → land_area_candidates
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('import_review.landuse_candidates') IS NOT NULL
     AND to_regclass('import_review.land_area_candidates') IS NULL THEN
    ALTER TABLE import_review.landuse_candidates RENAME TO land_area_candidates;
  ELSIF to_regclass('import_review.land_area_candidates') IS NULL THEN
    RAISE EXCEPTION '155: import_review.land_area_candidates missing';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('import_review.landuse_candidates_id_seq') IS NOT NULL
     AND to_regclass('import_review.land_area_candidates_id_seq') IS NULL THEN
    ALTER SEQUENCE import_review.landuse_candidates_id_seq
      RENAME TO land_area_candidates_id_seq;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='import_review' AND table_name='land_area_candidates'
      AND column_name='landuse_class_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='import_review' AND table_name='land_area_candidates'
      AND column_name='land_area_class_id'
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME COLUMN landuse_class_id TO land_area_class_id;
  END IF;
END $$;

-- Rename candidate constraints / indexes that still use landuse naming
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='landuse_candidates_pkey'
      AND conrelid='import_review.land_area_candidates'::regclass
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME CONSTRAINT landuse_candidates_pkey TO land_area_candidates_pkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='landuse_candidates_review_batch_id_fkey'
      AND conrelid='import_review.land_area_candidates'::regclass
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME CONSTRAINT landuse_candidates_review_batch_id_fkey
      TO land_area_candidates_review_batch_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='irr_lu_landuse_class_id_fkey'
      AND conrelid='import_review.land_area_candidates'::regclass
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME CONSTRAINT irr_lu_landuse_class_id_fkey
      TO irr_land_area_land_area_class_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='irr_landuse_admin_area_id_fkey'
      AND conrelid='import_review.land_area_candidates'::regclass
  ) THEN
    ALTER TABLE import_review.land_area_candidates
      RENAME CONSTRAINT irr_landuse_admin_area_id_fkey
      TO irr_land_area_admin_area_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='import_review' AND c.relname='irr_lu_landuse_class_id_idx'
  ) THEN
    ALTER INDEX import_review.irr_lu_landuse_class_id_idx
      RENAME TO irr_land_area_land_area_class_id_idx;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='import_review' AND c.relname='irr_landuse_admin_area_id_idx'
  ) THEN
    ALTER INDEX import_review.irr_landuse_admin_area_id_idx
      RENAME TO irr_land_area_admin_area_id_idx;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='import_review' AND c.relname='landuse_candidates_pkey'
  ) THEN
    ALTER INDEX import_review.landuse_candidates_pkey
      RENAME TO land_area_candidates_pkey;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Normalize hierarchy: landuse / landcover / wetland roots
--    Preserve existing IDs. Add missing codes only.
-- ---------------------------------------------------------------------------

-- Roots
INSERT INTO ref.ref_land_area_classes AS c (
  code, name_en, name_mm, parent_id, sort_order, min_zoom,
  default_import_confidence, is_public, is_active, created_at, updated_at
)
VALUES
  ('landuse', 'Land use', 'မြေအသုံးချမှု', NULL, 10, 10, 70, true, true, now(), now()),
  ('landcover', 'Land cover', 'မြေဖုံးအုပ်မှု', NULL, 20, 10, 70, true, true, now(), now()),
  ('wetland', 'Wetland', 'စိုစွတ်မြေ', NULL, 30, 11, 70, true, true, now(), now())
ON CONFLICT (code) DO UPDATE
SET name_en = EXCLUDED.name_en,
    name_mm = COALESCE(c.name_mm, EXCLUDED.name_mm),
    parent_id = NULL,
    is_active = true,
    updated_at = now();

-- Attach existing mid-level landuse groups under landuse root
UPDATE ref.ref_land_area_classes AS child
SET parent_id = root.id,
    updated_at = now()
FROM ref.ref_land_area_classes AS root
WHERE root.code = 'landuse'
  AND child.code IN ('urban', 'agriculture', 'institution', 'green', 'transport', 'special')
  AND child.parent_id IS DISTINCT FROM root.id;

-- Move forest / grassland under landcover
UPDATE ref.ref_land_area_classes AS child
SET parent_id = root.id,
    sort_order = CASE child.code WHEN 'forest' THEN 0 WHEN 'grassland' THEN 1 ELSE child.sort_order END,
    updated_at = now()
FROM ref.ref_land_area_classes AS root
WHERE root.code = 'landcover'
  AND child.code IN ('forest', 'grassland')
  AND child.parent_id IS DISTINCT FROM root.id;

-- Move government under institution (from urban)
UPDATE ref.ref_land_area_classes AS child
SET parent_id = parent.id,
    sort_order = 4,
    updated_at = now()
FROM ref.ref_land_area_classes AS parent
WHERE parent.code = 'institution'
  AND child.code = 'government'
  AND child.parent_id IS DISTINCT FROM parent.id;

-- Missing landcover children
INSERT INTO ref.ref_land_area_classes AS c (
  code, name_en, name_mm, parent_id, sort_order, min_zoom,
  default_import_confidence, is_public, is_active, created_at, updated_at
)
SELECT v.code, v.name_en, v.name_mm, p.id, v.sort_order, v.min_zoom,
       v.default_import_confidence, true, true, now(), now()
FROM (VALUES
  ('scrub', 'Scrub', NULL::text, 2, 12::numeric, 70::numeric),
  ('heath', 'Heath', NULL, 3, 12, 70),
  ('sand', 'Sand', NULL, 4, 12, 70),
  ('beach', 'Beach', NULL, 5, 13, 70),
  ('bare_rock', 'Bare rock', NULL, 6, 13, 70),
  ('mud', 'Mud', NULL, 7, 13, 70)
) AS v(code, name_en, name_mm, sort_order, min_zoom, default_import_confidence)
JOIN ref.ref_land_area_classes p ON p.code = 'landcover'
ON CONFLICT (code) DO UPDATE
SET parent_id = EXCLUDED.parent_id,
    name_en = EXCLUDED.name_en,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now();

-- Missing wetland children
INSERT INTO ref.ref_land_area_classes AS c (
  code, name_en, name_mm, parent_id, sort_order, min_zoom,
  default_import_confidence, is_public, is_active, created_at, updated_at
)
SELECT v.code, v.name_en, v.name_mm, p.id, v.sort_order, v.min_zoom,
       v.default_import_confidence, true, true, now(), now()
FROM (VALUES
  ('marsh', 'Marsh', NULL::text, 0, 13::numeric, 70::numeric),
  ('swamp', 'Swamp', NULL, 1, 13, 70),
  ('mangrove', 'Mangrove', NULL, 2, 12, 75),
  ('reedbed', 'Reedbed', NULL, 3, 13, 70),
  ('wet_meadow', 'Wet meadow', NULL, 4, 13, 70),
  ('saltmarsh', 'Salt marsh', NULL, 5, 13, 70),
  ('tidalflat', 'Tidal flat', NULL, 6, 13, 70),
  ('bog', 'Bog', NULL, 7, 13, 65),
  ('fen', 'Fen', NULL, 8, 13, 65)
) AS v(code, name_en, name_mm, sort_order, min_zoom, default_import_confidence)
JOIN ref.ref_land_area_classes p ON p.code = 'wetland'
ON CONFLICT (code) DO UPDATE
SET parent_id = EXCLUDED.parent_id,
    name_en = EXCLUDED.name_en,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now();

-- Missing special children
INSERT INTO ref.ref_land_area_classes AS c (
  code, name_en, name_mm, parent_id, sort_order, min_zoom,
  default_import_confidence, is_public, is_active, created_at, updated_at
)
SELECT v.code, v.name_en, v.name_mm, p.id, v.sort_order, v.min_zoom,
       v.default_import_confidence, true, true, now(), now()
FROM (VALUES
  ('quarry', 'Quarry', NULL::text, 3, 13::numeric, 65::numeric),
  ('landfill', 'Landfill', NULL, 4, 13, 60)
) AS v(code, name_en, name_mm, sort_order, min_zoom, default_import_confidence)
JOIN ref.ref_land_area_classes p ON p.code = 'special'
ON CONFLICT (code) DO UPDATE
SET parent_id = EXCLUDED.parent_id,
    name_en = EXCLUDED.name_en,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now();

-- Reorder special: military/vacant/quarry/landfill/other
UPDATE ref.ref_land_area_classes
SET sort_order = CASE code
  WHEN 'military' THEN 0
  WHEN 'vacant' THEN 1
  WHEN 'quarry' THEN 2
  WHEN 'landfill' THEN 3
  WHEN 'other' THEN 4
  ELSE sort_order
END,
updated_at = now()
WHERE code IN ('military', 'vacant', 'quarry', 'landfill', 'other');

-- Ensure green children only park / recreation_ground remain under green
UPDATE ref.ref_land_area_classes
SET sort_order = CASE code WHEN 'park' THEN 0 WHEN 'recreation_ground' THEN 1 ELSE sort_order END,
    updated_at = now()
WHERE code IN ('park', 'recreation_ground');

-- ---------------------------------------------------------------------------
-- 6) Add OSM lineage columns (buildings pattern)
-- ---------------------------------------------------------------------------
ALTER TABLE core.core_land_areas
  ADD COLUMN IF NOT EXISTS source_registry_id bigint,
  ADD COLUMN IF NOT EXISTS source_snapshot_id bigint,
  ADD COLUMN IF NOT EXISTS source_feature_type text,
  ADD COLUMN IF NOT EXISTS source_feature_id bigint,
  ADD COLUMN IF NOT EXISTS region_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'core_land_areas_source_registry_id_fkey'
      AND conrelid = 'core.core_land_areas'::regclass
  ) THEN
    ALTER TABLE core.core_land_areas
      ADD CONSTRAINT core_land_areas_source_registry_id_fkey
        FOREIGN KEY (source_registry_id)
        REFERENCES system.system_source_registry (id)
        NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'core_land_areas_source_snapshot_id_fkey'
      AND conrelid = 'core.core_land_areas'::regclass
  ) THEN
    ALTER TABLE core.core_land_areas
      ADD CONSTRAINT core_land_areas_source_snapshot_id_fkey
        FOREIGN KEY (source_snapshot_id)
        REFERENCES system.system_source_snapshots (id)
        NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'core_land_areas_source_feature_type_chk'
      AND conrelid = 'core.core_land_areas'::regclass
  ) THEN
    ALTER TABLE core.core_land_areas
      ADD CONSTRAINT core_land_areas_source_feature_type_chk
        CHECK (
          source_feature_type IS NULL
          OR source_feature_type IN ('way', 'relation')
        )
        NOT VALID;
  END IF;
END $$;

-- Backfill only when safely resolvable from source_refs / external_id.
-- Never copy numeric source_snapshot_id from JSON across environments.
WITH raw_source AS (
  SELECT
    a.id,
    nullif(btrim(a.source_refs ->> 'osm_id'), '') AS osm_id_text,
    lower(nullif(btrim(a.source_refs ->> 'osm_feature_type'), '')) AS osm_feature_type_text,
    lower(nullif(btrim(a.source_refs ->> 'source'), '')) AS source_text,
    nullif(btrim(a.source_refs ->> 'region_code'), '') AS source_region_code,
    coalesce(
      nullif(btrim(a.source_refs ->> 'source_snapshot_version'), ''),
      nullif(btrim(a.source_refs ->> 'snapshot_version'), '')
    ) AS source_snapshot_version,
    nullif(btrim(a.external_id), '') AS external_id
  FROM core.core_land_areas AS a
  WHERE a.source_registry_id IS NULL
     OR a.source_snapshot_id IS NULL
     OR a.source_feature_type IS NULL
     OR a.source_feature_id IS NULL
     OR a.region_code IS NULL
),
parsed AS (
  SELECT
    r.id,
    CASE
      WHEN r.osm_id_text ~ '^[1-9][0-9]*$'
        OR r.external_id ~* '^osm:(way|relation|w|r):[1-9][0-9]*$'
        THEN 'osm_myanmar'
      WHEN r.source_text = 'dashboard'
        THEN 'manual_dashboard'
      ELSE NULL
    END AS source_code,
    CASE
      WHEN r.osm_feature_type_text IN ('w', 'way') THEN 'way'
      WHEN r.osm_feature_type_text IN ('r', 'rel', 'relation') THEN 'relation'
      WHEN r.external_id ~* '^osm:(way|w):' THEN 'way'
      WHEN r.external_id ~* '^osm:(relation|r):' THEN 'relation'
      ELSE NULL
    END AS source_feature_type,
    CASE
      WHEN r.osm_id_text ~ '^[1-9][0-9]*$'
       AND r.osm_id_text::numeric <= 9223372036854775807::numeric
        THEN r.osm_id_text::bigint
      WHEN r.external_id ~* '^osm:(way|relation|w|r):([1-9][0-9]*)$'
        THEN (regexp_match(r.external_id, '([1-9][0-9]*)$'))[1]::bigint
      ELSE NULL
    END AS source_feature_id,
    lower(nullif(btrim(r.source_region_code), '')) AS region_code,
    r.source_snapshot_version
  FROM raw_source r
)
UPDATE core.core_land_areas AS a
SET
  source_registry_id = COALESCE(
    a.source_registry_id,
    reg.id
  ),
  source_snapshot_id = COALESCE(
    a.source_snapshot_id,
    snap.id
  ),
  source_feature_type = COALESCE(a.source_feature_type, p.source_feature_type),
  source_feature_id = COALESCE(a.source_feature_id, p.source_feature_id),
  region_code = COALESCE(a.region_code, p.region_code)
FROM parsed p
LEFT JOIN system.system_source_registry reg
  ON reg.source_code = p.source_code
 AND reg.is_active IS TRUE
LEFT JOIN system.system_source_snapshots snap
  ON snap.source_registry_id = reg.id
 AND snap.snapshot_version = p.source_snapshot_version
WHERE a.id = p.id
  AND (
    (a.source_registry_id IS NULL AND reg.id IS NOT NULL)
    OR (a.source_snapshot_id IS NULL AND snap.id IS NOT NULL)
    OR (a.source_feature_type IS NULL AND p.source_feature_type IS NOT NULL)
    OR (a.source_feature_id IS NULL AND p.source_feature_id IS NOT NULL)
    OR (a.region_code IS NULL AND p.region_code IS NOT NULL)
  );

ALTER TABLE core.core_land_areas
  VALIDATE CONSTRAINT core_land_areas_source_registry_id_fkey;
ALTER TABLE core.core_land_areas
  VALIDATE CONSTRAINT core_land_areas_source_snapshot_id_fkey;
ALTER TABLE core.core_land_areas
  VALIDATE CONSTRAINT core_land_areas_source_feature_type_chk;

CREATE UNIQUE INDEX IF NOT EXISTS core_land_areas_source_identity_uidx
  ON core.core_land_areas (source_registry_id, source_feature_type, source_feature_id)
  WHERE source_registry_id IS NOT NULL
    AND source_feature_type IS NOT NULL
    AND source_feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_land_areas_source_registry_id_idx
  ON core.core_land_areas (source_registry_id);
CREATE INDEX IF NOT EXISTS core_land_areas_source_snapshot_id_idx
  ON core.core_land_areas (source_snapshot_id);
CREATE INDEX IF NOT EXISTS core_land_areas_region_code_idx
  ON core.core_land_areas (region_code);

COMMENT ON COLUMN core.core_land_areas.land_area_class_id IS
  'Authoritative class FK → ref.ref_land_area_classes.id (landuse / landcover / wetland hierarchy).';
COMMENT ON COLUMN core.core_land_areas.class_code IS
  'DEPRECATED as authoritative. Kept temporarily for tile/API compatibility. Prefer land_area_class_id.';
COMMENT ON COLUMN core.core_land_areas.name IS
  'DEPRECATED as canonical name store. Prefer core.core_land_area_names.';
COMMENT ON COLUMN core.core_land_areas.source_registry_id IS
  'Typed lineage → system.system_source_registry.id';
COMMENT ON COLUMN core.core_land_areas.source_snapshot_id IS
  'Typed lineage → system.system_source_snapshots.id (resolved by snapshot_version, never by foreign numeric IDs).';
COMMENT ON COLUMN core.core_land_areas.source_feature_type IS
  'OSM feature type: way | relation';
COMMENT ON COLUMN core.core_land_areas.source_feature_id IS
  'OSM feature id (bigint)';
COMMENT ON COLUMN core.core_land_areas.region_code IS
  'Optional region package / extract code from import lineage';

-- ---------------------------------------------------------------------------
-- 7) Refresh search view (name unchanged; columns updated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW search.v_search_landuse_source AS
SELECT
    'landuse'::text AS entity_type,
    lu.id AS entity_id,
    lu.public_id::text AS public_id,
    COALESCE(nm.name_en, nm.name_my, lu.name, lc.name_en) AS display_name,
    COALESCE(lc.name_en, lu.class_code) AS subtitle,
    COALESCE(nm.name_my, lu.name, lc.name_mm) AS primary_name_my,
    COALESCE(nm.name_en, lu.name, lc.name_en) AS primary_name_en,
    COALESCE(lu.name, lc.name_en) AS primary_name_und,
    COALESCE(lc.code, lu.class_code) AS code,
    lu.external_id,
    COALESCE(lc.code, lu.class_code) AS category_code,
    lc.name_mm AS category_name_my,
    lc.name_en AS category_name_en,
    lu.admin_area_id,
    ctx.adm_my AS admin_area_name_my,
    ctx.adm_en AS admin_area_name_en,
    ctx.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(lu.geom) AS geometry_type,
    COALESCE(lu.centroid, search.safe_centroid(lu.geom)) AS centroid,
    search.safe_bbox(lu.geom) AS bbox,
    (COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL) AS has_geometry,
    (COALESCE(lu.centroid, search.safe_centroid(lu.geom)) IS NOT NULL) AS supports_plus_code,
    concat_ws(
      ' ',
      lu.name, nm.all_names, lc.name_en, lc.name_mm, lu.class_code,
      ctx.adm_en, ctx.adm_my, search.hierarchy_text(ctx.hierarchy)
    ) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    COALESCE(lu.confidence_score, 0) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    COALESCE(lu.is_verified, false) AS is_verified,
    true AS is_public,
    COALESCE(lu.is_active, false) AS is_active,
    lu.updated_at AS source_updated_at,
    COALESCE(nm.names_json, '[]'::jsonb) AS names
FROM core.core_land_areas lu
LEFT JOIN ref.ref_land_area_classes lc ON lc.id = lu.land_area_class_id
LEFT JOIN LATERAL (
    SELECT search.admin_area_name(lu.admin_area_id, 'my') AS adm_my,
           search.admin_area_name(lu.admin_area_id, 'en') AS adm_en,
           search.admin_area_hierarchy(lu.admin_area_id) AS hierarchy
) ctx ON true
LEFT JOIN LATERAL (
    SELECT
        (SELECT x.name FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'my' OR upper(trim(coalesce(x.script_code, ''))) = 'MYMR')
            ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                          WHEN x.is_primary THEN 2
                          WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                     x.search_weight DESC NULLS LAST, x.name
            LIMIT 1) AS name_my,
        (SELECT x.name FROM core.core_land_area_names x
            WHERE x.land_area_id = lu.id
              AND (x.language_code = 'en' OR upper(trim(coalesce(x.script_code, ''))) = 'LATN')
            ORDER BY CASE WHEN x.name_type = 'official' AND x.is_primary THEN 1
                          WHEN x.is_primary THEN 2
                          WHEN x.name_type = 'official' THEN 3 ELSE 4 END,
                     x.search_weight DESC NULLS LAST, x.name
            LIMIT 1) AS name_en,
        (SELECT jsonb_agg(jsonb_build_object(
                    'name', x.name, 'language_code', x.language_code,
                    'script_code', x.script_code, 'name_type', x.name_type,
                    'is_primary', x.is_primary, 'search_weight', coalesce(x.search_weight, 0))
                    ORDER BY x.is_primary DESC, x.name)
            FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS names_json,
        (SELECT string_agg(DISTINCT x.name, ' ')
            FROM core.core_land_area_names x WHERE x.land_area_id = lu.id) AS all_names
) nm ON true
WHERE lu.deleted_at IS NULL
  AND lu.is_active = true
  AND lu.geom IS NOT NULL
  AND NOT st_isempty(lu.geom)
  AND (
      nullif(btrim(lu.name), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM core.core_land_area_names x WHERE x.land_area_id = lu.id)
  );

COMMENT ON VIEW search.v_search_landuse_source IS
  'Search source for land areas (entity_type=landuse). Reads core.core_land_areas + ref.ref_land_area_classes + names.';

-- ---------------------------------------------------------------------------
-- 8) Assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  before_areas bigint;
  after_areas bigint;
  before_names bigint;
  after_names bigint;
  before_fk bigint;
  after_fk bigint;
  orphan_fk bigint;
  broken_parent bigint;
  dup_code bigint;
BEGIN
  SELECT land_areas, land_area_names, with_class_fk
  INTO before_areas, before_names, before_fk
  FROM _m155_before;

  SELECT count(*) INTO after_areas FROM core.core_land_areas;
  SELECT count(*) INTO after_names FROM core.core_land_area_names;
  SELECT count(*) INTO after_fk FROM core.core_land_areas WHERE land_area_class_id IS NOT NULL;

  IF before_areas IS DISTINCT FROM after_areas THEN
    RAISE EXCEPTION '155: land_areas count changed % → %', before_areas, after_areas;
  END IF;
  IF before_names IS DISTINCT FROM after_names THEN
    RAISE EXCEPTION '155: land_area_names count changed % → %', before_names, after_names;
  END IF;
  IF before_fk IS DISTINCT FROM after_fk OR after_fk <> after_areas THEN
    RAISE EXCEPTION '155: class FK coverage changed (before=% after=% total=%)', before_fk, after_fk, after_areas;
  END IF;

  IF to_regclass('ref.ref_landuse_classes') IS NOT NULL THEN
    RAISE EXCEPTION '155: old ref.ref_landuse_classes still exists';
  END IF;
  IF to_regclass('import_review.landuse_candidates') IS NOT NULL THEN
    RAISE EXCEPTION '155: old import_review.landuse_candidates still exists';
  END IF;

  SELECT count(*) INTO orphan_fk
  FROM core.core_land_areas a
  LEFT JOIN ref.ref_land_area_classes c ON c.id = a.land_area_class_id
  WHERE a.land_area_class_id IS NOT NULL AND c.id IS NULL;
  IF orphan_fk > 0 THEN
    RAISE EXCEPTION '155: % orphan land_area_class_id values', orphan_fk;
  END IF;

  SELECT count(*) INTO broken_parent
  FROM ref.ref_land_area_classes c
  LEFT JOIN ref.ref_land_area_classes p ON p.id = c.parent_id
  WHERE c.parent_id IS NOT NULL AND p.id IS NULL;
  IF broken_parent > 0 THEN
    RAISE EXCEPTION '155: % broken parent_id links in ref_land_area_classes', broken_parent;
  END IF;

  SELECT count(*) INTO dup_code
  FROM (
    SELECT code FROM ref.ref_land_area_classes GROUP BY code HAVING count(*) > 1
  ) d;
  IF dup_code > 0 THEN
    RAISE EXCEPTION '155: duplicate ref codes present';
  END IF;

  -- Required roots / moved classes
  IF NOT EXISTS (SELECT 1 FROM ref.ref_land_area_classes WHERE code='landuse' AND parent_id IS NULL) THEN
    RAISE EXCEPTION '155: missing landuse root';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ref.ref_land_area_classes WHERE code='landcover' AND parent_id IS NULL) THEN
    RAISE EXCEPTION '155: missing landcover root';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ref.ref_land_area_classes WHERE code='wetland' AND parent_id IS NULL) THEN
    RAISE EXCEPTION '155: missing wetland root';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ref.ref_land_area_classes c
    JOIN ref.ref_land_area_classes p ON p.id = c.parent_id
    WHERE c.code='forest' AND p.code='landcover'
  ) THEN
    RAISE EXCEPTION '155: forest not under landcover';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ref.ref_land_area_classes c
    JOIN ref.ref_land_area_classes p ON p.id = c.parent_id
    WHERE c.code='government' AND p.code='institution'
  ) THEN
    RAISE EXCEPTION '155: government not under institution';
  END IF;

  IF pg_get_viewdef('search.v_search_landuse_source'::regclass, true) ILIKE '%landuse_class_id%'
     OR pg_get_viewdef('search.v_search_landuse_source'::regclass, true) ILIKE '%landuse_id%'
     OR pg_get_viewdef('search.v_search_landuse_source'::regclass, true) ILIKE '%ref_landuse_classes%' THEN
    RAISE EXCEPTION '155: search view still references old landuse names';
  END IF;
END $$;

COMMIT;
