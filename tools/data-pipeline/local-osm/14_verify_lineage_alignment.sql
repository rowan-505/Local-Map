-- =============================================================================
-- Optional Stage 14: verify_lineage_alignment (LOCAL database only — read-mostly)
-- -----------------------------------------------------------------------------
-- Purpose:
--   - Confirm `system.system_remote_review_package_items` trace back to `staging_*`
--     candidates for the same `source_snapshot_id` as the parent package row.
--   - Spot-check duplicated lineage mirrors on each item `payload` (Stage J).
--   - After Stage K+L, sanity-check upload stamps (`remote_candidate_id`).
--
-- Scope:
--   - Does NOT connect to Supabase. Use README_REMOTE_REVIEW.md for manual
--     `import_review` checks (paste into psql against SUPABASE_DATABASE_URL).
--   - Does NOT read or modify `core.*`.
--
-- psql vars:
--   package_name      (required) — same as REMOTE_REVIEW_PACKAGE_NAME / Stage J
--   staging_schema    optional raw identifier (default staging) — must match pipeline STAGING_SCHEMA
--   snapshot_version  optional — when set/non-blank, must equal package.snapshot_version
--
-- Fail-fast: any severity=FAIL bucket with qty>0 stops psql ON_ERROR_STOP via
--   RAIS EXCEPTION after the `_lineage_chk_14` result set above.
--
-- psql variables (:var / :'var') cannot be referenced inside anonymous PL/pgSQL blocks ($$ … $$).
-- Stage 14 snapshots them into temp table `_lineage_psql_ctx` before the DO block runs.
--
-- Example (manual; never implicit):
--   PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v staging_schema=staging \
--        -v snapshot_version="$SNAPSHOT_VERSION" \
--        -v package_name='your_pkg' \
--        -f ./14_verify_lineage_alignment.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\if :{?staging_schema}
\else
\set staging_schema 'staging'
\endif

\if :{?snapshot_version}
\else
\set snapshot_version ''
\endif

-- Guard: nonempty package_name
SELECT CAST(
        CASE WHEN NULLIF(trim(:'package_name'), '') IS NULL THEN
            E'missing_package_name:_use_-v_package_name_same_as_REMOTE_REVIEW_PACKAGE_NAME'
        ELSE
            '0'
        END AS integer)
    AS _package_name_guard;

WITH tgt_pkg AS (
    SELECT p.*
      FROM system.system_remote_review_packages p
     WHERE p.package_name = trim(:'package_name')
     LIMIT 1
)
SELECT
    'package_lineage_header'::text AS slice,
    t.id                                                          AS package_id,
    t.package_name,
    t.snapshot_version                                              AS source_snapshot_version,
    t.source_snapshot_id                                            AS source_snapshot_id_local,
    t.remote_review_batch_id                                        AS review_batch_id_pkg,
    t.remote_upload_status,
    cardinality(coalesce(t.entity_families, ARRAY[]::text[]))      AS entity_families_card
FROM tgt_pkg t;

SELECT CAST(
        CASE WHEN NOT EXISTS (
            SELECT 1
              FROM system.system_remote_review_packages
             WHERE package_name = trim(:'package_name')
        ) THEN
            concat('unknown_remote_review_package:', trim(:'package_name'))
        ELSE
            '0'
        END AS integer)
    AS _known_package_guard;

DROP TABLE IF EXISTS _lineage_chk_14;

CREATE TEMP TABLE _lineage_chk_14 (
    kind text PRIMARY KEY,
    severity text NOT NULL,
    qty bigint NOT NULL
);

-- psql substitutes :'variable' outside PL/pgSQL only; NEVER inside $$ ... $$
-- (PostgreSQL parses : as invalid). Bridge via one temp row for the DO block.
DROP TABLE IF EXISTS _lineage_psql_ctx;
CREATE TEMP TABLE _lineage_psql_ctx (
    staging_schema_raw text NOT NULL,
    snapshot_version_raw text NOT NULL,
    package_name_raw text NOT NULL
);

INSERT INTO _lineage_psql_ctx (
    staging_schema_raw,
    snapshot_version_raw,
    package_name_raw
)
VALUES (
    trim(:'staging_schema'),
    coalesce(trim(:'snapshot_version'), ''),
    trim(:'package_name')
);

DROP TABLE IF EXISTS stage14_family_manifest;
CREATE TEMP TABLE stage14_family_manifest (
    entity_family text PRIMARY KEY,
    staging_table text NOT NULL,
    matched_core_table text
);

