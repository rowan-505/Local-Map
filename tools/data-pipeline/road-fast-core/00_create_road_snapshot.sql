-- =============================================================================
-- Stage 00: create_road_snapshot
-- Whole-country Myanmar road import (no boundary_id).
--
-- psql variables: source_code, batch_name, snapshot_ref, snapshot_version, checksum
-- region_code is accepted for logging only; snapshot region is always MM.
--
-- Ensures ref.ref_source_types (osm) and system.system_source_registry (:source_code).
-- Creates or reuses batch + snapshot by snapshot_version.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE pipeline_params (
    source_code text NOT NULL,
    batch_name text NOT NULL,
    snapshot_ref text NOT NULL,
    snapshot_version text NOT NULL,
    checksum text
) ON COMMIT DROP;

INSERT INTO pipeline_params (source_code, batch_name, snapshot_ref, snapshot_version, checksum)
VALUES (
    NULLIF(btrim(:'source_code'), ''),
    NULLIF(btrim(:'batch_name'), ''),
    NULLIF(btrim(:'snapshot_ref'), ''),
    NULLIF(btrim(:'snapshot_version'), ''),
    NULLIF(btrim(:'checksum'), '')
);

CREATE TEMP TABLE stage00_result (
    action text NOT NULL,
    import_batch_id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    source_registry_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    region_code text NOT NULL
) ON COMMIT DROP;

DO $stage00$
DECLARE
    p pipeline_params%ROWTYPE;
    v_osm_type_id bigint;
    v_registry_id bigint;
    v_batch_id bigint;
    v_snapshot_id bigint;
    v_action text;
    v_existing system.system_source_snapshots%ROWTYPE;
BEGIN
    SELECT * INTO p FROM pipeline_params;

    IF p.source_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: source_code';
    END IF;
    IF p.batch_name IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: batch_name';
    END IF;
    IF p.snapshot_ref IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_ref';
    END IF;
    IF p.snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;

    INSERT INTO ref.ref_source_types (code, name)
    VALUES ('osm', 'OpenStreetMap')
    ON CONFLICT (code) DO UPDATE
    SET name = excluded.name;

    SELECT st.id
    INTO v_osm_type_id
    FROM ref.ref_source_types AS st
    WHERE st.code = 'osm';

    IF v_osm_type_id IS NULL THEN
        RAISE EXCEPTION 'ref.ref_source_types row for code=osm is missing after upsert';
    END IF;

    INSERT INTO system.system_source_registry (
        source_code,
        source_name,
        source_type_id,
        source_uri,
        is_active,
        config
    )
    VALUES (
        p.source_code,
        coalesce(
            CASE p.source_code
                WHEN 'osm_myanmar' THEN 'OpenStreetMap Myanmar Extract'
                ELSE p.source_code
            END,
            p.source_code
        ),
        v_osm_type_id,
        CASE p.source_code
            WHEN 'osm_myanmar' THEN 'https://download.geofabrik.de/asia/myanmar-latest.osm.pbf'
            ELSE NULL
        END,
        true,
        CASE p.source_code
            WHEN 'osm_myanmar' THEN '{"provider":"geofabrik","dataset":"myanmar","format":"osm_pbf"}'::jsonb
            ELSE '{"pipeline":"road-fast-core"}'::jsonb
        END
    )
    ON CONFLICT (source_code) DO UPDATE
    SET
        source_type_id = excluded.source_type_id,
        is_active = true,
        updated_at = now();

    SELECT r.id
    INTO v_registry_id
    FROM system.system_source_registry AS r
    WHERE r.source_code = p.source_code;

    IF v_registry_id IS NULL THEN
        RAISE EXCEPTION 'system.system_source_registry missing source_code=% after ensure', p.source_code;
    END IF;

    SELECT s.*
    INTO v_existing
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = p.snapshot_version;

    IF FOUND THEN
        v_action := 'reused_existing_snapshot';
        v_snapshot_id := v_existing.id;
        v_batch_id := v_existing.import_batch_id;
    ELSE
        INSERT INTO system.system_import_batches (
            source_registry_id,
            batch_name,
            trigger_type,
            status,
            started_at,
            note
        )
        VALUES (
            v_registry_id,
            p.batch_name,
            'manual',
            'running',
            now(),
            format(
                'road-fast-core stage 00 — whole-country MM roads — snapshot_version=%s',
                p.snapshot_version
            )
        )
        RETURNING id INTO v_batch_id;

        INSERT INTO system.system_source_snapshots (
            source_registry_id,
            import_batch_id,
            snapshot_ref,
            snapshot_version,
            region_code,
            checksum,
            boundary_id,
            captured_at,
            created_at
        )
        VALUES (
            v_registry_id,
            v_batch_id,
            p.snapshot_ref,
            p.snapshot_version,
            'MM',
            p.checksum,
            NULL,
            now(),
            now()
        )
        RETURNING id INTO v_snapshot_id;

        v_action := 'created_new_snapshot';
    END IF;

    INSERT INTO stage00_result (
        action,
        import_batch_id,
        source_snapshot_id,
        source_registry_id,
        snapshot_version,
        region_code
    )
    VALUES (
        v_action,
        v_batch_id,
        v_snapshot_id,
        v_registry_id,
        p.snapshot_version,
        'MM'
    );
END
$stage00$;

SELECT
    action,
    import_batch_id,
    source_snapshot_id,
    source_registry_id,
    snapshot_version,
    region_code
FROM stage00_result;

COMMIT;
