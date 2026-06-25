-- 111_user_saved_places_map_points.sql
--
-- Purpose:
--   Extend app.user_saved_places so users can save arbitrary clicked map points
--   ("map_point") in addition to core place entities ("place").
--
-- Source-of-truth rules:
--   * The database remains the source of truth for saved items.
--   * Saved "place" rows reference core.core_places(id) via entity_id (validated
--     in the API). Saved "map_point" rows store their own coordinates and do not
--     reference a core entity (entity_id is NULL).
--   * Coordinates are stored both as latitude/longitude (double precision) and as
--     a PostGIS geometry(Point, 4326) for spatial use; geom is derived from
--     lat/lng on insert by the API.
--
-- Safety:
--   * Idempotent where practical (IF NOT EXISTS / guarded constraint swaps).
--   * Existing 'place' rows are preserved; they already satisfy the new
--     constraints (entity_id NOT NULL).
--   * NOT applied automatically — apply via the standard Supabase migration flow.

BEGIN;

-- 1) New nullable columns for map_point saves (additive, safe on existing rows).
ALTER TABLE app.user_saved_places
    ADD COLUMN IF NOT EXISTS latitude     double precision,
    ADD COLUMN IF NOT EXISTS longitude    double precision,
    ADD COLUMN IF NOT EXISTS address_line text,
    ADD COLUMN IF NOT EXISTS plus_code    text,
    ADD COLUMN IF NOT EXISTS geom         geometry(Point, 4326);

-- 2) entity_id becomes optional (required only for 'place' — enforced by CHECK below).
ALTER TABLE app.user_saved_places
    ALTER COLUMN entity_id DROP NOT NULL;

-- 3) Allow both 'place' and 'map_point' for entity_type.
ALTER TABLE app.user_saved_places
    DROP CONSTRAINT IF EXISTS user_saved_places_entity_type_chk;
ALTER TABLE app.user_saved_places
    ADD CONSTRAINT user_saved_places_entity_type_chk
        CHECK (entity_type IN ('place', 'map_point'));

-- 4) Shape constraints per entity_type:
--    place     -> entity_id required
--    map_point -> latitude/longitude required and within valid ranges
ALTER TABLE app.user_saved_places
    DROP CONSTRAINT IF EXISTS user_saved_places_shape_chk;
ALTER TABLE app.user_saved_places
    ADD CONSTRAINT user_saved_places_shape_chk CHECK (
        (entity_type = 'place' AND entity_id IS NOT NULL)
        OR (
            entity_type = 'map_point'
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            AND latitude BETWEEN -90 AND 90
            AND longitude BETWEEN -180 AND 180
        )
    );

-- 5) Uniqueness: keep one save per user per place; map_point has no strict unique
--    (optional near-duplicate prevention is handled in the API). Replace the old
--    full UNIQUE constraint with a partial unique index scoped to 'place'.
ALTER TABLE app.user_saved_places
    DROP CONSTRAINT IF EXISTS user_saved_places_unique_entity;
CREATE UNIQUE INDEX IF NOT EXISTS user_saved_places_unique_place
    ON app.user_saved_places (user_id, entity_id)
    WHERE entity_type = 'place';

-- 6) Spatial index for map_point geometry lookups.
CREATE INDEX IF NOT EXISTS user_saved_places_geom_gix
    ON app.user_saved_places
    USING gist (geom)
    WHERE geom IS NOT NULL;

COMMIT;
