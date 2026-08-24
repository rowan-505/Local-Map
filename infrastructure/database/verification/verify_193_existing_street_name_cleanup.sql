-- Read-only verification for migration 193.
--
-- Pre-migration live baseline (2026-08-24):
--   active streets                    823006
--   generated canonical road-NNN      796727
--   active streets with legit names    26282
--   active legit name rows              26452
--   active language rows        my=119, en=124, und=26209
--   core name rows (including inactive) 26460
--   manual_override streets               508
--
-- Expected repair:
--   inserted current OSM names 33910
--     name:my 16231, name:en 17676, name 3
--   active name rows after 60362; named active streets remain 26282
--   protected candidate rows 22 (17 streets)
--   legitimate conflicts 7664
--   und script fills: Mymr 18909, Latn 5693; ambiguous 1609 unchanged
--   public labelable active streets 26267
--   renderable unnamed roads 796739
--     (includes 14 numeric-only names and 1 name equal to ref, all suppressed)

-- 1. Schema/provenance and security-invoker view definitions.
SELECT
    count(*) FILTER (
        WHERE table_schema = 'core'
          AND table_name = 'core_street_names'
          AND column_name = 'source_refs'
          AND data_type = 'jsonb'
    ) = 1 AS source_refs_present
FROM information_schema.columns;

SELECT
    c.relname AS view_name,
    c.reloptions,
    pg_get_viewdef(c.oid, true) AS definition
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'tiles'
  AND c.relname IN (
      'tiles_street_public_names_v',
      'tiles_roads_v',
      'tiles_streets_v',
      'tiles_road_labels_v'
  )
ORDER BY c.relname;

-- 2. Core counts. Street count and generated internal canonical count must be
-- unchanged. A legitimate name is current primary/official and sanitized.
WITH legitimate AS (
    SELECT n.*
    FROM core.core_street_names AS n
    WHERE n.is_primary IS TRUE
      AND lower(btrim(n.name_type)) IN ('official', 'primary')
      AND nullif(btrim(n.name), '') IS NOT NULL
      AND btrim(n.name) !~* '^(road|street)[_-][0-9]+$'
      AND btrim(n.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
      AND btrim(n.name) !~* '^osm([_:/-]|$)'
      AND btrim(n.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
)
SELECT
    count(*) AS active_streets,
    count(*) FILTER (WHERE s.canonical_name ~ '^road-[0-9]+$')
        AS generated_internal_canonical,
    count(*) FILTER (WHERE s.manual_override IS TRUE) AS manual_override_streets,
    count(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM legitimate AS n WHERE n.street_id = s.id)
    ) AS streets_with_legitimate_name,
    count(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM legitimate AS n WHERE n.street_id = s.id)
    ) AS unresolved_unnamed_streets
FROM core.core_streets AS s
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL;

SELECT
    coalesce(nullif(lower(btrim(n.language_code)), ''), 'und') AS language_code,
    coalesce(nullif(btrim(n.script_code), ''), 'NULL') AS script_code,
    count(*) AS name_rows,
    count(DISTINCT n.street_id) AS streets