INSERT INTO stage14_family_manifest (entity_family, staging_table, matched_core_table)
VALUES
    ('buildings', 'staging_building_candidates', 'core_map_buildings'),
    ('places', 'staging_place_candidates', 'core_places'),
    ('roads', 'staging_road_candidates', 'core_streets'),
    ('bus_stops', 'staging_bus_stop_candidates', 'core_bus_stops'),
    ('landuse', 'staging_landuse_candidates', 'core_map_landuse'),
    ('water_lines', 'staging_water_line_candidates', 'core_map_water_lines'),
    ('water_polygons', 'staging_water_polygon_candidates', 'core_map_water_polygons'),
    ('addresses', 'staging_address_candidates', 'core_addresses'),
    ('admin_areas', 'staging_admin_area_candidates', 'core_admin_areas'),
    ('routing_barriers', 'staging_routing_barrier_candidates', NULL);

DROP TABLE IF EXISTS stage14_per_entity;
CREATE TEMP TABLE stage14_per_entity (
    entity_family text PRIMARY KEY,
    staging_rows bigint NOT NULL DEFAULT 0,
    package_items bigint NOT NULL DEFAULT 0,
    with_remote_candidate_id bigint NOT NULL DEFAULT 0,
    missing_source_refs bigint NOT NULL DEFAULT 0,
    missing_normalized_data bigint NOT NULL DEFAULT 0,
    external_id_mismatch bigint NOT NULL DEFAULT 0
);

INSERT INTO stage14_per_entity (entity_family)
SELECT entity_family FROM stage14_family_manifest;
-- ---------------------------------------------------------------------------
-- Consolidated lineage checks on package + items (+ dynamic staging joins)
-- ---------------------------------------------------------------------------
DO $_14$
DECLARE
    v_schema  text;
    v_pkg_nm  text;
    v_pkg_id  bigint;
    v_ssid    bigint;
    v_sver    text;
    v_env_sv  text;
    sql       text;
    r         stage14_family_manifest%ROWTYPE;

    miss_staging bigint := 0;
    bad_expected_table bigint := 0;
    bad_core_hint bigint := 0;
    bad_conf bigint;
    miss_payload_mirror bigint;
    fail_empty_source_refs bigint := 0;
    fail_empty_normalized_data bigint := 0;

    warn_ext_blank bigint := 0;
    warn_ext_mismatch bigint := 0;
    warn_f2_blank bigint := 0;
    warn_matched_xor bigint := 0;

    post_upload_miss bigint := 0;
    post_review_batch bigint;
    v_miss_part bigint;
    v_tbl_part bigint;
    v_core_part bigint;
    v_staging_rows bigint;
    v_pkg_items bigint;
    v_miss_sr bigint;
    v_miss_nd bigint;
    v_with_remote bigint;
    v_ext_mismatch bigint;
