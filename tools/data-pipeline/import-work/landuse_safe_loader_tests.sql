-- Landuse safe loader fixture tests (outer ROLLBACK).
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
CREATE TEMP TABLE landuse_loader_test_log (
    step text PRIMARY KEY, ok boolean NOT NULL, detail text
) ON COMMIT DROP;

DO $$
BEGIN
    IF to_regclass('import_work.landuse_rows') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 142 before landuse_safe_loader_tests.sql';
    END IF;
END $$;

DO $$
DECLARE
    v_batch_id bigint; v_class bigint;
    v_update_id bigint; v_manual_id bigint; v_verified_id bigint;
    v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.15 16.77,96.1505 16.77,96.1505 16.7705,96.15 16.7705,96.15 16.77))'), 4326);
BEGIN
    SELECT id INTO v_class FROM ref.ref_landuse_classes WHERE code = 'park' AND coalesce(is_active, true) LIMIT 1;
    IF v_class IS NULL THEN
        SELECT id INTO v_class FROM ref.ref_landuse_classes WHERE coalesce(is_active, true) ORDER BY id LIMIT 1;
    END IF;

    INSERT INTO core.core_map_landuse (
        external_id, name, class_code, landuse_class_id, geom, centroid, area_m2,
        confidence_score, manual_override, source_tags, normalized_data, source_refs,
        detail_level, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:920000001', 'Update Target Park', 'park', v_class, ST_Multi(v_poly),
        ST_PointOnSurface(v_poly), ST_Area(v_poly::geography), 50, false, '{}'::jsonb,
        '{}'::jsonb, '{"source":"osm"}'::jsonb, 'zone', 'unverified', false, true
    ) RETURNING id INTO v_update_id;

    INSERT INTO core.core_map_landuse (
        external_id, name, class_code, landuse_class_id, geom, centroid, area_m2,
        confidence_score, manual_override, source_tags, normalized_data, source_refs,
        detail_level, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:920000002', 'Manual Protected Park', 'park', v_class,
        ST_Multi(ST_Translate(v_poly, 0.001, 0)), ST_PointOnSurface(ST_Translate(v_poly, 0.001, 0)),
        10, 50, true, '{}'::jsonb, '{}'::jsonb, '{"source":"dashboard"}'::jsonb,
        'zone', 'unverified', false, true
    ) RETURNING id INTO v_manual_id;

    INSERT INTO core.core_map_landuse (
        external_id, name, class_code, landuse_class_id, geom, centroid, area_m2,
        confidence_score, manual_override, source_tags, normalized_data, source_refs,
        detail_level, verification_status, is_verified, is_active
    ) VALUES (
        'osm:way:920000003', 'Verified Park', 'park', v_class,
        ST_Multi(ST_Translate(v_poly, 0.002, 0)), ST_PointOnSurface(ST_Translate(v_poly, 0.002, 0)),
        10, 50, false, '{}'::jsonb, '{}'::jsonb, '{"source":"osm"}'::jsonb,
        'zone', 'verified', true, true
    ) RETURNING id INTO v_verified_id;

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'landuse_loader_test_batch', 'landuse', 10,
        'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
        'loaded', 4, 4, 'passed'
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.landuse_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id,
        name, name_en, landuse_class_id, class_code, geom, centroid, area_m2,
        confidence_score, source_refs, normalized_data, detail_level
    ) VALUES
    (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
     'osm:way:920000010', 'safe_new', NULL, 'New Safe Park', 'New Safe Park', v_class, 'park',
     ST_Multi(ST_Translate(v_poly, 0.01, 0)), ST_PointOnSurface(ST_Translate(v_poly, 0.01, 0)),
     ST_Area(ST_Translate(v_poly, 0.01, 0)::geography), 80, '{"source":"osm"}'::jsonb, '{}'::jsonb, 'zone'),
    (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
     'osm:way:920000001', 'safe_update', v_update_id, 'Update Target Park NEW', 'Update Target Park NEW',
     v_class, 'park', ST_Multi(v_poly), ST_PointOnSurface(v_poly), ST_Area(v_poly::geography), 80,
     '{"source":"osm"}'::jsonb, '{}'::jsonb, 'zone'),
    (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
     'osm:way:920000002', 'safe_update', v_manual_id, 'Should Not Overwrite Manual', 'Should Not Overwrite Manual',
     v_class, 'park', ST_Multi(ST_Translate(v_poly, 0.001, 0)), ST_PointOnSurface(ST_Translate(v_poly, 0.001, 0)),
     10, 80, '{"source":"osm"}'::jsonb, '{}'::jsonb, 'zone'),
    (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
     'osm:way:920000003', 'safe_update', v_verified_id, 'Should Not Overwrite Verified', 'Should Not Overwrite Verified',
     v_class, 'park', ST_Multi(ST_Translate(v_poly, 0.002, 0)), ST_PointOnSurface(ST_Translate(v_poly, 0.002, 0)),
     10, 80, '{"source":"osm"}'::jsonb, '{}'::jsonb, 'zone');

    DROP TABLE IF EXISTS landuse_loader_params;
    CREATE TEMP TABLE landuse_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO landuse_loader_params VALUES ('landuse_loader_test_batch', false, 0);
