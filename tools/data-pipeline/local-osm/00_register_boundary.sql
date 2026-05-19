-- =============================================================================
-- Stage 00: register_boundary
-- Register or reuse one local import boundary in system.system_import_boundaries.
-- Does not touch raw, staging, core, or Supabase.
--
-- psql variables (set by 00_register_boundary.sh):
--   boundary_code, boundary_name, boundary_version, boundary_ref,
--   source_file_path, checksum, region_code
--
-- Input table:
--   tmp_import.import_boundary_tmp
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE pipeline_boundary_params (
    boundary_code text,
    boundary_name text,
    boundary_version text,
    boundary_ref text,
    source_file_path text,
    checksum text,
    region_code text
) ON COMMIT DROP;

INSERT INTO pipeline_boundary_params (
    boundary_code,
    boundary_name,
    boundary_version,
    boundary_ref,
    source_file_path,
    checksum,
    region_code
)
VALUES (
    NULLIF(btrim(:'boundary_code'), ''),
    NULLIF(btrim(:'boundary_name'), ''),
    NULLIF(btrim(:'boundary_version'), ''),
    NULLIF(btrim(:'boundary_ref'), ''),
    NULLIF(btrim(:'source_file_path'), ''),
    NULLIF(btrim(:'checksum'), ''),
    NULLIF(btrim(:'region_code'), '')
);

CREATE TEMP TABLE boundary_registration_output (
    boundary_id bigint NOT NULL,
    action text NOT NULL,
    boundary_code text NOT NULL,
    boundary_version text NOT NULL,
    boundary_ref text NOT NULL,
    checksum text NOT NULL,
    area_m2 numeric
) ON COMMIT DROP;

DO $boundary$
DECLARE
    v_boundary_code text;
    v_boundary_name text;
    v_boundary_version text;
    v_boundary_ref text;
    v_source_file_path text;
    v_checksum text;
    v_region_code text;
    v_existing_count integer;
    v_existing_id bigint;
    v_boundary_id bigint;
    v_geom geometry(MultiPolygon, 4326);
    v_area_m2 numeric;
    v_action text;
BEGIN
    SELECT
        p.boundary_code,
        p.boundary_name,
        p.boundary_version,
        p.boundary_ref,
        p.source_file_path,
        p.checksum,
        p.region_code
    INTO
        v_boundary_code,
        v_boundary_name,
        v_boundary_version,
        v_boundary_ref,
        v_source_file_path,
        v_checksum,
        v_region_code
    FROM pipeline_boundary_params AS p;

    IF v_boundary_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: boundary_code';
    END IF;
    IF v_boundary_name IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: boundary_name';
    END IF;
    IF v_boundary_version IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: boundary_version';
    END IF;
    IF v_boundary_ref IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: boundary_ref';
    END IF;
    IF v_source_file_path IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: source_file_path';
    END IF;
    IF v_checksum IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: checksum';
    END IF;
    IF v_region_code IS NULL THEN
        RAISE EXCEPTION 'missing psql variable: region_code';
    END IF;

    SELECT count(DISTINCT b.id), min(b.id)
    INTO v_existing_count, v_existing_id
    FROM system.system_import_boundaries AS b
    WHERE (b.boundary_ref = v_boundary_ref AND b.checksum = v_checksum)
       OR (b.boundary_code = v_boundary_code AND b.boundary_version = v_boundary_version);

    IF v_existing_count > 1 THEN
        RAISE EXCEPTION
            'ambiguous boundary reuse: multiple rows match boundary_ref/checksum or boundary_code/boundary_version (boundary_ref=%, boundary_code=%, boundary_version=%)',
            v_boundary_ref,
            v_boundary_code,
            v_boundary_version;
    END IF;

    IF v_existing_id IS NOT NULL THEN
        v_boundary_id := v_existing_id;
        v_action := 'reused_existing_boundary';

        SELECT b.area_m2
        INTO v_area_m2
        FROM system.system_import_boundaries AS b
        WHERE b.id = v_boundary_id;
    ELSE
        SELECT
            ST_Multi(
                ST_CollectionExtract(
                    ST_UnaryUnion(
                        ST_Collect(
                            ST_CollectionExtract(
                                ST_MakeValid(
                                    ST_Transform(
                                        CASE
                                            WHEN ST_SRID(t.geom) = 0 THEN ST_SetSRID(t.geom, 4326)
                                            ELSE t.geom
                                        END,
                                        4326
                                    )
                                ),
                                3
                            )
                        )
                    ),
                    3
                )
            )::geometry(MultiPolygon, 4326)
        INTO v_geom
        FROM tmp_import.import_boundary_tmp AS t
        WHERE t.geom IS NOT NULL
          AND NOT ST_IsEmpty(t.geom);

        IF v_geom IS NULL OR ST_IsEmpty(v_geom) THEN
            RAISE EXCEPTION 'tmp_import.import_boundary_tmp did not contain usable polygon geometry';
        END IF;

        v_area_m2 := ST_Area(v_geom::geography);

        INSERT INTO system.system_import_boundaries (
            boundary_code,
            boundary_name,
            region_code,
            boundary_ref,
            boundary_version,
            checksum,
            source_file_path,
            geom,
            bbox,
            area_m2,
            metadata,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            v_boundary_code,
            v_boundary_name,
            v_region_code,
            v_boundary_ref,
            v_boundary_version,
            v_checksum,
            v_source_file_path,
            v_geom,
            ST_Envelope(v_geom)::geometry(Polygon, 4326),
            v_area_m2,
            jsonb_build_object(
                'source_file_path', v_source_file_path,
                'checksum', v_checksum,
                'imported_at', now()
            ),
            true,
            now(),
            now()
        )
        RETURNING id INTO v_boundary_id;

        v_action := 'created_boundary';
    END IF;

    INSERT INTO boundary_registration_output (
        boundary_id,
        action,
        boundary_code,
        boundary_version,
        boundary_ref,
        checksum,
        area_m2
    )
    VALUES (
        v_boundary_id,
        v_action,
        v_boundary_code,
        v_boundary_version,
        v_boundary_ref,
        v_checksum,
        v_area_m2
    );
END
$boundary$;

SELECT
    boundary_id,
    action,
    boundary_code,
    boundary_version,
    boundary_ref,
    checksum,
    area_m2
FROM boundary_registration_output;

COMMIT;