BEGIN
    SELECT lower(btrim(trim(staging_schema_raw))),
           NULLIF(btrim(trim(snapshot_version_raw)), ''),
           trim(package_name_raw)
      INTO STRICT v_schema, v_env_sv, v_pkg_nm
      FROM _lineage_psql_ctx;

    IF v_schema !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'staging_schema invalid (expected [a-z][a-z0-9_]*): %', v_schema;
    END IF;

    SELECT id,
           source_snapshot_id,
           snapshot_version,
           remote_review_batch_id
      INTO STRICT v_pkg_id, v_ssid, v_sver, post_review_batch
      FROM system.system_remote_review_packages
     WHERE package_name = v_pkg_nm;

    IF v_ssid IS NULL OR NULLIF(btrim(coalesce(v_sver, '')), '') IS NULL THEN
        RAISE EXCEPTION 'LINEAGE_FATAL: package.source_snapshot_id or snapshot_version missing for %',
            v_pkg_nm;
    END IF;

    IF v_env_sv IS NOT NULL AND v_env_sv <> v_sver THEN
        RAISE EXCEPTION
            'LINEAGE_FATAL: package.snapshot_version (%) differs from psql snapshot_version (%) — wrong package/env pairing.',
            v_sver, v_env_sv;
    END IF;

    -- Item rows must resolve to expected staging table for THIS snapshot FK (all families).
    FOR r IN SELECT * FROM stage14_family_manifest ORDER BY entity_family LOOP
        IF to_regclass(format('%I.%I', v_schema, r.staging_table)) IS NULL THEN
            RAISE NOTICE 'stage14_skip family=% missing staging table %.%', r.entity_family, v_schema, r.staging_table;
            CONTINUE;
        END IF;

        sql := format(
            $dq$
SELECT count(*)
  FROM system.system_remote_review_package_items i
 WHERE i.package_id = %s::bigint
   AND i.entity_family = %L
   AND NOT EXISTS (
       SELECT 1 FROM %I.%I sb
        WHERE sb.id = i.local_staging_id AND sb.source_snapshot_id = %s::bigint)
$dq$,
            v_pkg_id, r.entity_family, v_schema, r.staging_table, v_ssid
        );
        EXECUTE sql INTO v_miss_part;
        miss_staging := miss_staging + coalesce(v_miss_part, 0);

        sql := format(
            $dq$
SELECT count(*)
  FROM system.system_remote_review_package_items i
 WHERE i.package_id = %s::bigint
   AND i.entity_family = %L
   AND i.source_table <> %L
$dq$,
            v_pkg_id, r.entity_family, r.staging_table
        );
        EXECUTE sql INTO v_tbl_part;
        bad_expected_table := bad_expected_table + coalesce(v_tbl_part, 0);

        IF r.matched_core_table IS NOT NULL THEN
            sql := format(
                $dq$
SELECT count(*)
  FROM system.system_remote_review_package_items i
 WHERE i.package_id = %s::bigint
   AND i.entity_family = %L
   AND coalesce(trim(i.matched_core_table), '') <> ''
   AND trim(i.matched_core_table) <> %L
$dq$,
                v_pkg_id, r.entity_family, r.matched_core_table
            );
            EXECUTE sql INTO v_core_part;
            bad_core_hint := bad_core_hint + coalesce(v_core_part, 0);
        END IF;

        sql := format(
            $dq$
SELECT count(*) FROM %I.%I sb WHERE sb.source_snapshot_id = %s::bigint
$dq$,
            v_schema, r.staging_table, v_ssid
        );
        EXECUTE sql INTO v_staging_rows;

        sql := format(
            $dq$
SELECT count(*),
       count(*) FILTER (WHERE i.source_refs IS NULL OR i.source_refs = '{}'::jsonb),
       count(*) FILTER (WHERE i.normalized_data IS NULL OR i.normalized_data = '{}'::jsonb),
       count(*) FILTER (WHERE i.remote_candidate_id IS NOT NULL)
  FROM system.system_remote_review_package_items i
 WHERE i.package_id = %s::bigint AND i.entity_family = %L
$dq$,
            v_pkg_id, r.entity_family
        );
        EXECUTE sql INTO v_pkg_items, v_miss_sr, v_miss_nd, v_with_remote;

        sql := format(
            $dq$
SELECT count(*)
  FROM system.system_remote_review_package_items i
 INNER JOIN %I.%I sb
    ON sb.id = i.local_staging_id AND sb.source_snapshot_id = %s::bigint
 WHERE i.package_id = %s::bigint
   AND i.entity_family = %L
   AND nullif(trim(coalesce(i.external_id, '')), '') IS NOT NULL
   AND nullif(trim(coalesce(sb.external_id::text, '')), '') IS NOT NULL
   AND trim(i.external_id) <> trim(sb.external_id::text)
$dq$,
            v_schema, r.staging_table, v_ssid, v_pkg_id, r.entity_family
        );
        EXECUTE sql INTO v_ext_mismatch;

        UPDATE stage14_per_entity
        SET staging_rows = coalesce(v_staging_rows, 0),
            package_items = coalesce(v_pkg_items, 0),
            missing_source_refs = coalesce(v_miss_sr, 0),
            missing_normalized_data = coalesce(v_miss_nd, 0),
            with_remote_candidate_id = coalesce(v_with_remote, 0),
            external_id_mismatch = coalesce(v_ext_mismatch, 0)
        WHERE entity_family = r.entity_family;
    END LOOP;

    -- Unknown entity families in package (not in manifest)
    SELECT count(*) INTO v_miss_part
      FROM system.system_remote_review_package_items i
     WHERE i.package_id = v_pkg_id
       AND i.entity_family NOT IN (SELECT entity_family FROM stage14_family_manifest);
    miss_staging := miss_staging + coalesce(v_miss_part, 0);

    SELECT count(*) FILTER (WHERE i.source_refs IS NULL OR i.source_refs = '{}'::jsonb),
           count(*) FILTER (WHERE i.normalized_data IS NULL OR i.normalized_data = '{}'::jsonb)
      INTO fail_empty_source_refs, fail_empty_normalized_data
      FROM system.system_remote_review_package_items i
     WHERE i.package_id = v_pkg_id;

    SELECT coalesce(sum(pe.external_id_mismatch), 0)::bigint
      INTO warn_ext_mismatch
      FROM stage14_per_entity pe;

    SELECT count(*) INTO bad_conf
      FROM system.system_remote_review_package_items i
     WHERE i.package_id = v_pkg_id
       AND i.confidence_score IS NOT NULL
       AND (i.confidence_score < 0 OR i.confidence_score > 100);

    SELECT count(*) INTO miss_payload_mirror
      FROM system.system_remote_review_package_items i
     WHERE i.package_id = v_pkg_id
       AND (
            coalesce(trim(i.payload ->> 'source_snapshot_version'), '') = ''
         OR coalesce(trim(i.payload ->> 'snapshot_version'), '') = ''
         OR coalesce(trim(i.payload ->> 'source_snapshot_id_local'), '') = ''
         OR trim(i.payload ->> 'source_snapshot_version') <> v_sver
         OR trim(i.payload ->> 'snapshot_version') <> v_sver
         OR NOT (trim(i.payload ->> 'source_snapshot_id_local') ~ '^[-+]?[0-9]+$')
         OR (trim(i.payload ->> 'source_snapshot_id_local'))::bigint <> v_ssid
       );

    SELECT count(*) FILTER (WHERE NULLIF(trim(coalesce(external_id, '')), '') IS NULL)
      INTO warn_ext_blank
      FROM system.system_remote_review_package_items
     WHERE package_id = v_pkg_id;

    SELECT count(*) FILTER (WHERE f2_comparison IS NULL)
      INTO warn_f2_blank
      FROM system.system_remote_review_package_items
     WHERE package_id = v_pkg_id;

    SELECT count(*) FILTER (
            WHERE (
                    matched_core_id IS NULL
                AND NULLIF(trim(coalesce(matched_core_table, '')), '') IS NOT NULL
                )
               OR (
                    matched_core_id IS NOT NULL
                AND NULLIF(trim(coalesce(matched_core_table, '')), '') IS NULL
                )
           )
      INTO warn_matched_xor
      FROM system.system_remote_review_package_items
     WHERE package_id = v_pkg_id;

    IF post_review_batch IS NOT NULL THEN
        SELECT count(*) INTO post_upload_miss
          FROM system.system_remote_review_package_items i
         WHERE i.package_id = v_pkg_id
           AND i.upload_status <> 'skipped'
           AND i.remote_candidate_id IS NULL;
    END IF;

    TRUNCATE _lineage_chk_14;

    INSERT INTO _lineage_chk_14 VALUES
      ('staging_row_missing_or_wrong_snapshot', 'FAIL', miss_staging),
      ('source_table_mismatch_vs_entity_family', 'FAIL', bad_expected_table),
      ('matched_core_table_unexpected_slug', 'FAIL', bad_core_hint),
      ('confidence_score_outside_0_100', 'FAIL', bad_conf),
      ('payload_lineage_mirror_missing_or_drifts', 'FAIL', miss_payload_mirror),
      ('package_items_missing_source_refs', 'FAIL', fail_empty_source_refs),
      ('package_items_missing_normalized_data', 'FAIL', fail_empty_normalized_data),
      ('post_upload_missing_remote_candidate_id', 'FAIL', post_upload_miss);

    INSERT INTO _lineage_chk_14 VALUES
      ('WARN_external_id_blank', 'WARN', warn_ext_blank),
      ('WARN_external_id_staging_mismatch', 'WARN', warn_ext_mismatch),
      ('WARN_f2_comparison_null', 'WARN', warn_f2_blank),
      ('WARN_matched_core_id_vs_table_incoherent', 'WARN', warn_matched_xor);

    RAISE NOTICE '14_verify_lineage_alignment: fail_rows=% warn_rows=% — inspect temp table _lineage_chk_14',
        miss_staging + bad_expected_table + bad_core_hint + bad_conf + miss_payload_mirror + post_upload_miss,
        warn_ext_blank + warn_f2_blank + warn_matched_xor;
