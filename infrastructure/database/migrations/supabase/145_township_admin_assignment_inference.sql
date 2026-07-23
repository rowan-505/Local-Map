-- Migration 145: conflict-aware township admin assignment inference
-- Mechanical rules only. Does not edit admin polygons or admin_level_id.
-- Ambiguous / weak matches return NULL (never force).
-- Local Yangon note: urban townships may be labeled ward_village_tract locally;
-- inference accepts non-fine ward_village_tract as township-like when targeting township.

-- =============================================================================
-- Township / admin assignment inference (mechanical rules only)
--
-- Does NOT edit admin polygons or admin_level_id rows.
-- Ambiguous / weak matches return NULL (conflict / unresolved) — never force.
-- =============================================================================

CREATE OR REPLACE FUNCTION core.normalize_admin_lookup_geom(p_geom geometry)
RETURNS geometry
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_geom IS NULL OR st_isempty(p_geom) THEN
        RETURN NULL;
    END IF;
    RETURN st_makevalid(st_setsrid(p_geom, 4326));
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.entity_rep_point_for_admin_lookup(p_geom geometry)
RETURNS geometry(Point, 4326)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_geom IS NULL OR st_isempty(p_geom) THEN NULL::geometry(Point, 4326)
        WHEN st_geometrytype(p_geom) IN ('ST_Point', 'ST_MultiPoint')
            THEN st_setsrid(st_pointonsurface(p_geom), 4326)::geometry(Point, 4326)
        ELSE st_setsrid(st_pointonsurface(st_makevalid(st_setsrid(p_geom, 4326))), 4326)::geometry(Point, 4326)
    END;
$$;

-- Keep ref-level matching for township = township/town codes only.
-- Township-like ward_village_tract drift is handled in find_* via
-- core.admin_area_qualifies_as_township_target(level_code, canonical_name).
CREATE OR REPLACE FUNCTION core.admin_level_matches_target(
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN false
        ELSE lower(btrim(p_target_admin_level_code)) IN (
            lower(btrim(coalesce(p_level_code, ''))),
            lower(btrim(coalesce(p_level_name, '')))
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('township', 'town')
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('township', 'town')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) = 'village'
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('village', 'hamlet', 'village_tract')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('state', 'state_region', 'region')
            AND lower(btrim(coalesce(p_level_code, ''))) IN (
                'state', 'state_region', 'region', 'division'
            )
        )
    END;
$$;

