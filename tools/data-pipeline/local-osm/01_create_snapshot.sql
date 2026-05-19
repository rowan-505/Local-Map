-- =============================================================================
-- Stage 01: create_snapshot
-- Register system.system_import_batches + system.system_source_snapshots
-- for one local OSM import. Does not touch raw, staging, or core.
--
-- psql variables (set by run_local_osm_pipeline.sh):
--   source_code, batch_name, snapshot_ref, snapshot_version, region_code,
--   checksum, boundary_id, allow_boundary_update
--
-- psql :'var' substitution works only outside dollar-quoted DO blocks; params
-- are loaded into pipeline_params first, then read inside the DO block.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?boundary_id}
\else
\set boundary_id ''
\endif
\if :{?allow_boundary_update}
\else
\set allow_boundary_update 'false'
\endif

BEGIN;

CREATE TEMP TABLE pipeline_params (
    source_code text NOT NULL,
    batch_name text NOT NULL,
    snapshot_ref text NOT NULL,
    snapshot_version text NOT NULL,
    region_code text NOT NULL,
    checksum text,
    boundary_id bigint,
    allow_boundary_update boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO pipeline_params (
    source_code,
    batch_name,
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum,
    boundary_id,
    allow_boundary_update
)
VALUES (
    NULLIF(btrim(:'source_code'), ''),
    NULLIF(btrim(:'batch_name'), ''),
    NULLIF(btrim(:'snapshot_ref'), ''),
    NULLIF(btrim(:'snapshot_version'), ''),
    NULLIF(btrim(:'region_code'), ''),
    NULLIF(btrim(:'checksum'), ''),
    NULLIF(btrim(:'boundary_id'), '')::bigint,
    lower(NULLIF(btrim(:'allow_boundary_update'), '')) IN ('true', 't', '1', 'yes', 'on')
);

CREATE TEMP TABLE stage01_output (
    report_line text NOT NULL,
    action text NOT NULL,
    source_registry_id bigint NOT NULL,
    import_batch_id bigint,
    source_snapshot_id bigint NOT NULL,
    snapshot_version text NOT NULL,
    previous_snapshot_id bigint,
    source_code text NOT NULL,
    region_code text,
    snapshot_ref text,
    checksum text,
    boundary_id bigint,
    boundary_warning text
) ON COMMIT DROP;

DO $stage$
DECLARE
    v_source_code text;
    v_batch_name text;
    v_snapshot_ref text;
    v_snapshot_version text;
    v_region_code text;
    v_checksum text;
    v_boundary_id bigint;
    v_allow_boundary_update boolean;
    v_boundary_exists boolean;
    v_boundary_warning text;

    v_registry_id bigint;
    v_registry_code text;
    v_batch_id bigint;
    v_snapshot_id bigint;
    v_previous_snapshot_id bigint;
    v_action text;
    v_existing system.system_source_snapshots%ROWTYPE;
BEGIN
    SELECT
        p.source_code,
        p.batch_name,
        p.snapshot_ref,
        p.snapshot_version,
        p.region_code,
        p.checksum,
        p.boundary_id,
        p.allow_boundary_update
    INTO
        v_source_code,
        v_batch_name,
        v_snapshot_ref,
        v_snapshot_version,
        v_region_code,
        v_checksum,
        v_boundary_id,
        v_allow_boundary_update
    FROM pipeline_params AS p;

    IF v_source_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: source_code';
    END IF;
    IF v_batch_name IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: batch_name';
    END IF;
    IF v_snapshot_ref IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_ref';
    END IF;
    IF v_snapshot_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: snapshot_version';
    END IF;
    IF v_region_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: region_code';
    END IF;
    IF v_boundary_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM system.system_import_boundaries AS b
            WHERE b.id = v_boundary_id
        )
        INTO v_boundary_exists;

        IF NOT v_boundary_exists THEN
            RAISE EXCEPTION 'boundary_id % not found in system.system_import_boundaries', v_boundary_id;
        END IF;
    END IF;

    SELECT r.id, r.source_code
    INTO v_registry_id, v_registry_code
    FROM system.system_source_registry AS r
    WHERE r.source_code = v_source_code;

    IF v_registry_id IS NULL THEN
        RAISE EXCEPTION
            'source_code "%" not found in system.system_source_registry. '
            'Register it first (e.g. infrastructure/database/seeds/local/001_seed_system_source_registry.sql).',
            v_source_code;
    END IF;

    SELECT s.*
    INTO v_existing
    FROM system.system_source_snapshots AS s
    WHERE s.snapshot_version = v_snapshot_version;

    IF FOUND THEN
        IF v_existing.source_registry_id IS DISTINCT FROM v_registry_id THEN
            RAISE EXCEPTION
                'snapshot_version "%" already exists (source_snapshot_id=%) for source_registry_id=%, '
                'but source_code "%" resolves to source_registry_id=%',
                v_snapshot_version,
                v_existing.id,
                v_existing.source_registry_id,
                v_source_code,
                v_registry_id;
        END IF;

        v_action := 'reused_existing_snapshot';
        v_snapshot_id := v_existing.id;
        v_batch_id := v_existing.import_batch_id;

        IF v_boundary_id IS NOT NULL THEN
            IF v_existing.boundary_id IS NULL THEN
                UPDATE system.system_source_snapshots
                SET boundary_id = v_boundary_id
                WHERE id = v_existing.id;

                v_action := 'reused_existing_snapshot_linked_boundary';
                v_existing.boundary_id := v_boundary_id;
            ELSIF v_existing.boundary_id IS DISTINCT FROM v_boundary_id THEN
                IF v_allow_boundary_update THEN
                    UPDATE system.system_source_snapshots
                    SET boundary_id = v_boundary_id
                    WHERE id = v_existing.id;

                    v_action := 'reused_existing_snapshot_updated_boundary';
                    v_existing.boundary_id := v_boundary_id;
                ELSE
                    v_boundary_warning := format(
                        'snapshot_version "%s" already has boundary_id=%s; provided boundary_id=%s was not applied. Pass allow_boundary_update=true to overwrite.',
                        v_snapshot_version,
                        v_existing.boundary_id,
                        v_boundary_id
                    );
                    RAISE WARNING '%', v_boundary_warning;
                END IF;
            END IF;
        END IF;

        INSERT INTO stage01_output (
            report_line,
            action,
            source_registry_id,
            import_batch_id,
            source_snapshot_id,
            snapshot_version,
            previous_snapshot_id,
            source_code,
            region_code,
            snapshot_ref,
            checksum,
            boundary_id,
            boundary_warning
        )
        VALUES (
            format(
                'snapshot_version "%s" already exists — no new batch or snapshot created',
                v_snapshot_version
            ),
            v_action,
            v_existing.source_registry_id,
            v_existing.import_batch_id,
            v_existing.id,
            v_existing.snapshot_version,
            NULL,
            v_registry_code,
            v_existing.region_code,
            v_existing.snapshot_ref,
            v_existing.checksum,
            v_existing.boundary_id,
            v_boundary_warning
        );
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
            v_batch_name,
            'manual',
            'running',
            now(),
            format(
                'Local OSM pipeline stage 01 — source_code=%s, snapshot_version=%s, region_code=%s',
                v_source_code,
                v_snapshot_version,
                v_region_code
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
            v_snapshot_ref,
            v_snapshot_version,
            v_region_code,
            v_checksum,
            v_boundary_id,
            now(),
            now()
        )
        RETURNING id INTO v_snapshot_id;

        v_action := 'created_snapshot';

        INSERT INTO stage01_output (
            report_line,
            action,
            source_registry_id,
            import_batch_id,
            source_snapshot_id,
            snapshot_version,
            previous_snapshot_id,
            source_code,
            region_code,
            snapshot_ref,
            checksum,
            boundary_id,
            boundary_warning
        )
        VALUES (
            format('created import batch %s and source snapshot %s', v_batch_id, v_snapshot_id),
            v_action,
            v_registry_id,
            v_batch_id,
            v_snapshot_id,
            v_snapshot_version,
            NULL,
            v_registry_code,
            v_region_code,
            v_snapshot_ref,
            v_checksum,
            v_boundary_id,
            NULL
        );
    END IF;

    SELECT s.id
    INTO v_previous_snapshot_id
    FROM system.system_source_snapshots AS s
    WHERE s.source_registry_id = v_registry_id
      AND s.region_code IS NOT DISTINCT FROM v_region_code
      AND s.id <> v_snapshot_id
    ORDER BY s.captured_at DESC, s.id DESC
    LIMIT 1;

    UPDATE stage01_output
    SET previous_snapshot_id = v_previous_snapshot_id
    WHERE source_snapshot_id = v_snapshot_id;
END
$stage$;

SELECT
    'stage01_result' AS section,
    action,
    source_registry_id,
    import_batch_id,
    source_snapshot_id,
    snapshot_version,
    previous_snapshot_id,
    source_code,
    region_code,
    snapshot_ref,
    checksum,
    boundary_id,
    boundary_warning
FROM stage01_output;

SELECT
    'stage01_message' AS section,
    report_line
FROM stage01_output;

SELECT
    'stage01_previous_snapshot' AS section,
    prev.id AS previous_snapshot_id,
    prev.snapshot_version AS previous_snapshot_version,
    prev.snapshot_ref AS previous_snapshot_ref,
    prev.region_code AS previous_region_code,
    prev.captured_at AS previous_captured_at
FROM stage01_output AS out
LEFT JOIN system.system_source_snapshots AS prev
    ON prev.id = out.previous_snapshot_id;

COMMIT;
