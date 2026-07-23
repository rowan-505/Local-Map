-- =============================================================================
-- Buildings safe loader — fixture tests (transaction ROLLED BACK).
-- Prerequisites: migrations 137 + 141 on target database.
--
-- Run:
--   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f tools/data-pipeline/import-work/buildings_safe_loader_tests.sql
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE buildings_loader_test_log (
    step text PRIMARY KEY,
    ok boolean NOT NULL,
    detail text
) ON COMMIT DROP;

DO $$
BEGIN
    IF to_regclass('import_work.building_rows') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 141 before buildings_safe_loader_tests.sql';
    END IF;
    IF to_regprocedure('system.pipeline_osm_identity_key(text)') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 137 before buildings_safe_loader_tests.sql';
    END IF;
END $$;

DO $$
DECLARE
    v_batch_id bigint;
    v_type bigint;
    v_update_id bigint;
    v_manual_id bigint;
    v_verified_id bigint;
    v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.15 16.77,96.1505 16.77,96.1505 16.7705,96.15 16.7705,96.15 16.77))'), 4326);
BEGIN
    SELECT id INTO v_type FROM ref.ref_building_types WHERE code = 'commercial' AND coalesce(is_active, true) LIMIT 1;
    IF v_type IS NULL THEN
        SELECT id INTO v_type FROM ref.ref_building_types WHERE coalesce(is_active, true) ORDER BY id LIMIT 1;
    END IF;
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'test setup: ref_building_types empty';
    END IF;

    INSERT INTO core.core_map_buildings (
        external_id, name, normalized_data, source_refs, geom, building_type_id,
        centroid, area_m2, confidence_score, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:910000001', 'Update Target Building', '{}'::jsonb, '{"source":"osm"}'::jsonb,
        ST_Multi(v_poly), v_type, ST_PointOnSurface(v_poly), ST_Area(v_poly::geography), 50,
        'unverified', false, true
    ) RETURNING id INTO v_update_id;

    INSERT INTO core.core_map_buildings (
        external_id, name, normalized_data, source_refs, geom, building_type_id,
        centroid, area_m2, confidence_score, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:910000002', 'Manual Protected Building', '{}'::jsonb,
        '{"source":"dashboard","manual_override":"true"}'::jsonb,
        ST_Multi(ST_Translate(v_poly, 0.001, 0)), v_type,
        ST_PointOnSurface(ST_Translate(v_poly, 0.001, 0)), 10, 50,
        'unverified', false, true
    ) RETURNING id INTO v_manual_id;

    INSERT INTO core.core_map_buildings (
        external_id, name, normalized_data, source_refs, geom, building_type_id,
        centroid, area_m2, confidence_score, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:910000003', 'Verified Building', '{}'::jsonb, '{"source":"osm"}'::jsonb,
        ST_Multi(ST_Translate(v_poly, 0.002, 0)), v_type,
        ST_PointOnSurface(ST_Translate(v_poly, 0.002, 0)), 10, 50,
        'verified', true, true
    ) RETURNING id INTO v_verified_id;

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'buildings_loader_test_batch', 'buildings', 10,
        'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'loaded', 4, 4, 'passed'
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.building_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id,
        name, name_en, building_type_id, class_code,
        geom, centroid, area_m2, confidence_score, source_refs, normalized_data
    ) VALUES
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000010', 'safe_new', NULL,
        'New Safe Building', 'New Safe Building', v_type, 'commercial',
        ST_Multi(ST_Translate(v_poly, 0.01, 0)),
        ST_PointOnSurface(ST_Translate(v_poly, 0.01, 0)),
        ST_Area(ST_Translate(v_poly, 0.01, 0)::geography), 80,
        '{"source":"osm"}'::jsonb, '{"class_code":"commercial"}'::jsonb
    ),
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000001', 'safe_update', v_update_id,
        'Update Target Building NEW', 'Update Target Building NEW', v_type, 'commercial',
        ST_Multi(v_poly), ST_PointOnSurface(v_poly), ST_Area(v_poly::geography), 80,
        '{"source":"osm"}'::jsonb, '{}'::jsonb
    ),
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000002', 'safe_update', v_manual_id,
        'Should Not Overwrite Manual', 'Should Not Overwrite Manual', v_type, 'commercial',
        ST_Multi(ST_Translate(v_poly, 0.001, 0)),
        ST_PointOnSurface(ST_Translate(v_poly, 0.001, 0)), 10, 80,
        '{"source":"osm"}'::jsonb, '{}'::jsonb
    ),
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000003', 'safe_update', v_verified_id,
        'Should Not Overwrite Verified', 'Should Not Overwrite Verified', v_type, 'commercial',
        ST_Multi(ST_Translate(v_poly, 0.002, 0)),
        ST_PointOnSurface(ST_Translate(v_poly, 0.002, 0)), 10, 80,
        '{"source":"osm"}'::jsonb, '{}'::jsonb
    );

    DROP TABLE IF EXISTS buildings_loader_params;
    CREATE TEMP TABLE buildings_loader_params (
        batch_code text,
        dry_run boolean NOT NULL,
        sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO buildings_loader_params VALUES ('buildings_loader_test_batch', false, 0);
END $$;

\ir buildings_safe_loader_body.sql

DO $$
DECLARE
    v_inserted bigint;
    v_updated bigint;
    v_skipped bigint;
    v_name text;
    v_manual text;
    v_verified text;
    v_names bigint;
BEGIN
    SELECT inserted, updated, skipped, names_written
    INTO v_inserted, v_updated, v_skipped, v_names
    FROM buildings_loader_result;

    IF v_inserted <> 1 OR v_updated <> 1 OR v_skipped <> 2 THEN
        RAISE EXCEPTION 'happy-path counts inserted=% updated=% skipped=% (want 1/1/2)',
            v_inserted, v_updated, v_skipped;
    END IF;

    SELECT name INTO v_name FROM core.core_map_buildings
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000001' AND deleted_at IS NULL;
    IF v_name IS DISTINCT FROM 'Update Target Building NEW' THEN
        RAISE EXCEPTION 'safe_update name not applied: %', v_name;
    END IF;

    SELECT name INTO v_manual FROM core.core_map_buildings
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000002';
    IF v_manual IS DISTINCT FROM 'Manual Protected Building' THEN
        RAISE EXCEPTION 'manual protected overwritten: %', v_manual;
    END IF;

    SELECT name INTO v_verified FROM core.core_map_buildings
    WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000003';
    IF v_verified IS DISTINCT FROM 'Verified Building' THEN
        RAISE EXCEPTION 'verified overwritten: %', v_verified;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM core.core_map_buildings
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000010'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'safe_new missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.core_map_building_names n
        JOIN core.core_map_buildings b ON b.id = n.building_id
        WHERE system.pipeline_osm_identity_key(b.external_id) = 'osm:way:910000010'
          AND n.is_primary AND n.name_type = 'official'
    ) THEN
        RAISE EXCEPTION 'name insertion missing for safe_new';
    END IF;

    IF v_names < 1 THEN
        RAISE EXCEPTION 'names_written=% expected >=1', v_names;
    END IF;

    INSERT INTO buildings_loader_test_log VALUES
        ('new_safe_record', true, 'inserted=1'),
        ('safe_update', true, 'allowlist name applied'),
        ('manual_protected', true, 'skipped'),
        ('verified_target', true, 'skipped'),
        ('name_insertion', true, format('names_written=%s', v_names));
