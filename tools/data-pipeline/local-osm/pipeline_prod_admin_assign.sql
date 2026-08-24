-- =============================================================================
-- Production township admin assign helpers (local pipeline → prod_mirror IDs).
-- Mirrors migration 146 operational-township rules against prod_mirror tables.
-- Does NOT query local core.core_admin_areas (local IDs are unsafe for IR/core).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS system;

-- Same denylist as core.admin_area_is_non_operational_township_id (migration 146).
CREATE OR REPLACE FUNCTION system.pipeline_prod_admin_is_non_operational_township_id(p_id bigint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_id IN (
        5979,  -- ပုံပါကျင်မြို့နယ်ခွဲ (town/lower)
        6115,  -- ပအိုဝ်း SAZ
        6192,  -- ဓနု SAZ
        6337,  -- မိုင်းညင်း (town/lower)
        6462,  -- ပန်ယန်း (town/lower)
        6483,  -- တန်ဃန်း (town/lower)
        6497,  -- လားရှိုးမြို့ (town/lower)
        6693,  -- နာဂ SAZ
        7523   -- ပုဇွန်တောင် wrong-entity
    );
$$;

CREATE OR REPLACE FUNCTION system.pipeline_prod_admin_is_operational_township(
    p_id bigint,
    p_level_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_level_code, ''))) = 'township'
       AND NOT system.pipeline_prod_admin_is_non_operational_township_id(p_id);
$$;

-- Importable classes that receive production township admin_area_id (policy 1C).
CREATE OR REPLACE FUNCTION system.pipeline_importable_for_admin_classes()
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- plpgsql so Stage 05 can load this file before import-class helpers exist.
    RETURN system.pipeline_direct_core_classes()
        || system.pipeline_ir_conflict_classes();
END;
$$;

CREATE OR REPLACE FUNCTION system.pipeline_is_importable_for_admin_class(p_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_class, '')))
        = ANY (system.pipeline_importable_for_admin_classes());
$$;

