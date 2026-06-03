-- =============================================================================
-- Stage 00: create_admin_snapshot
--
-- Ensures ref.ref_source_types (code=osm) and system.system_source_registry (:source_code).
-- Creates or reuses system.system_import_batches by :batch_name (per source registry).
-- Creates or reuses system.system_source_snapshots by :snapshot_version.
-- If (source_registry_id, snapshot_ref) is taken by another snapshot_version, uses
-- :snapshot_version as snapshot_ref (snapshot_version is globally unique).
-- Region code: :region_code. Does not delete system rows.
--
-- psql variables: source_code, batch_name, snapshot_ref, snapshot_version, checksum, region_code
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE pipeline_params (
    source_code text NOT NULL,
    batch_name text NOT NULL,
    snapshot_ref text NOT NULL,
    snapshot_version text NOT NULL,
    region_code text NOT NULL,
    checksum text
) ON COMMIT DROP;

INSERT INTO pipeline_params (
    source_code,
    batch_name,
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum
)
VALUES (
    NULLIF(btrim(:'source_code'), ''),
    NULLIF(btrim(:'batch_name'), ''),
    NULLIF(btrim(:'snapshot_ref'), ''),
    NULLIF(btrim(:'snapshot_version'), ''),
    NULLIF(btrim(:'region_code'), ''),
    NULLIF(btrim(:'checksum'), '')
);

CREATE TEMP TABLE stage00_result (
    action text NOT NULL,
    import_batch_id bigint NOT NULL,
    source_snapshot_id bigint NOT NULL,
    source_registry_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    snapshot_ref text NOT NULL,
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
    v_snapshot_ref text;
    v_existing system.system_source_snapshots%ROWTYPE;
    v_ref_conflict system.system_source_snapshots%ROWTYPE;
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
    IF p.region_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: region_code';
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
            ELSE '{"pipeline":"admin-fast-core"}'::jsonb
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
        IF v_existing.source_registry_id IS DISTINCT FROM v_registry_id THEN
            RAISE EXCEPTION
                'snapshot_version "%" already exists (source_snapshot_id=%) for source_registry_id=%, '
                'but source_code "%" resolves to source_registry_id=%',
                p.snapshot_version,
                v_existing.id,
                v_existing.source_registry_id,
                p.source_code,
                v_registry_id;
        END IF;

        v_action := 'reused_existing_snapshot';
        v_snapshot_id := v_existing.id;
        v_batch_id := v_existing.import_batch_id;
        v_snapshot_ref := v_existing.snapshot_ref;
    ELSE
        SELECT b.id
        INTO v_batch_id
        FROM system.system_import_batches AS b
        WHERE b.source_registry_id = v_registry_id
          AND b.batch_name = p.batch_name
        ORDER BY b.started_at DESC, b.id DESC
        LIMIT 1;

        IF v_batch_id IS NULL THEN
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
                    'admin-fast-core stage 00 — region_code=%s — snapshot_version=%s',
                    p.region_code,
                    p.snapshot_version
                )
            )
            RETURNING id INTO v_batch_id;

            v_action := 'created_new_batch_and_snapshot';
        ELSE
            v_action := 'reused_existing_batch_created_snapshot';
        END IF;

        v_snapshot_ref := p.snapshot_ref;

        SELECT s.*
        INTO v_ref_conflict
        FROM system.system_source_snapshots AS s
        WHERE s.source_registry_id = v_registry_id
          AND s.snapshot_ref = p.snapshot_ref;

        IF FOUND AND v_ref_conflict.snapshot_version IS DISTINCT FROM p.snapshot_version THEN
            v_snapshot_ref := p.snapshot_version;
            v_action := v_action || '_snapshot_ref_from_version';
        END IF;

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
            v_snapshot_ref,
            p.snapshot_version,
            p.region_code,
            p.checksum,
            NULL,
            now(),
            now()
        )
        RETURNING id INTO v_snapshot_id;
    END IF;

    IF v_snapshot_ref IS NULL THEN
        SELECT s.snapshot_ref
        INTO v_snapshot_ref
        FROM system.system_source_snapshots AS s
        WHERE s.id = v_snapshot_id;
    END IF;

    INSERT INTO stage00_result (
        action,
        import_batch_id,
        source_snapshot_id,
        source_registry_id,
        snapshot_version,
        snapshot_ref,
        region_code
    )
    VALUES (
        v_action,
        v_batch_id,
        v_snapshot_id,
        v_registry_id,
        p.snapshot_version,
        v_snapshot_ref,
        p.region_code
    );
END
$stage00$;

SELECT
    action,
    import_batch_id,
    source_snapshot_id,
    source_registry_id,
    snapshot_version,
    snapshot_ref,
    region_code
FROM stage00_result;

COMMIT;
