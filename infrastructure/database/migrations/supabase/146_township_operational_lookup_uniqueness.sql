-- =============================================================================
-- 146: Operational township lookup uniqueness
-- -----------------------------------------------------------------------------
-- Goal:
--   For target='township', match only the audited operational true-township set
--   (active, non-deleted, level=township, excluding non-operational IDs).
--   Use ST_Covers. Return the id only when exactly one operational township
--   covers the point; otherwise NULL. Never silent LIMIT 1.
--
-- Reuses migration 145 structure (unique-or-NULL, line/polygon margins) but
-- replaces qualifies_as_township_target for township target with the exact
-- 364-row operational predicate from the uniqueness audit.
--
-- Does NOT change geometries or non-function tables.
-- =============================================================================

-- Non-operational township-level IDs from Stage-1 classification
-- (SAZ containers, town/lower, wrong-entity) still stored as level=township.
CREATE OR REPLACE FUNCTION core.admin_area_is_non_operational_township_id(p_id bigint)
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

COMMENT ON FUNCTION core.admin_area_is_non_operational_township_id(bigint) IS
    'True for township-level rows excluded from the operational 364-township set (SAZ/town/wrong-entity).';

-- Exact operational predicate used by the uniqueness audit.
CREATE OR REPLACE FUNCTION core.admin_area_is_operational_township(
    p_id bigint,
    p_level_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(coalesce(p_level_code, ''))) = 'township'
       AND NOT core.admin_area_is_non_operational_township_id(p_id);
$$;

COMMENT ON FUNCTION core.admin_area_is_operational_township(bigint, text) IS
    'Operational true-township: level code township and not in non-operational denylist.';