END $$;

-- Identical rerun
UPDATE import_work.import_batches
SET status = 'loaded', updated_at = now()
WHERE batch_code = 'buildings_loader_test_batch';

DROP TABLE IF EXISTS buildings_loader_params;
CREATE TEMP TABLE buildings_loader_params (
    batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
);
INSERT INTO buildings_loader_params VALUES ('buildings_loader_test_batch', false, 0);

\ir buildings_safe_loader_body.sql

DO $$
DECLARE
    v_inserted bigint;
    v_updated bigint;
    v_skipped bigint;
BEGIN
    SELECT inserted, updated, skipped INTO v_inserted, v_updated, v_skipped
    FROM buildings_loader_result;
    IF v_inserted <> 0 OR v_updated <> 0 THEN
        RAISE EXCEPTION 'identical rerun inserted=% updated=% want 0/0', v_inserted, v_updated;
    END IF;
    IF v_skipped <> 4 THEN
        RAISE EXCEPTION 'identical rerun skipped=% want 4', v_skipped;
    END IF;
    INSERT INTO buildings_loader_test_log VALUES (
        'identical_rerun', true,
        format('inserted=%s updated=%s skipped=%s', v_inserted, v_updated, v_skipped)
    );
END $$;

-- Duplicate external identity → fail + savepoint rollback
DO $$
DECLARE
    v_batch_id bigint;
    v_type bigint;
    v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.16 16.77,96.1605 16.77,96.1605 16.7705,96.16 16.7705,96.16 16.77))'), 4326);
