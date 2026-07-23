-- Roads safe loader fixture tests (outer ROLLBACK).
-- Prerequisites: migrations 137 + 144.
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

CREATE TEMP TABLE roads_loader_test_log (
    step text PRIMARY KEY,
    ok boolean NOT NULL,
    detail text
) ON COMMIT DROP;

DO $$
BEGIN
    IF to_regclass('import_work.road_rows') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 144 before roads_safe_loader_tests.sql';
    END IF;
END $$;

DO $$
DECLARE
    v_batch_id bigint;
    v_update_id bigint;
    v_manual_id bigint;
    v_verified_id bigint;
    v_geom_id bigint;
    v_line geometry := ST_SetSRID(ST_GeomFromText('LINESTRING(96.30 16.60, 96.301 16.601)'), 4326);
    v_line2 geometry := ST_SetSRID(ST_GeomFromText('LINESTRING(96.30 16.60, 96.305 16.605)'), 4326);
    v_rc_id bigint;
    v_src_id bigint;
BEGIN
    SELECT id INTO v_rc_id FROM ref.ref_road_classes WHERE code = 'residential' ORDER BY id LIMIT 1;
    IF v_rc_id IS NULL THEN
        SELECT id INTO v_rc_id FROM ref.ref_road_classes ORDER BY id LIMIT 1;
    END IF;
    SELECT id INTO v_src_id FROM ref.ref_source_types WHERE code = 'osm' ORDER BY id LIMIT 1;

    INSERT INTO core.core_streets (
        external_id, canonical_name, geom, source_type_id, road_class_id, road_class,
        surface, is_oneway, bridge, tunnel, layer, source_refs, normalized_data,
        is_active, manual_override, edit_status, routing_status,
        is_verified, verification_status
    ) VALUES
    (
        'osm:way:940000001', 'road-940000001', v_line, v_src_id, v_rc_id, 'residential',
        NULL, false, false, false, 0,
        '{"external_id":"osm:way:940000001","source":"osm"}'::jsonb,
        '{"name_is_generated":true}'::jsonb,
        true, false, 'published', 'current', false, 'unverified'
    ),
    (
        'osm:way:940000002', 'Manual Road', ST_Translate(v_line, 0.01, 0), v_src_id, v_rc_id, 'residential',
        NULL, false, false, false, 0,
        '{"external_id":"osm:way:940000002","source":"dashboard","manual_override":"true"}'::jsonb,
        '{}'::jsonb,
        true, true, 'published', 'current', false, 'unverified'
    ),
    (
        'osm:way:940000003', 'Verified Road', ST_Translate(v_line, 0.02, 0), v_src_id, v_rc_id, 'residential',
        NULL, false, false, false, 0,
        '{"external_id":"osm:way:940000003","source":"osm"}'::jsonb,
        '{}'::jsonb,
        true, false, 'published', 'current', true, 'verified'
    ),
    (
        'osm:way:940000004', 'Geom Move Road', v_line, v_src_id, v_rc_id, 'residential',
        NULL, false, false, false, 0,
        '{"external_id":"osm:way:940000004","source":"osm"}'::jsonb,
        '{}'::jsonb,
        true, false, 'published', 'current', false, 'unverified'
    );

    SELECT id INTO v_update_id FROM core.core_streets WHERE external_id = 'osm:way:940000001';
    SELECT id INTO v_manual_id FROM core.core_streets WHERE external_id = 'osm:way:940000002';
    SELECT id INTO v_verified_id FROM core.core_streets WHERE external_id = 'osm:way:940000003';
    SELECT id INTO v_geom_id FROM core.core_streets WHERE external_id = 'osm:way:940000004';

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'roads_loader_test_batch', 'roads', 12,
        'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
        'loaded', 5, 5, 'passed'
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.road_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id,
        canonical_name, class_code, road_class_id, geom,
        is_oneway, bridge, tunnel, layer, surface,
        source_refs, normalized_data, local_staging_id
    ) VALUES
    (v_batch_id, 12, 'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
     'osm:way:940000010', 'safe_new', NULL, 'New Test Road', 'residential', v_rc_id,
     ST_Translate(v_line, 0.05, 0), false, false, false, 0, 'asphalt',
     '{"source":"osm","region_code":"MM-YANGON"}'::jsonb, '{}'::jsonb, 910),
    (v_batch_id, 12, 'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
     'osm:way:940000001', 'safe_update', v_update_id, 'Main Test Road', 'residential', v_rc_id,
     v_line, false, false, false, 0, 'asphalt',
     '{"source":"osm"}'::jsonb, '{"name_is_generated":false}'::jsonb, 901),
    (v_batch_id, 12, 'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
     'osm:way:940000002', 'safe_update', v_manual_id, 'Manual Road', 'residential', v_rc_id,
     ST_Translate(v_line, 0.01, 0), true, false, false, 0, NULL,
     '{"source":"osm"}'::jsonb, '{}'::jsonb, 902),
    (v_batch_id, 12, 'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
     'osm:way:940000003', 'safe_update', v_verified_id, 'Verified Road', 'residential', v_rc_id,
     ST_Translate(v_line, 0.02, 0), true, false, false, 0, NULL,
     '{"source":"osm"}'::jsonb, '{}'::jsonb, 903),
    (v_batch_id, 12, 'osm_myanmar_2026_07_21_yangon_roads_5k_v1',
     'osm:way:940000004', 'safe_update', v_geom_id, 'Geom Move Road', 'residential', v_rc_id,
     v_line2, false, false, false, 0, NULL,
     '{"source":"osm"}'::jsonb, '{}'::jsonb, 904);

    INSERT INTO roads_loader_test_log VALUES
        ('fixture_seed', true, format('batch=%s', v_batch_id));
END $$;

DROP TABLE IF EXISTS roads_loader_params;
CREATE TEMP TABLE roads_loader_params (
    batch_code text,
    dry_run boolean NOT NULL,
    sample_limit integer NOT NULL DEFAULT 0
) ON COMMIT DROP;

INSERT INTO roads_loader_params VALUES ('roads_loader_test_batch', true, 0);

\ir roads_safe_loader_body.sql

DO $$
DECLARE
    v_insert bigint;
    v_update bigint;
    v_conflict bigint;
BEGIN
    SELECT
        count(*) FILTER (WHERE action = 'insert'),
        count(*) FILTER (WHERE action = 'update'),
        count(*) FILTER (WHERE action = 'conflict_ir')
    INTO v_insert, v_update, v_conflict
    FROM roads_loader_plan;

    IF v_insert <> 1 THEN
        RAISE EXCEPTION 'expected 1 insert, got %', v_insert;
    END IF;
    IF v_update < 1 THEN
        RAISE EXCEPTION 'expected >=1 update (placeholder name / surface), got %', v_update;
    END IF;
    IF v_conflict < 3 THEN
        RAISE EXCEPTION 'expected >=3 conflict_ir (manual/verified/geom), got %', v_conflict;
    END IF;

    INSERT INTO roads_loader_test_log VALUES (
        'plan_actions', true,
        format('insert=%s update=%s conflict=%s', v_insert, v_update, v_conflict)
    );
END $$;

SELECT * FROM roads_loader_test_log ORDER BY step;
\echo 'roads_safe_loader_tests PASS (rolled back)'

ROLLBACK;