CREATE OR REPLACE FUNCTION core.find_admin_area_for_point(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_point geometry(Point, 4326);
    v_target text := lower(btrim(coalesce(target_admin_level_code, '')));
    v_result bigint;
    v_match_count integer;
BEGIN
    v_point := core.entity_rep_point_for_admin_lookup(p_geom);
    IF v_point IS NULL OR st_isempty(v_point) OR NOT st_isvalid(v_point) THEN
        RETURN NULL;
    END IF;

    -- Township target: operational true-townships only; exact-one or NULL.
    IF v_target = 'township' THEN
        SELECT count(*)::integer, min(aa.id)
        INTO v_match_count, v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_is_operational_township(aa.id, al.code)
          AND st_covers(aa.geom, v_point);

        IF coalesce(v_match_count, 0) = 1 THEN
            RETURN v_result;
        END IF;
        RETURN NULL;
    END IF;

    -- Town target: unique cover among level=town (not operational township set).
    IF v_target = 'town' THEN
        SELECT count(*)::integer, min(aa.id)
        INTO v_match_count, v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND lower(btrim(al.code)) = 'town'
          AND st_covers(aa.geom, v_point);

        IF coalesce(v_match_count, 0) = 1 THEN
            RETURN v_result;
        END IF;
        RETURN NULL;
    END IF;

    -- Generic / other levels: smallest covering polygon (ST_Covers only).
    SELECT aa.id
    INTO v_result
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.is_active IS TRUE
      AND aa.deleted_at IS NULL
      AND aa.geom IS NOT NULL
      AND NOT st_isempty(aa.geom)
      AND st_isvalid(aa.geom)
      AND core.admin_area_matches_assignment_target(
          aa.admin_level_id, al.code, al.name, target_admin_level_code
      )
      AND st_covers(aa.geom, v_point)
    ORDER BY st_area(aa.geom::geography) ASC NULLS LAST, aa.id ASC
    LIMIT 1;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_point(geometry, text) IS
    'Point admin lookup via ST_Covers. target=township: exactly one operational true-township or NULL; never silent LIMIT 1; never district fallback.';

CREATE OR REPLACE FUNCTION core.pick_admin_area_for_line_overlap(
    p_line_geom geometry,
    p_target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_line geometry;
    v_line_len double precision;
    v_target text := lower(btrim(coalesce(p_target_admin_level_code, '')));
    v_best_id bigint;
    v_best_m double precision;
    v_second_m double precision;
    v_share double precision;
BEGIN
    v_line := core.normalize_admin_lookup_geom(p_line_geom);
    IF v_line IS NULL OR st_isempty(v_line) OR NOT st_isvalid(v_line) THEN
        RETURN NULL;
    END IF;

    v_line_len := st_length(v_line::geography);
    IF v_line_len IS NULL OR v_line_len <= 0 THEN
        RETURN core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_line),
            p_target_admin_level_code
        );
    END IF;

    IF v_target = 'township' THEN
        SELECT x.id, x.overlap_m, x.second_m
        INTO v_best_id, v_best_m, v_second_m
        FROM (
            SELECT
                c.id,
                st_length(st_intersection(c.geom, v_line)::geography) AS overlap_m,
                lead(st_length(st_intersection(c.geom, v_line)::geography)) OVER (
                    ORDER BY st_length(st_intersection(c.geom, v_line)::geography) DESC NULLS LAST,
                             st_area(c.geom::geography) ASC NULLS LAST,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY st_length(st_intersection(c.geom, v_line)::geography) DESC NULLS LAST,
                             st_area(c.geom::geography) ASC NULLS LAST,
                             c.id ASC
                ) AS rn
            FROM core.core_admin_areas AS c
            INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
            WHERE c.is_active IS TRUE
              AND c.deleted_at IS NULL
              AND c.geom IS NOT NULL
              AND NOT st_isempty(c.geom)
              AND st_isvalid(c.geom)
              AND core.admin_area_is_operational_township(c.id, al.code)
              AND st_intersects(c.geom, v_line)
        ) AS x
        WHERE x.rn = 1
          AND x.overlap_m > 0;

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
    END IF;

    SELECT c.id
    INTO v_best_id
    FROM core.core_admin_areas AS c
    INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
    CROSS JOIN LATERAL (
        SELECT st_length(st_intersection(c.geom, v_line)::geography) AS overlap_m
    ) AS x
    WHERE c.is_active IS TRUE
      AND c.deleted_at IS NULL
      AND c.geom IS NOT NULL
      AND NOT st_isempty(c.geom)
      AND st_isvalid(c.geom)
      AND core.admin_area_matches_assignment_target(
          c.admin_level_id, al.code, al.name, p_target_admin_level_code
      )
      AND st_intersects(c.geom, v_line)
      AND x.overlap_m > 0
    ORDER BY
        x.overlap_m DESC NULLS LAST,
        (x.overlap_m / v_line_len) DESC NULLS LAST,
        st_area(c.geom::geography) ASC NULLS LAST,
        c.id ASC
    LIMIT 1;

    RETURN v_best_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.pick_admin_area_for_line_overlap(geometry, text) IS
    'Largest line overlap length. Township target uses operational townships only; refuses weak/close overlaps.';

