-- Existing-database street-name cleanup.
--
-- Scope:
--   * never changes core.core_streets geometry, identity, lifecycle, or canonical data;
--   * fills script_code only for obvious single-script language_code='und' names;
--   * imports current names only from preserved OSM name/name:my/name:en tags;
--   * preserves protected/manual and conflicting current names for review;
--   * removes generated/internal identifiers from public road tile name fields;
--   * keeps unnamed road geometries in line-rendering views with name = NULL.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- core_street_names previously had no row-level source metadata. Keep the
-- existing seven-column semantics intact and add only the repository-standard
-- source_refs envelope for names inserted by this repair.
ALTER TABLE core.core_street_names
    ADD COLUMN IF NOT EXISTS source_refs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN core.core_street_names.source_refs IS
    'Row-level name provenance. Migration 193 records preserved OSM tag source; legacy rows remain {}.';

-- Script is not language. Only fill a missing script_code for obvious
-- single-script und names; mixed/ambiguous names and existing codes are kept.
UPDATE core.core_street_names
SET script_code = CASE
        WHEN name ~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
         AND name !~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
            THEN 'Mymr'
        WHEN name ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
         AND name !~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
            THEN 'Latn'
        ELSE script_code
    END
WHERE lower(coalesce(nullif(btrim(language_code), ''), 'und')) = 'und'
  AND nullif(btrim(script_code), '') IS NULL
  AND (
        (name ~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
         AND name !~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]')
        OR
        (name ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
         AND name !~ '[က-႟ꧠ-꧿ꩠ-ꩿ]')
      );

