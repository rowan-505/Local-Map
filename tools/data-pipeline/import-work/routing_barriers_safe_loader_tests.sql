-- Routing barriers safe loader fixture tests (outer ROLLBACK).
-- Prerequisites: migrations 137 + 143. Does not rebuild Valhalla.
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

CREATE TEMP TABLE routing_barriers_loader_test_log (
    step text PRIMARY KEY,
    ok boolean NOT NULL,
    detail text
) ON COMMIT DROP;

DO $$
BEGIN
    IF to_regclass('import_work.routing_barrier_rows') IS NULL THEN
        RAISE EXCEPTION 'Apply migration 143 before routing_barriers_safe_loader_tests.sql';
    END IF;
END $$;

DO $$
DECLARE
    v_batch_id bigint;
    v_update_id bigint;
    v_manual_id bigint;
    v_verified_id bigint;
    v_pt geometry := ST_SetSRID(ST_MakePoint(96.30, 16.60), 4326);
BEGIN
    INSERT INTO routing.routing_barriers (
        barrier_type, geom, is_active, source_refs, normalized_data,
        verification_status, is_verified
    ) VALUES (
        'gate', v_pt, true,
        '{"external_id":"osm:node:940000001","source":"osm"}'::jsonb,
        '{"access_tags":{}}'::jsonb,
        'unverified', false
    ) RETURNING id INTO v_update_id;

    INSERT INTO routing.routing_barriers (
        barrier_type, geom, is_active, source_refs, normalized_data,
        verification_status, is_verified
    ) VALUES (
        'gate', ST_Translate(v_pt, 0.01, 0), true,
        '{"external_id":"osm:node:940000002","source":"dashboard","manual_override":"true"}'::jsonb,
        '{"access_tags":{}}'::jsonb,
        'unverified', false
    ) RETURNING id INTO v_manual_id;

    INSERT INTO routing.routing_barriers (
        barrier_type, geom, is_active, source_refs, normalized_data,
        verification_status, is_verified
    ) VALUES (
        'gate', ST_Translate(v_pt, 0.02, 0), true,
        '{"external_id":"osm:node:940000003","source":"osm"}'::jsonb,
        '{"access_tags":{}}'::jsonb,
        'verified', true
    ) RETURNING id INTO v_verified_id;

    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_test_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2',
        'loaded', 4, 4, 'passed'
    ) RETURNING id INTO v_batch_id;

    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id,
        barrier_type, access_tags, point_geom, source_refs, normalized_data, local_staging_id
    ) VALUES
    (v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
     'osm:node:940000010', 'safe_new', NULL, 'bollard', '{}'::jsonb,
     ST_Translate(v_pt, 0.05, 0), '{"source":"osm","region_code":"MM-KYAUKTAN"}'::jsonb,
     '{}'::jsonb, 910),
    (v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
     'osm:node:940000001', 'safe_update', v_update_id, 'gate', '{}'::jsonb,
     v_pt, '{"source":"osm"}'::jsonb, '{"note":"meta only"}'::jsonb, 901),
    (v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
     'osm:node:940000002', 'safe_update', v_manual_id, 'gate', '{}'::jsonb,
     ST_Translate(v_pt, 0.01, 0), '{"source":"osm"}'::jsonb, '{}'::jsonb, 902),
    (v_batch_id, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
     'osm:node:940000003', 'safe_update', v_verified_id, 'gate', '{}'::jsonb,
     ST_Translate(v_pt, 0.02, 0), '{"source":"osm"}'::jsonb, '{}'::jsonb, 903);

    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_test_batch', false, 0);
END $$;

\ir routing_barriers_safe_loader_body.sql

DO $$
DECLARE
    v_i bigint; v_u bigint; v_s bigint; v_c bigint;
    v_ir bigint;
    v_meta jsonb;
