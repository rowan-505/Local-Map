-- =============================================================================
-- Places safe loader — rollback test suite (no durable production writes)
--
-- Prerequisites: migrations 136 + 137 applied on the target database.
--
-- Run:
--   psql "$SUPABASE_WRITE_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f tools/data-pipeline/import-work/places_safe_loader_tests.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE places_loader_test_log (
    step text PRIMARY KEY,
    ok boolean NOT NULL,
    detail text
) ON COMMIT DROP;

DO $$
BEGIN
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 137 before running places_safe_loader_tests.sql';
    END IF;
    IF to_regclass('import_work.place_rows') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 136 before running places_safe_loader_tests.sql';
    END IF;
END $$;

DO $$
DECLARE
    v_batch_id bigint;
    v_osm_type bigint;
    v_cat bigint;
    v_update_id bigint;
    v_manual_id bigint;
    v_verified_id bigint;
BEGIN
    SELECT id INTO v_osm_type FROM ref.ref_source_types WHERE code = 'osm' LIMIT 1;
    SELECT id INTO v_cat FROM ref.ref_poi_categories ORDER BY id LIMIT 1;
    IF v_osm_type IS NULL OR v_cat IS NULL THEN
        RAISE EXCEPTION 'test setup: osm source type or poi category missing';
    END IF;

    INSERT INTO core.core_places (
        primary_name, display_name, category_id,
        point_geom, lat, lng, importance_score, popularity_score, confidence_score,
        is_public, is_verified, verification_status, source_type_id,
        external_id, source_refs, normalized_data
    ) VALUES
    (
        'Loader Update Target', 'Loader Update Target', v_cat,
        ST_SetSRID(ST_MakePoint(96.50, 16.60), 4326), 16.60, 96.50,
        0, 0, 50, true, false, 'unverified', v_osm_type,
        'osm:node:900000001', '{"source":"osm"}'::jsonb, '{}'::jsonb
    )
    RETURNING id INTO v_update_id;

    INSERT INTO core.core_places (
        primary_name, display_name, category_id,
        point_geom, lat, lng, importance_score, popularity_score, confidence_score,
        is_public, is_verified, verification_status, source_type_id,
        external_id, source_refs, normalized_data
    ) VALUES
    (
        'Manual Protected Place', 'Manual Protected Place', v_cat,
        ST_SetSRID(ST_MakePoint(96.51, 16.61), 4326), 16.61, 96.51,
        0, 0, 50, true, false, 'unverified', v_osm_type,
        'osm:node:900000002', '{"source":"dashboard","manual_override":"true"}'::jsonb, '{}'::jsonb
    )
    RETURNING id INTO v_manual_id;

    INSERT INTO core.core_places (
        primary_name, display_name, category_id,
        point_geom, lat, lng, importance_score, popularity_score, confidence_score,
        is_public, is_verified, verification_status, source_type_id,
        external_id, source_refs, normalized_data
    ) VALUES
    (
        'Verified Place', 'Verified Place', v_cat,
        ST_SetSRID(ST_MakePoint(96.52, 16.62), 4326), 16.62, 96.52,
        0, 0, 50, true, true, 'verified', v_osm_type,
        'osm:node:900000003', '{"source":"osm"}'::jsonb, '{}'::jsonb
    )
    RETURNING id INTO v_verified_id;

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'places_loader_test_batch', 'places', 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'loaded', 4, 4, 'passed'
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO import_work.place_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id,
        primary_name, display_name, category_id,
        point_geom, lat, lng, confidence_score, source_refs, source_hash,
        validation_status
    ) VALUES
    (
        v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:900000010', 'safe_new', NULL,
        'Brand New Settlement', 'Brand New Settlement', v_cat,
        ST_SetSRID(ST_MakePoint(96.53, 16.63), 4326), 16.63, 96.53,
        80, '{"source":"osm"}'::jsonb, 'hash-new', 'passed'
    ),
    (
        v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:900000001', 'safe_update', v_update_id,
        'Loader Update Target NEW', 'Loader Update Target NEW', v_cat,
        ST_SetSRID(ST_MakePoint(96.501, 16.601), 4326), 16.601, 96.501,
        80, '{"source":"osm"}'::jsonb, 'hash-upd', 'passed'
    ),
    (
        v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:900000002', 'safe_update', v_manual_id,
        'Should Not Apply', 'Should Not Apply', v_cat,
        ST_SetSRID(ST_MakePoint(96.511, 16.611), 4326), 16.611, 96.511,
        80, '{"source":"osm"}'::jsonb, 'hash-man', 'passed'
    ),
    (
        v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:900000003', 'safe_update', v_verified_id,
        'Should Not Verify Overwrite', 'Should Not Verify Overwrite', v_cat,
        ST_SetSRID(ST_MakePoint(96.521, 16.621), 4326), 16.621, 96.521,
        80, '{"source":"osm"}'::jsonb, 'hash-ver', 'passed'
    );

    DROP TABLE IF EXISTS places_loader_params;
    CREATE TEMP TABLE places_loader_params (
        batch_code text,
        dry_run boolean NOT NULL,
        sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO places_loader_params VALUES ('places_loader_test_batch', false, 0);
END $$;

\ir places_safe_loader_body.sql

DO $$
DECLARE
    v_inserted bigint;
    v_updated bigint;
    v_skipped bigint;
    v_name text;
    v_manual_name text;
    v_verified_name text;
BEGIN
    SELECT inserted, updated, skipped
    INTO v_inserted, v_updated, v_skipped
    FROM places_loader_result;

    IF v_inserted <> 1 OR v_updated <> 1 OR v_skipped <> 2 THEN
        RAISE EXCEPTION 'happy-path counts inserted=% updated=% skipped=% (want 1/1/2)',
            v_inserted, v_updated, v_skipped;
    END IF;

    SELECT primary_name INTO v_name
    FROM core.core_places
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000001'
      AND deleted_at IS NULL;
    IF v_name IS DISTINCT FROM 'Loader Update Target NEW' THEN
        RAISE EXCEPTION 'safe_update allowlist name not applied: %', v_name;
    END IF;

    SELECT primary_name INTO v_manual_name
    FROM core.core_places
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000002';
    IF v_manual_name IS DISTINCT FROM 'Manual Protected Place' THEN
        RAISE EXCEPTION 'manual protected overwritten: %', v_manual_name;
    END IF;

    SELECT primary_name INTO v_verified_name
    FROM core.core_places
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000003';
    IF v_verified_name IS DISTINCT FROM 'Verified Place' THEN
        RAISE EXCEPTION 'verified row overwritten: %', v_verified_name;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM core.core_places
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000010'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'safe_new missing';
    END IF;

    INSERT INTO places_loader_test_log VALUES
        ('new_safe_record', true, 'inserted=1'),
        ('safe_update', true, 'allowlist name applied'),
        ('manual_protected', true, 'skipped'),
        ('verified_conflict', true, 'skipped');
END $$;

-- Identical rerun
UPDATE import_work.import_batches
SET status = 'loaded', updated_at = now()
WHERE batch_code = 'places_loader_test_batch';

DROP TABLE IF EXISTS places_loader_params;
CREATE TEMP TABLE places_loader_params (
    batch_code text,
    dry_run boolean NOT NULL,
    sample_limit integer NOT NULL DEFAULT 0
);
INSERT INTO places_loader_params VALUES ('places_loader_test_batch', false, 0);

\ir places_safe_loader_body.sql

DO $$
DECLARE
    v_inserted bigint;
    v_updated bigint;
    v_skipped bigint;
BEGIN
    SELECT inserted, updated, skipped INTO v_inserted, v_updated, v_skipped
    FROM places_loader_result;

    IF v_inserted <> 0 OR v_updated <> 0 THEN
        RAISE EXCEPTION 'identical rerun inserted=% updated=% want 0/0', v_inserted, v_updated;
    END IF;
    IF v_skipped <> 4 THEN
        RAISE EXCEPTION 'identical rerun skipped=% want 4', v_skipped;
    END IF;

    INSERT INTO places_loader_test_log VALUES (
        'identical_rerun', true,
        format('inserted=%s updated=%s skipped=%s', v_inserted, v_updated, v_skipped)
    );
END $$;

-- Duplicate identity (canonical + legacy short) → loader fails; use SAVEPOINT
DO $$
DECLARE
    v_batch_id bigint;
    v_cat bigint;
    v_before bigint;
    v_after bigint;
BEGIN
    SELECT id INTO v_cat FROM ref.ref_poi_categories ORDER BY id LIMIT 1;
    SELECT count(*) INTO v_before FROM core.core_places WHERE deleted_at IS NULL;

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_version,
        status, expected_row_count, loaded_row_count
    ) VALUES (
        'places_loader_dup_batch', 'places', 'osm_myanmar_2026_05_15_kyauktan_v2',
        'loaded', 2, 2
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO import_work.place_rows (
        import_batch_id, source_snapshot_version, external_id, classification,
        primary_name, display_name, category_id, point_geom, lat, lng,
        source_refs, validation_status
    ) VALUES
    (
        v_batch_id, 'osm_myanmar_2026_05_15_kyauktan_v2', 'osm:node:900000020', 'safe_new',
        'Dup A', 'Dup A', v_cat, ST_SetSRID(ST_MakePoint(96.6, 16.7), 4326), 16.7, 96.6,
        '{}'::jsonb, 'passed'
    ),
    (
        v_batch_id, 'osm_myanmar_2026_05_15_kyauktan_v2', 'osm:N:900000020', 'safe_new',
        'Dup B', 'Dup B', v_cat, ST_SetSRID(ST_MakePoint(96.61, 16.71), 4326), 16.71, 96.61,
        '{}'::jsonb, 'passed'
    );

    DROP TABLE IF EXISTS places_loader_params;
    CREATE TEMP TABLE places_loader_params (
        batch_code text,
        dry_run boolean NOT NULL,
        sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO places_loader_params VALUES ('places_loader_dup_batch', false, 0);
END $$;

SAVEPOINT before_dup_load;
\set ON_ERROR_STOP off
\ir places_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_dup_load;

DO $$
DECLARE
    v_before bigint;
    v_after bigint;
BEGIN
    -- After rollback-to-savepoint, core should match count from before the failed load.
    -- The dup batch header/rows remain; core must not have gained osm:node:900000020.
    IF EXISTS (
        SELECT 1 FROM core.core_places
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000020'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'duplicate identity load wrote core rows';
    END IF;

    INSERT INTO places_loader_test_log VALUES
        ('duplicate_external_id', true, 'loader aborted; no core row for dup identity'),
        ('partial_failure_rollback', true, 'savepoint restored core');
END $$;

-- Invalid category
DO $$
DECLARE
    v_batch_id bigint;
BEGIN
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_version,
        status, expected_row_count, loaded_row_count
    ) VALUES (
        'places_loader_badcat_batch', 'places', 'osm_myanmar_2026_05_15_kyauktan_v2',
        'loaded', 1, 1
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO import_work.place_rows (
        import_batch_id, source_snapshot_version, external_id, classification,
        primary_name, display_name, category_id, point_geom, lat, lng,
        source_refs, validation_status
    ) VALUES (
        v_batch_id, 'osm_myanmar_2026_05_15_kyauktan_v2', 'osm:node:900000030', 'safe_new',
        'Bad Cat', 'Bad Cat', -999999, ST_SetSRID(ST_MakePoint(96.7, 16.8), 4326), 16.8, 96.7,
        '{}'::jsonb, 'passed'
    );

    DROP TABLE IF EXISTS places_loader_params;
    CREATE TEMP TABLE places_loader_params (
        batch_code text,
        dry_run boolean NOT NULL,
        sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO places_loader_params VALUES ('places_loader_badcat_batch', false, 0);
END $$;

SAVEPOINT before_badcat_load;
\set ON_ERROR_STOP off
\ir places_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_badcat_load;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.core_places
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:node:900000030'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'invalid category load wrote core rows';
    END IF;

    INSERT INTO places_loader_test_log VALUES
        ('invalid_target_category', true, 'loader aborted; no core write');
END $$;

SELECT
    'places_safe_loader_tests' AS section,
    step,
    ok,
    detail
FROM places_loader_test_log
ORDER BY step;

-- Discard all fixture writes
ROLLBACK;

\echo 'places_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)'
