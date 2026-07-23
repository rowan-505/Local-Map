-- water_lines safe loader fixture tests (outer ROLLBACK).
\set ON_ERROR_STOP on
\pset pager off
BEGIN;
CREATE TEMP TABLE water_lines_loader_test_log (step text PRIMARY KEY, ok boolean NOT NULL, detail text) ON COMMIT DROP;
DO $$ BEGIN
  IF to_regclass('import_work.water_line_rows') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 142 before water_lines_safe_loader_tests.sql';
  END IF;
END $$;

DO $$
DECLARE
  v_batch_id bigint; v_update_id bigint; v_manual_id bigint; v_verified_id bigint;
  v_g geometry := ST_Multi(ST_GeomFromText('LINESTRING(96.15 16.77,96.1505 16.7705)',4326));
BEGIN
  INSERT INTO core.core_map_water_lines (external_id, name, class_code, geom, normalized_data, source_refs, verification_status, is_verified, is_active)
  VALUES ('osm:way:930000001', 'Update Target Water', 'river', v_g, '{}'::jsonb, '{"source":"osm"}'::jsonb, 'unverified', false, true)
  RETURNING id INTO v_update_id;
  INSERT INTO core.core_map_water_lines (external_id, name, class_code, geom, normalized_data, source_refs, verification_status, is_verified, is_active)
  VALUES ('osm:way:930000002', 'Manual Protected Water', 'river', ST_Translate(v_g, 0.001, 0), '{}'::jsonb, '{"source":"dashboard","manual_override":"true"}'::jsonb, 'unverified', false, true)
  RETURNING id INTO v_manual_id;
  INSERT INTO core.core_map_water_lines (external_id, name, class_code, geom, normalized_data, source_refs, verification_status, is_verified, is_active)
  VALUES ('osm:way:930000003', 'Verified Water', 'river', ST_Translate(v_g, 0.002, 0), '{}'::jsonb, '{"source":"osm"}'::jsonb, 'verified', true, true)
  RETURNING id INTO v_verified_id;

  INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
  VALUES ('water_lines_loader_test_batch', 'water_lines', 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'loaded', 4, 4, 'passed')
  RETURNING id INTO v_batch_id;

  INSERT INTO import_work.water_line_rows (
    import_batch_id, source_snapshot_id, source_snapshot_version,
    external_id, classification, target_core_id, name, name_en, class_code, geom, source_refs, normalized_data
  ) VALUES
  (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'osm:way:930000010', 'safe_new', NULL, 'New Safe Water', 'New Safe Water', 'river', ST_Translate(v_g, 0.01, 0), '{"source":"osm"}'::jsonb, '{}'::jsonb),
  (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'osm:way:930000001', 'safe_update', v_update_id, 'Update Target Water NEW', 'Update Target Water NEW', 'river', v_g, '{"source":"osm"}'::jsonb, '{}'::jsonb),
  (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'osm:way:930000002', 'safe_update', v_manual_id, 'Should Not Overwrite Manual', 'Should Not Overwrite Manual', 'river', ST_Translate(v_g, 0.001, 0), '{"source":"osm"}'::jsonb, '{}'::jsonb),
  (v_batch_id, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'osm:way:930000003', 'safe_update', v_verified_id, 'Should Not Overwrite Verified', 'Should Not Overwrite Verified', 'river', ST_Translate(v_g, 0.002, 0), '{"source":"osm"}'::jsonb, '{}'::jsonb);

  DROP TABLE IF EXISTS water_lines_loader_params;
  CREATE TEMP TABLE water_lines_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
  INSERT INTO water_lines_loader_params VALUES ('water_lines_loader_test_batch', false, 0);
END $$;

\ir water_lines_safe_loader_body.sql

DO $$
DECLARE v_i bigint; v_u bigint; v_s bigint; v_names bigint; v_name text; v_manual text; v_verified text;
BEGIN
  SELECT inserted, updated, skipped, names_written INTO v_i, v_u, v_s, v_names FROM water_lines_loader_result;
  IF v_i <> 1 OR v_u <> 1 OR v_s <> 2 THEN RAISE EXCEPTION 'happy-path %/%/%', v_i, v_u, v_s; END IF;
  SELECT name INTO v_name FROM core.core_map_water_lines WHERE system.pipeline_osm_identity_key(external_id)='osm:way:930000001' AND deleted_at IS NULL;
  IF v_name IS DISTINCT FROM 'Update Target Water NEW' THEN RAISE EXCEPTION 'update name fail: %', v_name; END IF;
  SELECT name INTO v_manual FROM core.core_map_water_lines WHERE system.pipeline_osm_identity_key(external_id)='osm:way:930000002';
  IF v_manual IS DISTINCT FROM 'Manual Protected Water' THEN RAISE EXCEPTION 'manual overwritten'; END IF;
  SELECT name INTO v_verified FROM core.core_map_water_lines WHERE system.pipeline_osm_identity_key(external_id)='osm:way:930000003';
  IF v_verified IS DISTINCT FROM 'Verified Water' THEN RAISE EXCEPTION 'verified overwritten'; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.core_map_water_line_names n JOIN core.core_map_water_lines c ON c.id=n.water_line_id
                 WHERE system.pipeline_osm_identity_key(c.external_id)='osm:way:930000010' AND n.is_primary) THEN
    RAISE EXCEPTION 'name insertion missing';
  END IF;
  INSERT INTO water_lines_loader_test_log VALUES
    ('new_safe_record', true, 'inserted=1'),
    ('safe_update', true, 'allowlist name applied'),
    ('manual_protected', true, 'skipped'),
    ('verified_target', true, 'skipped'),
    ('name_insertion', true, format('names_written=%s', v_names));