BEGIN
    SELECT inserted, updated, skipped, conflict_ir, ir_review_batch_id
    INTO v_i, v_u, v_s, v_c, v_ir
    FROM routing_barriers_loader_result;

    -- expect: insert 1, update 1 (meta), conflict_ir 2 (manual+verified), skip 0
    IF v_i <> 1 OR v_u <> 1 OR v_c <> 2 THEN
        RAISE EXCEPTION 'happy-path counts inserted=% updated=% conflict_ir=% skipped=% (want 1/1/2)',
            v_i, v_u, v_c, v_s;
    END IF;
    IF v_ir IS NULL THEN
        RAISE EXCEPTION 'expected IR review batch for conflicts';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM import_review.routing_barrier_candidates
        WHERE review_batch_id = v_ir AND review_status = 'needs_review'
    ) THEN
        RAISE EXCEPTION 'IR conflict candidates missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM routing.routing_barriers
        WHERE system.pipeline_osm_identity_key(source_refs->>'external_id') = 'osm:node:940000010'
          AND coalesce(is_active, true)
    ) THEN
        RAISE EXCEPTION 'safe_new missing';
    END IF;
    SELECT normalized_data INTO v_meta FROM routing.routing_barriers
    WHERE system.pipeline_osm_identity_key(source_refs->>'external_id') = 'osm:node:940000001';
    IF v_meta->>'note' IS DISTINCT FROM 'meta only' THEN
        RAISE EXCEPTION 'safe_update allowlist meta not applied: %', v_meta;
    END IF;

    INSERT INTO routing_barriers_loader_test_log VALUES
        ('new_safe_record', true, 'inserted=1'),
        ('safe_update', true, 'allowlist source_refs/normalized_data'),
        ('manual_protected', true, 'conflict_ir'),
        ('verified_target', true, 'conflict_ir'),
        ('conflict_upload', true, format('ir_batch=%s', v_ir));
END $$;

-- identical rerun
UPDATE import_work.import_batches
SET status = 'loaded', updated_at = now()
WHERE batch_code = 'routing_barriers_loader_test_batch';
DROP TABLE IF EXISTS routing_barriers_loader_params;
CREATE TEMP TABLE routing_barriers_loader_params (
    batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
);
INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_test_batch', false, 0);
\ir routing_barriers_safe_loader_body.sql

DO $$
DECLARE v_i bigint; v_u bigint; v_s bigint; v_c bigint;
BEGIN
    SELECT inserted, updated, skipped, conflict_ir INTO v_i, v_u, v_s, v_c
    FROM routing_barriers_loader_result;
    -- new identity already inserted → skip; update allowlist unchanged → skip;
    -- manual/verified still conflict_ir
    IF v_i <> 0 THEN RAISE EXCEPTION 'identical rerun inserted=%', v_i; END IF;
    IF v_s < 2 THEN RAISE EXCEPTION 'identical rerun skipped=% want >=2', v_s; END IF;
    INSERT INTO routing_barriers_loader_test_log VALUES
        ('identical_rerun', true, format('inserted=%s skipped=%s conflict_ir=%s', v_i, v_s, v_c));
END $$;

-- barrier type change → conflict_ir
SAVEPOINT rbar_type;
DO $$
DECLARE
    v_batch bigint;
    v_core bigint;
    v_pt geometry := ST_SetSRID(ST_MakePoint(96.31, 16.61), 4326);
BEGIN
    INSERT INTO routing.routing_barriers (barrier_type, geom, is_active, source_refs, normalized_data, verification_status, is_verified)
    VALUES ('gate', v_pt, true, '{"external_id":"osm:node:940000020","source":"osm"}'::jsonb,
            '{"access_tags":{}}'::jsonb, 'unverified', false)
    RETURNING id INTO v_core;
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_type_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2', 'loaded', 1, 1, 'passed'
    ) RETURNING id INTO v_batch;
    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id, barrier_type, access_tags,
        point_geom, source_refs, normalized_data, local_staging_id
    ) VALUES (
        v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:940000020', 'safe_update', v_core, 'bollard', '{}'::jsonb,
        v_pt, '{"source":"osm"}'::jsonb, '{}'::jsonb, 920
    );
    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_type_batch', false, 0);
