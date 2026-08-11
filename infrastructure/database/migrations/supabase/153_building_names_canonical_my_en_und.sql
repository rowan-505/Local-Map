-- =============================================================================
-- Supabase migration 153: canonical building names (my | en | und)
-- =============================================================================
--
-- Goals:
--   1. Normalize language_code mm → my and enforce CHECK (my|en|und).
--   2. Make core.core_map_building_names the only canonical name store.
--   3. Backfill nonblank core.core_map_buildings.name into names as imported/und.
--   4. Add identity unique index: building_id + language_code + name_type + normalized name.
--   5. Refresh tiles/search views to read joined names (no mm; no legacy name fallback).
--      tiles.tiles_buildings_v preserves the live production column contract
--      (name_mm/name_en/building_type_*/admin_area_*). Do not require region_code —
--      that column is not on core.core_map_buildings in production.
--   6. Deprecate core.core_map_buildings.name (leave column; stop new architectural deps).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Ensure companion names table exists (local DBs may lag behind 028).
CREATE TABLE IF NOT EXISTS core.core_map_building_names (
    id bigserial PRIMARY KEY,
    building_id bigint NOT NULL REFERENCES core.core_map_buildings (id) ON DELETE CASCADE,
    name text NOT NULL,
    language_code text NOT NULL,
    script_code text,
    name_type text NOT NULL DEFAULT 'official',
    is_primary boolean NOT NULL DEFAULT false,
    search_weight integer NOT NULL DEFAULT 50,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT core_map_building_names_name_nonempty_chk CHECK (btrim(name) <> ''),
    CONSTRAINT core_map_building_names_name_type_chk
        CHECK (name_type IN ('official', 'alternate', 'short', 'local', 'old', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS core_map_building_names_one_primary_per_lang_type_uidx
    ON core.core_map_building_names (building_id, language_code, name_type)
    WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS core_map_building_names_building_id_idx
    ON core.core_map_building_names (building_id);

CREATE INDEX IF NOT EXISTS core_map_building_names_language_code_idx
    ON core.core_map_building_names (language_code);

-- ---------------------------------------------------------------------------
-- 0) Extract helper for OSM building tags → structured names[]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION system.pipeline_extract_building_names(p_tags jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
WITH tags AS (
    SELECT coalesce(p_tags, '{}'::jsonb) AS j
),
raw AS (
    SELECT
        nullif(btrim(coalesce(j->>'name:my', j->>'name:mm', j->>'name:my-MM', '')), '') AS name_my,
        nullif(btrim(coalesce(j->>'name:en', '')), '') AS name_en,
        nullif(btrim(coalesce(j->>'name', '')), '') AS name_plain
    FROM tags
),
candidates AS (
    SELECT * FROM (
        SELECT name_my AS name, 'my'::text AS language_code, 'Mymr'::text AS script_code, 100 AS search_weight, 1 AS sort_key
        FROM raw WHERE name_my IS NOT NULL
        UNION ALL
        SELECT name_en, 'en', 'Latn', CASE WHEN name_my IS NULL THEN 100 ELSE 90 END, 2
        FROM raw WHERE name_en IS NOT NULL
        UNION ALL
        SELECT name_plain,
            CASE
                WHEN name_en IS NOT NULL AND lower(name_plain) = lower(name_en) THEN 'en'
                WHEN name_plain ~ '[\u1000-\u109F]' THEN 'my'
                ELSE 'und'
            END,
            CASE
                WHEN name_en IS NOT NULL AND lower(name_plain) = lower(name_en) THEN 'Latn'
                WHEN name_plain ~ '[\u1000-\u109F]' THEN 'Mymr'
                ELSE NULL
            END,
            80,
            3
        FROM raw
        WHERE name_plain IS NOT NULL
          AND (
              name_my IS NULL
              OR lower(name_plain) IS DISTINCT FROM lower(name_my)
          )
          AND (
              name_en IS NULL
              OR lower(name_plain) IS DISTINCT FROM lower(name_en)
              OR name_plain ~ '[\u1000-\u109F]' IS FALSE
          )
    ) AS x
),
dedup AS (
    SELECT DISTINCT ON (language_code, lower(btrim(name)))
        name, language_code, script_code, search_weight, sort_key
    FROM candidates
    ORDER BY language_code, lower(btrim(name)), sort_key
),
ranked AS (
    SELECT
        name,
        language_code,
        script_code,
        'imported'::text AS name_type,
        (row_number() OVER (PARTITION BY language_code ORDER BY sort_key, search_weight DESC) = 1) AS is_primary,
        search_weight
    FROM dedup
)
SELECT coalesce(
    jsonb_agg(
        jsonb_strip_nulls(
            jsonb_build_object(
                'name', name,
                'language_code', language_code,
                'script_code', script_code,
                'name_type', name_type,
                'is_primary', is_primary,
                'search_weight', search_weight
            )
        )
        ORDER BY language_code, is_primary DESC, search_weight DESC
    ),
    '[]'::jsonb
)
FROM ranked;
$$;

COMMENT ON FUNCTION system.pipeline_extract_building_names(jsonb) IS
    'OSM building tags → jsonb names[] with language_code my|en|und (mm normalized to my).';

-- ---------------------------------------------------------------------------
-- 1) Fail closed on primary mm/my collisions before conversion
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM core.core_map_building_names AS legacy
        JOIN core.core_map_building_names AS canonical
          ON canonical.building_id = legacy.building_id
         AND canonical.name_type = legacy.name_type
         AND canonical.is_primary IS TRUE
         AND lower(btrim(canonical.language_code)) = 'my'
        WHERE legacy.is_primary IS TRUE
          AND lower(btrim(legacy.language_code)) = 'mm'
    ) THEN
        RAISE EXCEPTION
            '153 STOP: primary mm/my identity collision on core_map_building_names requires review';
    END IF;
END
$$;

ALTER TABLE core.core_map_building_names
    DROP CONSTRAINT IF EXISTS core_map_building_names_language_code_chk;

UPDATE core.core_map_building_names
SET
    language_code = 'my',
    updated_at = now()
WHERE lower(btrim(language_code)) IN ('mm', 'my-mm', 'my-MM');

ALTER TABLE core.core_map_building_names
    ADD CONSTRAINT core_map_building_names_language_code_chk
    CHECK (language_code IN ('my', 'en', 'und'))
    NOT VALID;

ALTER TABLE core.core_map_building_names
    VALIDATE CONSTRAINT core_map_building_names_language_code_chk;

-- ---------------------------------------------------------------------------
-- 2) Backfill legacy buildings.name → imported/und (no duplicates)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_has_deleted_at boolean;
    v_sql text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'core_map_buildings' AND column_name = 'deleted_at'
    ) INTO v_has_deleted_at;

    v_sql := format($q$
INSERT INTO core.core_map_building_names (
    building_id,
    name,
    language_code,
    script_code,
    name_type,
    is_primary,
    search_weight
)
SELECT
    b.id,
    btrim(b.name),
    'und',
    NULL,
    'imported',
    NOT EXISTS (
        SELECT 1
        FROM core.core_map_building_names AS existing_primary
        WHERE existing_primary.building_id = b.id
          AND existing_primary.language_code = 'und'
          AND existing_primary.is_primary IS TRUE
    ),
    50
FROM core.core_map_buildings AS b
WHERE nullif(btrim(b.name), '') IS NOT NULL
  AND (%s)
  AND NOT EXISTS (
      SELECT 1
      FROM core.core_map_building_names AS n
      WHERE n.building_id = b.id
        AND n.name_type = 'imported'
        AND n.language_code = 'und'
        AND lower(btrim(n.name)) = lower(btrim(b.name))
  )
$q$, CASE WHEN v_has_deleted_at THEN 'b.deleted_at IS NULL' ELSE 'TRUE' END);

    EXECUTE v_sql;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Identity unique index (idempotent imported upserts)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS core_map_building_names_identity_uidx
    ON core.core_map_building_names (
        building_id,
        language_code,
        name_type,
        lower(btrim(name))
    );