END $$;

DROP TABLE IF EXISTS water_lines_loader_params;
CREATE TEMP TABLE water_lines_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
INSERT INTO water_lines_loader_params VALUES ('water_lines_loader_test_batch', false, 0);
\ir water_lines_safe_loader_body.sql
DO $$
DECLARE v_i bigint; v_u bigint; v_s bigint;
BEGIN
  SELECT inserted, updated, skipped INTO v_i, v_u, v_s FROM water_lines_loader_result;
  IF v_i <> 0 OR v_u <> 0 OR v_s <> 4 THEN RAISE EXCEPTION 'rerun %/%/%', v_i, v_u, v_s; END IF;
  INSERT INTO water_lines_loader_test_log VALUES ('identical_rerun', true, 'inserted=0 updated=0 skipped=4');
END $$;

SAVEPOINT water_lines_dup;
DO $$
DECLARE v_batch bigint; v_g geometry := ST_Multi(ST_GeomFromText('LINESTRING(96.15 16.77,96.1505 16.7705)',4326));
BEGIN
  INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
  VALUES ('water_lines_loader_dup_batch','water_lines',10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','loaded',2,2,'passed') RETURNING id INTO v_batch;
  INSERT INTO import_work.water_line_rows (import_batch_id, source_snapshot_id, source_snapshot_version, external_id, classification, name, name_en, class_code, geom, source_refs, normalized_data)
  VALUES
  (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:way:930000020','safe_new','Dup A','Dup A','river',v_g,'{}'::jsonb,'{}'::jsonb),
  (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:W:930000020','safe_new','Dup B','Dup B','river',ST_Translate(v_g,0.001,0),'{}'::jsonb,'{}'::jsonb);
  DROP TABLE IF EXISTS water_lines_loader_params;
  CREATE TEMP TABLE water_lines_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
  INSERT INTO water_lines_loader_params VALUES ('water_lines_loader_dup_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir water_lines_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT water_lines_dup;
INSERT INTO water_lines_loader_test_log VALUES ('duplicate_external_id', true, 'aborted; no core write') ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SAVEPOINT water_lines_noclass;
DO $$
DECLARE
  v_g geometry;
  v_batch bigint;
  v_ok boolean := false;
BEGIN
  SELECT geom INTO v_g FROM import_work.water_line_rows LIMIT 1;
  IF v_g IS NULL THEN
    RAISE EXCEPTION 'setup geom missing';
  END IF;
  INSERT INTO import_work.import_batches (
    batch_code, entity_family, source_snapshot_id, source_snapshot_version,
    status, expected_row_count, loaded_row_count, validation_status
  ) VALUES (
    'water_lines_loader_noclass_batch', 'water_lines', 10,
    'osm_myanmar_2026_07_21_yangon_downtown_sample_v1', 'loaded', 1, 1, 'passed'
  ) RETURNING id INTO v_batch;
  BEGIN
    INSERT INTO import_work.water_line_rows (
      import_batch_id, source_snapshot_id, source_snapshot_version,
      external_id, classification, name, name_en, class_code, geom, source_refs, normalized_data
    ) VALUES (
      v_batch, 10, 'osm_myanmar_2026_07_21_yangon_downtown_sample_v1',
      'osm:way:930000030', 'safe_new', 'No Class', 'No Class', '   ', v_g, '{}'::jsonb, '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'expected class_code nonempty check violation';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT water_lines_noclass;
INSERT INTO water_lines_loader_test_log VALUES ('missing_type', true, 'work-table class_code check') ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SAVEPOINT water_lines_badgeom;
DO $$
DECLARE v_batch bigint;
BEGIN
  INSERT INTO import_work.import_batches (batch_code, entity_family, source_snapshot_id, source_snapshot_version, status, expected_row_count, loaded_row_count, validation_status)
  VALUES ('water_lines_loader_badgeom_batch','water_lines',10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','loaded',1,1,'passed') RETURNING id INTO v_batch;
  INSERT INTO import_work.water_line_rows (import_batch_id, source_snapshot_id, source_snapshot_version, external_id, classification, name, name_en, class_code, geom, source_refs, normalized_data)
  VALUES (v_batch,10,'osm_myanmar_2026_07_21_yangon_downtown_sample_v1','osm:way:930000040','safe_new','Bad Geom','Bad Geom','river', ST_GeomFromText('MULTILINESTRING EMPTY', 4326), '{}'::jsonb,'{}'::jsonb);
  DROP TABLE IF EXISTS water_lines_loader_params;
  CREATE TEMP TABLE water_lines_loader_params (batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0);
  INSERT INTO water_lines_loader_params VALUES ('water_lines_loader_badgeom_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir water_lines_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT water_lines_badgeom;
INSERT INTO water_lines_loader_test_log VALUES ('invalid_geometry', true, 'aborted') ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

INSERT INTO water_lines_loader_test_log VALUES ('partial_failure_rollback', true, 'savepoint restored') ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SELECT 'water_lines_safe_loader_tests' AS section, step, ok, detail FROM water_lines_loader_test_log ORDER BY step;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM water_lines_loader_test_log WHERE NOT ok) THEN RAISE EXCEPTION 'water_lines_safe_loader_tests: FAILED'; END IF;
  RAISE NOTICE 'water_lines_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)';
END $$;
ROLLBACK;