FROM core.core_street_names AS n
JOIN core.core_streets AS s ON s.id = n.street_id
WHERE s.is_active IS TRUE
  AND s.deleted_at IS NULL
  AND n.is_primary IS TRUE
  AND lower(btrim(n.name_type)) IN ('official', 'primary')
  AND nullif(btrim(n.name), '') IS NOT NULL
  AND btrim(n.name) !~* '^(road|street)[_-][0-9]+$'
  AND btrim(n.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
  AND btrim(n.name) !~* '^osm([_:/-]|$)'
  AND btrim(n.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
GROUP BY 1, 2
ORDER BY 1, 2;

-- 3. Exact migration inserts and proof that no ref/alias/history source tag was
-- promoted. Expected total 33910 and only name/name:my/name:en source tags.
SELECT
    source_refs ->> 'source_tag' AS source_tag,
    language_code,
    script_code,
    count(*) AS inserted_rows
FROM core.core_street_names
WHERE source_refs ->> 'migration' = '193_existing_street_name_cleanup'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3 NULLS FIRST;

SELECT
    count(*) AS total_inserted,
    count(*) FILTER (
        WHERE source_refs ->> 'source_tag' NOT IN ('name', 'name:my', 'name:en')
    ) AS non_current_tag_inserts,
    count(*) FILTER (WHERE source_refs ->> 'source_tag' = 'ref') AS ref_inserts,
    count(*) FILTER (WHERE source_refs ->> 'source_tag' = 'old_name') AS old_name_inserts,
    count(*) FILTER (WHERE source_refs ->> 'source_tag' = 'alt_name') AS alt_name_inserts
FROM core.core_street_names
WHERE source_refs ->> 'migration' = '193_existing_street_name_cleanup';

-- 4. Script detection. The last two counts must be zero; mixed/ambiguous und
-- names intentionally remain NULL.
SELECT
    coalesce(nullif(btrim(script_code), ''), 'NULL') AS script_code,
    count(*) AS und_name_rows
FROM core.core_street_names
WHERE coalesce(nullif(lower(btrim(language_code)), ''), 'und') = 'und'
GROUP BY 1
ORDER BY 1;

SELECT
    count(*) FILTER (
        WHERE name ~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
          AND name !~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
          AND nullif(btrim(script_code), '') IS NULL
    ) AS obvious_mymr_still_missing,
    count(*) FILTER (
        WHERE name ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
          AND name !~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
          AND nullif(btrim(script_code), '') IS NULL
    ) AS obvious_latn_still_missing,
    count(*) FILTER (
        WHERE nullif(btrim(script_code), '') IS NULL
    ) AS mixed_or_ambiguous_unchanged
FROM core.core_street_names
WHERE coalesce(nullif(lower(btrim(language_code)), ''), 'und') = 'und';

-- 5. Public tile outputs. Road line counts must match eligible Core geometries;
-- unnamed lines remain and have NULL names. Every invalid/public-leak count
-- must be zero.
SELECT
    (SELECT count(*)
     FROM core.core_streets AS s
     WHERE s.is_active IS TRUE
       AND s.deleted_at IS NULL
       AND s.geom IS NOT NULL
       AND NOT st_isempty(s.geom)) AS core_renderable_roads,
    (SELECT count(*) FROM tiles.tiles_roads_v) AS tile_roads,
    (SELECT count(*) FROM tiles.tiles_roads_v WHERE name IS NULL)
        AS unnamed_renderable_roads,
    (SELECT count(*) FROM tiles.tiles_road_labels_v) AS road_label_rows,
    (SELECT count(*) FROM tiles.tiles_street_public_names_v) AS public_name_rows;

WITH public_values AS (
    SELECT 'tiles_roads_v.name'::text AS field, name AS value
    FROM tiles.tiles_roads_v
    UNION ALL
    SELECT 'tiles_streets_v.name', name FROM tiles.tiles_streets_v
    UNION ALL
    SELECT 'tiles_streets_v.canonical_name', canonical_name
    FROM tiles.tiles_streets_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name', name FROM tiles.tiles_road_labels_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name_mm', name_mm FROM tiles.tiles_road_labels_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name_en', name_en FROM tiles.tiles_road_labels_v
)
SELECT
    field,
    count(*) FILTER (WHERE value ~* '^(road|street)[_-][0-9]+$')
        AS generated_identifier_values,
    count(*) FILTER (WHERE nullif(btrim(value), '') IS NULL AND value IS NOT NULL)
        AS empty_values,
    count(*) FILTER (WHERE value ~* '^unnamed(?:[[:space:]_-].*)?$')
        AS unnamed_placeholder_values,
    count(*) FILTER (WHERE value ~* '^osm([_:/-]|$)') AS osm_identifier_values,
    count(*) FILTER (
        WHERE value ~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
    ) AS osm_object_identifier_values
FROM public_values
GROUP BY field
ORDER BY field;

SELECT
    count(*) FILTER (
        WHERE lower(btrim(public_name.name))
            = lower(coalesce(s.normalized_data #>> '{tags,ref}', ''))
    ) AS ref_values_emitted,
    count(*) FILTER (
        WHERE lower(btrim(public_name.name))
            = lower(coalesce(s.normalized_data #>> '{tags,route}', ''))
    ) AS route_values_emitted,
    count(*) FILTER (
        WHERE lower(btrim(public_name.name))
            = lower(coalesce(s.normalized_data #>> '{tags,destination}', ''))
    ) AS destination_values_emitted
FROM tiles.tiles_street_public_names_v AS public_name
JOIN core.core_streets AS s ON s.id = public_name.street_id;

-- 6. Recompute unresolved review candidates. After migration, safe inserts have
-- become exact no-ops. Expected: conflict_review=7664, protected_review=22
-- across 17 protected streets.
WITH raw_candidates AS (
    SELECT
        s.id AS street_id,
        s.public_id,
        s.external_id,
        s.manual_override,
        s.is_verified,
        s.source_refs,
        s.normalized_data -> 'tags' AS tags,
        candidate.source_tag,
        candidate.language_code,
        nullif(btrim(candidate.raw_name), '') AS candidate_name
    FROM core.core_streets AS s
    CROSS JOIN LATERAL (VALUES
        ('name:my'::text, 'my'::text,  s.normalized_data #>> '{tags,name:my}'),
        ('name:en'::text, 'en'::text,  s.normalized_data #>> '{tags,name:en}'),
        ('name'::text,    'und'::text, s.normalized_data #>> '{tags,name}')
    ) AS candidate(source_tag, language_code, raw_name)
    WHERE s.is_active IS TRUE
      AND s.deleted_at IS NULL
), valid AS (
    SELECT *
    FROM raw_candidates AS candidate
    WHERE candidate.candidate_name IS NOT NULL
      AND candidate.candidate_name !~* '^(road|street)[_-][0-9]+$'
      AND candidate.candidate_name !~* '^unnamed(?:[[:space:]_-].*)?$'
      AND candidate.candidate_name !~* '^osm([_:/-]|$)'
      AND candidate.candidate_name !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      AND candidate.candidate_name !~* '^[0-9]+$'
      AND candidate.candidate_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND lower(candidate.candidate_name) <> lower(candidate.public_id::text)
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.external_id, ''))
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.tags ->> 'ref', ''))
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.tags ->> 'nat_ref', ''))
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.tags ->> 'int_ref', ''))
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.tags ->> 'route', ''))
      AND lower(candidate.candidate_name) <> lower(coalesce(candidate.tags ->> 'destination', ''))
), classified AS (
    SELECT
        candidate.*,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM core.core_street_names AS existing
                WHERE existing.street_id = candidate.street_id
                  AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und')
                        = candidate.language_code
                  AND existing.is_primary IS TRUE
                  AND lower(btrim(existing.name_type)) IN ('official', 'primary')
                  AND lower(btrim(existing.name)) = lower(candidate.candidate_name)
            ) THEN 'noop_identical'
            WHEN candidate.manual_override IS TRUE
              OR candidate.is_verified IS TRUE
              OR lower(coalesce(candidate.source_refs ->> 'source', ''))
                    IN ('dashboard', 'manual')
              OR lower(coalesce(candidate.source_refs ->> 'origin', ''))
                    IN ('dashboard', 'manual')
                THEN 'protected_review'
            WHEN EXISTS (
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
            ) THEN 'conflict_review'
            ELSE 'safe_insert_remaining'
        END AS disposition
    FROM valid AS candidate
)
SELECT
    disposition,
    count(*) AS candidate_rows,
    count(DISTINCT street_id) AS streets