COMMENT ON INDEX core.core_map_building_names_identity_uidx IS
    'Prevents identical duplicate building names for the same language_code + name_type.';

-- ---------------------------------------------------------------------------
-- 4) Deprecate legacy column (keep for now; stop new writes in application code)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN core.core_map_buildings.name IS
    'DEPRECATED. Canonical names live in core.core_map_building_names. Do not write new values. Retained temporarily for dependency safety.';

-- ---------------------------------------------------------------------------
-- 5) Refresh tiles.tiles_buildings_v — names table only, language my|en|und
--     Skipped when core_map_buildings lacks production columns (slim local DBs).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    dependent_views text;
    has_public_id boolean;
    has_deleted_at boolean;
    has_building_type_id boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'core_map_buildings' AND column_name = 'public_id'
    ) INTO has_public_id;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'core_map_buildings' AND column_name = 'deleted_at'
    ) INTO has_deleted_at;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'core_map_buildings' AND column_name = 'building_type_id'
    ) INTO has_building_type_id;

    IF NOT (has_public_id AND has_deleted_at AND has_building_type_id) THEN
        RAISE NOTICE '153: skip tiles.tiles_buildings_v refresh (core_map_buildings missing production columns)';
        RETURN;
    END IF;

    IF to_regclass('tiles.tiles_buildings_v') IS NULL THEN
        RAISE NOTICE '153: skip tiles.tiles_buildings_v refresh (view missing)';
        RETURN;
    END IF;

    SELECT string_agg(format('%I.%I', dependent_schema.nspname, dependent.relname), ', ')
    INTO dependent_views
    FROM pg_depend AS dependency
    JOIN pg_rewrite AS rewrite
      ON rewrite.oid = dependency.objid
    JOIN pg_class AS dependent
      ON dependent.oid = rewrite.ev_class
    JOIN pg_namespace AS dependent_schema
      ON dependent_schema.oid = dependent.relnamespace
    WHERE dependency.refobjid = 'tiles.tiles_buildings_v'::regclass
      AND dependent.oid <> dependency.refobjid;

    IF dependent_views IS NOT NULL THEN
        RAISE EXCEPTION
            'tiles.tiles_buildings_v has dependent views: %',
            dependent_views;
    END IF;

    EXECUTE 'DROP VIEW tiles.tiles_buildings_v';

    EXECUTE $view$
