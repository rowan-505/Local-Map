-- =============================================================================
-- Supabase migration 148: minimal core water cleanup
-- =============================================================================
--
-- Scope (only):
--   core.core_map_water_lines
--   core.core_map_water_polygons
--   core.core_map_water_line_names
--   core.core_map_water_polygon_names
--
-- Dry-run baseline inspected on 2026-07-29 against Supabase "Map Project":
--   water lines:          51,233
--   water polygons:       19,380
--   water line names:      3,149
--   water polygon names:   1,532
--
-- Expected final counts:
--   water lines:          51,232
--   water polygons:       19,371
--   water line names:      3,149
--   water polygon names:   1,531
--
-- Exact April legacy deletes and retained July counterparts:
--   line 1 -> line 46000
--   polygon 1 -> polygon 38378
--   polygon 2 -> polygon 38379
--   polygon 3 -> polygon 38380
--   polygon 4 -> polygon 38383
--   polygon 5 -> polygon 38539
--   polygon 6 -> polygon 38382
--   polygon 7 -> polygon 38381
--   polygon 8 -> polygon 38384
--   polygon 9 -> polygon 38343
--
-- The polygon delete cascades one dependent legacy name row:
--   core_map_water_polygon_names.id = 1
--
-- Exact name-row target IDs, compressed as inclusive ranges:
--   water_line_names mm -> my (893):
--     8, 3312-3387, 3560-3623, 3813-3910, 4074-4158, 4323-4420,
--     4539-4584, 4795-4815, 4970-4982, 5224-5281, 5522-5641,
--     5778-5877, 6118-6218, 6279-6287, 6333-6335
--   water_polygon_names mm -> my (496):
--     9, 1594-1670, 1845-1908, 2061-2104, 2284-2343, 2593-2713,
--     2913-3041
--   water_line_names official -> imported (3,148):
--     7-8, 3150-4567, 4569-6290, 6330-6335
--   water_polygon_names official -> imported (1,531):
--     8-11, 1538-3063, 3065
--
-- Name row 4568 is deliberately excluded from official -> imported:
-- its Myanmar text is present only in source tag name:mm, not source name:my.
-- No name text is inserted, translated, normalized, or overwritten.
--
-- Exact deterministic class updates (10 polygons):
--   old_mote/old_moat -> moat: 1373, 1374, 1376, 1379
--   source-confirmed reservoir phrase -> reservoir: 1279, 1282
--   natural=water-confirmed natural/yes/water_01 -> water:
--     1510, 31726, 31896, 34038
--
-- Exact-geometry duplicate pairs intentionally retained because OSM identities
-- differ:
--   lines:    60033 / 60047
--   polygons: 1654 / 26740
--   polygons: 31279 / 31280
--
-- Safety:
--   * one transaction
--   * transaction-scoped advisory lock and short lock timeout
--   * assertions accept only the fully pre-migration or fully post-migration
--     state for each idempotent action
--   * no geometry-size predicate and no tiny-geometry deletion
--   * no change to verified/manual names or features
--   * exact source-name evidence is required for official -> imported
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

SELECT pg_advisory_xact_lock(
    hashtextextended('coremap:148:cleanup_core_water_legacy_names_classes', 0)
);