CREATE OR REPLACE FUNCTION core.admin_area_matches_assignment_target(
    p_admin_level_id bigint,
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN true
        ELSE core.admin_level_matches_target(
            p_level_code,
            p_level_name,
            p_target_admin_level_code
        )
        OR EXISTS (
            SELECT 1
            FROM ref.ref_admin_levels AS tl
            WHERE tl.id = p_admin_level_id
              AND (
                  lower(btrim(tl.code)) = lower(btrim(p_target_admin_level_code))
                  OR lower(btrim(tl.name)) = lower(btrim(p_target_admin_level_code))
              )
        )
    END;
$$;

CREATE OR REPLACE FUNCTION core.admin_area_name_looks_like_fine_ward(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(p_name, '') ~ 'ရပ်ကွက်'
        OR coalesce(p_name, '') ~ 'အမှတ်'
        OR lower(coalesce(p_name, '')) ~ '(^|[^a-z])ward([^a-z]|$)';
$$;

COMMENT ON FUNCTION core.admin_area_name_looks_like_fine_ward(text) IS
    'True for numbered/fine ward names; excludes township-scale units mislabeled as ward_village_tract.';

-- True township/town, or township-scale ward_village_tract (local level-code drift vs production).
CREATE OR REPLACE FUNCTION core.admin_area_qualifies_as_township_target(
    p_level_code text,
    p_canonical_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN lower(btrim(coalesce(p_level_code, ''))) IN ('township', 'town') THEN true
        WHEN lower(btrim(coalesce(p_level_code, ''))) = 'ward_village_tract'
             AND NOT core.admin_area_name_looks_like_fine_ward(p_canonical_name)
            THEN true
        ELSE false
    END;
$$;

COMMENT ON FUNCTION core.admin_area_qualifies_as_township_target(text, text) IS
    'Township assignment target: official township/town, or non-fine ward_village_tract (Yangon local drift).';

CREATE OR REPLACE FUNCTION core.admin_area_township_match_priority(
    p_level_code text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE lower(btrim(coalesce(p_level_code, '')))
        WHEN 'township' THEN 1
        WHEN 'town' THEN 2
        WHEN 'ward_village_tract' THEN 3
        ELSE 99
    END;
$$;

-- Keep ref-level matching for township = township/town codes only.
-- Township-like ward_village_tract drift is handled in find_* via
-- core.admin_area_qualifies_as_township_target(level_code, canonical_name).
CREATE OR REPLACE FUNCTION core.admin_level_matches_target(
    p_level_code text,
    p_level_name text,
    p_target_admin_level_code text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN nullif(btrim(coalesce(p_target_admin_level_code, '')), '') IS NULL THEN false
        ELSE lower(btrim(p_target_admin_level_code)) IN (
            lower(btrim(coalesce(p_level_code, ''))),
            lower(btrim(coalesce(p_level_name, '')))
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('township', 'town')
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('township', 'town')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) = 'village'
            AND lower(btrim(coalesce(p_level_code, ''))) IN ('village', 'hamlet', 'village_tract')
        )
        OR (
            lower(btrim(p_target_admin_level_code)) IN ('state', 'state_region', 'region')
            AND lower(btrim(coalesce(p_level_code, ''))) IN (
                'state', 'state_region', 'region', 'division'
            )
        )
    END;
$$;

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
    v_priority integer;
BEGIN
    v_point := core.entity_rep_point_for_admin_lookup(p_geom);
    IF v_point IS NULL OR st_isempty(v_point) OR NOT st_isvalid(v_point) THEN
        RETURN NULL;
    END IF;

    -- Township target: conflict-aware; never silent LIMIT 1; never district fallback.
    IF v_target IN ('township', 'town') THEN
        SELECT min(core.admin_area_township_match_priority(al.code))
        INTO v_priority
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_qualifies_as_township_target(al.code, aa.canonical_name)
          AND st_covers(aa.geom, v_point);

        IF v_priority IS NULL THEN
            RETURN NULL;
        END IF;

        SELECT count(*)::integer, min(aa.id)
        INTO v_match_count, v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_qualifies_as_township_target(al.code, aa.canonical_name)
          AND core.admin_area_township_match_priority(al.code) = v_priority
          AND st_covers(aa.geom, v_point);

        IF coalesce(v_match_count, 0) = 1 THEN
            RETURN v_result;
        END IF;
        -- 0 or >1 → unresolved / ambiguous
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
    'Containing admin via ST_Covers. Township target: unique match only (true township preferred over township-like ward_village_tract); ambiguous/outside → NULL; never district fallback.';

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

    IF v_target IN ('township', 'town') THEN
        SELECT
            x.id,
            x.overlap_m,
            x.second_m
        INTO v_best_id, v_best_m, v_second_m
        FROM (
            SELECT
                c.id,
                st_length(st_intersection(c.geom, v_line)::geography) AS overlap_m,
                lead(st_length(st_intersection(c.geom, v_line)::geography)) OVER (
                    ORDER BY st_length(st_intersection(c.geom, v_line)::geography) DESC NULLS LAST,
                             core.admin_area_township_match_priority(al.code) ASC,
                             st_area(c.geom::geography) ASC NULLS LAST,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY st_length(st_intersection(c.geom, v_line)::geography) DESC NULLS LAST,
                             core.admin_area_township_match_priority(al.code) ASC,
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
              AND core.admin_area_qualifies_as_township_target(al.code, c.canonical_name)
              AND st_intersects(c.geom, v_line)
        ) AS x
        WHERE x.rn = 1
          AND x.overlap_m > 0;

        IF v_best_id IS NULL OR v_best_m IS NULL OR v_best_m <= 0 THEN
            RETURN NULL;
        END IF;

        v_share := v_best_m / v_line_len;
        -- Weak or close overlaps → conflict (do not force).
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
    'Largest line overlap. Township target refuses weak (<55% length) or close (best/second < 1.25) matches.';

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

    -- Township target: optional midpoint fallback only (still township rules; no district).
    IF v_target IN ('township', 'town') THEN
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

    -- Untargeted legacy path: ward instability → township → district → state_region
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
    'Line township assignment via dominant length overlap; ambiguous/weak → NULL.';

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

    IF v_target IN ('township', 'town') THEN
        -- Normal polygon: unique township cover at point-on-surface.
        SELECT count(*)::integer, min(aa.id)
        INTO v_pos_count, v_result
        FROM core.core_admin_areas AS aa
        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
        WHERE aa.is_active IS TRUE
          AND aa.deleted_at IS NULL
          AND aa.geom IS NOT NULL
          AND NOT st_isempty(aa.geom)
          AND st_isvalid(aa.geom)
          AND core.admin_area_qualifies_as_township_target(al.code, aa.canonical_name)
          AND st_covers(aa.geom, v_point);

        IF coalesce(v_pos_count, 0) = 1 THEN
            RETURN v_result;
        END IF;
        IF coalesce(v_pos_count, 0) > 1 THEN
            RETURN NULL; -- ambiguous at POS
        END IF;

        -- Large cross-boundary: dominant area overlap with clear margin.
        v_poly_area := st_area(v_geom::geography);
        IF v_poly_area IS NULL OR v_poly_area < 50000 THEN
            RETURN NULL; -- small / unresolved; do not force
        END IF;

        SELECT x.id, x.overlap_m, x.second_m
        INTO v_best_id, v_best_m, v_second_m
        FROM (
            SELECT
                c.id,
                st_area(st_intersection(c.geom, v_geom)::geography) AS overlap_m,
                lead(st_area(st_intersection(c.geom, v_geom)::geography)) OVER (
                    ORDER BY st_area(st_intersection(c.geom, v_geom)::geography) DESC NULLS LAST,
                             core.admin_area_township_match_priority(al.code) ASC,
                             c.id ASC
                ) AS second_m,
                row_number() OVER (
                    ORDER BY st_area(st_intersection(c.geom, v_geom)::geography) DESC NULLS LAST,
                             core.admin_area_township_match_priority(al.code) ASC,
                             c.id ASC
                ) AS rn
            FROM core.core_admin_areas AS c
            INNER JOIN ref.ref_admin_levels AS al ON al.id = c.admin_level_id
            WHERE c.is_active IS TRUE
              AND c.deleted_at IS NULL
              AND c.geom IS NOT NULL
              AND NOT st_isempty(c.geom)
              AND st_isvalid(c.geom)
              AND core.admin_area_qualifies_as_township_target(al.code, c.canonical_name)
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

    -- Non-township target: POS then largest intersection (legacy).
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
    'Polygon township: unique POS cover, else dominant area for large cross-boundary; ambiguous → NULL.';

-- Diagnostic classifier used by Yangon admin-assignment report.
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
      AND core.admin_area_qualifies_as_township_target(al.code, aa.canonical_name)
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
    'Report helper: valid_township | ambiguous_township | district_only | outside_township | assignment_failure.';