END $_14$;

DROP TABLE IF EXISTS _lineage_psql_ctx;

SELECT * FROM _lineage_chk_14 ORDER BY (CASE severity WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END), kind;

\echo ''
\echo Per-entity staging alignment (package items → staging row for snapshot):

SELECT
    'lineage_per_entity'::text AS slice,
    pe.*
FROM stage14_per_entity pe
ORDER BY pe.entity_family;

\echo ''

-- -----------------------------------------------------------------------------
-- README: duplicate these against Supabase (import_review.*) manually.
-- -----------------------------------------------------------------------------
-- BEGIN Supabase lineage spot-check snippets (substitute placeholders):
--
-- Batch row (tie by batch_name === REMOTE_REVIEW_PACKAGE_NAME):
--   SELECT id,
--          batch_name,
--          source_snapshot_version,
--          source_snapshot_id_local,
--          cardinality(entity_families) AS entity_families_card,
--          total_candidate_count,
--          uploaded_candidate_count,
--          status
--     FROM import_review.review_batches
--    WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>'
--    LIMIT 3;
--
-- Required lineage columns on ALL candidates — non-null textual / identity fields:
--   WITH b AS (
--     SELECT id FROM import_review.review_batches
--      WHERE batch_name = '<REMOTE_REVIEW_PACKAGE_NAME>' LIMIT 1
--   ),
--   unioned AS (
--     SELECT 'buildings'::text AS fam,
--            c.source_snapshot_version, c.source_snapshot_id_local, c.entity_family,
--            c.local_staging_id, c.normalized_data, c.source_refs, c.review_batch_id,
--            c.external_id, c.confidence_score, c.f2_comparison
--       FROM import_review.building_candidates c JOIN b ON b.id = c.review_batch_id
--     UNION ALL
--     SELECT 'places'::text AS fam,
--            p.source_snapshot_version, p.source_snapshot_id_local, p.entity_family,
--            p.local_staging_id, p.normalized_data, p.source_refs, p.review_batch_id,
--            p.external_id, p.confidence_score, p.f2_comparison
--       FROM import_review.place_candidates p JOIN b ON b.id = p.review_batch_id
--     UNION ALL
--     SELECT 'roads'::text AS fam,
--            r.source_snapshot_version, r.source_snapshot_id_local, r.entity_family,
--            r.local_staging_id, r.normalized_data, r.source_refs, r.review_batch_id,
--            r.external_id, r.confidence_score, r.f2_comparison
--       FROM import_review.road_candidates r JOIN b ON b.id = r.review_batch_id
--   )
--   SELECT
--     sum((source_snapshot_version IS NULL OR trim(source_snapshot_version) = '')::int)                         AS missing_ssv,
--     sum((source_snapshot_id_local IS NULL)::int)                                                               AS missing_ssid_local,
--     sum((trim(entity_family) = '')::int)                                                                        AS missing_entity_family,
--     sum((normalized_data IS NULL)::int)                                                                        AS nd_null,
--     sum((normalized_data = '{}'::jsonb)::int)                                                                   AS nd_empty_obj,
--     sum((source_refs IS NULL)::int)                                                                            AS sr_null,
--     sum((source_refs = '{}'::jsonb)::int)                                                                     AS sr_empty_obj,
--     sum((confidence_score IS NOT NULL AND (confidence_score < 0 OR confidence_score > 100))::int)                AS bad_confidence
--   FROM unioned;
--
-- WARN-only (often legitimately sparse):
--     sum((external_id IS NULL OR trim(external_id) = '')::int) AS blank_external_id,
--     sum((f2_comparison IS NULL)::int)                           AS blank_f2
--   extend the SELECT above.
--
-- FK alignment: staging id must match `(review_batch_id, local_staging_id, entity_family)`
-- uniqueness in import_review (see irr_*_uniq_* constraints).
-- END Supabase snippets
-- -----------------------------------------------------------------------------

-- Fail the script if any FAIL bucket > 0 (clear EXCEPTION; no bogus integer CAST)
DO $_lineage_guard$
DECLARE
    v_fail_sum bigint;
BEGIN
    SELECT coalesce(sum(qty), 0)::bigint
      INTO STRICT v_fail_sum
      FROM _lineage_chk_14
     WHERE severity = 'FAIL';

    IF v_fail_sum > 0 THEN
        RAISE EXCEPTION
          'LINEAGE_ALIGNMENT_FAIL total_FAIL_qty=% (see preceding SELECT from _lineage_chk_14; re-run Stage J for payload mirrors; verify remote_candidate_id after Stage K)',
            v_fail_sum
            USING ERRCODE = 'P0001';
    END IF;
END $_lineage_guard$;

DROP TABLE IF EXISTS _lineage_chk_14;

\echo Stage 14 lineage alignment complete (local).