CREATE TEMP TABLE water_cleanup_results (
    action text PRIMARY KEY,
    affected_ids bigint[] NOT NULL,
    affected_count bigint NOT NULL
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Preflight: exact schema objects and whole-table baseline/final state
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_line_count bigint;
    v_polygon_count bigint;
    v_line_name_count bigint;
    v_polygon_name_count bigint;
    v_legacy_line_count bigint;
    v_legacy_polygon_count bigint;
    v_match_count bigint;
    v_name_count bigint;
    v_target_count bigint;
    v_target_hash text;
    v_constraint_definition text;
BEGIN
    IF to_regclass('core.core_map_water_lines') IS NULL
       OR to_regclass('core.core_map_water_polygons') IS NULL
       OR to_regclass('core.core_map_water_line_names') IS NULL
       OR to_regclass('core.core_map_water_polygon_names') IS NULL THEN
        RAISE EXCEPTION '148 preflight: one or more target tables are missing';
    END IF;

    SELECT count(*) INTO v_line_count
    FROM core.core_map_water_lines;

    SELECT count(*) INTO v_polygon_count
    FROM core.core_map_water_polygons;

    SELECT count(*) INTO v_line_name_count
    FROM core.core_map_water_line_names;

    SELECT count(*) INTO v_polygon_name_count
    FROM core.core_map_water_polygon_names;

    SELECT count(*) INTO v_legacy_line_count
    FROM core.core_map_water_lines
    WHERE id = 1;

    SELECT count(*) INTO v_legacy_polygon_count
    FROM core.core_map_water_polygons
    WHERE id BETWEEN 1 AND 9;

    IF NOT (
        (v_legacy_line_count = 1 AND v_legacy_polygon_count = 9)
        OR (v_legacy_line_count = 0 AND v_legacy_polygon_count = 0)
    ) THEN
        RAISE EXCEPTION
            '148 preflight: partial legacy feature state (line %, polygons %)',
            v_legacy_line_count, v_legacy_polygon_count;
    END IF;

    IF v_legacy_line_count = 1 THEN
        IF (v_line_count, v_polygon_count, v_line_name_count, v_polygon_name_count)
           <> (51233, 19380, 3149, 1532) THEN
            RAISE EXCEPTION
                '148 preflight: unexpected pre-cleanup counts (%, %, %, %)',
                v_line_count, v_polygon_count, v_line_name_count, v_polygon_name_count;
        END IF;
    ELSE
        IF (v_line_count, v_polygon_count, v_line_name_count, v_polygon_name_count)
           <> (51232, 19371, 3149, 1531) THEN
            RAISE EXCEPTION
                '148 preflight: unexpected post-cleanup counts (%, %, %, %)',
                v_line_count, v_polygon_count, v_line_name_count, v_polygon_name_count;
        END IF;
    END IF;

    -- The one April line must be unverified and must match the retained July
    -- row by both source OSM id and exact geometry.
    IF v_legacy_line_count = 1 THEN
        SELECT count(*) INTO v_match_count
        FROM core.core_map_water_lines AS legacy
        JOIN core.core_map_water_lines AS canonical
          ON canonical.id = 46000
        WHERE legacy.id = 1
          AND legacy.external_id = '377202555'
          AND legacy.source_refs->>'osm_id' = '377202555'
          AND legacy.created_at >= timestamptz '2026-04-01'
          AND legacy.created_at < timestamptz '2026-05-01'
          AND NOT legacy.is_verified
          AND legacy.verification_status <> 'verified'
          AND canonical.external_id = 'osm:way:377202555'
          AND canonical.source_refs->>'osm_id' = '377202555'
          AND canonical.created_at >= timestamptz '2026-07-01'
          AND canonical.created_at < timestamptz '2026-08-01'
          AND md5(st_asewkb(legacy.geom)) = 'c346e9122d4fa1d85ad62a226ed34296'
          AND st_equals(legacy.geom, canonical.geom);

        IF v_match_count <> 1 THEN
            RAISE EXCEPTION '148 preflight: April line 1 no longer matches July line 46000';
        END IF;

        WITH expected(
            legacy_id,
            legacy_external_id,
            canonical_id,
            canonical_external_id,
            geom_md5
        ) AS (
            VALUES
                (1::bigint, '376702300', 38378::bigint, 'osm:way:376702300', 'c633fc203bd193d66a91c880dfe677a0'),
                (2::bigint, '376702301', 38379::bigint, 'osm:way:376702301', '0f1ed3928b4f99e1affdf86b5faa74a7'),
                (3::bigint, '376702302', 38380::bigint, 'osm:way:376702302', 'f2a998573aca5984f6cde52c28a4af5a'),
                (4::bigint, '376702306', 38383::bigint, 'osm:way:376702306', '72b939ea9e6e394fcd8a0cd1b3f83114'),
                (5::bigint, '936940446', 38539::bigint, 'osm:way:936940446', '3c87903e18a26bad0a80b24575d3d2ed'),
                (6::bigint, '376702304', 38382::bigint, 'osm:way:376702304', '1160c520e9efe325a2139da74cdf4f8e'),
                (7::bigint, '376702303', 38381::bigint, 'osm:way:376702303', '044f74de8a90e3d86b6c26187ab44316'),
                (8::bigint, '376702307', 38384::bigint, 'osm:way:376702307', '299f11a144b7e23c87cfb1a73392b915'),
                (9::bigint, '5547441', 38343::bigint, 'osm:relation:5547441', '4263e0c62396a22158bd46cd745ac8e3')
        )
        SELECT count(*) INTO v_match_count
        FROM expected AS e
        JOIN core.core_map_water_polygons AS legacy
          ON legacy.id = e.legacy_id
        JOIN core.core_map_water_polygons AS canonical
          ON canonical.id = e.canonical_id
        WHERE legacy.external_id = e.legacy_external_id
          AND legacy.source_refs->>'osm_id' = e.legacy_external_id
          AND legacy.created_at >= timestamptz '2026-04-01'
          AND legacy.created_at < timestamptz '2026-05-01'
          AND NOT legacy.is_verified
          AND legacy.verification_status <> 'verified'
          AND canonical.external_id = e.canonical_external_id
          AND canonical.source_refs->>'osm_id' = e.legacy_external_id
          AND canonical.created_at >= timestamptz '2026-07-01'
          AND canonical.created_at < timestamptz '2026-08-01'
          AND md5(st_asewkb(legacy.geom)) = e.geom_md5
          AND st_equals(legacy.geom, canonical.geom);

        IF v_match_count <> 9 THEN
            RAISE EXCEPTION
                '148 preflight: expected 9 exact April/July polygon matches, found %',
                v_match_count;
        END IF;

        SELECT count(*) INTO v_name_count
        FROM core.core_map_water_line_names
        WHERE water_line_id = 1;

        IF v_name_count <> 0 THEN
            RAISE EXCEPTION
                '148 preflight: unexpected dependent names on legacy water line 1: %',
                v_name_count;
        END IF;

        SELECT count(*) INTO v_name_count
        FROM core.core_map_water_polygon_names
        WHERE water_polygon_id BETWEEN 1 AND 9;

        IF v_name_count <> 1 OR NOT EXISTS (
            SELECT 1
            FROM core.core_map_water_polygon_names
            WHERE id = 1
              AND water_polygon_id = 1
              AND name = 'San Chain Mee Pound'
              AND language_code = 'und'
              AND name_type = 'imported'
        ) THEN
            RAISE EXCEPTION
                '148 preflight: legacy polygon names are not exactly the expected row id 1';
        END IF;
    END IF;

    -- The three report-only duplicate pairs must remain distinct OSM records.
    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_lines AS a
        JOIN core.core_map_water_lines AS b ON b.id = 60047
        WHERE a.id = 60033
          AND a.external_id = 'osm:way:1409650247'
          AND b.external_id = 'osm:way:701735524'
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) THEN
        RAISE EXCEPTION '148 preflight: report-only water-line pair 60033/60047 changed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons AS a
        JOIN core.core_map_water_polygons AS b ON b.id = 26740
        WHERE a.id = 1654
          AND a.external_id = 'osm:way:916903812'
          AND b.external_id = 'osm:relation:12442194'
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) THEN
        RAISE EXCEPTION '148 preflight: report-only polygon pair 1654/26740 changed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons AS a
        JOIN core.core_map_water_polygons AS b ON b.id = 31280
        WHERE a.id = 31279
          AND a.external_id = 'osm:way:1394478705'
          AND b.external_id = 'osm:way:1394479299'
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) THEN
        RAISE EXCEPTION '148 preflight: report-only polygon pair 31279/31280 changed';
    END IF;

    -- Language target sets must be entirely pre- or post-migration.
    SELECT
        count(*),
        md5(string_agg(id::text, ',' ORDER BY id))
    INTO v_target_count, v_target_hash
    FROM core.core_map_water_line_names
    WHERE language_code = 'mm';

    IF v_target_count NOT IN (0, 893)
       OR (v_target_count = 893 AND v_target_hash <> 'a04aa2895312b5fbbbc623a73cc48cd3') THEN
        RAISE EXCEPTION
            '148 preflight: unexpected water-line mm target set (count %, hash %)',
            v_target_count, v_target_hash;
    END IF;

    SELECT
        count(*),
        md5(string_agg(id::text, ',' ORDER BY id))
    INTO v_target_count, v_target_hash
    FROM core.core_map_water_polygon_names
    WHERE language_code = 'mm';

    IF v_target_count NOT IN (0, 496)
       OR (v_target_count = 496 AND v_target_hash <> 'e1d645268cbb51fc84cc4734a241c828') THEN
        RAISE EXCEPTION
            '148 preflight: unexpected water-polygon mm target set (count %, hash %)',
            v_target_count, v_target_hash;
    END IF;

    -- Protect the partial unique indexes before changing language/name type.
    IF EXISTS (
        SELECT 1
        FROM core.core_map_water_line_names AS mm
        JOIN core.core_map_water_line_names AS my
          ON my.water_line_id = mm.water_line_id
         AND my.language_code = 'my'
         AND my.name_type = mm.name_type
         AND my.is_primary
        WHERE mm.language_code = 'mm'
          AND mm.is_primary
    ) OR EXISTS (
        SELECT 1
        FROM core.core_map_water_polygon_names AS mm
        JOIN core.core_map_water_polygon_names AS my
          ON my.water_polygon_id = mm.water_polygon_id
         AND my.language_code = 'my'
         AND my.name_type = mm.name_type
         AND my.is_primary
        WHERE mm.language_code = 'mm'
          AND mm.is_primary
    ) THEN
        RAISE EXCEPTION '148 preflight: mm -> my would conflict with a primary-name unique index';
    END IF;

    -- Source-proven official -> imported target sets must also be entirely
    -- pre- or post-migration. Myanmar evidence intentionally requires name:my.
    SELECT
        count(*),
        md5(string_agg(n.id::text, ',' ORDER BY n.id))
    INTO v_target_count, v_target_hash
    FROM core.core_map_water_line_names AS n
    JOIN core.core_map_water_lines AS w ON w.id = n.water_line_id
    WHERE n.name_type = 'official'
      AND NOT w.is_verified
      AND w.verification_status <> 'verified'
      AND system.pipeline_osm_identity_key(w.external_id) IS NOT NULL
      AND nullif(w.source_refs->>'osm_id', '') IS NOT NULL
      AND coalesce(w.source_refs->>'raw_table', '') IN (
          'raw_osm_lines',
          'raw.raw_osm_lines'
      )
      AND CASE n.language_code
          WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
          WHEN 'mm' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'und' THEN w.normalized_data->'tags'->>'name'
          ELSE NULL
      END IS NOT NULL
      AND btrim(n.name) = btrim(
          CASE n.language_code
              WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
              WHEN 'mm' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'und' THEN w.normalized_data->'tags'->>'name'
              ELSE NULL
          END
      );

    IF v_target_count NOT IN (0, 3148)
       OR (v_target_count = 3148 AND v_target_hash <> 'ec99fc6e1cb932d50b1fb891e1063cb9') THEN
        RAISE EXCEPTION
            '148 preflight: unexpected line-name official target set (count %, hash %)',
            v_target_count, v_target_hash;
    END IF;

    SELECT
        count(*),
        md5(string_agg(n.id::text, ',' ORDER BY n.id))
    INTO v_target_count, v_target_hash
    FROM core.core_map_water_polygon_names AS n
    JOIN core.core_map_water_polygons AS w ON w.id = n.water_polygon_id
    WHERE n.name_type = 'official'
      AND NOT w.is_verified
      AND w.verification_status <> 'verified'
      AND system.pipeline_osm_identity_key(w.external_id) IS NOT NULL
      AND nullif(w.source_refs->>'osm_id', '') IS NOT NULL
      AND coalesce(w.source_refs->>'raw_table', '') IN (
          'raw_osm_polygons',
          'raw.raw_osm_polygons'
      )
      AND CASE n.language_code
          WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
          WHEN 'mm' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'und' THEN w.normalized_data->'tags'->>'name'
          ELSE NULL
      END IS NOT NULL
      AND btrim(n.name) = btrim(
          CASE n.language_code
              WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
              WHEN 'mm' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'und' THEN w.normalized_data->'tags'->>'name'
              ELSE NULL
          END
      );

    IF v_target_count NOT IN (0, 1531)
       OR (v_target_count = 1531 AND v_target_hash <> '15712c444a6d8c68eeaa99c64d0aa1db') THEN
        RAISE EXCEPTION
            '148 preflight: unexpected polygon-name official target set (count %, hash %)',
            v_target_count, v_target_hash;
    END IF;

    -- The named language constraints must be either the inspected legacy form
    -- or the desired en|my|und form.
    SELECT pg_get_constraintdef(oid, true)
    INTO v_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_line_names'::regclass
      AND conname = 'core_map_water_line_names_language_code_chk';

    IF v_constraint_definition IS NULL
       OR (
            position('''mm''::text' IN v_constraint_definition) = 0
            AND position('''my''::text' IN v_constraint_definition) = 0
       ) THEN
        RAISE EXCEPTION
            '148 preflight: unexpected line-name language constraint: %',
            v_constraint_definition;
    END IF;

    SELECT pg_get_constraintdef(oid, true)
    INTO v_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_polygon_names'::regclass
      AND conname = 'core_map_water_polygon_names_language_code_chk';

    IF v_constraint_definition IS NULL
       OR (
            position('''mm''::text' IN v_constraint_definition) = 0
            AND position('''my''::text' IN v_constraint_definition) = 0
       ) THEN
        RAISE EXCEPTION
            '148 preflight: unexpected polygon-name language constraint: %',
            v_constraint_definition;
    END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- Replace language checks only when they still contain legacy mm.
-- New constraints are NOT VALID until after the deterministic data update.
-- ---------------------------------------------------------------------------
DO $constraints$
DECLARE
    v_definition text;
BEGIN
    SELECT pg_get_constraintdef(oid, true)
    INTO v_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_line_names'::regclass
      AND conname = 'core_map_water_line_names_language_code_chk';

    IF position('''mm''::text' IN v_definition) > 0 THEN
        ALTER TABLE core.core_map_water_line_names
            DROP CONSTRAINT core_map_water_line_names_language_code_chk;
        ALTER TABLE core.core_map_water_line_names
            ADD CONSTRAINT core_map_water_line_names_language_code_chk
            CHECK (language_code IN ('en', 'my', 'und')) NOT VALID;
    END IF;

    SELECT pg_get_constraintdef(oid, true)
    INTO v_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_polygon_names'::regclass
      AND conname = 'core_map_water_polygon_names_language_code_chk';

    IF position('''mm''::text' IN v_definition) > 0 THEN
        ALTER TABLE core.core_map_water_polygon_names
            DROP CONSTRAINT core_map_water_polygon_names_language_code_chk;
        ALTER TABLE core.core_map_water_polygon_names
            ADD CONSTRAINT core_map_water_polygon_names_language_code_chk
            CHECK (language_code IN ('en', 'my', 'und')) NOT VALID;
    END IF;
END
$constraints$;

-- ---------------------------------------------------------------------------
-- Delete only the exact April legacy rows, child first.
-- ---------------------------------------------------------------------------
WITH changed AS (
    DELETE FROM core.core_map_water_polygon_names
    WHERE id = 1
      AND water_polygon_id = 1
      AND name = 'San Chain Mee Pound'
      AND language_code = 'und'
      AND name_type = 'imported'
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'delete_legacy_polygon_names',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

WITH changed AS (
    DELETE FROM core.core_map_water_lines
    WHERE id = 1
      AND external_id = '377202555'
      AND created_at >= timestamptz '2026-04-01'
      AND created_at < timestamptz '2026-05-01'
      AND NOT is_verified
      AND verification_status <> 'verified'
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'delete_legacy_water_lines',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

WITH changed AS (
    DELETE FROM core.core_map_water_polygons
    WHERE id BETWEEN 1 AND 9
      AND created_at >= timestamptz '2026-04-01'
      AND created_at < timestamptz '2026-05-01'
      AND NOT is_verified
      AND verification_status <> 'verified'
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'delete_legacy_water_polygons',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

-- ---------------------------------------------------------------------------
-- Standardize Myanmar language code. No name text changes.
-- ---------------------------------------------------------------------------
WITH changed AS (
    UPDATE core.core_map_water_line_names
    SET language_code = 'my',
        updated_at = now()
    WHERE language_code = 'mm'
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'water_line_names_mm_to_my',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

WITH changed AS (
    UPDATE core.core_map_water_polygon_names
    SET language_code = 'my',
        updated_at = now()
    WHERE language_code = 'mm'
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'water_polygon_names_mm_to_my',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

DO $name_type_conflicts$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM core.core_map_water_line_names AS official
        JOIN core.core_map_water_line_names AS imported
          ON imported.water_line_id = official.water_line_id
         AND imported.language_code = official.language_code
         AND imported.name_type = 'imported'
         AND imported.is_primary
        WHERE official.name_type = 'official'
          AND official.is_primary
    ) OR EXISTS (
        SELECT 1
        FROM core.core_map_water_polygon_names AS official
        JOIN core.core_map_water_polygon_names AS imported
          ON imported.water_polygon_id = official.water_polygon_id
         AND imported.language_code = official.language_code
         AND imported.name_type = 'imported'
         AND imported.is_primary
        WHERE official.name_type = 'official'
          AND official.is_primary
    ) THEN
        RAISE EXCEPTION
            '148 preflight: official -> imported would conflict with a primary-name unique index';
    END IF;
END
$name_type_conflicts$;

-- ---------------------------------------------------------------------------
-- Relabel only unverified OSM-derived names with exact source-tag evidence.
-- btrim is used only for evidence comparison; stored name text is untouched.
-- ---------------------------------------------------------------------------
WITH changed AS (
    UPDATE core.core_map_water_line_names AS n
    SET name_type = 'imported',
        updated_at = now()
    FROM core.core_map_water_lines AS w
    WHERE w.id = n.water_line_id
      AND n.name_type = 'official'
      AND NOT w.is_verified
      AND w.verification_status <> 'verified'
      AND system.pipeline_osm_identity_key(w.external_id) IS NOT NULL
      AND nullif(w.source_refs->>'osm_id', '') IS NOT NULL
      AND coalesce(w.source_refs->>'raw_table', '') IN (
          'raw_osm_lines',
          'raw.raw_osm_lines'
      )
      AND CASE n.language_code
          WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
          WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'und' THEN w.normalized_data->'tags'->>'name'
          ELSE NULL
      END IS NOT NULL
      AND btrim(n.name) = btrim(
          CASE n.language_code
              WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
              WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'und' THEN w.normalized_data->'tags'->>'name'
              ELSE NULL
          END
      )
    RETURNING n.id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'water_line_names_official_to_imported',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

WITH changed AS (
    UPDATE core.core_map_water_polygon_names AS n
    SET name_type = 'imported',
        updated_at = now()
    FROM core.core_map_water_polygons AS w
    WHERE w.id = n.water_polygon_id
      AND n.name_type = 'official'
      AND NOT w.is_verified
      AND w.verification_status <> 'verified'
      AND system.pipeline_osm_identity_key(w.external_id) IS NOT NULL
      AND nullif(w.source_refs->>'osm_id', '') IS NOT NULL
      AND coalesce(w.source_refs->>'raw_table', '') IN (
          'raw_osm_polygons',
          'raw.raw_osm_polygons'
      )
      AND CASE n.language_code
          WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
          WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
          WHEN 'und' THEN w.normalized_data->'tags'->>'name'
          ELSE NULL
      END IS NOT NULL
      AND btrim(n.name) = btrim(
          CASE n.language_code
              WHEN 'en' THEN w.normalized_data->'tags'->>'name:en'
              WHEN 'my' THEN w.normalized_data->'tags'->>'name:my'
              WHEN 'und' THEN w.normalized_data->'tags'->>'name'
              ELSE NULL
          END
      )
    RETURNING n.id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'water_polygon_names_official_to_imported',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

-- ---------------------------------------------------------------------------
-- Normalize only the 10 source-confirmed deterministic polygon classes.
-- No feature name, source tag, normalized_data, or geometry is changed.
-- ---------------------------------------------------------------------------
WITH changed AS (
    UPDATE core.core_map_water_polygons
    SET class_code = CASE
            WHEN id IN (1373, 1374, 1376, 1379) THEN 'moat'
            WHEN id IN (1279, 1282) THEN 'reservoir'
            WHEN id IN (1510, 31726, 31896, 34038) THEN 'water'
        END,
        updated_at = now()
    WHERE NOT is_verified
      AND verification_status <> 'verified'
      AND (
          (id = 1373 AND class_code = 'old_mote')
          OR (id IN (1374, 1376, 1379) AND class_code = 'old_moat')
          OR (
              id IN (1279, 1282)
              AND class_code = 'ကောလိယရေလှောင်တမံ'
              AND normalized_data->'tags'->>'water' = class_code
              AND btrim(normalized_data->'tags'->>'name') = btrim(name)
              AND lower(name) ~ '(reservoir|dam)'
          )
          OR (
              id = 1510
              AND class_code = 'natural'
              AND normalized_data->'tags'->>'natural' = 'water'
          )
          OR (
              id IN (31726, 31896)
              AND class_code = 'yes'
              AND normalized_data->'tags'->>'natural' = 'water'
          )
          OR (
              id = 34038
              AND class_code = 'water_01'
              AND normalized_data->'tags'->>'natural' = 'water'
          )
      )
    RETURNING id
)
INSERT INTO water_cleanup_results (action, affected_ids, affected_count)
SELECT
    'water_polygon_class_normalization',
    coalesce(array_agg(id ORDER BY id), ARRAY[]::bigint[]),
    count(*)
FROM changed;

ALTER TABLE core.core_map_water_line_names
    VALIDATE CONSTRAINT core_map_water_line_names_language_code_chk;

ALTER TABLE core.core_map_water_polygon_names
    VALIDATE CONSTRAINT core_map_water_polygon_names_language_code_chk;

-- ---------------------------------------------------------------------------
-- In-transaction verification. Any failure rolls back every change.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
    v_count bigint;
    v_definition text;
BEGIN
    IF (SELECT count(*) FROM core.core_map_water_lines) <> 51232 THEN
        RAISE EXCEPTION '148 verify: water line final count is not 51,232';
    END IF;

    IF (SELECT count(*) FROM core.core_map_water_polygons) <> 19371 THEN
        RAISE EXCEPTION '148 verify: water polygon final count is not 19,371';
    END IF;

    IF (SELECT count(*) FROM core.core_map_water_line_names) <> 3149 THEN
        RAISE EXCEPTION '148 verify: water line name final count is not 3,149';
    END IF;

    IF (SELECT count(*) FROM core.core_map_water_polygon_names) <> 1531 THEN
        RAISE EXCEPTION '148 verify: water polygon name final count is not 1,531';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.core_map_water_lines WHERE id = 1
    ) OR EXISTS (
        SELECT 1 FROM core.core_map_water_polygons WHERE id BETWEEN 1 AND 9
    ) OR EXISTS (
        SELECT 1 FROM core.core_map_water_polygon_names WHERE id = 1
    ) THEN
        RAISE EXCEPTION '148 verify: one or more exact legacy IDs still exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM core.core_map_water_lines
        WHERE id = 46000 AND external_id = 'osm:way:377202555'
    ) OR (
        SELECT count(*) FROM core.core_map_water_polygons
        WHERE id IN (38378, 38379, 38380, 38383, 38539, 38382, 38381, 38384, 38343)
    ) <> 9 THEN
        RAISE EXCEPTION '148 verify: one or more retained July counterparts are missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.core_map_water_line_names
        WHERE language_code NOT IN ('en', 'my', 'und')
    ) OR EXISTS (
        SELECT 1 FROM core.core_map_water_polygon_names
        WHERE language_code NOT IN ('en', 'my', 'und')
    ) THEN
        RAISE EXCEPTION '148 verify: invalid water-name language_code remains';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.core_map_water_line_names WHERE language_code = 'mm'
    ) OR EXISTS (
        SELECT 1 FROM core.core_map_water_polygon_names WHERE language_code = 'mm'
    ) THEN
        RAISE EXCEPTION '148 verify: legacy mm language_code remains';
    END IF;

    SELECT pg_get_constraintdef(oid, true)
    INTO v_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_line_names'::regclass
      AND conname = 'core_map_water_line_names_language_code_chk'
      AND convalidated;

    IF v_definition IS NULL
       OR position('''mm''::text' IN v_definition) > 0
       OR position('''my''::text' IN v_definition) = 0
       OR position('''en''::text' IN v_definition) = 0
       OR position('''und''::text' IN v_definition) = 0 THEN
        RAISE EXCEPTION
            '148 verify: line-name language constraint is not validated en|my|und: %',
            v_definition;
    END IF;

    SELECT pg_get_constraintdef(oid, true)
    INTO v_definition
    FROM pg_constraint
    WHERE conrelid = 'core.core_map_water_polygon_names'::regclass
      AND conname = 'core_map_water_polygon_names_language_code_chk'
      AND convalidated;

    IF v_definition IS NULL
       OR position('''mm''::text' IN v_definition) > 0
       OR position('''my''::text' IN v_definition) = 0
       OR position('''en''::text' IN v_definition) = 0
       OR position('''und''::text' IN v_definition) = 0 THEN
        RAISE EXCEPTION
            '148 verify: polygon-name language constraint is not validated en|my|und: %',
            v_definition;
    END IF;

    SELECT count(*) INTO v_count
    FROM core.core_map_water_line_names
    WHERE name_type = 'imported';

    IF v_count <> 3148 THEN
        RAISE EXCEPTION
            '148 verify: expected 3,148 imported line names, found %',
            v_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_line_names AS n
        JOIN core.core_map_water_lines AS w ON w.id = n.water_line_id
        WHERE n.id = 4568
          AND n.name = 'ဖျက်ကြီး ရေလှောင်တမံ'
          AND n.language_code = 'my'
          AND n.name_type = 'official'
          AND w.id = 3526
          AND w.external_id = 'osm:way:943982496'
          AND w.normalized_data->'tags'->>'name:my' IS NULL
          AND w.normalized_data->'tags'->>'name:mm' = n.name
    ) THEN
        RAISE EXCEPTION
            '148 verify: reported name row 4568 was changed unexpectedly';
    END IF;

    IF (SELECT count(*) FROM core.core_map_water_polygon_names WHERE name_type = 'imported') <> 1531
       OR EXISTS (
            SELECT 1
            FROM core.core_map_water_polygon_names
            WHERE name_type = 'official'
       ) THEN
        RAISE EXCEPTION '148 verify: polygon name_type totals are unexpected';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM core.core_map_water_line_names AS n
        JOIN core.core_map_water_lines AS w ON w.id = n.water_line_id
        WHERE n.name_type = 'imported'
          AND (w.is_verified OR w.verification_status = 'verified')
    ) OR EXISTS (
        SELECT 1
        FROM core.core_map_water_polygon_names AS n
        JOIN core.core_map_water_polygons AS w ON w.id = n.water_polygon_id
        WHERE n.name_type = 'imported'
          AND (w.is_verified OR w.verification_status = 'verified')
    ) THEN
        RAISE EXCEPTION '148 verify: a verified feature has an automatically relabeled name';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons
        WHERE class_code IN (
            'old_mote',
            'old_moat',
            'ကောလိယရေလှောင်တမံ',
            'natural',
            'water_01'
        )
    ) THEN
        RAISE EXCEPTION '148 verify: deterministic legacy polygon classes remain';
    END IF;

    IF (
        SELECT count(*)
        FROM core.core_map_water_polygons
        WHERE id IN (1373, 1374, 1376, 1379)
          AND class_code = 'moat'
    ) <> 4 OR (
        SELECT count(*)
        FROM core.core_map_water_polygons
        WHERE id IN (1279, 1282)
          AND class_code = 'reservoir'
    ) <> 2 OR (
        SELECT count(*)
        FROM core.core_map_water_polygons
        WHERE id IN (1510, 31726, 31896, 34038)
          AND class_code = 'water'
    ) <> 4 THEN
        RAISE EXCEPTION '148 verify: one or more deterministic class targets are wrong';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons
        WHERE id = 23021
          AND class_code = 'yes'
          AND coalesce(normalized_data->'tags'->>'natural', '') <> 'water'
    ) THEN
        RAISE EXCEPTION '148 verify: report-only polygon class row 23021 changed';
    END IF;

    -- Re-check report-only exact-geometry pairs after all writes.
    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_lines AS a
        JOIN core.core_map_water_lines AS b ON b.id = 60047
        WHERE a.id = 60033
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) OR NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons AS a
        JOIN core.core_map_water_polygons AS b ON b.id = 26740
        WHERE a.id = 1654
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) OR NOT EXISTS (
        SELECT 1
        FROM core.core_map_water_polygons AS a
        JOIN core.core_map_water_polygons AS b ON b.id = 31280
        WHERE a.id = 31279
          AND a.external_id <> b.external_id
          AND st_equals(a.geom, b.geom)
    ) THEN
        RAISE EXCEPTION '148 verify: a report-only exact-geometry pair changed';
    END IF;
END
$verify$;

-- Application result for this run. First run returns the exact affected IDs;
-- an idempotent rerun returns empty arrays and zero counts.
SELECT action, affected_count, affected_ids
FROM water_cleanup_results
ORDER BY action;

-- Final count/language/name-type verification result.
SELECT *
FROM (
    SELECT
        'core_map_water_lines'::text AS object_name,
        count(*)::bigint AS total,
        NULL::bigint AS en,
        NULL::bigint AS my,
        NULL::bigint AS und,
        NULL::bigint AS official,
        NULL::bigint AS imported
    FROM core.core_map_water_lines

    UNION ALL

    SELECT
        'core_map_water_polygons',
        count(*),
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    FROM core.core_map_water_polygons

    UNION ALL

    SELECT
        'core_map_water_line_names',
        count(*),
        count(*) FILTER (WHERE language_code = 'en'),
        count(*) FILTER (WHERE language_code = 'my'),
        count(*) FILTER (WHERE language_code = 'und'),
        count(*) FILTER (WHERE name_type = 'official'),
        count(*) FILTER (WHERE name_type = 'imported')
    FROM core.core_map_water_line_names

    UNION ALL

    SELECT
        'core_map_water_polygon_names',
        count(*),
        count(*) FILTER (WHERE language_code = 'en'),
        count(*) FILTER (WHERE language_code = 'my'),
        count(*) FILTER (WHERE language_code = 'und'),
        count(*) FILTER (WHERE name_type = 'official'),
        count(*) FILTER (WHERE name_type = 'imported')
    FROM core.core_map_water_polygon_names
) AS final_counts
ORDER BY object_name;

COMMIT;

-- =============================================================================
-- Read-only verification queries for a post-migration review
-- =============================================================================

-- 1. Expected final table counts.
SELECT 'water_lines' AS entity, count(*)::bigint AS total
FROM core.core_map_water_lines
UNION ALL
SELECT 'water_polygons', count(*)
FROM core.core_map_water_polygons
UNION ALL
SELECT 'water_line_names', count(*)
FROM core.core_map_water_line_names
UNION ALL
SELECT 'water_polygon_names', count(*)
FROM core.core_map_water_polygon_names;

-- 2. Exact retained July counterpart IDs.
SELECT 'water_line' AS entity, id, external_id, name, class_code
FROM core.core_map_water_lines
WHERE id = 46000
UNION ALL
SELECT 'water_polygon', id, external_id, name, class_code
FROM core.core_map_water_polygons
WHERE id IN (38378, 38379, 38380, 38383, 38539, 38382, 38381, 38384, 38343)
ORDER BY entity, id;

-- 3. Language and name-type distribution.
SELECT
    'water_line_names' AS entity,
    language_code,
    name_type,
    count(*)::bigint AS total,
    array_agg(id ORDER BY id) AS exact_ids
FROM core.core_map_water_line_names
GROUP BY language_code, name_type
UNION ALL
SELECT
    'water_polygon_names',
    language_code,
    name_type,
    count(*),
    array_agg(id ORDER BY id)
FROM core.core_map_water_polygon_names
GROUP BY language_code, name_type
ORDER BY entity, language_code, name_type;

-- 4. Reported Myanmar name with no source name:my (must remain unchanged).
SELECT
    n.id AS name_id,
    n.water_line_id,
    w.external_id,
    n.name,
    n.language_code,
    n.name_type,
    w.normalized_data->'tags'->>'name:my' AS source_name_my,
    w.normalized_data->'tags'->>'name:mm' AS source_name_mm
FROM core.core_map_water_line_names AS n
JOIN core.core_map_water_lines AS w ON w.id = n.water_line_id
WHERE n.id = 4568;

-- 5. Exact class results.
SELECT id, external_id, name, class_code
FROM core.core_map_water_polygons
WHERE id IN (1279, 1282, 1373, 1374, 1376, 1379, 1510, 31726, 31896, 34038)
ORDER BY id;

-- 6. Three exact-geometry groups intentionally retained because identities differ.
SELECT
    'water_line' AS entity,
    a.id AS id_a,
    a.external_id AS external_id_a,
    b.id AS id_b,
    b.external_id AS external_id_b,
    st_equals(a.geom, b.geom) AS exact_geometry,
    a.external_id <> b.external_id AS different_identity
FROM core.core_map_water_lines AS a
JOIN core.core_map_water_lines AS b ON (a.id, b.id) = (60033, 60047)

UNION ALL

SELECT
    'water_polygon',
    a.id,
    a.external_id,
    b.id,
    b.external_id,
    st_equals(a.geom, b.geom),
    a.external_id <> b.external_id
FROM core.core_map_water_polygons AS a
JOIN core.core_map_water_polygons AS b ON (a.id, b.id) = (1654, 26740)

UNION ALL

SELECT
    'water_polygon',
    a.id,
    a.external_id,
    b.id,
    b.external_id,
    st_equals(a.geom, b.geom),
    a.external_id <> b.external_id
FROM core.core_map_water_polygons AS a
JOIN core.core_map_water_polygons AS b ON (a.id, b.id) = (31279, 31280);