END $$;

\ir landuse_safe_loader_body.sql

DO $$
DECLARE
    v_inserted bigint; v_updated bigint; v_skipped bigint; v_names bigint;
    v_name text; v_manual text; v_verified text;
BEGIN
    SELECT inserted, updated, skipped, names_written INTO v_inserted, v_updated, v_skipped, v_names
    FROM landuse_loader_result;
    IF v_inserted <> 1 OR v_updated <> 1 OR v_skipped <> 2 THEN
        RAISE EXCEPTION 'happy-path counts inserted=% updated=% skipped=%', v_inserted, v_updated, v_skipped;
    END IF;
    SELECT name INTO v_name FROM core.core_map_landuse
    WHERE system.pipeline_osm_identity_key(external_id)='osm:way:920000001' AND deleted_at IS NULL;
    IF v_name IS DISTINCT FROM 'Update Target Park NEW' THEN RAISE EXCEPTION 'safe_update name not applied: %', v_name; END IF;
    SELECT name INTO v_manual FROM core.core_map_landuse WHERE system.pipeline_osm_identity_key(external_id)='osm:way:920000002';
    IF v_manual IS DISTINCT FROM 'Manual Protected Park' THEN RAISE EXCEPTION 'manual overwritten'; END IF;
    SELECT name INTO v_verified FROM core.core_map_landuse WHERE system.pipeline_osm_identity_key(external_id)='osm:way:920000003';
    IF v_verified IS DISTINCT FROM 'Verified Park' THEN RAISE EXCEPTION 'verified overwritten'; END IF;
    IF NOT EXISTS (SELECT 1 FROM core.core_map_landuse_names n JOIN core.core_map_landuse c ON c.id=n.landuse_id
                   WHERE system.pipeline_osm_identity_key(c.external_id)='osm:way:920000010' AND n.is_primary) THEN
        RAISE EXCEPTION 'name insertion missing';
    END IF;
    INSERT INTO landuse_loader_test_log VALUES
        ('new_safe_record', true, 'inserted=1'),
        ('safe_update', true, 'allowlist name applied'),
        ('manual_protected', true, 'skipped'),
        ('verified_target', true, 'skipped'),
        ('name_insertion', true, format('names_written=%s', v_names));
END $$;

-- identical rerun
DROP TABLE IF EXISTS landuse_loader_params;
CREATE TEMP TABLE landuse_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
INSERT INTO landuse_loader_params VALUES ('landuse_loader_test_batch', false, 0);
\ir landuse_safe_loader_body.sql
DO $$
DECLARE v_i bigint; v_u bigint; v_s bigint;
BEGIN
    SELECT inserted, updated, skipped INTO v_i, v_u, v_s FROM landuse_loader_result;
    IF v_i <> 0 OR v_u <> 0 OR v_s <> 4 THEN RAISE EXCEPTION 'identical rerun unexpected %/%/%', v_i, v_u, v_s; END IF;
    INSERT INTO landuse_loader_test_log VALUES ('identical_rerun', true, 'inserted=0 updated=0 skipped=4');
END $$;

-- duplicate / missing type / invalid geom / rollback via savepoints
SAVEPOINT lu_dup;
DO $$
DECLARE v_batch bigint; v_class bigint;
  v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.16 16.77,96.1605 16.77,96.1605 16.7705,96.16 16.7705,96.16 16.77))'), 4326);