-- Point → production township id (exact-one ST_Covers) or NULL.
CREATE OR REPLACE FUNCTION system.pipeline_find_township_for_point_prod(
    p_geom geometry,
    p_prod_mirror_schema text DEFAULT 'prod_mirror'
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_point geometry(Point, 4326);
    v_schema text := coalesce(nullif(btrim(p_prod_mirror_schema), ''), 'prod_mirror');
    v_match_count integer;
    v_result bigint;
BEGIN
    IF p_geom IS NULL OR ST_IsEmpty(p_geom) THEN
        RETURN NULL;
    END IF;

    BEGIN
        IF GeometryType(p_geom) IN ('POINT', 'MULTIPOINT') THEN
            v_point := ST_SetSRID(ST_GeometryN(ST_CollectionExtract(p_geom, 1), 1), 4326)::geometry(Point, 4326);
        ELSE
            v_point := ST_SetSRID(ST_PointOnSurface(p_geom), 4326)::geometry(Point, 4326);
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    IF v_point IS NULL OR ST_IsEmpty(v_point) OR NOT ST_IsValid(v_point) THEN
        RETURN NULL;
    END IF;

    IF to_regclass(format('%I.core_admin_areas', v_schema)) IS NULL
       OR to_regclass(format('%I.ref_admin_levels', v_schema)) IS NULL THEN
        RAISE EXCEPTION
            'prod_mirror admin tables missing in schema "%" (need core_admin_areas + ref_admin_levels)',
            v_schema;
    END IF;

    EXECUTE format(
        $q$
        SELECT count(*)::integer, min(aa.id)
        FROM %I.core_admin_areas AS aa
        INNER JOIN %I.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT ST_IsEmpty(aa.geom)
          AND ST_IsValid(aa.geom)
          AND system.pipeline_prod_admin_is_operational_township(aa.id, al.code)
          AND ST_Covers(aa.geom, $1)
        $q$,
        v_schema,
        v_schema
    )
    INTO v_match_count, v_result
    USING v_point;

    IF coalesce(v_match_count, 0) = 1 THEN
        RETURN v_result;
    END IF;
    RETURN NULL;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION system.pipeline_find_township_for_point_prod(geometry, text) IS
    'Operational township id from prod_mirror (migration 146 exact-one ST_Covers) or NULL.';

-- Read-only containment status. Distinguishes 0 vs 1 vs 2+ township matches.
-- Does not raise when prod_mirror is missing (Stage 05 still extracts).
CREATE OR REPLACE FUNCTION system.pipeline_township_containment_for_point_prod(
    p_geom geometry,
    p_prod_mirror_schema text DEFAULT 'prod_mirror'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_point geometry(Point, 4326);
    v_schema text := coalesce(nullif(btrim(p_prod_mirror_schema), ''), 'prod_mirror');
    v_match_count integer := 0;
    v_township_id bigint;
    v_status text;
BEGIN
    IF p_geom IS NULL OR ST_IsEmpty(p_geom) THEN
        RETURN jsonb_build_object(
            'township_id', NULL,
            'match_count', 0,
            'status', 'unassigned'
        );
    END IF;

    BEGIN
        IF GeometryType(p_geom) IN ('POINT', 'MULTIPOINT') THEN
            v_point := ST_SetSRID(
                ST_GeometryN(ST_CollectionExtract(p_geom, 1), 1),
                4326
            )::geometry(Point, 4326);
        ELSE
            v_point := ST_SetSRID(ST_PointOnSurface(p_geom), 4326)::geometry(Point, 4326);
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN jsonb_build_object(
                'township_id', NULL,
                'match_count', 0,
                'status', 'unassigned'
            );
    END;

    IF v_point IS NULL OR ST_IsEmpty(v_point) OR NOT ST_IsValid(v_point) THEN
        RETURN jsonb_build_object(
            'township_id', NULL,
            'match_count', 0,
            'status', 'unassigned'
        );
    END IF;

    IF to_regclass(format('%I.core_admin_areas', v_schema)) IS NULL
       OR to_regclass(format('%I.ref_admin_levels', v_schema)) IS NULL THEN
        RETURN jsonb_build_object(
            'township_id', NULL,
            'match_count', 0,
            'status', 'unavailable'
        );
    END IF;

    EXECUTE format(
        $q$
        SELECT count(*)::integer, min(aa.id)
        FROM %I.core_admin_areas AS aa
        INNER JOIN %I.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT ST_IsEmpty(aa.geom)
          AND ST_IsValid(aa.geom)
          AND system.pipeline_prod_admin_is_operational_township(aa.id, al.code)
          AND ST_Covers(aa.geom, $1)
        $q$,
        v_schema,
        v_schema
    )
    INTO v_match_count, v_township_id
    USING v_point;

    v_match_count := coalesce(v_match_count, 0);
    IF v_match_count = 1 THEN
        v_status := 'assigned';
    ELSIF v_match_count > 1 THEN
        v_status := 'multiple_match';
        v_township_id := NULL;
    ELSE
        v_status := 'unassigned';
        v_township_id := NULL;
    END IF;

    RETURN jsonb_build_object(
        'township_id', to_jsonb(v_township_id),
        'match_count', v_match_count,
        'status', v_status
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'township_id', NULL,
            'match_count', 0,
            'status', 'unavailable'
        );
END;
$$;

COMMENT ON FUNCTION system.pipeline_township_containment_for_point_prod(geometry, text) IS
    'Read-only prod_mirror township containment: assigned / unassigned / multiple_match / unavailable.';

CREATE OR REPLACE FUNCTION system.pipeline_apply_township_containment_normalized_data(
    p_normalized_data jsonb,
    p_containment jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (
        (
            coalesce(p_normalized_data, '{}'::jsonb)
            - 'core_admin_area_id'
            - 'admin_area_id'
            - 'township_match_count'
            - 'township_match_status'
        )
        || CASE
            WHEN coalesce(p_containment->>'status', '') = 'assigned'
                 AND nullif(p_containment->>'township_id', '') IS NOT NULL
            THEN jsonb_build_object('admin_area_id', (p_containment->>'township_id')::bigint)
            ELSE '{}'::jsonb
           END
        || jsonb_build_object(
            'township_match_count', coalesce((p_containment->>'match_count')::integer, 0),
            'township_match_status', coalesce(p_containment->>'status', 'unassigned'),
            'admin_assign_source', 'prod_mirror_township'
        )
    );
$$;

-- Line → production township via dominant overlap (migration 146 margins).
CREATE OR REPLACE FUNCTION system.pipeline_find_township_for_line_prod(
    p_geom geometry,
    p_prod_mirror_schema text DEFAULT 'prod_mirror'
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_line geometry;
    v_schema text := coalesce(nullif(btrim(p_prod_mirror_schema), ''), 'prod_mirror');
    v_line_len double precision;
    v_best_id bigint;
    v_best_m double precision;
    v_second_m double precision;
    v_share double precision;
BEGIN
    IF p_geom IS NULL OR ST_IsEmpty(p_geom) THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_line := ST_SetSRID(ST_CollectionExtract(p_geom, 2), 4326);
        IF v_line IS NULL OR ST_IsEmpty(v_line) THEN
            v_line := ST_SetSRID(p_geom, 4326);
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    IF v_line IS NULL OR ST_IsEmpty(v_line) OR NOT ST_IsValid(v_line) THEN
        RETURN NULL;
    END IF;

    v_line_len := ST_Length(v_line::geography);
    IF v_line_len IS NULL OR v_line_len <= 0 THEN
        RETURN system.pipeline_find_township_for_point_prod(v_line, v_schema);
    END IF;

    EXECUTE format(
        $q$
        SELECT x.id, x.overlap_m, x.second_m
        FROM (
            SELECT
                c.id,
                ST_Length(ST_Intersection(c.geom, $1)::geography) AS overlap_m,
                lead(ST_Length(ST_Intersection(c.geom, $1)::geography)) OVER (
                    ORDER BY ST_Length(ST_Intersection(c.geom, $1)::geography) DESC NULLS LAST,
                             ST_Area(c.geom::geography) ASC NULLS LAST,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY ST_Length(ST_Intersection(c.geom, $1)::geography) DESC NULLS LAST,
                             ST_Area(c.geom::geography) ASC NULLS LAST,
                             c.id ASC
                ) AS rn
            FROM %I.core_admin_areas AS c
            INNER JOIN %I.ref_admin_levels AS al ON al.id = c.admin_level_id
            WHERE c.deleted_at IS NULL
              AND c.geom IS NOT NULL
              AND NOT ST_IsEmpty(c.geom)
              AND ST_IsValid(c.geom)
              AND system.pipeline_prod_admin_is_operational_township(c.id, al.code)
              AND ST_Intersects(c.geom, $1)
        ) AS x
        WHERE x.rn = 1
          AND x.overlap_m > 0
        $q$,
        v_schema,
        v_schema
    )
    INTO v_best_id, v_best_m, v_second_m
    USING v_line;

    IF v_best_id IS NULL OR v_best_m IS NULL OR v_best_m <= 0 THEN
        RETURN NULL;
    END IF;

    v_share := v_best_m / v_line_len;
    IF v_share < 0.55 THEN
        RETURN NULL;
    END IF;
    IF v_second_m IS NOT NULL AND v_second_m > 0 AND (v_best_m / v_second_m) < 1.25 THEN
        RETURN NULL;
    END IF;

    RETURN v_best_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION system.pipeline_find_township_for_line_prod(geometry, text) IS
    'Operational township id from prod_mirror by dominant line overlap (migration 146 margins).';

-- Polygon → production township (POS exact-one, else overlap margins).
CREATE OR REPLACE FUNCTION system.pipeline_find_township_for_polygon_prod(
    p_geom geometry,
    p_prod_mirror_schema text DEFAULT 'prod_mirror'
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_geom geometry;
    v_point geometry(Point, 4326);
    v_schema text := coalesce(nullif(btrim(p_prod_mirror_schema), ''), 'prod_mirror');
    v_result bigint;
    v_pos_count integer;
    v_poly_area double precision;
    v_best_id bigint;
    v_best_m double precision;
    v_second_m double precision;
    v_share double precision;
BEGIN
    IF p_geom IS NULL OR ST_IsEmpty(p_geom) THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_geom := ST_SetSRID(p_geom, 4326);
        v_point := ST_PointOnSurface(v_geom)::geometry(Point, 4326);
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
    END;

    IF v_geom IS NULL OR ST_IsEmpty(v_geom) OR NOT ST_IsValid(v_geom) THEN
        RETURN NULL;
    END IF;

    EXECUTE format(
        $q$
        SELECT count(*)::integer, min(aa.id)
        FROM %I.core_admin_areas AS aa
        INNER JOIN %I.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT ST_IsEmpty(aa.geom)
          AND ST_IsValid(aa.geom)
          AND system.pipeline_prod_admin_is_operational_township(aa.id, al.code)
          AND ST_Covers(aa.geom, $1)
        $q$,
        v_schema,
        v_schema
    )
    INTO v_pos_count, v_result
    USING v_point;

    IF coalesce(v_pos_count, 0) = 1 THEN
        RETURN v_result;
    END IF;
    IF coalesce(v_pos_count, 0) > 1 THEN
        RETURN NULL;
    END IF;

    v_poly_area := ST_Area(v_geom::geography);
    IF v_poly_area IS NULL OR v_poly_area < 50000 THEN
        RETURN NULL;
    END IF;

    EXECUTE format(
        $q$
        SELECT x.id, x.overlap_m, x.second_m
        FROM (
            SELECT
                c.id,
                ST_Area(ST_Intersection(c.geom, $1)::geography) AS overlap_m,
                lead(ST_Area(ST_Intersection(c.geom, $1)::geography)) OVER (
                    ORDER BY ST_Area(ST_Intersection(c.geom, $1)::geography) DESC NULLS LAST,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY ST_Area(ST_Intersection(c.geom, $1)::geography) DESC NULLS LAST,
                             c.id ASC
                ) AS rn
            FROM %I.core_admin_areas AS c
            INNER JOIN %I.ref_admin_levels AS al ON al.id = c.admin_level_id
            WHERE c.deleted_at IS NULL
              AND c.geom IS NOT NULL
              AND NOT ST_IsEmpty(c.geom)
              AND ST_IsValid(c.geom)
              AND system.pipeline_prod_admin_is_operational_township(c.id, al.code)
              AND ST_Intersects(c.geom, $1)
        ) AS x
        WHERE x.rn = 1 AND x.overlap_m > 0
        $q$,
        v_schema,
        v_schema
    )
    INTO v_best_id, v_best_m, v_second_m
    USING v_geom;

    IF v_best_id IS NULL THEN
        RETURN NULL;
    END IF;

    v_share := v_best_m / v_poly_area;
    IF v_share < 0.60 THEN
        RETURN NULL;
    END IF;
    IF v_second_m IS NOT NULL AND v_second_m > 0
       AND (v_share - (v_second_m / v_poly_area)) < 0.15 THEN
        RETURN NULL;
    END IF;

    RETURN v_best_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION system.pipeline_find_township_for_polygon_prod(geometry, text) IS
    'Operational township id from prod_mirror for polygons (POS exact-one, else overlap margins).';

-- Merge production admin_area_id into normalized_data; drop legacy local core_admin_area_id.
CREATE OR REPLACE FUNCTION system.pipeline_set_prod_admin_normalized_data(
    p_normalized_data jsonb,
    p_admin_area_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT (
        (coalesce(p_normalized_data, '{}'::jsonb) - 'core_admin_area_id' - 'admin_area_id')
        || CASE
            WHEN p_admin_area_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('admin_area_id', p_admin_area_id)
           END
        || jsonb_build_object(
            'admin_assign_source', 'prod_mirror_township',
            'admin_assign_at', to_jsonb(clock_timestamp()::timestamptz)
        )
    );
$$;