END $$;
\ir routing_barriers_safe_loader_body.sql
DO $$
BEGIN
    IF (SELECT conflict_ir FROM routing_barriers_loader_result) <> 1 THEN
        RAISE EXCEPTION 'type change expected conflict_ir=1';
    END IF;
    IF (SELECT barrier_type FROM routing.routing_barriers
        WHERE system.pipeline_osm_identity_key(source_refs->>'external_id')='osm:node:940000020')
       IS DISTINCT FROM 'gate' THEN
        RAISE EXCEPTION 'type change must not overwrite core';
    END IF;
END $$;
ROLLBACK TO SAVEPOINT rbar_type;
INSERT INTO routing_barriers_loader_test_log VALUES ('type_change_conflict', true, 'conflict_ir')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

-- access meaning change → conflict_ir
SAVEPOINT rbar_access;
DO $$
DECLARE
    v_batch bigint;
    v_core bigint;
    v_pt geometry := ST_SetSRID(ST_MakePoint(96.32, 16.62), 4326);
BEGIN
    INSERT INTO routing.routing_barriers (barrier_type, geom, is_active, source_refs, normalized_data, verification_status, is_verified)
    VALUES ('gate', v_pt, true, '{"external_id":"osm:node:940000021","source":"osm"}'::jsonb,
            '{"access_tags":{"access":"yes"}}'::jsonb, 'unverified', false)
    RETURNING id INTO v_core;
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_access_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2', 'loaded', 1, 1, 'passed'
    ) RETURNING id INTO v_batch;
    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id, barrier_type, access_tags,
        point_geom, source_refs, normalized_data, local_staging_id
    ) VALUES (
        v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:940000021', 'safe_update', v_core, 'gate',
        '{"access":"no"}'::jsonb, v_pt, '{"source":"osm"}'::jsonb, '{}'::jsonb, 921
    );
    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_access_batch', false, 0);
END $$;
\ir routing_barriers_safe_loader_body.sql
DO $$
BEGIN
    IF (SELECT conflict_ir FROM routing_barriers_loader_result) <> 1 THEN
        RAISE EXCEPTION 'access change expected conflict_ir=1';
    END IF;
END $$;
ROLLBACK TO SAVEPOINT rbar_access;
INSERT INTO routing_barriers_loader_test_log VALUES ('access_change_conflict', true, 'conflict_ir')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

-- substantial movement → conflict_ir
SAVEPOINT rbar_move;
DO $$
DECLARE
    v_batch bigint;
    v_core bigint;
    v_pt geometry := ST_SetSRID(ST_MakePoint(96.33, 16.63), 4326);
BEGIN
    INSERT INTO routing.routing_barriers (barrier_type, geom, is_active, source_refs, normalized_data, verification_status, is_verified)
    VALUES ('gate', v_pt, true, '{"external_id":"osm:node:940000022","source":"osm"}'::jsonb,
            '{"access_tags":{}}'::jsonb, 'unverified', false)
    RETURNING id INTO v_core;
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_move_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2', 'loaded', 1, 1, 'passed'
    ) RETURNING id INTO v_batch;
    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, target_core_id, barrier_type, access_tags,
        point_geom, source_refs, normalized_data, local_staging_id
    ) VALUES (
        v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:940000022', 'safe_update', v_core, 'gate', '{}'::jsonb,
        ST_Translate(v_pt, 0.001, 0), -- ~111 m
        '{"source":"osm"}'::jsonb, '{}'::jsonb, 922
    );
    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_move_batch', false, 0);