CREATE VIEW tiles.tiles_buildings_v AS
SELECT
    building.id,
    building.public_id,
    name_my.name AS name_mm,
    name_en.name AS name_en,
    name_und.name AS name_und,
    name_my.name AS name_my,
    coalesce(
        nullif(btrim(name_my.name), ''),
        nullif(btrim(name_en.name), ''),
        nullif(btrim(name_und.name), '')
    ) AS name,
    building.building_type_id,
    building_type.code AS building_type,
    building_type.code AS building_type_code,
    building_type.name AS building_type_name,
    building_type.name_mm AS building_type_name_mm,
    building.levels,
    building.height_m,
    building.area_m2,
    building.confidence_score,
    building.is_verified,
    building.geom,
    building.admin_area_id,
    admin_area.canonical_name AS admin_area_name
FROM core.core_map_buildings AS building
LEFT JOIN ref.ref_building_types AS building_type
  ON building_type.id = building.building_type_id
 AND building_type.is_active IS TRUE
LEFT JOIN core.core_admin_areas AS admin_area
  ON admin_area.id = building.admin_area_id
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND (
          lower(btrim(building_name.language_code)) = 'my'
          OR upper(btrim(coalesce(building_name.script_code, ''))) = 'MYMR'
      )
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
            WHEN building_name.name_type = 'alternate' THEN 3
            ELSE 4
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_my ON true
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND (
          lower(btrim(building_name.language_code)) = 'en'
          OR upper(btrim(coalesce(building_name.script_code, ''))) = 'LATN'
      )
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
            WHEN building_name.name_type = 'alternate' THEN 3
            ELSE 4
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_en ON true
LEFT JOIN LATERAL (
    SELECT building_name.name
    FROM core.core_map_building_names AS building_name
    WHERE building_name.building_id = building.id
      AND lower(btrim(building_name.language_code)) = 'und'
      AND nullif(btrim(building_name.name), '') IS NOT NULL
    ORDER BY
        CASE
            WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
            WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
            WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
            WHEN building_name.name_type = 'alternate' THEN 3
            ELSE 4
        END,
        building_name.search_weight DESC NULLS LAST,
        building_name.id
    LIMIT 1
) AS name_und ON true
WHERE building.is_active IS TRUE
  AND building.deleted_at IS NULL
$view$;

    EXECUTE $c$
COMMENT ON VIEW tiles.tiles_buildings_v IS
    'Building tile source: preserves live Martin/dashboard columns; labels from core_map_building_names only (my/en/und). No region_code (column absent on core_map_buildings).'
$c$;
    EXECUTE 'REVOKE ALL ON TABLE tiles.tiles_buildings_v FROM PUBLIC';
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Refresh search.v_search_buildings_source — names table only
--     Skipped when search helpers are absent (incomplete local DBs).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regprocedure('search.safe_centroid(geometry)') IS NULL
       OR to_regprocedure('search.safe_bbox(geometry)') IS NULL
       OR to_regprocedure('search.admin_area_name(bigint, text)') IS NULL THEN
        RAISE NOTICE '153: skip search.v_search_buildings_source refresh (search helpers missing)';
        RETURN;
    END IF;

    EXECUTE $view$