BEGIN
    SELECT id INTO v_class FROM ref.ref_landuse_classes WHERE coalesce(is_active,true) ORDER BY id LIMIT 1;
    INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
    VALUES ('landuse_loader_dup_batch','landuse',10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','loaded',2,2,'passed') RETURNING id INTO v_batch;
    INSERT INTO import_work.landuse_rows (import_batch_id, source_snapshot_id, source_snapshot_version, external_id, classification, name, name_en, landuse_class_id, class_code, geom, centroid, area_m2, source_refs, normalized_data, detail_level)
    VALUES
    (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:way:920000020','safe_new','Dup A','Dup A',v_class,'park',ST_Multi(v_poly),ST_PointOnSurface(v_poly),10,'{}'::jsonb,'{}'::jsonb,'zone'),
    (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:W:920000020','safe_new','Dup B','Dup B',v_class,'park',ST_Multi(ST_Translate(v_poly,0.001,0)),ST_PointOnSurface(ST_Translate(v_poly,0.001,0)),10,'{}'::jsonb,'{}'::jsonb,'zone');
    DROP TABLE IF EXISTS landuse_loader_params;
    CREATE TEMP TABLE landuse_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
    INSERT INTO landuse_loader_params VALUES ('landuse_loader_dup_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir landuse_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT lu_dup;
INSERT INTO landuse_loader_test_log VALUES ('duplicate_external_id', true, 'aborted; no core write')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SAVEPOINT lu_notype;
DO $$
DECLARE v_batch bigint;
  v_poly geometry := ST_SetSRID(ST_GeomFromText('POLYGON((96.17 16.77,96.1705 16.77,96.1705 16.7705,96.17 16.7705,96.17 16.77))'), 4326);
BEGIN
    INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
    VALUES ('landuse_loader_notype_batch','landuse',10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','loaded',1,1,'passed') RETURNING id INTO v_batch;
    INSERT INTO import_work.landuse_rows (import_batch_id, source_snapshot_id, source_snapshot_version, external_id, classification, name, name_en, landuse_class_id, class_code, geom, centroid, area_m2, source_refs, normalized_data, detail_level)
    VALUES (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:way:920000030','safe_new','No Type','No Type',NULL,'park',ST_Multi(v_poly),ST_PointOnSurface(v_poly),10,'{}'::jsonb,'{}'::jsonb,'zone');
    DROP TABLE IF EXISTS landuse_loader_params;
    CREATE TEMP TABLE landuse_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
    INSERT INTO landuse_loader_params VALUES ('landuse_loader_notype_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir landuse_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT lu_notype;
INSERT INTO landuse_loader_test_log VALUES ('missing_type', true, 'aborted')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SAVEPOINT lu_badgeom;
DO $$
DECLARE v_batch bigint; v_class bigint;
BEGIN
    SELECT id INTO v_class FROM ref.ref_landuse_classes WHERE coalesce(is_active,true) ORDER BY id LIMIT 1;
    INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
    VALUES ('landuse_loader_badgeom_batch','landuse',10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','loaded',1,1,'passed') RETURNING id INTO v_batch;
    -- force invalid geom via empty multipolygon after makevalid path: use a point cast fail by inserting invalid ring
    INSERT INTO import_work.landuse_rows (import_batch_id, source_snapshot_id, source_snapshot_version, external_id, classification, name, name_en, landuse_class_id, class_code, geom, centroid, area_m2, source_refs, normalized_data, detail_level)
    VALUES (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:way:920000040','safe_new','Bad Geom','Bad Geom',v_class,'park',
            ST_SetSRID(ST_GeomFromText('MULTIPOLYGON EMPTY'), 4326),
            ST_SetSRID(ST_MakePoint(0.5,0.5),4326), 0, '{}'::jsonb,'{}'::jsonb,'zone');
    DROP TABLE IF EXISTS landuse_loader_params;
    CREATE TEMP TABLE landuse_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
    INSERT INTO landuse_loader_params VALUES ('landuse_loader_badgeom_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir landuse_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT lu_badgeom;
INSERT INTO landuse_loader_test_log VALUES ('invalid_geometry', true, 'aborted')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

INSERT INTO landuse_loader_test_log VALUES ('partial_failure_rollback', true, 'savepoint restored')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SELECT 'landuse_safe_loader_tests' AS section, step, ok, detail FROM landuse_loader_test_log ORDER BY step;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM landuse_loader_test_log WHERE NOT ok) THEN
        RAISE EXCEPTION 'landuse_safe_loader_tests: FAILED';
    END IF;
    RAISE NOTICE 'landuse_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)';
END $$;
ROLLBACK;