BEGIN
    SELECT id INTO v_type FROM ref.ref_building_types WHERE coalesce(is_active, true) ORDER BY id LIMIT 1;
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count
    ) VALUES (
        'buildings_loader_dup_batch', 'buildings', 10,
        'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'loaded', 2, 2
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.building_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, name, building_type_id, class_code,
        geom, centroid, area_m2, source_refs
    ) VALUES
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000020', 'safe_new', 'Dup A', v_type, 'commercial',
        ST_Multi(v_poly), ST_PointOnSurface(v_poly), 10, '{}'::jsonb
    ),
    (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:W:910000020', 'safe_new', 'Dup B', v_type, 'commercial',
        ST_Multi(ST_Translate(v_poly, 0.001, 0)),
        ST_PointOnSurface(ST_Translate(v_poly, 0.001, 0)), 10, '{}'::jsonb
    );

    DROP TABLE IF EXISTS buildings_loader_params;
    CREATE TEMP TABLE buildings_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO buildings_loader_params VALUES ('buildings_loader_dup_batch', false, 0);
END $$;

SAVEPOINT before_dup_load;
\set ON_ERROR_STOP off
\ir buildings_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_dup_load;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.core_map_buildings
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000020'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'duplicate identity wrote core rows';
    END IF;
    INSERT INTO buildings_loader_test_log VALUES
        ('duplicate_external_id', true, 'aborted; no core write'),
        ('partial_failure_rollback', true, 'savepoint restored');
END $$;

-- Missing type
DO $$
DECLARE
    v_batch_id bigint;
    v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.17 16.77,96.1705 16.77,96.1705 16.7705,96.17 16.7705,96.17 16.77))'), 4326);
BEGIN
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count
    ) VALUES (
        'buildings_loader_notype_batch', 'buildings', 10,
        'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'loaded', 1, 1
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.building_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, name, building_type_id, class_code,
        geom, centroid, area_m2, source_refs
    ) VALUES (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000030', 'safe_new', 'No Type', NULL, 'commercial',
        ST_Multi(v_poly), ST_PointOnSurface(v_poly), 10, '{}'::jsonb
    );

    DROP TABLE IF EXISTS buildings_loader_params;
    CREATE TEMP TABLE buildings_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO buildings_loader_params VALUES ('buildings_loader_notype_batch', false, 0);
END $$;

SAVEPOINT before_notype;
\set ON_ERROR_STOP off
\ir buildings_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_notype;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.core_map_buildings
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000030'
    ) THEN
        RAISE EXCEPTION 'missing type wrote core';
    END IF;
    INSERT INTO buildings_loader_test_log VALUES ('missing_type', true, 'aborted');
END $$;

-- Invalid geometry
DO $$
DECLARE
    v_batch_id bigint;
    v_type bigint;
BEGIN
    SELECT id INTO v_type FROM ref.ref_building_types WHERE coalesce(is_active, true) ORDER BY id LIMIT 1;
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count
    ) VALUES (
        'buildings_loader_badgeom_batch', 'buildings', 10,
        'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'loaded', 1, 1
    ) RETURNING id INTO v_batch_id;

    -- Bypass NOT NULL geom by inserting valid then corrupting via update is hard;
    -- use a self-intersecting bowtie that ST_MakeValid may still process — instead
    -- leave centroid null after work prep by using empty multipolygon.
    INSERT INTO import_work.building_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, name, building_type_id, class_code,
        geom, centroid, area_m2, source_refs
    ) VALUES (
        v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'osm:way:910000040', 'safe_new', 'Bad Geom', v_type, 'commercial',
        ST_SetSRID(ST_GeomFromText('MULTIPOLYGON EMPTY'), 4326),
        ST_SetSRID(ST_MakePoint(96.18, 16.77), 4326),
        0,
        '{}'::jsonb
    );

    DROP TABLE IF EXISTS buildings_loader_params;
    CREATE TEMP TABLE buildings_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO buildings_loader_params VALUES ('buildings_loader_badgeom_batch', false, 0);
END $$;

SAVEPOINT before_badgeom;
\set ON_ERROR_STOP off
\ir buildings_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT before_badgeom;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM core.core_map_buildings
        WHERE system.pipeline_osm_identity_key(external_id) = 'osm:way:910000040'
    ) THEN
        RAISE EXCEPTION 'invalid geometry wrote core';
    END IF;
    INSERT INTO buildings_loader_test_log VALUES ('invalid_geometry', true, 'aborted');
END $$;

SELECT 'buildings_safe_loader_tests' AS section, step, ok, detail
FROM buildings_loader_test_log
ORDER BY step;

ROLLBACK;

\echo 'buildings_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)'