CREATE OR REPLACE FUNCTION core.find_admin_area_for_polygon(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_geom geometry;
    v_point geometry(Point, 4326);
    v_target text := lower(btrim(coalesce(target_admin_level_code, '')));
    v_result bigint;
    v_poly_area double precision;
    v_best_id bigint;
    v_best_m double precision;
    v_second_m double precision;
    v_share double precision;
    v_pos_count integer;
BEGIN
    v_geom := core.normalize_admin_lookup_geom(p_geom);
    IF v_geom IS NULL OR st_isempty(v_geom) OR NOT st_isvalid(v_geom) THEN
        RETURN NULL;
    END IF;

    v_point := st_pointonsurface(v_geom)::geometry(Point, 4326);

    IF v_target = 'township' THEN
        SELECT count(*)::integer, min(aa.id)
        INTO v_pos_count, v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_is_operational_township(aa.id, al.code)
          AND st_covers(aa.geom, v_point);

        IF coalesce(v_pos_count, 0) = 1 THEN
            RETURN v_result;
        END IF;
        IF coalesce(v_pos_count, 0) > 1 THEN
            RETURN NULL;
        END IF;

        v_poly_area := st_area(v_geom::geography);
        IF v_poly_area IS NULL OR v_poly_area < 50000 THEN
            RETURN NULL;
        END IF;

        SELECT x.id, x.overlap_m, x.second_m
        INTO v_best_id, v_best_m, v_second_m
        FROM (
            SELECT
                c.id,
                st_area(st_intersection(c.geom, v_geom)::geography) AS overlap_m,
                lead(st_area(st_intersection(c.geom, v_geom)::geography)) OVER (
                    ORDER BY st_area(st_intersection(c.geom, v_geom)::geography) DESC NULLS LAST,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY st_area(st_intersection(c.geom, v_geom)::geography) DESC NULLS LAST,
                             c.id ASC
                ) AS rn
            FROM core.core_admin_areas AS c
            INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
            WHERE c.is_active IS TRUE
              AND c.deleted_at IS NULL
              AND c.geom IS NOT NULL
              AND NOT st_isempty(c.geom)
              AND st_isvalid(c.geom)
              AND core.admin_area_is_operational_township(c.id, al.code)
              AND st_intersects(c.geom, v_geom)
        ) AS x
        WHERE x.rn = 1 AND x.overlap_m > 0;

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
    END IF;

    v_result := core.find_admin_area_for_point(v_point, target_admin_level_code);
    IF v_result IS NOT NULL THEN
        RETURN v_result;
    END IF;

    BEGIN
        SELECT aa.id
        INTO v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_matches_assignment_target(
              aa.admin_level_id, al.code, al.name, target_admin_level_code
          )
          AND st_intersects(aa.geom, v_geom)
        ORDER BY
            st_area(st_intersection(aa.geom, v_geom)::geography) DESC NULLS LAST,
            st_area(aa.geom::geography) ASC NULLS LAST,
            aa.id ASC
        LIMIT 1;
    EXCEPTION
        WHEN OTHERS THEN
            v_result := NULL;
    END;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_polygon(geometry, text) IS
    'Polygon township: unique operational POS cover, else dominant area with margin; ambiguous → NULL.';

-- Validation helper: ST_Covers; township-level ids must be operational.
CREATE OR REPLACE FUNCTION core.is_admin_area_id_valid_for_point(
    p_admin_area_id bigint,
    p_point geometry
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_admin_area_id IS NULL THEN false
        WHEN p_point IS NULL OR st_isempty(p_point) THEN false
        ELSE EXISTS (
            SELECT 1
            FROM core.core_admin_areas AS aa
            INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
            WHERE aa.id = p_admin_area_id
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND aa.geom IS NOT NULL
              AND NOT st_isempty(aa.geom)
              AND st_isvalid(aa.geom)
              AND st_covers(aa.geom, p_point)
              AND (
                  lower(btrim(al.code)) <> 'township'
                  OR core.admin_area_is_operational_township(aa.id, al.code)
              )
        )
    END;
$$;

COMMENT ON FUNCTION core.is_admin_area_id_valid_for_point(bigint, geometry) IS
    'True when id is active, covers the point (ST_Covers), and if township-level then operational.';

-- Keep line wrapper; inherits pick + point fallback with new township rules.
CREATE OR REPLACE FUNCTION core.find_admin_area_for_line(
    p_geom geometry,
    target_admin_level_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_geom geometry;
    v_result bigint;
    v_target text := lower(btrim(coalesce(target_admin_level_code, '')));
BEGIN
    v_geom := core.normalize_admin_lookup_geom(p_geom);
    IF v_geom IS NULL OR st_isempty(v_geom) OR NOT st_isvalid(v_geom) THEN
        RETURN NULL;
    END IF;

    IF st_dimension(v_geom) <> 1
       AND st_geometrytype(v_geom) NOT IN ('ST_LineString', 'ST_MultiLineString') THEN
        RETURN core.find_admin_area_for_point(v_geom, target_admin_level_code);
    END IF;

    v_result := core.pick_admin_area_for_line_overlap(v_geom, target_admin_level_code);
    IF v_result IS NOT NULL THEN
        RETURN v_result;
    END IF;

    IF v_target = 'township' THEN
        RETURN core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_geom),
            target_admin_level_code
        );
    END IF;

    IF nullif(v_target, '') IS NOT NULL THEN
        RETURN core.find_admin_area_for_point(
            core.entity_rep_point_for_admin_lookup(v_geom),
            target_admin_level_code
        );
    END IF;

    RETURN core.find_admin_area_for_point(
        core.entity_rep_point_for_admin_lookup(v_geom),
        NULL
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.find_admin_area_for_line(geometry, text) IS
    'Line township assignment via dominant length overlap on operational townships; weak/ambiguous → NULL.';

-- Align classifier counts with operational predicate.
CREATE OR REPLACE FUNCTION core.classify_township_assignment_for_point(p_geom geometry)
RETURNS TABLE (
    status text,
    admin_area_id bigint,
    admin_level_code text,
    township_match_count integer,
    district_id bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_point geometry(Point, 4326);
    v_tw_id bigint;
    v_tw_code text;
    v_tw_count integer;
    v_district_id bigint;
BEGIN
    v_point := core.entity_rep_point_for_admin_lookup(p_geom);
    IF v_point IS NULL THEN
        status := 'assignment_failure';
        admin_area_id := NULL;
        admin_level_code := NULL;
        township_match_count := 0;
        district_id := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT count(*)::integer
    INTO v_tw_count
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.is_active AND aa.deleted_at IS NULL AND aa.geom IS NOT NULL
      AND st_isvalid(aa.geom)
      AND core.admin_area_is_operational_township(aa.id, al.code)
      AND st_covers(aa.geom, v_point);

    v_tw_id := core.find_admin_area_for_point(v_point, 'township');

    IF v_tw_id IS NOT NULL THEN
        SELECT al.code INTO v_tw_code
        FROM core.core_admin_areas aa
        JOIN ref.ref_admin_levels al ON al.id = aa.admin_level_id
        WHERE aa.id = v_tw_id;
        status := 'valid_township';
        admin_area_id := v_tw_id;
        admin_level_code := v_tw_code;
        township_match_count := v_tw_count;
        district_id := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT aa.id INTO v_district_id
    FROM core.core_admin_areas AS aa
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE aa.is_active AND aa.deleted_at IS NULL AND aa.geom IS NOT NULL
      AND al.code = 'district'
      AND st_covers(aa.geom, v_point)
    ORDER BY st_area(aa.geom::geography) ASC, aa.id
    LIMIT 1;

    IF coalesce(v_tw_count, 0) > 1 THEN
        status := 'ambiguous_township';
    ELSIF v_district_id IS NOT NULL THEN
        status := 'district_only';
    ELSIF coalesce(v_tw_count, 0) = 0 THEN
        status := 'outside_township';
    ELSE
        status := 'assignment_failure';
    END IF;

    admin_area_id := NULL;
    admin_level_code := NULL;
    township_match_count := coalesce(v_tw_count, 0);
    district_id := v_district_id;
    RETURN NEXT;
EXCEPTION
    WHEN OTHERS THEN
        status := 'assignment_failure';
        admin_area_id := NULL;
        admin_level_code := NULL;
        township_match_count := 0;
        district_id := NULL;
        RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION core.classify_township_assignment_for_point(geometry) IS
    'Report helper using operational township predicate: valid_township | ambiguous_township | district_only | outside_township | assignment_failure.';