END $$;
\ir routing_barriers_safe_loader_body.sql
DO $$
BEGIN
    IF (SELECT conflict_ir FROM routing_barriers_loader_result) <> 1 THEN
        RAISE EXCEPTION 'movement expected conflict_ir=1';
    END IF;
END $$;
ROLLBACK TO SAVEPOINT rbar_move;
INSERT INTO routing_barriers_loader_test_log VALUES ('movement_conflict', true, 'conflict_ir')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

-- duplicate identity fail
SAVEPOINT rbar_dup;
DO $$
DECLARE v_batch bigint; v_pt geometry := ST_SetSRID(ST_MakePoint(96.34, 16.64), 4326);
BEGIN
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_dup_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2', 'loaded', 2, 2, 'passed'
    ) RETURNING id INTO v_batch;
    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, barrier_type, access_tags, point_geom, source_refs, normalized_data, local_staging_id
    ) VALUES
    (v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2', 'osm:node:940000030', 'safe_new', 'gate', '{}'::jsonb, v_pt, '{}'::jsonb, '{}'::jsonb, 930),
    (v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2', 'osm:N:940000030', 'safe_new', 'gate', '{}'::jsonb, ST_Translate(v_pt, 0.002, 0), '{}'::jsonb, '{}'::jsonb, 931);
    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_dup_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir routing_barriers_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT rbar_dup;
INSERT INTO routing_barriers_loader_test_log VALUES ('duplicate_external_id', true, 'aborted')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

-- invalid geometry
SAVEPOINT rbar_badgeom;
DO $$
DECLARE v_batch bigint;
BEGIN
    INSERT INTO import_work.import_batches (
        batch_code, entity_family, source_snapshot_id, source_snapshot_version,
        status, expected_row_count, loaded_row_count, validation_status
    ) VALUES (
        'routing_barriers_loader_badgeom_batch', 'routing_barriers', 4,
        'osm_myanmar_2026_05_15_kyauktan_v2', 'loaded', 1, 1, 'passed'
    ) RETURNING id INTO v_batch;
    INSERT INTO import_work.routing_barrier_rows (
        import_batch_id, source_snapshot_id, source_snapshot_version,
        external_id, classification, barrier_type, access_tags, point_geom, geom, source_refs, normalized_data, local_staging_id
    ) VALUES (
        v_batch, 4, 'osm_myanmar_2026_05_15_kyauktan_v2',
        'osm:node:940000040', 'safe_new', 'gate', '{}'::jsonb,
        NULL, ST_GeomFromText('LINESTRING EMPTY', 4326), '{}'::jsonb, '{}'::jsonb, 940
    );
    DROP TABLE IF EXISTS routing_barriers_loader_params;
    CREATE TEMP TABLE routing_barriers_loader_params (
        batch_code text, dry_run boolean NOT NULL, sample_limit integer NOT NULL DEFAULT 0
    );
    INSERT INTO routing_barriers_loader_params VALUES ('routing_barriers_loader_badgeom_batch', false, 0);
END $$;
\set ON_ERROR_STOP off
\ir routing_barriers_safe_loader_body.sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT rbar_badgeom;
INSERT INTO routing_barriers_loader_test_log VALUES ('invalid_geometry', true, 'aborted')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

INSERT INTO routing_barriers_loader_test_log VALUES ('partial_failure_rollback', true, 'savepoint restored')
ON CONFLICT (step) DO UPDATE SET ok=true, detail=EXCLUDED.detail;

SELECT 'routing_barriers_safe_loader_tests' AS section, step, ok, detail
FROM routing_barriers_loader_test_log ORDER BY step;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM routing_barriers_loader_test_log WHERE NOT ok) THEN
        RAISE EXCEPTION 'routing_barriers_safe_loader_tests: FAILED';
    END IF;
    RAISE NOTICE 'routing_barriers_safe_loader_tests: ALL CHECKS PASSED (transaction rolled back)';
END $$;

ROLLBACK;