CREATE OR REPLACE VIEW search.v_search_buildings_source AS
SELECT
    'building'::text AS entity_type,
    building.id AS entity_id,
    building.public_id::text AS public_id,
    coalesce(names.name_my, names.name_en, names.name_und) AS display_name,
    building_type.name AS subtitle,
    names.name_my AS primary_name_my,
    names.name_en AS primary_name_en,
    names.name_und AS primary_name_und,
    NULL::text AS code,
    building.external_id,
    building_type.code AS category_code,
    building_type.name_mm AS category_name_my,
    building_type.name AS category_name_en,
    building.admin_area_id,
    admin_context.adm_my AS admin_area_name_my,
    admin_context.adm_en AS admin_area_name_en,
    admin_context.hierarchy AS admin_hierarchy,
    NULL::text AS address_text,
    NULL::jsonb AS address_parts,
    geometrytype(building.geom) AS geometry_type,
    coalesce(building.centroid, search.safe_centroid(building.geom)) AS centroid,
    search.safe_bbox(building.geom) AS bbox,
    (coalesce(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL) AS has_geometry,
    (coalesce(building.centroid, search.safe_centroid(building.geom)) IS NOT NULL) AS supports_plus_code,
    concat_ws(
        ' ',
        names.all_names,
        building_type.name,
        building_type.name_mm,
        admin_context.adm_en,
        admin_context.adm_my,
        search.hierarchy_text(admin_context.hierarchy)
    ) AS searchable_text,
    0::numeric AS importance_score,
    0::numeric AS popularity_score,
    coalesce(building.confidence_score, 0) AS confidence_score,
    0::numeric AS boundary_confidence_score,
    coalesce(building.is_verified, false) AS is_verified,
    true AS is_public,
    coalesce(building.is_active, false) AS is_active,
    building.updated_at AS source_updated_at,
    coalesce(names.names_json, '[]'::jsonb) AS names
FROM core.core_map_buildings AS building
LEFT JOIN ref.ref_building_types AS building_type
  ON building_type.id = building.building_type_id
LEFT JOIN LATERAL (
    SELECT
        search.admin_area_name(building.admin_area_id, 'my') AS adm_my,
        search.admin_area_name(building.admin_area_id, 'en') AS adm_en,
        search.admin_area_hierarchy(building.admin_area_id) AS hierarchy
) AS admin_context ON true
LEFT JOIN LATERAL (
    SELECT
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND (
                  lower(btrim(building_name.language_code)) = 'my'
                  OR upper(btrim(coalesce(building_name.script_code, ''))) = 'MYMR'
              )
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate' THEN 3
                    ELSE 4
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_my,
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND (
                  lower(btrim(building_name.language_code)) = 'en'
                  OR upper(btrim(coalesce(building_name.script_code, ''))) = 'LATN'
              )
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate' THEN 3
                    ELSE 4
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_en,
        (
            SELECT building_name.name
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND lower(btrim(building_name.language_code)) = 'und'
              AND nullif(btrim(building_name.name), '') IS NOT NULL
            ORDER BY
                CASE
                    WHEN building_name.name_type = 'official' AND building_name.is_primary IS TRUE THEN 0
                    WHEN building_name.name_type = 'local' AND building_name.is_primary IS TRUE THEN 1
                    WHEN building_name.name_type = 'imported' AND building_name.is_primary IS TRUE THEN 2
                    WHEN building_name.name_type = 'alternate' THEN 3
                    ELSE 4
                END,
                building_name.search_weight DESC NULLS LAST,
                building_name.name
            LIMIT 1
        ) AS name_und,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'name', building_name.name,
                    'languageCode', building_name.language_code,
                    'scriptCode', building_name.script_code,
                    'nameType', building_name.name_type,
                    'isPrimary', building_name.is_primary,
                    'searchWeight', coalesce(building_name.search_weight, 0)
                )
                ORDER BY building_name.is_primary DESC, building_name.name
            )
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
        ) AS names_json,
        (
            SELECT string_agg(DISTINCT building_name.name, ' ')
            FROM core.core_map_building_names AS building_name
            WHERE building_name.building_id = building.id
              AND nullif(btrim(building_name.name), '') IS NOT NULL
        ) AS all_names
) AS names ON true
WHERE building.deleted_at IS NULL
  AND building.is_active IS TRUE
  AND building.geom IS NOT NULL
  AND NOT st_isempty(building.geom)
  AND EXISTS (
      SELECT 1
      FROM core.core_map_building_names AS building_name
      WHERE building_name.building_id = building.id
        AND nullif(btrim(building_name.name), '') IS NOT NULL
  )
$view$;

    EXECUTE $c$
COMMENT ON VIEW search.v_search_buildings_source IS
    'Named active buildings from core_map_building_names only (my/en/und).'
$c$;
END
$$;

COMMIT;