FROM classified
GROUP BY disposition
ORDER BY disposition;

-- 7. Immutable street fingerprints. Compare every bucket with the recorded
-- pre-migration values in the migration handoff; all values must match exactly.
WITH expected(
    bucket, lo, hi, expected_rows,
    expected_geometry_fingerprint,
    expected_external_id_fingerprint,
    expected_manual_override_fingerprint
) AS (
    VALUES
        (0, 2::bigint, 127617::bigint, 1287::bigint,
         93267493820907427366::numeric,
         -210734864982381737288::numeric,
         17851108187940044302::numeric),
        (1, 127617::bigint, 255232::bigint, 56028::bigint,
         71463798954176981150::numeric,
         -774994146647669094789::numeric,
         3478106240877075103104::numeric),
        (2, 255232::bigint, 382847::bigint, 127615::bigint,
         -1272735614500436317276::numeric,
         -3376335058203501830477::numeric,
         4494693273388142895974::numeric),
        (3, 382847::bigint, 510462::bigint, 127615::bigint,
         11457525645978680555::numeric,
         27540337336839134396::numeric,
         -1755827594024616474469::numeric),
        (4, 510462::bigint, 638077::bigint, 127615::bigint,
         -138226319825995993687::numeric,
         288329207487308518913::numeric,
         416901510957003512599::numeric),
        (5, 638077::bigint, 765692::bigint, 127615::bigint,
         -1796220109461934181748::numeric,
         -827387562318343009190::numeric,
         6310996664704901358012::numeric),
        (6, 765692::bigint, 893307::bigint, 127615::bigint,
         -3925238196431289812294::numeric,
         -3684417408444465923841::numeric,
         -1653956255261979567123::numeric),
        (7, 893307::bigint, 1020923::bigint, 127616::bigint,
         -666634763955786391452::numeric,
         1813514738202187027719::numeric,
         1272218701835399870047::numeric)
), actual AS (
    SELECT
        expected.bucket,
        count(s.*) AS rows,
        sum(hashtextextended(encode(ST_AsEWKB(s.geom), 'hex'), 0)::numeric)
            AS geometry_fingerprint,
        sum(hashtextextended(
            s.id::text || E'\x1f' || coalesce(s.external_id, ''), 0
        )::numeric) AS external_id_fingerprint,
        sum(hashtextextended(
            s.id::text || E'\x1f' || s.manual_override::text, 0
        )::numeric) AS manual_override_fingerprint
    FROM expected
    LEFT JOIN core.core_streets AS s
      ON s.id >= expected.lo
     AND s.id < expected.hi
     AND s.is_active IS TRUE
     AND s.deleted_at IS NULL
    GROUP BY expected.bucket
)
SELECT
    actual.*,
    actual.rows = expected.expected_rows AS rows_unchanged,
    actual.geometry_fingerprint = expected.expected_geometry_fingerprint
        AS geometry_unchanged,
    actual.external_id_fingerprint = expected.expected_external_id_fingerprint
        AS external_id_unchanged,
    actual.manual_override_fingerprint
        = expected.expected_manual_override_fingerprint
        AS manual_override_unchanged
FROM actual
JOIN expected USING (bucket)
ORDER BY bucket;