-- Recover current names from preserved normalized_data.tags only.
--
-- Deliberately excluded:
--   ref, nat_ref, int_ref, route, destination, old_name, alt_name,
--   loc_name, short_name, official_name and road_name_candidates.
--
-- Conflict policy:
--   exact same language/value -> no-op
--   protected/verified street  -> no-op for review
--   different legitimate primary in that language -> no-op for review
--   otherwise -> insert a primary OSM-derived current name
WITH raw_candidates AS (
    SELECT
        s.id AS street_id,
        s.public_id,
        s.external_id,
        s.manual_override,
        s.is_verified,
        s.source_refs AS street_source_refs,
        s.normalized_data -> 'tags' AS tags,
        candidate.source_tag,
        candidate.language_code,
        candidate.fixed_script_code,
        nullif(btrim(candidate.raw_name), '') AS candidate_name
    FROM core.core_streets AS s
    CROSS JOIN LATERAL (VALUES
        ('name:my'::text, 'my'::text,  'Mymr'::text,
            s.normalized_data #>> '{tags,name:my}'),
        ('name:en'::text, 'en'::text,  'Latn'::text,
            s.normalized_data #>> '{tags,name:en}'),
        ('name'::text,    'und'::text, NULL::text,
            s.normalized_data #>> '{tags,name}')
    ) AS candidate(source_tag, language_code, fixed_script_code, raw_name)
    WHERE s.is_active IS TRUE
      AND s.deleted_at IS NULL
), valid_candidates AS (
    SELECT
        raw.*,
        CASE
            WHEN raw.fixed_script_code IS NOT NULL
                THEN raw.fixed_script_code
            WHEN raw.candidate_name ~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
             AND raw.candidate_name !~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
                THEN 'Mymr'
            WHEN raw.candidate_name ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
             AND raw.candidate_name !~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
                THEN 'Latn'
            ELSE NULL
        END AS script_code
    FROM raw_candidates AS raw
    WHERE raw.candidate_name IS NOT NULL
      AND raw.candidate_name !~* '^(road|street)[_-][0-9]+$'
      AND raw.candidate_name !~* '^unnamed(?:[[:space:]_-].*)?$'
      AND raw.candidate_name !~* '^osm([_:/-]|$)'
      AND raw.candidate_name !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      AND raw.candidate_name !~* '^[0-9]+$'
      AND raw.candidate_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND lower(raw.candidate_name) <> lower(raw.public_id::text)
      AND lower(raw.candidate_name) <> lower(coalesce(raw.external_id, ''))
      AND lower(raw.candidate_name) <> lower(coalesce(raw.tags ->> 'ref', ''))
      AND lower(raw.candidate_name) <> lower(coalesce(raw.tags ->> 'nat_ref', ''))
      AND lower(raw.candidate_name) <> lower(coalesce(raw.tags ->> 'int_ref', ''))
      AND lower(raw.candidate_name) <> lower(coalesce(raw.tags ->> 'route', ''))
      AND lower(raw.candidate_name) <> lower(coalesce(raw.tags ->> 'destination', ''))
)
INSERT INTO core.core_street_names (
    street_id,
    name,
    language_code,
    script_code,
    name_type,
    is_primary,
    source_refs
)
SELECT
    candidate.street_id,
    candidate.candidate_name,
    candidate.language_code,
    candidate.script_code,
    'primary'::text,
    true,
    jsonb_build_object(
        'source', 'osm',
        'source_field', 'normalized_data.tags',
        'source_tag', candidate.source_tag,
        'migration', '193_existing_street_name_cleanup'
    )
FROM valid_candidates AS candidate
WHERE candidate.manual_override IS NOT TRUE
  AND candidate.is_verified IS NOT TRUE
  AND lower(coalesce(candidate.street_source_refs ->> 'source', ''))
        NOT IN ('dashboard', 'manual')
  AND lower(coalesce(candidate.street_source_refs ->> 'origin', ''))
        NOT IN ('dashboard', 'manual')
  AND NOT EXISTS (
        SELECT 1
        FROM core.core_street_names AS existing
        WHERE existing.street_id = candidate.street_id
          AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und')
                = candidate.language_code
          AND existing.is_primary IS TRUE
          AND lower(btrim(existing.name_type)) IN ('official', 'primary')
          AND lower(btrim(existing.name)) = lower(candidate.candidate_name)
  )
  AND NOT EXISTS (
        SELECT 1
        FROM core.core_street_names AS existing
        WHERE existing.street_id = candidate.street_id
          AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und')
                = candidate.language_code
          AND existing.is_primary IS TRUE
          AND lower(btrim(existing.name_type)) IN ('official', 'primary')
          AND nullif(btrim(existing.name), '') IS NOT NULL
          AND btrim(existing.name) !~* '^(road|street)[_-][0-9]+$'
          AND btrim(existing.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
          AND btrim(existing.name) !~* '^osm([_:/-]|$)'
          AND btrim(existing.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
          AND lower(btrim(existing.name)) <> lower(candidate.candidate_name)
  )
ORDER BY candidate.street_id, candidate.language_code;

-- One shared public-name resolver makes all tile views use the same eligibility
-- and language priority. Internal canonical_name remains unchanged in Core.
CREATE OR REPLACE VIEW tiles.tiles_street_public_names_v
WITH (security_invoker = true) AS
WITH eligible AS (
    SELECT
        n.id,
        n.street_id,
        btrim(n.name) AS name,
        coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') AS language_code,
        upper(coalesce(nullif(btrim(n.script_code), ''), '')) AS script_code,
        lower(btrim(n.name_type)) AS name_type,
        CASE
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und')
                    IN ('my', 'mm') THEN 'my'
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'en'
                THEN 'en'
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'und'
             AND upper(coalesce(nullif(btrim(n.script_code), ''), '')) = 'MYMR'
                THEN 'my'
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'und'
             AND upper(coalesce(nullif(btrim(n.script_code), ''), '')) = 'LATN'
                THEN 'en'
            ELSE NULL
        END AS language_slot,
        CASE
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und')
                    IN ('my', 'mm') THEN 1
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'en'
                THEN 2
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'und'
             AND upper(coalesce(nullif(btrim(n.script_code), ''), '')) = 'MYMR'
                THEN 3
            WHEN coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') = 'und'
             AND upper(coalesce(nullif(btrim(n.script_code), ''), '')) = 'LATN'
                THEN 4
            ELSE 5
        END AS language_priority
    FROM core.core_street_names AS n
    INNER JOIN core.core_streets AS s ON s.id = n.street_id
    WHERE n.is_primary IS TRUE
      AND lower(btrim(n.name_type)) IN ('official', 'primary')
      AND coalesce(nullif(lower(btrim(n.language_code)), ''), 'und')
            IN ('my', 'mm', 'en', 'und')
      AND nullif(btrim(n.name), '') IS NOT NULL
      AND btrim(n.name) !~* '^(road|street)[_-][0-9]+$'
      AND btrim(n.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
      AND btrim(n.name) !~* '^osm([_:/-]|$)'
      AND btrim(n.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      AND btrim(n.name) !~* '^[0-9]+$'
      AND btrim(n.name) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND lower(btrim(n.name)) <> lower(s.public_id::text)
      AND lower(btrim(n.name)) <> lower(coalesce(s.external_id, ''))
      AND lower(btrim(n.name))
            <> lower(coalesce(s.normalized_data #>> '{tags,ref}', ''))
      AND lower(btrim(n.name))
            <> lower(coalesce(s.normalized_data #>> '{tags,nat_ref}', ''))
      AND lower(btrim(n.name))
            <> lower(coalesce(s.normalized_data #>> '{tags,int_ref}', ''))
      AND lower(btrim(n.name))
            <> lower(coalesce(s.normalized_data #>> '{tags,route}', ''))
      AND lower(btrim(n.name))
            <> lower(coalesce(s.normalized_data #>> '{tags,destination}', ''))
), ranked AS (
    SELECT
        eligible.*,
        row_number() OVER (
            PARTITION BY street_id
            ORDER BY
                language_priority,
                CASE WHEN name_type = 'official' THEN 0 ELSE 1 END,
                id
        ) AS overall_rank,
        row_number() OVER (
            PARTITION BY street_id, language_slot
            ORDER BY
                language_priority,
                CASE WHEN name_type = 'official' THEN 0 ELSE 1 END,
                id
        ) AS slot_rank
    FROM eligible
)
SELECT
    street_id,
    max(name) FILTER (WHERE overall_rank = 1) AS name,
    max(name) FILTER (WHERE language_slot = 'my' AND slot_rank = 1) AS name_mm,
    max(name) FILTER (WHERE language_slot = 'en' AND slot_rank = 1) AS name_en
FROM ranked
GROUP BY street_id;

COMMENT ON VIEW tiles.tiles_street_public_names_v IS
    'Sanitized current public street names: my, en, und/Mymr, und/Latn, then other und. Primary/official rows only; never canonical/ref/generated identifiers.';

-- Keep every active, non-empty road geometry. Unnamed roads have name = NULL.
CREATE OR REPLACE VIEW tiles.tiles_roads_v
WITH (security_invoker = true) AS
SELECT
    s.id,
    public_name.name,
    s.geom,
    'road'::text AS layer_type
FROM core.core_streets AS s
LEFT JOIN tiles.tiles_street_public_names_v AS public_name
    ON public_name.street_id = s.id
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom);

COMMENT ON VIEW tiles.tiles_roads_v IS
    'Renderable active road geometries. Public name comes only from sanitized core_street_names; unnamed roads remain with name NULL.';

-- Preserve the existing columns consumed by PMTiles. canonical_name is retained
-- only when it is not an internal/generated identifier; Core remains unchanged.
CREATE OR REPLACE VIEW tiles.tiles_streets_v
WITH (security_invoker = true) AS
SELECT
    s.id,
    s.public_id::text AS public_id,
    public_name.name,
    CASE
        WHEN nullif(btrim(s.canonical_name), '') IS NULL THEN NULL
        WHEN btrim(s.canonical_name) ~* '^(road|street)[_-][0-9]+$' THEN NULL
        WHEN btrim(s.canonical_name) ~* '^unnamed(?:[[:space:]_-].*)?$' THEN NULL
        WHEN btrim(s.canonical_name) ~* '^osm([_:/-]|$)' THEN NULL
        WHEN btrim(s.canonical_name) ~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$' THEN NULL
        WHEN btrim(s.canonical_name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN NULL
        WHEN lower(btrim(s.canonical_name)) = lower(s.public_id::text) THEN NULL
        WHEN lower(btrim(s.canonical_name)) = lower(coalesce(s.external_id, '')) THEN NULL
        ELSE btrim(s.canonical_name)
    END AS canonical_name,
    s.admin_area_id,
    s.is_active,
    s.updated_at,
    st_force2d(st_setsrid(s.geom, 4326))::geometry(LineString, 4326) AS geom,
    public_name.name_mm,
    public_name.name_en,
    coalesce(rc.code, 'unknown'::text) AS road_class,
    coalesce(rc.code, 'unknown'::text) AS road_class_code,
    coalesce(rc.rank, 100) AS sort_rank,
    coalesce(rc.min_zoom, 12::numeric) AS min_zoom,
    s.surface,
    coalesce(s.travel_direction = ANY (ARRAY['forward'::text, 'reverse'::text]), false) AS is_oneway,
    coalesce(s.bridge, false) AS bridge,
    coalesce(s.tunnel, false) AS tunnel,
    coalesce(s.layer, 0) AS layer
FROM core.core_streets AS s
LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
LEFT JOIN tiles.tiles_street_public_names_v AS public_name
    ON public_name.street_id = s.id
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND st_isvalid(s.geom)
  AND NOT st_isempty(s.geom)
  AND st_geometrytype(st_force2d(st_setsrid(s.geom, 4326))) = 'ST_LineString'::text;

COMMENT ON VIEW tiles.tiles_streets_v IS
    'Active renderable street lines. Public name uses sanitized core_street_names only; generated canonical identifiers are NULL in the public tile projection.';

-- Labels are emitted only for roads with a legitimate current public name.
CREATE OR REPLACE VIEW tiles.tiles_road_labels_v
WITH (security_invoker = true) AS
SELECT
    s.id,
    public_name.name,
    s.geom,
    'road_label'::text AS layer_type,
    public_name.name_mm,
    public_name.name_en
FROM core.core_streets AS s
INNER JOIN tiles.tiles_street_public_names_v AS public_name
    ON public_name.street_id = s.id
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND s.geom IS NOT NULL
  AND NOT st_isempty(s.geom)
  AND public_name.name IS NOT NULL;

COMMENT ON VIEW tiles.tiles_road_labels_v IS
    'Road label lines with legitimate current names only. No canonical/ref/generated fallback; unnamed roads are rendered by road line views without a label feature.';

RESET lock_timeout;
RESET statement_timeout;
